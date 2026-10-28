import {modelCapacityDetails} from './output-capacity';
import type {Env,Document} from './types';
import {quota} from './pipeline';
const RETRYABLE=new Set(['semantic_review_failed','unsupported_number_or_unit','claim_number_mismatch','invented_evidence','missing_market_hashtags','missing_evidence','unsupported_entity','incomplete_draft','subscription_turn_failed','hermes_job_failed','JSONDecodeError','lease_expired','repair_budget_expired']);
export async function recordModelReview(env:Env,id:string,audit:unknown,time=Math.floor(Date.now()/1000)){
 const a=audit as {issues?:unknown};
 const issues=Array.isArray(a?.issues)?a.issues.filter((i):i is string=>typeof i==='string').slice(0,20).map(i=>i.slice(0,4500)):[];
 const capacity=modelCapacityDetails(issues);if(capacity.length)await env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('model_capacity:'+id,JSON.stringify({version:1,job_id:id,at:time,details:capacity})).run();
 await env.DB.prepare('INSERT INTO model_reviews(job_id,issues,next_retry,updated_at) VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET issues=excluded.issues,next_retry=MAX(model_reviews.next_retry,excluded.next_retry),updated_at=excluded.updated_at').bind(id,JSON.stringify(issues),time+30,time).run();
}
export async function previousModelIssues(env:Env,id:string):Promise<string[]>{
 const r=await env.DB.prepare('SELECT issues FROM model_reviews WHERE job_id=?').bind(id).first<{issues:string}>();
 return r?JSON.parse(r.issues):[];
}
export async function retryKapModel(env:Env,id:string,time=Math.floor(Date.now()/1000)):Promise<boolean>{
 const job=await env.DB.prepare("SELECT documents,error FROM model_jobs WHERE id=? AND kind='kap' AND state='needs_review' AND result_draft IS NULL AND created_at>?").bind(id,time-86400).first<{documents:string;error:string}>();
 if(!job||!RETRYABLE.has(job.error))return false;
 const docs=JSON.parse(job.documents) as Document[];
 if(!docs.length||docs.some(d=>!d.body?.trim()||!d.passages?.length||d.coverage&&!d.coverage.complete))return false;
 await env.DB.prepare('INSERT OR IGNORE INTO model_reviews(job_id,updated_at) VALUES(?,?)').bind(id,time).run();
 const review=await env.DB.prepare('SELECT retries,next_retry FROM model_reviews WHERE job_id=?').bind(id).first<{retries:number;next_retry:number}>();
 if(!review||review.retries>=2||review.next_retry>time||!await quota(env,'kap-ai-budget'))return false;
 const results=await env.DB.batch([
  env.DB.prepare("UPDATE model_jobs SET state='retry_pending',lease_until=0,lease_token=NULL WHERE id=? AND state='needs_review' AND result_draft IS NULL AND EXISTS(SELECT 1 FROM model_reviews r WHERE r.job_id=model_jobs.id AND r.retries<2 AND r.next_retry<=?)").bind(id,time),
  env.DB.prepare("UPDATE model_reviews SET retries=retries+1,next_retry=?,updated_at=? WHERE job_id=? AND retries<2 AND next_retry<=? AND EXISTS(SELECT 1 FROM model_jobs j WHERE j.id=model_reviews.job_id AND j.state='retry_pending')").bind(time+300,time,id,time)
 ]);
 return !!results[0].meta.changes;
}
// An explicit owner resubmission may supply newly read evidence for an expired
// job. The URL/job identity and retry count survive; no delivery is replayed.
export async function retryManualModel(env:Env,id:string,documents:Document[],time=Math.floor(Date.now()/1000)):Promise<boolean>{
 const job=await env.DB.prepare("SELECT state,error FROM model_jobs WHERE id=? AND kind='manual' AND state IN ('needs_review','expired','paused') AND result_draft IS NULL AND NOT EXISTS(SELECT 1 FROM articles a WHERE a.id=model_jobs.article_id AND a.draft_id IS NOT NULL)").bind(id).first<{state:string;error:string|null}>();
 if(!job||job.state!=='paused'&&!(job.state==='expired'&&job.error===null)&&!RETRYABLE.has(job.error??''))return false;
 if(!documents.length||documents.some(d=>!d.body?.trim()||!d.passages?.length||d.passages.some(p=>typeof p.id!=='string'||typeof p.text!=='string'||!p.text.trim())||d.coverage&&!d.coverage.complete))return false;
 const input=JSON.stringify(documents),token=crypto.randomUUID();
 const {sha256}=await import('./utils/text');
 const limit=Math.max(0,Math.min(500,Math.floor(Number(env.AI_DAILY_DRAFT_LIMIT)||0)));
 const budget='manual-retry-budget:'+new Date(time*1000).toISOString().slice(0,10);
 await env.DB.prepare('INSERT OR IGNORE INTO model_reviews(job_id,updated_at) VALUES(?,?)').bind(id,time).run();
 const result=await env.DB.batch([
  env.DB.prepare(`UPDATE model_jobs SET state='retry_pending',documents=?,input_hash=?,created_at=?,lease_token=?,lease_until=0,error=NULL WHERE id=? AND state=? AND error IS ? AND result_draft IS NULL
   AND NOT EXISTS(SELECT 1 FROM articles a WHERE a.id=model_jobs.article_id AND a.draft_id IS NOT NULL)
   AND EXISTS(SELECT 1 FROM model_reviews r WHERE r.job_id=model_jobs.id AND r.retries<2)
   AND COALESCE((SELECT CAST(value AS INTEGER) FROM system_state WHERE key=?),0)<?`).bind(input,await sha256(input),time,token,id,job.state,job.error,budget,limit),
  env.DB.prepare("UPDATE model_reviews SET retries=retries+1,updated_at=? WHERE job_id=? AND EXISTS(SELECT 1 FROM model_jobs j WHERE j.id=model_reviews.job_id AND j.lease_token=? AND j.state='retry_pending')").bind(time,id,token),
  env.DB.prepare("INSERT INTO system_state(key,value) SELECT ?,'1' WHERE EXISTS(SELECT 1 FROM model_jobs WHERE id=? AND lease_token=? AND state='retry_pending') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1").bind(budget,id,token),
  env.DB.prepare("UPDATE articles SET status='model_queued',error=NULL,lease_until=0 WHERE id=(SELECT article_id FROM model_jobs WHERE id=? AND lease_token=? AND state='retry_pending')").bind(id,token)
 ]);
 return !!result[0].meta.changes;
}
