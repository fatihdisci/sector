import type {Env} from './types';import type {ReviewArtifact} from './news-owner-review';
import {canonical} from './news-owner-review';import {sha256} from './utils/text';
import type {MaintenanceLink,MaintenanceSuccessor} from './news-maintenance-chain';
export const MAINTENANCE_CANDIDATE_KEYS=['news_maintenance_staged_candidate','news_maintenance_candidate'] as const;
export async function maintenanceCandidate(env:Env){
 for(const key of MAINTENANCE_CANDIDATE_KEYS){const row=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{value:string}>();
  if(!row)continue;try{const c=JSON.parse(row.value);return c?.state==='pending'&&/^[a-f0-9]{64}$/.test(c.hash)?{key,raw:row.value,hash:c.hash as string}:null;}catch{return null;}
 }return null;
}
export async function maintenanceCandidateForRuntime(env:Env,hash:string,deadline:number){
 const candidate=await maintenanceCandidate(env);if(!candidate||candidate.hash!==hash)return false;
 try{const c=JSON.parse(candidate.raw);return Number.isSafeInteger(c.expires_at)&&c.expires_at>deadline;}catch{return false;}
}
/** Read immutable artifact/candidate history; approvals stay in their original records. */
export async function loadMaintenanceSuccessor(env:Env,artifact:ReviewArtifact):Promise<MaintenanceSuccessor|null>{
 const read=async(key:string)=>{const row=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{value:string}>();return row?.value??null;};
 const candidates=await Promise.all(MAINTENANCE_CANDIDATE_KEYS.map(read));
 const links:MaintenanceLink[]=[];let current=artifact;const seen=new Set<string>();
 try{for(let depth=0;depth<32;depth++){
  if(seen.has(current.hash))return null;seen.add(current.hash);
  let raw:string|null=null;
  const history=await read('news_maintenance_history:'+current.hash);
  if(history){const h=JSON.parse(history);if(canonical(h.artifact)!==canonical(current))return null;raw=h.candidate_raw;}
  else for(const candidate of candidates)if(candidate&&JSON.parse(candidate).hash===current.hash){raw=candidate;break;}
  if(!raw)break;
  const c=JSON.parse(raw),digest=await sha256(raw);
  const row=await env.DB.prepare("SELECT value FROM system_state WHERE key LIKE 'news_maintenance_approval:%' AND json_valid(value) AND json_extract(value,'$.candidate_digest')=? LIMIT 1").bind(digest).first<{value:string}>();
  const event=JSON.parse(row?.value??'null');if(!event?.nonce)return null;
  const request=JSON.parse(await read('news_maintenance_request:'+event.nonce)??'null');
  links.unshift({artifact:current,candidate_raw:raw,request,event});
  const parent=await read('news_maintenance_history:'+c.previous_artifact_hash);
  if(!parent)break;current=JSON.parse(parent).artifact;
 }
 if(!links.length)return null;const last=links.pop()!;return{candidate_raw:last.candidate_raw,request:last.request,event:last.event,parents:links};
 }catch{return null;}
}
