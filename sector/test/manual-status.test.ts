import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {localDatabase} from '../src/local-adapters';
import {queueManual} from '../src/manual';
import {manualStatusId} from '../src/manual-status';
import {deliver} from '../src/pipeline';
import {runManual} from '../scripts/manual_reader';
import type {Env} from '../src/types';
async function env(){return {DB:await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),MODE:'telegram_review',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'42',TELEGRAM_BOT_TOKEN:'123:test',TELEGRAM_VERIFIED_BOT_ID:'123',MEDIA:{get:async()=>({arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer})}} as unknown as Env;}
const message={message_id:8,from:{id:7},chat:{id:42,type:'private'},text:'https://www.ekonomim.com/test'};
test('manual acknowledgement is sent once and delivery replaces the same message with media',async()=>{
 const e=await env(),original=globalThis.fetch,calls:{method:string;body:any}[]=[];
 globalThis.fetch=async(url,init)=>{calls.push({method:String(url).split('/').pop()!,body:init?.body});return Response.json({ok:true,result:{message_id:99}});};
 try{
  await queueManual(e,10,message);await queueManual(e,10,message);assert.equal(calls.length,1);assert.equal(await manualStatusId(e,10),99);
  const now=Math.floor(Date.now()/1000),draft={headline:'📢 Haber',body:'İçerik',hashtags:['#Ekonomi','#Finans'],card_headline:'Haber',card_body:'İçerik'};
  await e.DB.prepare("INSERT INTO sources(id,config) VALUES('s','{}')").run();
  await e.DB.prepare("INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen) VALUES('a','s','https://www.ekonomim.com/test','Haber','','',?)").bind(now).run();
  await e.DB.prepare("INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,kind,state,result_draft) VALUES('j','a','[]','h',?,'manual','complete','d')").bind(now).run();
  await e.DB.prepare("UPDATE manual_requests SET job_id='j',state='model_queued' WHERE update_id=10").run();
  await e.DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,state,created_at,expires_at,media_key) VALUES('d','e','f',?,?,'single','pending',?,?,'drafts/aaa/1.png')").bind(JSON.stringify(draft),JSON.stringify([{url:message.text}]),now,now+3600).run();
  await deliver(e);assert.deepEqual(calls.map(c=>c.method),['sendMessage','editMessageMedia']);assert.equal(calls[1].body.get('message_id'),'99');
  await runManual(e);assert.equal(calls.length,2);assert.equal((await e.DB.prepare('SELECT state FROM manual_requests WHERE update_id=10').first<{state:string}>())!.state,'complete');
 }finally{globalThis.fetch=original;}
});
test('manual read failure edits acknowledgement instead of sending another message',async()=>{
 const e=await env(),original=globalThis.fetch,methods:string[]=[];
 globalThis.fetch=async(url)=>{methods.push(String(url).split('/').pop()!);return Response.json({ok:true,result:{message_id:99}});};
 try{await queueManual(e,10,message);await e.DB.prepare("UPDATE manual_requests SET state='needs_review',error='manual_source_unsupported' WHERE update_id=10").run();await runManual(e);await runManual(e);assert.deepEqual(methods,['sendMessage','editMessageText']);}finally{globalThis.fetch=original;}
});
test('ambiguous acknowledgement timeout does not duplicate the status',async()=>{
 const e=await env(),original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('timeout');};
 try{await queueManual(e,10,message);await queueManual(e,10,message);assert.equal(calls,1);assert.equal(await manualStatusId(e,10),undefined);}finally{globalThis.fetch=original;}
});
