import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import{newsProgressNote,newsFailureNote}from'../src/news-progress';import{refreshNewsRequests}from'../src/news-inbox';import{localDatabase}from'../src/local-adapters';import{leaseJob}from'../src/bridge';import{withModelHeartbeat}from'../scripts/model_heartbeat';import{numericIssues,numericTokens,EDITOR_PROMPT}from'../src/editorial';import type{Env,Draft,Document}from'../src/types';
const row={status:'model_queued',job_state:'queued',delivery_state:null,requested_at:1000};
test('queue text requires a real active lease; pause, long wait and missing heartbeat are separate',()=>{
 assert.doesNotMatch(newsProgressNote(row,false,{now:1010}),/Önce başlayan|Başka bir içerik/);
 assert.match(newsProgressNote(row,false,{now:1010,activeJobs:1}),/Başka bir içerik/);
 assert.match(newsProgressNote(row,false,{now:1200,activeJobs:0}),/Bekleme uzadı.*başka aktif içerik görünmüyor.*doğrulanamadı/);
 assert.match(newsProgressNote(row,false,{now:1200,workerAt:1190}),/Bekleme uzadı.*işleyicinin almasını/);
 assert.match(newsProgressNote(row,false,{now:1200,workerAt:1100}),/güncel yanıt alınamıyor/);
 assert.match(newsProgressNote(row,true,{now:1200,workerAt:1100}),/geçici olarak beklemede/);
 assert.doesNotMatch(newsProgressNote({...row,job_state:'paused'}),/otomatik devam edecek/);
 assert.match(newsProgressNote({...row,job_state:'leased',job_lease_until:1300},true,{now:1200}),/kaynak ve sayılar/);
 assert.match(newsProgressNote({...row,job_state:'leased',job_lease_until:1100},false,{now:1200}),/süresi doldu/);
 assert.match(newsProgressNote({...row,job_state:'leased',job_lease_until:1300},false,{now:1200,workerAt:1100}),/işleyiciden güncel yanıt/);
 assert.match(newsProgressNote({...row,delivery_state:'sending'},true),/Telegram’a iletiliyor/);
});
test('failure messages distinguish job/source/numeric/layout/transport errors and never expose raw issues',()=>{
 for(const code of['unsupported_number_or_unit','claim_number_mismatch'])assert.match(newsFailureNote({...row,job_error:code}),/sayı, işaret veya birim/);
 for(const code of['output_capacity_exceeded','card_word_overflow','card_content_overflow','report_card_capacity_exceeded'])assert.match(newsFailureNote({...row,job_error:code}),/sığmadı/);
 assert.match(newsFailureNote({...row,status:'needs_review',error:'image_parse_failed'}),/eksiksiz okunamadı/);
 assert.match(newsFailureNote({...row,status:'needs_review',error:'source_http_403',job_error:'unsupported_number_or_unit',review_issues:'["unsupported_number_or_unit"]'}),/eksiksiz okunamadı/);
 assert.match(newsFailureNote({...row,job_error:'hermes_job_failed'}),/Model işlemi/);
 const secret='PRIVATE TOKEN NEVER SHOW';const output=newsFailureNote({...row,job_error:'unknown_'+secret,review_issues:JSON.stringify([secret,'unsupported_number_or_unit'])});assert.match(output,/sayı, işaret/);assert(!output.includes(secret));
 assert.match(newsFailureNote({...row,review_issues:'invalid json'}),/Taslak doğrulanamadı/);
});
async function setup(){
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));const env={DB,MODE:'telegram_review',TELEGRAM_BOT_TOKEN:'123:test',TELEGRAM_VERIFIED_BOT_ID:'123',TELEGRAM_CHAT_ID:'1',TELEGRAM_USER_ID:'1'}as Env;
 const now=Math.floor(Date.now()/1000);await DB.prepare("INSERT INTO sources(id,config,enabled)VALUES('s','{\"name\":\"Test\"}',1)").run();
 await DB.prepare("INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen,status)VALUES('a','s','https://example.com/a','BIST 100 — 14:00','','2026-10-26T11:00:03Z',?,'model_queued')").bind(now).run();
 await DB.prepare("INSERT INTO news_cards(id,article_id,state,message_id,created_at,requested_at)VALUES('c','a','model_queued',1,?,?)").bind(now,now-200).run();
 await DB.prepare("INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,kind,state)VALUES('j','a','[]','x',?,'news','queued')").bind(now).run();return{env,now};
}
test('actual joins show recorded numeric failure; repeated refresh and throttle cannot lose final reason or rerun work',async()=>{
 const{env,now}=await setup();await env.DB.prepare("UPDATE model_jobs SET state='needs_review',error='unsupported_number_or_unit' WHERE id='j'").run();await env.DB.prepare("INSERT INTO model_reviews(job_id,issues,updated_at)VALUES('j',?,?)").bind(JSON.stringify(['private audit contents']),now).run();
 const old=globalThis.fetch;const calls:URLSearchParams[]=[];globalThis.fetch=async(url,init)=>{assert.match(String(url),/editMessageText$/);calls.push(init!.body as URLSearchParams);return calls.length===1?Response.json({ok:false,error_code:429,parameters:{retry_after:60}},{status:429}):Response.json({ok:true,result:{message_id:1}});};
 try{
  await refreshNewsRequests(env);await refreshNewsRequests(env);assert.equal(calls.length,1);assert.equal((await env.DB.prepare('SELECT state FROM news_cards').first<any>()).state,'model_queued');
  await env.DB.prepare("DELETE FROM system_state WHERE key='news_progress:c'").run();await refreshNewsRequests(env);await refreshNewsRequests(env);assert.equal(calls.length,2);assert.match(calls[1].get('text')!,/sayı, işaret veya birim/);assert(!calls[1].get('text')!.includes('private audit'));
  assert.equal((await env.DB.prepare('SELECT state FROM news_cards').first<any>()).state,'failed');assert.equal((await env.DB.prepare('SELECT state FROM model_jobs').first<any>()).state,'needs_review');assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,0);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);
 }finally{globalThis.fetch=old;}
});
test('expired leases do not count as blocking work or get automatically reissued',async()=>{
 const{env,now}=await setup();await env.DB.prepare("UPDATE model_jobs SET state='leased',lease_until=? WHERE id='j'").bind(now-1).run();const old=globalThis.fetch;const notes:string[]=[];globalThis.fetch=async(url,init)=>{assert.match(String(url),/editMessageText$/);notes.push((init!.body as URLSearchParams).get('text')!);return Response.json({ok:true,result:{message_id:1}});};
 try{await refreshNewsRequests(env);assert.match(notes[0],/süresi doldu/);assert.equal(await leaseJob(env),null);assert.equal(await leaseJob(env),null);await refreshNewsRequests(env);assert.match(notes.at(-1)!,/süresi doldu/);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<any>()).n,1);assert.equal((await env.DB.prepare('SELECT state FROM model_jobs').first<any>()).state,'needs_review');}finally{globalThis.fetch=old;}
});
test('heartbeat is independent of last model failure, stops cleanly and owns no job state',async()=>{
 const{env}=await setup();await env.DB.prepare("INSERT INTO system_state VALUES('model_health','{\"ok\":false,\"code\":\"unsupported_number_or_unit\"}')").run();
 await assert.rejects(withModelHeartbeat(env,async()=>{await new Promise(r=>setTimeout(r,20));const h=JSON.parse((await env.DB.prepare("SELECT value FROM system_state WHERE key='model_worker_heartbeat'").first<any>()).value);assert.equal(h.stopped,false);throw Error('test_exit');},5),/test_exit/);
 const h=JSON.parse((await env.DB.prepare("SELECT value FROM system_state WHERE key='model_worker_heartbeat'").first<any>()).value);assert.equal(h.stopped,true);assert.equal((await env.DB.prepare('SELECT state FROM model_jobs').first<any>()).state,'queued');
});
// Minimal public-source excerpt of channel message 26431, not a saved model output.
// The original result was overwritten; this is an explicit local reproduction.
const text='BIST 100: 11.004,37 puan. Görselde değişim “%1,01 düşüşle” ve ayrıca -112,62 puan olarak verilmiş.';
const doc={title:'BIST 100',body:text,passages:[{id:'p',text}]}as Document;
const bad={headline:'📉 BIST 100',body:'Endeks 112,62 puan geriledi.',card_headline:'BIST 100',card_body:'Endeks geriledi.',claims:[{text:'Endeks %1,01 geriledi.',evidence:[{document:0,passage:'p',quote:'BIST 100: 11.004,37 puan.'}]}]}as Draft;
test('14:00 signed points and insufficient percentage quote reproduce rejection; exact signed/quoted values pass numeric checks without relaxed validation',()=>{
 assert(numericIssues(bad,[doc]).some(x=>x.startsWith('body:')));assert(numericIssues(bad,[doc]).some(x=>x.startsWith('claims[0]')));
 const good={...bad,body:'Endeksteki puan değişimi -112,62 puan.',claims:[{text:'Endeks %1,01 geriledi.',evidence:[{document:0,passage:'p',quote:text}]}]};assert.deepEqual(numericIssues(good,[doc]),[]);
 assert(numericIssues({...good,body:'Endeksteki puan değişimi 112,62 puan.'},[doc]).some(x=>x.startsWith('body:')));
 assert.deepEqual(numericTokens('-112,62 puan'),['-112,62 puan']);assert.match(EDITOR_PROMPT,/işaretli puan farkı/);
});
