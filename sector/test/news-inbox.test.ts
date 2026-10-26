import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {localDatabase} from '../src/local-adapters';
import {announceNews,requestNews,refreshNewsRequests,newsProgressNote,previewDuplicate,previewText} from '../src/news-inbox';
import {prepare} from '../src/pipeline';
import {leaseJob} from '../src/bridge';
import worker from '../src/worker';
import type {Env} from '../src/types';
async function fixture(){
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));
 const env={DB,MODE:'telegram_review',AI_DAILY_DRAFT_LIMIT:'240',TELEGRAM_BOT_TOKEN:'123:test',TELEGRAM_VERIFIED_BOT_ID:'123',TELEGRAM_CHAT_ID:'1',TELEGRAM_USER_ID:'1',TELEGRAM_WEBHOOK_SECRET:'test'} as Env;
 const doc={source_id:'spk',source_name:'SPK',family:'spk',official:true,url:'https://spk.gov.tr/test',title:'SPK yeni düzenlemeyi açıkladı',body:'SPK yeni düzenlemeyi açıkladı. Yeni karar bugün duyuruldu.',passages:[{id:'p1',text:'SPK yeni düzenlemeyi açıkladı.'}],published_at:new Date().toISOString()};
 await DB.prepare('INSERT INTO sources(id,config,enabled) VALUES(?,?,1)').bind('spk',JSON.stringify({id:'spk',name:'SPK',method:'bridge_pdf',official:true})).run();
 await DB.prepare('INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen,document) VALUES(?,?,?,?,?,?,?,?)').bind('a','spk',doc.url,doc.title,'Yeni karar bugün duyuruldu.',doc.published_at,Date.now()/1000,JSON.stringify(doc)).run();
 return env;
}
test('previews spend no quota, disable link previews, and require one explicit generation request',async()=>{
 const env=await fixture(),original=globalThis.fetch;const calls:{url:string;body:URLSearchParams}[]=[];
 globalThis.fetch=async(input,init)=>{calls.push({url:String(input),body:init!.body as URLSearchParams});return Response.json({ok:true,result:{message_id:100}});};
 try{
  await prepare(env);assert.equal(await leaseJob(env),null);
  await announceNews(env);await announceNews(env);assert.equal(calls.length,1);
  assert.match(calls[0].url,/sendMessage$/);assert.equal(JSON.parse(calls[0].body.get('link_preview_options')!).is_disabled,true);
  const markup=JSON.parse(calls[0].body.get('reply_markup')!);const callback=markup.inline_keyboard[1][0].callback_data;
  assert(Buffer.byteLength(callback)<=64);const id=callback.slice(5);
  assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM model_jobs').first<{n:number}>())!.n,0);
  assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM system_state WHERE key LIKE '%budget%'").first<{n:number}>())!.n,0);
  assert.match(await requestNews(env,id,999),/kullanılamıyor/);
  await requestNews(env,id,100);assert.match(await requestNews(env,id,100),/zaten/);
  await prepare(env);await prepare(env);
  assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM model_jobs').first<{n:number}>())!.n,1);
  assert.equal((await env.DB.prepare("SELECT value FROM system_state WHERE key LIKE 'news-request-budget:%'").first<{value:string}>())!.value,'1');
  assert(await leaseJob(env));assert.equal(await leaseJob(env),null);
 }finally{globalThis.fetch=original;}
});
test('same titles merge without AI; changed amounts remain separate',()=>{
 assert(previewDuplicate('Banka net kârını yüzde 20 artırdı','Banka net kârını yüzde 20 artırdı!'));
 assert(!previewDuplicate('Banka net kârını yüzde 20 artırdı','Banka net kârını yüzde 30 artırdı'));
 assert(!previewDuplicate('A şirketi yeni yatırımını duyurdu','B şirketi yeni yatırımını duyurdu'));
 assert.equal(previewText('SPK','Başlık','Başlık'),'SPK\n\nBaşlık');
});
test('callback cannot be requested by another user and legacy automatic jobs stay blocked',async()=>{
 const env=await fixture();
 await env.DB.prepare("INSERT INTO news_cards(id,article_id,state,message_id,created_at) VALUES('11111111-1111-1111-1111-111111111111','a','sent',100,1)").run();
 const response=await worker.fetch(new Request('https://local/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'test'},body:JSON.stringify({update_id:1,callback_query:{id:'cb',data:'news:11111111-1111-1111-1111-111111111111',from:{id:2},message:{message_id:100,chat:{id:1,type:'private'}}}})}),env,{waitUntil:()=>{}} as unknown as ExecutionContext);
 assert.equal(response.status,200);assert.equal((await env.DB.prepare('SELECT state FROM news_cards').first<{state:string}>())!.state,'sent');
 await env.DB.prepare("INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at) VALUES('old','a','[]','x',?)").bind(Date.now()/1000).run();
 assert.equal(await leaseJob(env),null);
 await env.DB.prepare("UPDATE model_jobs SET kind='kap' WHERE id='old'").run();assert(await leaseJob(env));
});
test('requested news shows persistent stage changes on its existing card, without duplicate messages',async()=>{
 const env=await fixture(),original=globalThis.fetch,calls:URLSearchParams[]=[];
 globalThis.fetch=async(input,init)=>{assert.match(String(input),/editMessageText$/);calls.push(init!.body as URLSearchParams);return Response.json({ok:true,result:{message_id:100}});};
 try{
  await env.DB.prepare("INSERT INTO news_cards(id,article_id,state,message_id,created_at) VALUES('n','a','requested',100,1)").run();
  await refreshNewsRequests(env);await refreshNewsRequests(env);assert.equal(calls.length,1);assert.match(calls[0].get('text')!,/tam metni okunuyor/);
  await env.DB.prepare("INSERT INTO system_state VALUES('model_paused_until',?)").bind(String(Date.now()+60000)).run();
  await refreshNewsRequests(env);await refreshNewsRequests(env);assert.equal(calls.length,2);assert.match(calls[1].get('text')!,/geçici olarak beklemede/);
  await env.DB.prepare("INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,kind,state) VALUES('j','a','[]','x',?,'news','leased')").bind(Date.now()/1000).run();
  await refreshNewsRequests(env);assert.equal(calls.length,3);assert.match(calls[2].get('text')!,/kaynak ve sayılar/);
  assert(calls.every(c=>c.get('message_id')==='100'));
 }finally{globalThis.fetch=original;}
});
test('progress edits respect Telegram throttling and a deleted preview cannot cause repeated edits',async()=>{
 const env=await fixture(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({ok:false,error_code:429,parameters:{retry_after:60}},{status:429});};
 try{
  await env.DB.prepare("INSERT INTO news_cards(id,article_id,state,message_id,created_at) VALUES('n','a','requested',100,1)").run();
  await refreshNewsRequests(env);await refreshNewsRequests(env);assert.equal(calls,1);
  await env.DB.prepare("DELETE FROM system_state WHERE key='news_progress:n'").run();
  globalThis.fetch=async()=>{calls++;return Response.json({ok:false,error_code:400},{status:400});};
  await refreshNewsRequests(env);await refreshNewsRequests(env);assert.equal(calls,2);
  assert.equal((await env.DB.prepare('SELECT state FROM news_cards').first<{state:string}>())!.state,'requested');
 }finally{globalThis.fetch=original;}
 assert.match(newsProgressNote({status:'prepared',job_state:'complete',delivery_state:'sent'}),/hazırlandı/);
});
test('a throttled completion notice retries the same preview without replaying a finished model job',async()=>{
 const env=await fixture(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({ok:false,error_code:429,parameters:{retry_after:60}},{status:429});};
 try{
  await env.DB.prepare("INSERT INTO news_cards(id,article_id,state,message_id,created_at) VALUES('n','a','model_queued',100,1)").run();
  await env.DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,state,created_at,expires_at,delivery_state,message_id) VALUES('d','e','f','{}','[]','v','pending',1,9999999999,'sent',900)").run();
  await env.DB.prepare("UPDATE articles SET draft_id='d',status='prepared' WHERE id='a'").run();
  await refreshNewsRequests(env);await refreshNewsRequests(env);assert.equal(calls,1);
  assert.equal((await env.DB.prepare('SELECT state FROM news_cards').first<{state:string}>())!.state,'model_queued');
  await env.DB.prepare("UPDATE system_state SET value='{}' WHERE key='news_progress:n'").run();
  globalThis.fetch=async(_input,init)=>{calls++;const body=init!.body as URLSearchParams;assert.equal(body.get('message_id'),'100');assert.match(body.get('text')!,/hazırlandı/);return Response.json({ok:true,result:{message_id:100}});};
  await refreshNewsRequests(env);assert.equal(calls,2);assert.equal((await env.DB.prepare('SELECT state FROM news_cards').first<{state:string}>())!.state,'complete');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<{n:number}>())!.n,0);
 }finally{globalThis.fetch=original;}
});
test('renewed owner request survives progress refresh before prepare replaces the previous failed model attempt',async()=>{
 const env=await fixture(),old=globalThis.fetch;globalThis.fetch=async(url)=>{assert.match(String(url),/editMessageText$/);return Response.json({ok:true,result:{message_id:100}});};
 try{
  await env.DB.prepare("insert into news_cards(id,article_id,state,message_id,created_at) values('retry-card','a','failed',100,1)").run();
  await env.DB.prepare("insert into model_jobs(id,article_id,documents,input_hash,created_at,kind,state,error)values('retry-job','a','[]','x',1,'news','needs_review','unsupported_number_or_unit')").run();
  await requestNews(env,'retry-card',100);await refreshNewsRequests(env);
  assert.equal((await env.DB.prepare('select state from news_cards').first<any>()).state,'requested');
  await prepare(env);await refreshNewsRequests(env);
  assert.equal((await env.DB.prepare('select state from news_cards').first<any>()).state,'model_queued');
  assert.equal((await env.DB.prepare('select state from model_jobs').first<any>()).state,'queued');
  assert.equal((await env.DB.prepare('select count(*)n from model_jobs').first<any>()).n,1);
  assert.equal((await env.DB.prepare('select count(*)n from x_posts').first<any>()).n,0);
 }finally{globalThis.fetch=old;}
});
