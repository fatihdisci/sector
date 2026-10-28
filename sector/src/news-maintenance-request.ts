/** Immutable binding for an owner-reviewed maintenance artifact. */
export type MaintenanceRequest={nonce:string;owner:string;chat:string;message:number;artifact:string;expires_at:number;state:'pending'|'approved'};
export function maintenanceRequestDecision(request:MaintenanceRequest|null, callback:{owner:string;chat:string;message:number;nonce:string}, currentArtifact:string, now:number):'approve'|'already_approved'|'reject'{
 if(!request||!callback.owner||!callback.chat||!Number.isSafeInteger(callback.message)||callback.message<=0||
    !/^[a-f0-9]{64}$/.test(request.artifact)||request.artifact!==currentArtifact||
    request.nonce!==callback.nonce||request.owner!==callback.owner||request.chat!==callback.chat||request.message!==callback.message||
    !Number.isSafeInteger(request.expires_at)||now>=request.expires_at)return 'reject';
 return request.state==='pending'?'approve':request.state==='approved'?'already_approved':'reject';
}

import type {Env} from './types';
import {sha256} from './utils/text';
import {canonical,type ReviewArtifact} from './news-owner-review';
import {validateMaintenanceReview} from './news-maintenance-review';
import {loadMaintenanceSuccessor,maintenanceCandidate,MAINTENANCE_CANDIDATE_KEYS} from './news-maintenance-store';
const candidateKey='news_maintenance_candidate';
/** Stage only; never creates an approval or changes readiness. */
export async function stageMaintenanceCandidate(env:Env,raw:string,artifact:ReviewArtifact,now=Date.now()):Promise<'staged'|'already_staged'>{
 let c:any;try{c=JSON.parse(raw);}catch{throw Error('candidate_invalid');}
 if(c?.state!=='pending'||!env.TELEGRAM_USER_ID||c.hash!==artifact.hash||await sha256(canonical({files:artifact.files,catalog_hash:artifact.catalog_hash}))!==artifact.hash||!Number.isSafeInteger(c.created_at)||c.created_at>now||!Number.isSafeInteger(c.expires_at)||c.expires_at<=now)throw Error('candidate_invalid');
 const keys=['news_maintenance_transition','news_owner_review_binding','news_schedule_transition','runtime_identity',...MAINTENANCE_CANDIDATE_KEYS];
 const rows=await Promise.all(keys.map(k=>env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(k).first<{value:string}>()));
 const values=rows.map(r=>r?.value??'null');let record:any,binding:any,schedule:any,runtime:any;try{[record,binding,schedule,runtime]=values.map(v=>JSON.parse(v));}catch{throw Error('candidate_parent_invalid');}
 const old=runtime?.news_review_artifact??null;
 if(!old||old.hash!==c.previous_artifact_hash||c.parent_state_hash!==record?.parent_state_hash)throw Error('candidate_parent_invalid');
 const successor=await loadMaintenanceSuccessor(env,old);
 const prior=await validateMaintenanceReview({record,artifact:old,binding,schedule,owner:env.TELEGRAM_USER_ID,ownerChat:env.TELEGRAM_CHAT_ID??'',rule:c.rule,catalog:c.catalog,scope:c.scope,activated_at:c.activated_at,schedule_since:c.schedule_since,now,successor});
 if(!prior.valid||artifact.catalog_hash!==old.catalog_hash)throw Error('candidate_parent_invalid');
 const existing=await maintenanceCandidate(env);
 if(existing?.raw===raw)return 'already_staged';
 if(c.hash===old.hash||await env.DB.prepare('SELECT 1 FROM system_state WHERE key=?').bind('news_maintenance_history:'+c.hash).first())throw Error('candidate_replay');
 if(existing){
  if(existing.hash!==old.hash||!successor)throw Error('candidate_already_exists');
  const historyKey='news_maintenance_history:'+old.hash,history=JSON.stringify({artifact:old,candidate_raw:successor.candidate_raw});
  const saved=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(historyKey).first<{value:string}>();
  if(saved&&saved.value!==history)throw Error('candidate_history_conflict');
  const guard=keys.map(()=>"COALESCE((SELECT value FROM system_state WHERE key=?),'null')=?").join(' AND '),bindings=keys.flatMap((k,i)=>[k,values[i]]);
  // Preserve the first pointer for old release rollback; archive no approval copies.
  const result=await env.DB.batch([
   env.DB.prepare(`INSERT OR IGNORE INTO system_state(key,value) SELECT ?,? WHERE ${guard}`).bind(historyKey,history,...bindings),
   env.DB.prepare(`INSERT INTO system_state(key,value) SELECT ?,? WHERE ${guard} AND EXISTS(SELECT 1 FROM system_state WHERE key=? AND value=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(MAINTENANCE_CANDIDATE_KEYS[0],raw,...bindings,historyKey,history)
  ]);
  if(!result[1].meta.changes)throw Error('candidate_parent_changed');return 'staged';
 }
 const claim=await env.DB.prepare(`INSERT OR IGNORE INTO system_state(key,value) SELECT ?,? WHERE ${keys.map(()=>"COALESCE((SELECT value FROM system_state WHERE key=?),'null')=?").join(' AND ')}`).bind(candidateKey,raw,...keys.flatMap((k,i)=>[k,values[i]])).run();
 if(!claim.meta.changes)throw Error('candidate_parent_changed');return 'staged';
}
async function candidate(env:Env){
 return maintenanceCandidate(env);
}
export async function maintenanceApproved(env:Env,artifact:string,now=Date.now()):Promise<boolean>{
 const c=await candidate(env);if(!c||c.hash!==artifact||!env.TELEGRAM_USER_ID||!env.TELEGRAM_CHAT_ID)return false;
 const digest=await sha256(c.raw),row=await env.DB.prepare("SELECT value FROM system_state WHERE key LIKE 'news_maintenance_approval:%' AND json_valid(value) AND json_extract(value,'$.candidate_digest')=? LIMIT 1").bind(digest).first<{value:string}>();
 try{const event=JSON.parse(row?.value??'null');if(!event?.nonce)return false;const saved=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind('news_maintenance_request:'+event.nonce).first<{value:string}>();const request=JSON.parse(saved?.value??'null');return maintenanceRequestDecision(request,{owner:env.TELEGRAM_USER_ID,chat:env.TELEGRAM_CHAT_ID,message:event.message,nonce:event.nonce},artifact,now)==='already_approved'&&request.candidate_digest===digest&&event.candidate_digest===digest&&event.owner===request.owner&&event.chat===request.chat&&event.artifact===artifact&&Number.isSafeInteger(event.approved_at)&&event.approved_at>0&&event.approved_at<request.expires_at&&event.approved_at<=now;}catch{return false;}
}
export async function createMaintenanceRequest(env:Env,send:(text:string,extra:Record<string,string>)=>Promise<any>){
 const c=await candidate(env);if(!c||!env.TELEGRAM_USER_ID||!env.TELEGRAM_CHAT_ID||!Number.isSafeInteger(env.TELEGRAM_UPDATE_ID))return;
 const nonce=crypto.randomUUID(),key='news_maintenance_request:'+nonce,marker='news_maintenance_update:'+env.TELEGRAM_UPDATE_ID;
 const candidate_digest=await sha256(c.raw);
 const initial=JSON.stringify({nonce,owner:env.TELEGRAM_USER_ID,chat:env.TELEGRAM_CHAT_ID,message:0,artifact:c.hash,candidate_digest,expires_at:Date.now()+900000,state:'sending'});
 const claims=await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) VALUES(?,?)').bind(marker,nonce),
  env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM system_state WHERE key=? AND value=?)').bind(key,initial,marker,nonce)
 ]);if(!claims[1].meta.changes)return;
 const sent=await send(`Bakım adayı: ${c.hash}\nBu onay yalnız bu sürüm içindir; diğer hazırlık kontrolleri geçerli kalır.`,{reply_markup:JSON.stringify({inline_keyboard:[[{text:'Bu bakım sürümünü onayla',callback_data:'nm:approve:'+nonce}]]})});
 const message=Number(sent?.message_id);if(!Number.isSafeInteger(message)||message<=0)return;
 const bound=JSON.stringify({nonce,owner:env.TELEGRAM_USER_ID,chat:env.TELEGRAM_CHAT_ID,message,artifact:c.hash,candidate_digest,expires_at:JSON.parse(initial).expires_at,state:'pending'});
 await env.DB.prepare('UPDATE system_state SET value=? WHERE key=? AND value=?').bind(bound,key,initial).run();
}
export async function approveMaintenanceRequest(env:Env,nonce:string,owner:string,chat:string,message:number,now=Date.now()):Promise<string>{
 const key='news_maintenance_request:'+nonce,c=await candidate(env);if(!c)return 'Bu bakım adayı artık geçerli değil.';
 const row=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{value:string}>();let request:MaintenanceRequest|null=null;try{request=JSON.parse(row?.value??'null');}catch{}
 const decision=maintenanceRequestDecision(request,{owner,chat,message,nonce},c.hash,now);
 if(decision==='reject'||!request||!row||(request as MaintenanceRequest&{candidate_digest?:string}).candidate_digest!==await sha256(c.raw))return 'Bu düğme geçersiz veya süresi dolmuş.';
 if(decision==='already_approved')return 'Bu bakım onayı zaten kaydedildi.';
 const approved=JSON.stringify({...request,state:'approved'}),event=JSON.stringify({nonce,owner,chat,message,artifact:c.hash,candidate_digest:await sha256(c.raw),approved_at:now});
 const result=await env.DB.batch([
  env.DB.prepare('UPDATE system_state SET value=? WHERE key=? AND value=? AND EXISTS(SELECT 1 FROM system_state WHERE key=? AND value=?)').bind(approved,key,row.value,c.key,c.raw),
  env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM system_state WHERE key=? AND value=?) AND EXISTS(SELECT 1 FROM system_state WHERE key=? AND value=?)').bind('news_maintenance_approval:'+nonce,event,key,approved,c.key,c.raw)
 ]);
 return result[0].meta.changes?'Bakım onayı kaydedildi.':'Bu bakım adayı değişti.';
}
