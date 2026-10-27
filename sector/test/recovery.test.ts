import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {localDatabase} from '../src/local-adapters';
import {requestNews,refreshNewsRequests} from '../src/news-inbox';
import {enqueueEvidence} from '../src/ingest';
import {deliver} from '../src/pipeline';
import type {Env,Document} from '../src/types';
export async function fixture(){
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));
 const env={DB,MODE:'telegram_review',AI_DAILY_DRAFT_LIMIT:'240',TELEGRAM_BOT_TOKEN:'123:test',TELEGRAM_VERIFIED_BOT_ID:'123',TELEGRAM_CHAT_ID:'1',TELEGRAM_USER_ID:'1',TELEGRAM_WEBHOOK_SECRET:'test',MEDIA:{get:async()=>({arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer})}} as unknown as Env;
 const doc:Document={source_id:'test',source_name:'Test',family:'test',official:true,url:'https://example.com/a',title:'Yeni sözleşme',body:'Şirket yeni bir üretim sözleşmesi imzaladı.',published_at:new Date().toISOString(),passages:[{id:'p1',text:'Şirket yeni bir üretim sözleşmesi imzaladı.'}]};
 return {env,doc};
}
const card='11111111-1111-1111-1111-111111111111';
async function prepared(){
 const {env,doc}=await fixture(),id=await enqueueEvidence(env,[doc],'manual'),time=Math.floor(Date.now()/1000);
 await env.DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,created_at,expires_at,media_key,delivery_state) VALUES('d','e','f',?,?,'official',?,?,'drafts/aaa/1.png','uncertain')").bind(JSON.stringify({headline:'📢 Yeni sözleşme',body:doc.body,hashtags:['#Şirket','#Ekonomi']}),JSON.stringify([doc]),time,time+3600).run();
 await env.DB.prepare("UPDATE model_jobs SET state='complete',result_draft='d',documents='[]' WHERE id=?").bind(id).run();
 await env.DB.prepare("UPDATE articles SET status='prepared',draft_id='d'").run();
 await env.DB.prepare("INSERT INTO news_cards(id,article_id,state,message_id,created_at) SELECT ?,id,'model_queued',100,? FROM articles").bind(card,time).run();
 return {env,id};
}
test('uncertain news delivery is not described as model failure and a known target is retried without AI',async()=>{
 const {env}=await prepared(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({ok:true,result:{message_id:50}});};
 try{
  await env.DB.prepare("INSERT INTO system_state VALUES('telegram_photo:d','50')").run();
  await refreshNewsRequests(env);await requestNews(env,card,100);await deliver(env);
  assert.equal((await env.DB.prepare("SELECT delivery_state FROM drafts WHERE id='d'").first<any>()).delivery_state,'sent');
  assert.equal((await env.DB.prepare('SELECT state FROM model_jobs').first<any>()).state,'complete');
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM model_jobs').first<any>()).n,1);
  assert.equal(calls,2);
 }finally{globalThis.fetch=original;}
});
test('uncertain delivery with no receipt stays blocked pending explicit confirmation',async()=>{
 const {env}=await prepared(),original=globalThis.fetch;globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:100}});
 try{await refreshNewsRequests(env);assert.match(await requestNews(env,card,100),/onay|belirsiz/i);assert.equal((await env.DB.prepare('SELECT delivery_state FROM drafts').first<any>()).delivery_state,'uncertain');assert.equal((await env.DB.prepare('SELECT state FROM news_cards').first<any>()).state,'failed');}finally{globalThis.fetch=original;}
});
test('resubmitted manual URL atomically retries a failed job once, with bounded budget and fresh evidence',async()=>{
 const {env,doc}=await fixture(),id=await enqueueEvidence(env,[doc],'manual');
 await env.DB.prepare("UPDATE model_jobs SET state='needs_review',error='subscription_turn_failed' WHERE id=?").bind(id).run();
 const result=await Promise.all([enqueueEvidence(env,[doc],'manual'),enqueueEvidence(env,[doc],'manual')]);assert.deepEqual(result,[id,id]);
 assert.equal((await env.DB.prepare('SELECT state FROM model_jobs').first<any>()).state,'retry_pending');
 assert.equal((await env.DB.prepare('SELECT retries FROM model_reviews').first<any>()).retries,1);
 assert.equal((await env.DB.prepare('SELECT count(*) n FROM model_jobs').first<any>()).n,1);
});
test('explicit uncertain resend uses the existing draft, respects revision and cannot enqueue a second concurrent send',async()=>{
 const {env}=await prepared(),old=globalThis.fetch;let photos=0;
 globalThis.fetch=async(url)=>{if(String(url).endsWith('/sendPhoto'))photos++;return Response.json({ok:true,result:{message_id:77}});};
 try{
  await refreshNewsRequests(env);await requestNews(env,card,100,99);assert.equal((await env.DB.prepare('SELECT delivery_state FROM drafts').first<any>()).delivery_state,'uncertain');
  await Promise.all([requestNews(env,card,100,1),requestNews(env,card,100,1)]);await Promise.all([deliver(env),deliver(env)]);
  assert.equal(photos,1);assert.equal((await env.DB.prepare('SELECT count(*) n FROM model_jobs').first<any>()).n,1);
  assert.equal((await env.DB.prepare('SELECT state FROM model_jobs').first<any>()).state,'complete');
 }finally{globalThis.fetch=old;}
});
test('manual retry counts persist through expiry and stop after two, without replaying completed or ambiguous drafts',async()=>{
 const {env,doc}=await fixture(),id=await enqueueEvidence(env,[doc],'manual');
 for(const state of ['needs_review','expired']){
  await env.DB.prepare("UPDATE model_jobs SET state=?,error=?,documents='[]' WHERE id=?").bind(state,state==='expired'?null:'lease_expired',id).run();
  assert.equal(await enqueueEvidence(env,[doc],'manual'),id);
  assert.equal((await env.DB.prepare('SELECT documents FROM model_jobs').first<any>()).documents,JSON.stringify([doc]));
 }
 await env.DB.prepare("UPDATE model_jobs SET state='needs_review',error='lease_expired' WHERE id=?").bind(id).run();
 await assert.rejects(()=>enqueueEvidence(env,[doc],'manual'),/model_retry_unavailable/);
 assert.equal((await env.DB.prepare('SELECT retries FROM model_reviews').first<any>()).retries,2);
 for(const state of ['complete','leased','queued']){
  await env.DB.prepare('UPDATE model_jobs SET state=?,result_draft=? WHERE id=?').bind(state,state==='complete'?'uncertain-draft':null,id).run();
  assert.equal(await enqueueEvidence(env,[doc],'manual'),id);assert.equal((await env.DB.prepare('SELECT state FROM model_jobs').first<any>()).state,state);
 }
});
test('manual retry requires complete evidence, retryable failure and remaining daily budget',async()=>{
 const {env,doc}=await fixture(),id=await enqueueEvidence(env,[doc],'manual');
 await env.DB.prepare("UPDATE model_jobs SET state='needs_review',error='source_image_invalid' WHERE id=?").bind(id).run();
 await assert.rejects(()=>enqueueEvidence(env,[doc],'manual'),/model_retry_unavailable/);
 await env.DB.prepare("UPDATE model_jobs SET error='subscription_turn_failed' WHERE id=?").bind(id).run();
 await assert.rejects(()=>enqueueEvidence(env,[{...doc,coverage:{complete:false,page_count:2,pages:[]}}],'manual'),/incomplete_source_evidence/);
 await assert.rejects(()=>enqueueEvidence({...env,AI_DAILY_DRAFT_LIMIT:'0'},[doc],'manual'),/model_retry_unavailable/);
 assert.equal((await env.DB.prepare('SELECT state FROM model_jobs').first<any>()).state,'needs_review');
});
