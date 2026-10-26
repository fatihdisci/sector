import {kapIndexMembership} from './kap/index-tags';
// KAP -> complete evidence -> shared audited model -> existing single-photo sender.
// No metadata-only messages. Collector and external delivery remain independent.
import {KapStore} from './kap/store';
import {decide} from './kap/rules';
import type {Disclosure,Indices} from './kap/parser';
import {focusedDisclosureTickers} from './kap/ticker-scope';
import {enqueueEvidence} from './ingest';
import {quota} from './pipeline';
import {retryKapModel} from './model-recovery';
import type {Document,Env} from './types';
export class KapDelivery {
 constructor(private store:KapStore,private env:Env,private load:(id:number)=>Promise<Document[]>,private clock=Date.now){
  store.db.exec(`CREATE TABLE IF NOT EXISTS kap_model_jobs(queue_id TEXT PRIMARY KEY REFERENCES queue(id),job_id TEXT,attempts INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT,message_id INTEGER);`);
 }
 reviewSummary(){return this.store.rows<{error:string;n:number}>("SELECT COALESCE(m.last_error,'unspecified_review') error,COUNT(*) n FROM queue q LEFT JOIN kap_model_jobs m ON m.queue_id=q.id WHERE q.state='needs_review' GROUP BY COALESCE(m.last_error,'unspecified_review')");}
 private allowed(d:Disclosure,kind='instant'){const scope=this.store.circuit(d,this.clock());if(kind==='circuit'&&scope)return this.store.prefs().circuitNotifications&&(scope.kind==='market'||scope.kind==='pay'&&scope.codes.length>0);return decide(d,this.store.prefs(),this.store.get<Indices>('indices')).action===(kind==='circuit'?'circuit':'instant');}
 private members(id:string){return this.store.rows<{metadata:string}>('SELECT d.metadata FROM queue_members m JOIN disclosures d ON d.id=m.disclosure_id WHERE m.queue_id=? ORDER BY d.id',id).map(r=>JSON.parse(r.metadata) as Disclosure);}
 private queueEligibility(id:string,kind:string):'allow'|'suppress'|'hold'{const members=this.members(id);if(!members.length)return'hold';if(kind==='circuit'&&this.store.circuitPolicy()){const review=members.map(d=>this.store.circuit(d,this.clock())).find(s=>s?.kind==='review');if(review){this.store.set('circuit_delivery_review',{at:this.clock(),id,reason:review.reason});return'hold';}return members.some(d=>this.allowed(d,kind))?'allow':'suppress';}return members.every(d=>this.allowed(d,kind))?'allow':'suppress';}
 private gate(id:string,kind:string){const result=this.queueEligibility(id,kind);if(result!=='allow')this.store.run("UPDATE queue SET state=? WHERE id=? AND sent_at IS NULL AND state!='uncertain'",result==='hold'?'needs_review':'suppressed',id);return result;}
 // Called synchronously immediately before the sender invokes Telegram. A
 // preference change during AI/rendering cannot rely on an old enqueue decision.
 deliveryDecision(documents:Document[]):'allow'|'suppress'|'hold'{
  const id=documents[0]?.source_id==='kap'?documents[0].url.match(/^https:\/\/www\.kap\.org\.tr\/tr\/Bildirim\/(\d+)$/)?.[1]:undefined;
  if(!id)return 'hold';
  return this.store.transaction(()=>{
   const row=this.store.row<{id:string;state:string;kind:string;metadata:string}>("SELECT q.id,q.state,q.kind,d.metadata FROM queue q JOIN queue_members m ON m.queue_id=q.id JOIN disclosures d ON d.id=m.disclosure_id WHERE d.id=?",Number(id));
   if(!row)return 'hold';
   if(row.state==='suppressed')return 'suppress';
   const eligible=this.gate(row.id,row.kind);if(eligible!=='allow')return eligible;
   return 'allow';
  });
 }
 async run():Promise<{state:string;id?:string}> {
  if(this.env.MODE!=='telegram_review')return {state:'disabled'};
  const s=this.store,now=this.clock();s.set('telegram_delivery',{enabled:true,heartbeatAt:now});
  // A completed AI job is not a delivery receipt. Wait for the photo sender.
  for(const pending of s.rows<{queue_id:string;job_id:string}>("SELECT m.queue_id,m.job_id FROM kap_model_jobs m JOIN queue q ON q.id=m.queue_id WHERE q.state IN ('model_queued','needs_review','suppressed')")){
   const job=await this.env.DB.prepare('SELECT state,error,result_draft FROM model_jobs WHERE id=?').bind(pending.job_id).first<{state:string;error:string|null;result_draft:string|null}>();
   const draft=job?.result_draft?await this.env.DB.prepare('SELECT state,delivery_state,delivered_at,message_id FROM drafts WHERE id=?').bind(job.result_draft).first<{state:string;delivery_state:string;delivered_at:number;message_id:number}>():null;
   if(draft?.delivery_state==='sent'){s.transaction(()=>{s.run("UPDATE queue SET state='sent',sent_at=? WHERE id=?",draft.delivered_at*1000,pending.queue_id);s.run('UPDATE kap_model_jobs SET message_id=?,last_error=NULL WHERE queue_id=?',draft.message_id,pending.queue_id);});}
   else if(job&&['queued','leased','retry_pending'].includes(job.state))s.run("UPDATE queue SET state='model_queued' WHERE id=? AND state!='suppressed'",pending.queue_id);
   else if(job?.state==='needs_review'||job?.state==='expired'||draft?.state==='needs_review'||draft?.delivery_state==='uncertain'){s.run("UPDATE queue SET state='needs_review' WHERE id=? AND state!='suppressed'",pending.queue_id);s.run('UPDATE kap_model_jobs SET last_error=? WHERE queue_id=?',job?.error??'draft_review_required',pending.queue_id);}
  }
  const waiting=await this.env.DB.prepare("SELECT COUNT(*) AS n FROM model_jobs WHERE state IN ('queued','leased','retry_pending') AND kind='kap'").first<{n:number}>();
  const total=await this.env.DB.prepare("SELECT COUNT(*) AS n FROM model_jobs WHERE state IN ('queued','leased','retry_pending')").first<{n:number}>();
  if((waiting?.n??0)>=2||(total?.n??0)>=4)return {state:'model_busy'};
  const row=s.transaction(()=>{
   s.run("UPDATE queue SET state='ready' WHERE state='preparing' AND id IN (SELECT queue_id FROM kap_model_jobs WHERE lease_until<?)",now);
   for(let i=0;i<100;i++){
    const r=s.row<{id:string;metadata:string;kind:string}>(`SELECT q.id,q.kind,d.metadata FROM queue q JOIN queue_members m ON m.queue_id=q.id JOIN disclosures d ON d.id=m.disclosure_id WHERE q.kind IN ('instant','circuit') AND q.state='ready' AND q.available_at<=? AND d.silent=0 ORDER BY (julianday(d.published_at)*1440+CASE json_extract(d.decision,'$.indexTier') WHEN 30 THEN 8 WHEN 100 THEN 4 ELSE 0 END) DESC,q.id LIMIT 1`,now);
    if(!r)return null;const d=JSON.parse(r.metadata) as Disclosure;
    if(this.gate(r.id,r.kind)!=='allow')continue;
    s.run("UPDATE queue SET state='preparing' WHERE id=?",r.id);
    s.run('INSERT INTO kap_model_jobs(queue_id,attempts,lease_until) VALUES(?,1,?) ON CONFLICT(queue_id) DO UPDATE SET attempts=attempts+1,lease_until=excluded.lease_until',r.id,now+300_000);
    return {...r,disclosure:d};
   }return null;
  });
  if(!row){
   // Fresh notifications above always win. Retry only source-complete model
   // failures, never a completed draft or an ambiguous Telegram delivery.
   for(const r of s.rows<{id:string;metadata:string;job_id:string;kind:string}>("SELECT q.id,q.kind,d.metadata,m.job_id FROM queue q JOIN queue_members qm ON qm.queue_id=q.id JOIN disclosures d ON d.id=qm.disclosure_id JOIN kap_model_jobs m ON m.queue_id=q.id WHERE q.state='needs_review' AND d.silent=0 ORDER BY d.published_at DESC")){
    if(this.gate(r.id,r.kind)!=='allow')continue;
    if(await retryKapModel(this.env,r.job_id,Math.floor(now/1000))){s.run("UPDATE queue SET state='model_queued' WHERE id=?",r.id);return {state:'model_retry_queued',id:r.id};}
   }
   return {state:s.row<{n:number}>("SELECT COUNT(*) n FROM queue WHERE state='needs_review'")!.n?'needs_review':'idle'};
  }
  try{
   // A frozen circuit group is one event. Read every member from the official
   // full-text reader; metadata is never substituted for missing evidence.
   const members=this.members(row.id).filter(d=>this.allowed(d,row.kind)),docs:Document[]=[];
   const indices=s.get<Indices>('indices');
   let size=0;const deadline=Date.now()+180_000;
   for(let start=0;start<members.length;start+=3){
    const remaining=deadline-Date.now();if(remaining<=0)throw Error('kap_group_timeout');
    let timer:ReturnType<typeof setTimeout>|undefined;
    const batch=await Promise.race([Promise.all(members.slice(start,start+3).map(async d=>{
     const loaded=await this.load(d.id),tier=d.subjectCodes.some(c=>indices?.bist30.includes(c))?30:d.subjectCodes.some(c=>indices?.bist100.includes(c))?100:undefined;
     const decision=decide(d,this.store.prefs(),indices),scopeLimited=decision.topics.some(t=>t==='circuit'||t==='buyback'||t==='share_trade');
     const circuit=this.store.circuit(d,this.clock()),codes=circuit?.kind==='market'?[]:circuit?.kind==='pay'?circuit.codes:scopeLimited?focusedDisclosureTickers(d,indices):d.subjectCodes;
     return loaded.map(doc=>({...doc,index_tier:tier as 30|100|undefined,index_membership:doc.source_id==='kap'?kapIndexMembership(codes,indices,now):undefined,...(scopeLimited&&doc.source_id==='kap'?{equity_codes:codes,...(circuit&&(circuit.kind==='pay'||circuit.kind==='market')?{circuit_scope:{kind:circuit.kind,included_codes:codes,excluded_codes:circuit.excluded,list_version:circuit.version}}:{})}:{})}));
    })),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('kap_group_timeout')),remaining);})]).finally(()=>clearTimeout(timer));
    for(const loaded of batch){size+=JSON.stringify(loaded).length;if(size>3_000_000)throw Error('kap_evidence_limit');docs.push(...loaded);}
   }
   const eligibility=this.gate(row.id,row.kind);if(eligibility!=='allow')return{state:eligibility==='hold'?'policy_review':'suppressed',id:row.id};if(s.row<{state:string}>('SELECT state FROM queue WHERE id=?',row.id)?.state==='suppressed')return{state:'suppressed',id:row.id};
   if(row.kind==='circuit'&&members.some(d=>!docs.some(doc=>doc.official&&doc.source_id==='kap'&&doc.url===d.url)))throw Error('kap_group_evidence_missing');
   if(!await quota(this.env,'kap-ai-budget')){s.run("UPDATE queue SET state='ready',available_at=? WHERE id=?",now+1800_000,row.id);return {state:'budget_wait',id:row.id};}
   const jobId=await enqueueEvidence(this.env,docs,'kap');
   s.transaction(()=>{s.run('UPDATE kap_model_jobs SET job_id=?,lease_until=0,last_error=NULL WHERE queue_id=?',jobId,row.id);s.run("UPDATE queue SET state='model_queued' WHERE id=? AND state='preparing'",row.id);});
   return {state:'model_queued',id:row.id};
  }catch(e){
   const attempts=s.row<{attempts:number}>('SELECT attempts FROM kap_model_jobs WHERE queue_id=?',row.id)!.attempts;
   const error=e instanceof Error&&/^[a-z_]{3,70}$/.test(e.message)?e.message:'kap_evidence_failed';
   s.transaction(()=>{s.run("UPDATE queue SET state=?,available_at=? WHERE id=? AND state='preparing'",attempts<3?'ready':'needs_review',now+Math.min(300_000,30_000*2**attempts),row.id);s.run('UPDATE kap_model_jobs SET lease_until=0,last_error=? WHERE queue_id=?',error,row.id);});
   return {state:'evidence_failed',id:row.id};
  }
 }
}
