import {selectMarketDocument} from './market-input';
import {outputPreferences} from './output-preferences';
import {retryManualModel} from './model-recovery';
import type {Document,Env} from './types';
import {sha256} from './utils/text';
// Trusted local readers only. This is not an endpoint accepting arbitrary evidence.
export async function enqueueEvidence(env:Env,documents:Document[],kind:'kap'|'manual',editorRequest='',idempotencyKey?:string):Promise<string> {
 if(!documents.length||documents.some(d=>!d.body?.trim()||!d.passages?.length||d.coverage&&!d.coverage.complete))throw Error('incomplete_source_evidence');
 if(editorRequest.length>12000||kind!=='manual'&&editorRequest)throw Error('invalid_editor_request');
 const preference=kind==='manual'?outputPreferences(editorRequest):undefined;
 if(preference)documents=documents.map(d=>({...selectMarketDocument(d,preference.side),output_preferences:preference}));
 const input=JSON.stringify(documents);if(input.length>3_500_000)throw Error('source_evidence_limit');
 if(idempotencyKey!==undefined){
  if(kind!=='kap'||!idempotencyKey||idempotencyKey.length>500)throw Error('invalid_idempotency_key');
  const doc=documents[0],articleId=await sha256('kap-selection-article:'+idempotencyKey),jobId=await sha256('kap-selection-job:'+idempotencyKey),time=Math.floor(Date.now()/1000);
  await env.DB.batch([
   env.DB.prepare('INSERT OR IGNORE INTO sources(id,config,enabled) VALUES(?,?,0)').bind(doc.source_id,JSON.stringify({id:doc.source_id,name:doc.source_name,method:'reference'})),
   env.DB.prepare("INSERT OR IGNORE INTO articles(id,source_id,url,title,summary,published_at,first_seen,status) VALUES(?,?,?,?,?,?,?,'model_queued')").bind(articleId,doc.source_id,doc.url,doc.title,'',doc.published_at??new Date().toISOString(),time),
   env.DB.prepare("INSERT OR IGNORE INTO model_jobs(id,article_id,documents,input_hash,created_at,kind) SELECT ?,id,?,?,?,'kap' FROM articles WHERE id=? AND url=?").bind(jobId,input,await sha256(input),time,articleId,doc.url)
  ]);
  const job=await env.DB.prepare('SELECT id FROM model_jobs WHERE id=? AND article_id=?').bind(jobId,articleId).first<{id:string}>();
  if(!job)throw Error('kap_existing_article');
  return job.id;
 }

 const doc=documents[0],recordUrl=doc.url+(editorRequest?(doc.url.includes('#')?'&':'#')+'endeks-editor='+await sha256(editorRequest):''),id=await sha256(recordUrl),time=Math.floor(Date.now()/1000),jobId=await sha256('evidence:'+id);
 await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO sources(id,config,enabled) VALUES(?,?,0)').bind(doc.source_id,JSON.stringify({id:doc.source_id,name:doc.source_name,method:'reference'})),
  env.DB.prepare('INSERT OR IGNORE INTO articles(id,source_id,url,title,summary,published_at,first_seen,status) VALUES(?,?,?,?,?,?,?,?)').bind(id,doc.source_id,recordUrl,doc.title,'',doc.published_at??new Date().toISOString(),time,'model_queued'),
  env.DB.prepare('UPDATE articles SET status=\'model_queued\',lease_until=0 WHERE id=? AND status=\'queued\'').bind(id),
  env.DB.prepare("INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,kind,edit_request) VALUES(?,?,?,?,?,?,?) ON CONFLICT(article_id,expected_revision) DO UPDATE SET documents=excluded.documents,input_hash=excluded.input_hash,created_at=excluded.created_at,kind=excluded.kind,state='queued',error=NULL WHERE model_jobs.state='paused' AND excluded.kind='kap'").bind(jobId,id,input,await sha256(input),time,kind,editorRequest||null)
 ]);
 const job=await env.DB.prepare('SELECT id,state FROM model_jobs WHERE article_id=? AND expected_revision=0').bind(id).first<{id:string;state:string}>();if(!job)throw Error('evidence_job_missing');
 if(kind==='manual'&&['needs_review','expired','paused'].includes(job.state)){
  const retried=await retryManualModel(env,job.id,documents,time);
  if(!retried){const current=await env.DB.prepare('SELECT state FROM model_jobs WHERE id=?').bind(job.id).first<{state:string}>();if(!current||!['queued','retry_pending','leased','complete'].includes(current.state))throw Error('model_retry_unavailable');}
 }
 return job.id;
}
