/** Close a rolled-back maintenance candidate without changing its approval. */
import {DatabaseSync} from 'node:sqlite';
import {open,readFile,realpath,access,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {newsReviewArtifact} from './news_review_artifact';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export function validateFailedClosure(i:any){
 const {candidate,active,history,request,event,receipt,failedRelease,failedArtifact,ready,lockPid,actor,now,pending}=i;
 if(!candidate||candidate.state!=='pending'||candidate.hash!==failedArtifact||candidate.hash===active?.news_review_artifact?.hash||candidate.previous_artifact_hash!==active?.news_review_artifact?.hash)throw Error('closure_candidate_mismatch');
 if(!receipt||receipt.state!=='rolled_back'||receipt.release!==failedRelease||!Array.isArray(receipt.paths)||!receipt.paths.some((p:any)=>p.live===i.liveApp&&p.existed===true))throw Error('closure_rollback_unverified');
 if(i.failedActive||i.activePath!==join(i.root,'releases',active.release,'app')||i.activeArtifact!==active.news_review_artifact.hash||!Number.isSafeInteger(lockPid)||lockPid<=1||!ready||ready.pid!==lockPid||ready.release!==active.release||ready.news_filter?.requested!=='active'||ready.news_filter?.mode!=='active'||!i.processAlive)throw Error('closure_runtime_unverified');
 if(!history||history.artifact?.hash!==active.news_review_artifact.hash||JSON.parse(history.candidate_raw).hash!==active.news_review_artifact.hash)throw Error('closure_history_unverified');
 if(!request||!event||request.state!=='approved'||request.artifact!==candidate.hash||event.artifact!==candidate.hash||request.owner!==actor||event.owner!==actor||!request.chat||request.chat!==event.chat||request.nonce!==event.nonce||request.message!==event.message||request.candidate_digest!==i.digest||event.candidate_digest!==i.digest||!Number.isSafeInteger(event.approved_at)||event.approved_at>=request.expires_at||event.approved_at>now)throw Error('closure_approval_unverified');
 if(pending)throw Error('closure_request_pending');
}
export async function closeFailedMaintenance(root:string,releaseId:string){
 if(!/^[a-f0-9]{32}$/.test(releaseId))throw Error('closure_release_invalid');root=await realpath(resolve(root));
 const lockPath=join(root,'.install.lock'),lock=await open(lockPath,'wx',0o600);let db:DatabaseSync|undefined;
 try{
  const failedRelease=join(root,'releases',releaseId),liveApp=join(root,'app'),receiptRaw=await readFile(join(root,'backups','update-'+releaseId,'rollback.json'),'utf8'),receipt=JSON.parse(receiptRaw);
  const failedArtifact=(await newsReviewArtifact(join(failedRelease,'app'))).hash,ready=JSON.parse(await readFile(join(root,'service-ready.json'),'utf8')),lockPid=Number(await readFile(join(root,'service.lock'),'utf8'));let processAlive=false;if(Number.isSafeInteger(lockPid)&&lockPid>1)try{process.kill(lockPid,0);processAlive=true;}catch{}
  let failedActive=true;try{await access(join(failedRelease,'active'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')failedActive=false;else throw e;}
  const activePath=await realpath(liveApp),activeArtifact=(await newsReviewArtifact(activePath)).hash;db=new DatabaseSync(join(root,'sector-haber.sqlite'));db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  const get=(key:string)=>{const row=db!.prepare('SELECT value FROM system_state WHERE key=?').get(key) as any;return row?.value as string|undefined;};
  const raw=get('news_maintenance_staged_candidate');if(!raw)throw Error('closure_candidate_missing');const candidate=JSON.parse(raw),digest=hash(raw),active=JSON.parse(get('runtime_identity')??'null'),transition=JSON.parse(get('news_maintenance_transition')??'null'),history=JSON.parse(get('news_maintenance_history:'+active?.news_review_artifact?.hash)??'null');
  const a=db.prepare("SELECT value FROM system_state WHERE key LIKE 'news_maintenance_approval:%' AND json_valid(value) AND json_extract(value,'$.candidate_digest')=?").all(digest) as any[];if(!a.length)throw Error('closure_approval_count');const events=a.map(x=>JSON.parse(x.value));
  const now=Date.now(),pending=!!db.prepare("SELECT 1 FROM system_state WHERE key LIKE 'news_maintenance_request:%' AND json_valid(value) AND json_extract(value,'$.candidate_digest')=? AND json_extract(value,'$.state') IN ('pending','sending') AND json_extract(value,'$.expires_at')>? LIMIT 1").get(digest,now);
  for(const event of events){const request=JSON.parse(get('news_maintenance_request:'+event.nonce)??'null');validateFailedClosure({candidate,active,history,request,event,receipt,failedRelease,failedArtifact,ready,lockPid,actor:transition?.actor,now,pending,liveApp,failedActive,activePath,activeArtifact,processAlive,digest,root});}
  const checks=["SELECT 1 FROM model_jobs WHERE state='leased' LIMIT 1","SELECT 1 FROM x_posts WHERE state IN ('uploading','posting') LIMIT 1","SELECT 1 FROM drafts WHERE delivery_state='sending' LIMIT 1","SELECT 1 FROM telegram_effects WHERE state='sending' LIMIT 1","SELECT 1 FROM kap_previews WHERE state='sending' LIMIT 1","SELECT 1 FROM news_digest_runs WHERE state='sending' LIMIT 1","SELECT 1 FROM news_digest_pages WHERE state='sending' LIMIT 1"];
  if(checks.some(q=>db!.prepare(q).get()))throw Error('closure_in_flight');
  const archive=JSON.stringify({state:'closed_failed',candidate_raw:raw,release:releaseId,rollback_sha256:hash(receiptRaw),approval_nonces:events.map(e=>e.nonce),closed_at:now});
  db.prepare('INSERT INTO system_state(key,value) VALUES(?,?)').run('news_maintenance_failed:'+candidate.hash,archive);
  const changed=db.prepare('UPDATE system_state SET value=? WHERE key=? AND value=?').run(history.candidate_raw,'news_maintenance_staged_candidate',raw);if(Number(changed.changes)!==1)throw Error('closure_candidate_changed');
  db.exec('COMMIT');return {closed:candidate.hash,active:active.news_review_artifact.hash};
 }catch(e){if(db?.isTransaction)db.exec('ROLLBACK');throw e;}finally{db?.close();await lock.close();await unlink(lockPath);}
}
