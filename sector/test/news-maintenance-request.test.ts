import test from 'node:test';
import assert from 'node:assert/strict';
import {maintenanceRequestDecision,maintenanceApproved,type MaintenanceRequest} from '../src/news-maintenance-request';
import {readFile} from 'node:fs/promises';
import {localDatabase} from '../src/local-adapters';
import worker from '../src/worker';
import type {Env} from '../src/types';

test('maintenance request binds owner, chat, message, nonce, artifact and expiry',()=>{
 const hash='a'.repeat(64), request:MaintenanceRequest={nonce:'n',owner:'owner',chat:'chat',message:12,artifact:hash,expires_at:1000,state:'pending'};
 const callback={owner:'owner',chat:'chat',message:12,nonce:'n'};
 assert.equal(maintenanceRequestDecision(request,callback,hash,999),'approve');
 assert.equal(maintenanceRequestDecision({...request,state:'approved'},callback,hash,999),'already_approved');
 for(const changed of [{...callback,owner:'other'},{...callback,chat:'other'},{...callback,message:13},{...callback,nonce:'other'}])
  assert.equal(maintenanceRequestDecision(request,changed,hash,999),'reject');
 assert.equal(maintenanceRequestDecision(request,callback,'b'.repeat(64),999),'reject');
 assert.equal(maintenanceRequestDecision(request,callback,hash,1000),'reject');
 assert.equal(maintenanceRequestDecision(null,callback,hash,999),'reject');
});

test('real owner command and callback bind candidate and record one approval; unauthorized, stale, wrong message and expired callbacks fail closed',async()=>{
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));
 const env={DB,MODE:'telegram_review',TELEGRAM_USER_ID:'1',TELEGRAM_CHAT_ID:'1',TELEGRAM_BOT_TOKEN:'123:test',TELEGRAM_VERIFIED_BOT_ID:'123',TELEGRAM_WEBHOOK_SECRET:'test'} as Env;
 const hash='a'.repeat(64),candidate=JSON.stringify({state:'pending',hash});
 await DB.prepare('INSERT INTO system_state VALUES(?,?)').bind('news_maintenance_candidate',candidate).run();
 const original=globalThis.fetch;let sent=0,callbackData='';
 globalThis.fetch=(async(_url:any,init:any)=>{const body=init.body as URLSearchParams;if(body.get('reply_markup'))callbackData=JSON.parse(body.get('reply_markup')!).inline_keyboard[0][0].callback_data;sent++;return Response.json({ok:true,result:{message_id:100+sent}});}) as typeof fetch;
 const post=(update:unknown)=>worker.fetch(new Request('https://local/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'test'},body:JSON.stringify(update)}),env,{waitUntil:()=>{}} as unknown as ExecutionContext);
 const callback=(id:number,user:number,message:number)=>post({update_id:id,callback_query:{id:'cb'+id,data:callbackData,from:{id:user},message:{message_id:message,chat:{id:1,type:'private'}}}});
 const events=async()=>(await DB.prepare("SELECT COUNT(*) n FROM system_state WHERE key LIKE 'news_maintenance_approval:%'").first<{n:number}>())!.n;
 try{
  await post({update_id:1,message:{message_id:5,text:'/haberfiltre',from:{id:2},chat:{id:1,type:'private'}}});assert.equal(sent,0);
  const command={update_id:2,message:{message_id:5,text:'/haberfiltre',from:{id:1},chat:{id:1,type:'private'}}};await post(command);assert.equal(sent,2);assert.match(callbackData,/^nm:approve:[a-f0-9-]{36}$/);
  const message=102;await post(command);assert.equal(sent,2);
  await callback(3,2,message);await callback(4,1,message+1);assert.equal(await events(),0);
  await DB.prepare('UPDATE system_state SET value=? WHERE key=?').bind(JSON.stringify({state:'pending',hash:'b'.repeat(64)}),'news_maintenance_candidate').run();await callback(5,1,message);assert.equal(await events(),0);
  await DB.prepare('UPDATE system_state SET value=? WHERE key=?').bind(JSON.stringify({state:'pending',hash,scope:'changed'}),'news_maintenance_candidate').run();await callback(55,1,message);assert.equal(await events(),0);
  await DB.prepare('UPDATE system_state SET value=? WHERE key=?').bind(candidate,'news_maintenance_candidate').run();await Promise.all([callback(6,1,message),callback(7,1,message)]);assert.equal(await events(),1);
  const event=await DB.prepare("SELECT value FROM system_state WHERE key LIKE 'news_maintenance_approval:%'").first<{value:string}>();const recorded=JSON.parse(event!.value);assert.deepEqual({owner:recorded.owner,chat:recorded.chat,message:recorded.message,artifact:recorded.artifact},{owner:'1',chat:'1',message:102,artifact:hash});
  assert.equal(await maintenanceApproved(env,hash),true);assert.equal(await maintenanceApproved(env,'f'.repeat(64)),false);
  await post({update_id:8,message:{message_id:6,text:'/haberfiltre',from:{id:1},chat:{id:1,type:'private'}}});const secondMessage=sent+100;
  const key='news_maintenance_request:'+callbackData.split(':').at(-1);const row=await DB.prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{value:string}>();const expired={...JSON.parse(row!.value),expires_at:Date.now()-1};await DB.prepare('UPDATE system_state SET value=? WHERE key=?').bind(JSON.stringify(expired),key).run();await callback(9,1,secondMessage);assert.equal(await events(),1);
 }finally{globalThis.fetch=original;}
});
