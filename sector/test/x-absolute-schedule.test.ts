import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import worker from '../src/worker';import {localDatabase} from '../src/local-adapters';import {parseIstanbulSchedule} from '../src/x-schedule';import {publishX,requestX} from '../src/x-publish';import {scheduleHoldSql} from '../src/x-schedule-validity';import type {Env} from '../src/types';
const ID='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',BASE=Date.parse('2026-10-31T10:00:00+03:00'),DUE=Date.parse('2026-11-01T14:00:00+03:00');
async function harness(t:any,persistent=false){
 const schema=await readFile('migrations/0001_sector.sql','utf8'),dir=persistent?await mkdtemp(join(tmpdir(),'x-absolute-')):null;if(dir)t.after(()=>rm(dir,{recursive:true,force:true}));const path=dir?join(dir,'test.sqlite'):':memory:',DB=await localDatabase(path,schema);let time=BASE,bytes=new Uint8Array([137,80,78,71,13,10,26,10]),seq=2000;
 const env={DB,MODE:'telegram_review',X_PUBLISH_ENABLED:'true',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'42',TELEGRAM_BOT_TOKEN:'123:test',TELEGRAM_VERIFIED_BOT_ID:'123',TELEGRAM_WEBHOOK_SECRET:'mock-webhook',MEDIA:{get:async()=>({arrayBuffer:async()=>bytes.buffer})}}as unknown as Env;
 await DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,state,created_at,expires_at,message_id,media_key,delivery_state) VALUES(?,?,?,?,'[]','verified','pending',?,?,100,'drafts/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/1.png','sent')").bind(ID,'e','f',JSON.stringify({headline:'Kurum raporu',body:'Doğrulanmış metin',hashtags:['#bist']}),BASE/1000,BASE/1000+3600).run();
 const oldNow=Date.now,oldFetch=globalThis.fetch;Date.now=()=>time;t.after(()=>{Date.now=oldNow;globalThis.fetch=oldFetch;});const calls:any[]=[];
 globalThis.fetch=async(url,init)=>{const method=String(url).split('/').pop();if(!['sendMessage','answerCallbackQuery','editMessageReplyMarkup'].includes(method!))throw Error('unexpected_external_call');calls.push({method,body:init?.body});return Response.json({ok:true,result:{message_id:++seq}});};
 let update=1;const dispatch=async(value:any)=>{const r=await worker.fetch(new Request('https://local/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'mock-webhook','content-type':'application/json'},body:JSON.stringify({update_id:update++,...value})}),env,{waitUntil(){}}as any);assert.equal(r.status,200,await r.text());};
 const cb=async(data:string,message_id:number,user=7,chat=42)=>dispatch({callback_query:{id:'c'+update,data,from:{id:user},message:{message_id,chat:{id:chat,type:'private'}}}});
 const intent=()=>DB.prepare('SELECT * FROM x_schedule_intents ORDER BY rowid DESC LIMIT 1').first<any>();
 const open=async()=>{await cb(`xdate:${ID}:1`,100);return intent();};
 const reply=async(text='01.11.2026 14:00',prompt?:number,user=7,chat=42)=>{const i=await intent();await dispatch({message:{message_id:500+update,text,from:{id:user},chat:{id:chat,type:'private'},reply_to_message:{message_id:prompt??i.prompt_message_id}}});return intent();};
 const confirm=async(message?:number,user=7,chat=42)=>{const i=await intent();await cb('xat:'+i.id,message??i.confirmation_message_id,user,chat);};
 const count=async()=>(await DB.prepare('SELECT count(*) n FROM x_posts').first<any>()).n;
 let sends=0,uploads=0;const api={identity:async()=>({id:'335502216',username:'borsacakali'}),upload:async()=>{uploads++;return '123';},post:async()=>{sends++;return '456';}};
 return {DB,env,calls,cb,open,reply,confirm,intent,count,api,path,schema,setTime:(n:number)=>{time=n;},changeMedia:()=>{bytes=new Uint8Array([...bytes,1]);},stats:()=>({sends,uploads})};
}
test('real Istanbul calendar parsing rejects rollover, invalid leap day, invalid clock, timezone suffix and past',()=>{
 assert.equal(parseIstanbulSchedule('01.11.2026 14:00',BASE),DUE);assert.equal(parseIstanbulSchedule('29.02.2028 09:00',BASE),Date.parse('2028-02-29T06:00:00Z'));
 for(const v of ['31.11.2026 14:00','29.02.2027 14:00','01.11.2026 24:00','01.11.2026 14:60','31.10.2026 10:00','30.10.2026 14:00','01.11.2026 14:00 UTC','14:00'])assert.equal(parseIstanbulSchedule(v,BASE),null,v);
});
test('authenticated owner prompt, reply and separate confirmation persist one exact UTC schedule',async t=>{
 const h=await harness(t);await h.cb(`xpost:${ID}:1`,100);assert(h.calls.some(c=>String(c.body?.get('reply_markup')).includes('Tarih/saat seç')));const i=await h.open();assert(i.prompt_message_id);assert.equal(await h.count(),0);await h.reply();assert.equal(await h.count(),0);assert(h.calls.some(c=>String(c.body?.get('text')).includes('01.11.2026 14:00 Türkiye saati')));await h.confirm();await h.confirm();assert.equal(await h.count(),1);
 const s=await h.DB.prepare('SELECT s.due_at,p.day,b.valid_until FROM x_schedules s JOIN x_posts p ON p.id=s.post_id JOIN x_schedule_bindings b ON b.post_id=p.id').first<any>();assert.equal(s.due_at,DUE);assert.equal(s.day,'2026-11-01');assert.equal(s.valid_until,DUE+300000);assert.equal((await h.intent()).state,'consumed');assert.equal(h.stats().sends,0);
});
test('wrong user/chat/card and wrong reply prompt never approve another draft',async t=>{
 const h=await harness(t);await h.cb(`xdate:${ID}:1`,100,8);assert.equal(await h.intent(),null);await h.open();await h.reply('01.11.2026 14:00',999);assert.equal((await h.intent()).state,'input');await h.reply('01.11.2026 14:00',undefined,8);assert.equal((await h.intent()).state,'input');await h.reply();await h.confirm(undefined,8);await h.confirm(undefined,7,43);await h.confirm(100);assert.equal(await h.count(),0);await h.confirm();assert.equal(await h.count(),1);
});
test('invalid date remains unconfirmed and a target that passes before confirmation never becomes immediate',async t=>{
 const h=await harness(t);await h.open();await h.reply('31.11.2026 10:00');assert.equal((await h.intent()).state,'input');await h.reply('31.10.2026 10:02');h.setTime(BASE+121000);await h.confirm();assert.equal(await h.count(),0);
});
test('old revision/content, changed media, expired input and disabled X fail before enqueue',async t=>{
 for(const change of ['revision','content','media','ttl','disabled']){
  const h=await harness(t);await h.open();await h.reply();
  if(change==='revision')await h.DB.prepare('UPDATE drafts SET revision=2').run();
  if(change==='content')await h.DB.prepare("UPDATE drafts SET content='{}'").run();
  if(change==='media')h.changeMedia();if(change==='ttl')h.setTime(BASE+16*60000);if(change==='disabled')h.env.X_PUBLISH_ENABLED='false';
  await h.confirm();assert.equal(await h.count(),0,change);
 }
});
test('uncertain or already planned X work cannot be requeued through the new UI',async t=>{
 const h=await harness(t);await h.open();await h.reply();await requestX(h.env,`xchoose:0:${ID}:1`,100,'direct');await h.DB.prepare("UPDATE x_posts SET state='uncertain'").run();await h.confirm();assert.equal(await h.count(),1);assert.equal((await h.DB.prepare('SELECT state FROM x_posts').first<any>()).state,'uncertain');
});
test('future exact plan survives draft TTL cleanup and a fresh database consumer then publishes once (mock only)',async t=>{
 const h=await harness(t,true);await h.open();await h.reply();await h.confirm();h.setTime(BASE+86400000);
 await h.DB.prepare(`UPDATE drafts SET state='expired',delivery_state='expired' WHERE expires_at<? AND state IN ('pending','deferred','needs_review') AND NOT ${scheduleHoldSql('drafts')}`).bind(Math.floor(Date.now()/1000),Date.now()).run();
 assert.equal((await h.DB.prepare('SELECT state,expires_at FROM drafts').first<any>()).state,'pending');const env={...h.env,DB:await localDatabase(h.path,h.schema)};await publishX(env,h.api);assert.equal(h.stats().uploads,0);h.setTime(DUE);await publishX(env,h.api);await publishX(env,h.api);assert.equal(h.stats().sends,1);assert.equal((await h.DB.prepare('SELECT state FROM x_posts').first<any>()).state,'sent');
});
test('cancelled plan, changed content or excessively late due cannot keep an expired draft alive',async t=>{
 for(const change of ['cancel','content','late']){
  const h=await harness(t);await h.open();await h.reply();await h.confirm();if(change==='cancel')await requestX(h.env,`xcancel:${ID}:1`,100,'cancel');if(change==='content')await h.DB.prepare("UPDATE drafts SET content='{}'").run();h.setTime(change==='late'?DUE+300001:DUE);
  await h.DB.prepare(`UPDATE drafts SET state='expired',delivery_state='expired' WHERE expires_at<? AND state IN ('pending','deferred','needs_review') AND NOT ${scheduleHoldSql('drafts')}`).bind(Math.floor(Date.now()/1000),Date.now()).run();assert.equal((await h.DB.prepare('SELECT state FROM drafts').first<any>()).state,'expired',change);await publishX(h.env,h.api);assert.equal(h.stats().sends,0,change);
 }
});
test('simultaneous confirmations reserve once and stale prompt replies do not become manual content jobs',async t=>{
 const h=await harness(t);await h.open();await h.reply();await Promise.all([h.confirm(),h.confirm()]);assert.equal(await h.count(),1);await h.reply();assert.equal((await h.DB.prepare('SELECT count(*) n FROM manual_requests').first<any>()).n,0);
});
test('message or draft identity mismatch and a manual publication mark block exact scheduling',async t=>{
 for(const change of ['card','published','expired']){
  const h=await harness(t);await h.open();await h.reply();
  if(change==='card')await h.DB.prepare('UPDATE drafts SET message_id=101').run();
  if(change==='published')await h.DB.prepare("INSERT INTO publication_marks VALUES(?,'published',?,?)").bind(ID,BASE,BASE).run();
  if(change==='expired')await h.DB.prepare('UPDATE drafts SET expires_at=0').run();
  await h.confirm();assert.equal(await h.count(),0,change);
 }
});
test('scheduled hash, revision and final upload checks fail closed despite the narrow TTL hold',async t=>{
 for(const change of ['hash','revision','during-upload']){
  const h=await harness(t);await h.open();await h.reply();await h.confirm();h.setTime(DUE);
  if(change==='hash')h.changeMedia();if(change==='revision')await h.DB.prepare('UPDATE drafts SET revision=2').run();
  if(change==='during-upload')h.api.upload=async()=>{await h.DB.prepare('UPDATE drafts SET revision=2').run();return '123';};
  await publishX(h.env,h.api);assert.equal(h.stats().sends,0,change);assert.equal((await h.DB.prepare('SELECT state FROM x_posts').first<any>()).state,'failed');
 }
});
test('ready-package date prompts show the actual tweet heading rather than a generic package title',async t=>{
 const h=await harness(t);await h.DB.prepare('UPDATE drafts SET content=?').bind(JSON.stringify({tweet_style:'owner_ready',headline:'Hazır yayın paketi',body:'Bank of America hangi hisseleri aldı?\n\nVeriler',hashtags:[]})).run();await h.open();await h.reply();assert(h.calls.filter(c=>c.method==='sendMessage').every(c=>String(c.body.get('text')).includes('Bank of America hangi hisseleri aldı?')));assert.equal(await h.count(),0);
});
