import {canonical,type ReviewArtifact} from './news-owner-review';
import {sha256} from './utils/text';
export type MaintenanceLink={artifact:ReviewArtifact;candidate_raw:string;request:any;event:any};
export type MaintenanceSuccessor={candidate_raw:string;request:any;event:any;parents?:MaintenanceLink[]};
/** Pure check only: the caller must first validate the original owner/anchor chain. */
export async function validMaintenanceChain(input:{parentValid:boolean;base:ReviewArtifact;recordedAt:number;fields:Record<string,unknown>;owner:string;chat:string;now:number;links:MaintenanceLink[]}){
 if(!input.parentValid||!input.owner||!input.chat||!input.links.length||input.links.length>32)return false;
 let previous=input.base.hash,approvedAt=input.recordedAt;
 const seen=new Set([previous]),nonces=new Set<string>();
 try{for(const {artifact,candidate_raw,request:q,event:e} of input.links){
  const c=JSON.parse(candidate_raw),digest=await sha256(candidate_raw);
  if(!artifact||artifact.catalog_hash!==input.base.catalog_hash||await sha256(canonical({files:artifact.files,catalog_hash:artifact.catalog_hash}))!==artifact.hash||seen.has(artifact.hash))return false;
  if(c?.state!=='pending'||c.hash!==artifact.hash||c.previous_artifact_hash!==previous||!Object.entries(input.fields).every(([key,value])=>c[key]===value))return false;
  if(!Number.isSafeInteger(c.created_at)||c.created_at<approvedAt||!Number.isSafeInteger(c.expires_at)||c.created_at>e?.approved_at||e?.approved_at>=c.expires_at)return false;
  if(q?.state!=='approved'||q.owner!==input.owner||q.chat!==input.chat||e?.owner!==q.owner||e?.chat!==q.chat||e?.message!==q.message||e?.nonce!==q.nonce||typeof q.nonce!=='string'||!q.nonce||nonces.has(q.nonce))return false;
  if(q.artifact!==artifact.hash||e.artifact!==artifact.hash||q.candidate_digest!==digest||e.candidate_digest!==digest||!Number.isSafeInteger(q.message)||q.message<=0)return false;
  if(!Number.isSafeInteger(q.expires_at)||!Number.isSafeInteger(e.approved_at)||e.approved_at<=0||e.approved_at>=q.expires_at||e.approved_at>input.now)return false;
  previous=artifact.hash;approvedAt=e.approved_at;seen.add(previous);nonces.add(q.nonce);
 }
 return true;
 }catch{return false;}
}
