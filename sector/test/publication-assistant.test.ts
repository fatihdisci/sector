import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {localDatabase} from '../src/local-adapters';import {publicationAction,publicationSummary,cadence,publicationMessage} from '../src/publication-assistant';import {requestX,xCount} from '../src/x-publish';import type {Env} from '../src/types';
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',now=Date.parse('2026-10-22T12:00:00Z');
async function setup(){const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));const env={DB,MODE:'telegram_review',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'7',TELEGRAM_BOT_TOKEN:'123:test',TELEGRAM_VERIFIED_BOT_ID:'123',X_PUBLISH_ENABLED:'true',MEDIA:{get:async()=>({arrayBuffer:async()=>new Uint8Array([137,80,78,71,13,10,26,10]).buffer})}} as unknown as Env;await DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,created_at,expires_at,message_id,media_key,delivery_state) VALUES(?,?,?,?,?,'verified',1,9999999999,10,'drafts/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/1.png','sent')").bind(id,id,id,JSON.stringify({headline:'Başlık',body:'Metin',hashtags:['BIST']}),JSON.stringify([{url:'https://kap.org.tr'}])).run();return env;}
const mock=()=>{const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:99}});return ()=>{globalThis.fetch=old;};};
test('manual mark, replay, undo and API exclusion share one ledger without spending API budget',async()=>{const restore=mock();try{const env=await setup();await publicationAction(env,'mark',id,1,10,now);await publicationAction(env,'mark',id,1,10,now+1000);await publicationAction(env,'mark',id,2,10,now+2000);let s=await publicationSummary(env,now+3000);assert.equal(s.total,1);assert.equal(s.last,now);assert.equal(await xCount(env),0);await requestX(env,`xchoose:0:${id}:1`,10,'cb');assert.equal(await xCount(env),0);await publicationAction(env,'undo',id,3,10,now+4000);assert.equal((await publicationSummary(env,now+4000)).total,0);await publicationAction(env,'mark',id,1,10,now+5000);assert.equal((await publicationSummary(env,now+5000)).total,0);await requestX(env,`xchoose:0:${id}:1`,10,'cb');assert.equal(await xCount(env),1);await publicationAction(env,'mark',id,4,10,now+6000);assert.equal((await publicationSummary(env,now+6000)).manual,0);}finally{restore();}});
test('API receipts are automatic, deduplicate manual marks and midnight uses Istanbul',async()=>{const env=await setup();await env.DB.prepare("INSERT INTO publication_marks VALUES(?,'published',?,?)").bind(id,now,now).run();await env.DB.prepare("INSERT INTO x_posts(id,draft_id,revision,day,state,content,media_key,created_at,finished_at) VALUES('x',?,1,'2026-10-22','sent','text','image',?,?)").bind(id,now,now).run();assert.deepEqual((({total,manual,api})=>({total,manual,api}))(await publicationSummary(env,now)),{total:1,manual:0,api:1});assert.equal((await publicationSummary(env,Date.parse('2026-10-22T21:00:00Z'))).total,0);assert.equal((await publicationSummary(env,now)).last,now);});
test('wrong card cannot mark; defer is not publication and does not schedule X',async()=>{const restore=mock();try{const env=await setup();await publicationAction(env,'mark',id,1,11,now);assert.equal((await publicationSummary(env,now)).total,0);await publicationAction(env,'defer',id,2,10,now);assert.equal((await publicationSummary(env,now)).total,0);assert.equal((await env.DB.prepare('SELECT state FROM publication_marks').first<any>()).state,'deferred');assert.equal(await xCount(env),0);}finally{restore();}});
test('cadence separates short gaps, normal gaps and quiet hours',()=>{assert.match(cadence(now-60000,now),/Çok yakın/);assert.match(cadence(now-3600000,now),/uygun/);assert.match(cadence(now-7200000,now),/Uzun ara/);assert.match(cadence(now,Date.parse('2026-10-22T21:00:00Z')),/Dinlenme/);});
test('manual time correction validates reply and refuses future dates',async()=>{const restore=mock();try{const env=await setup();await publicationAction(env,'mark',id,1,10,now);await env.DB.prepare('INSERT INTO publication_time_edits VALUES(?,?,99,?)').bind('7',id,Date.now()+60000).run();assert(await publicationMessage(env,{text:'2099-01-01 12:00',reply_to_message:{message_id:99}},2));assert.equal((await publicationSummary(env,now)).last,now);assert(await publicationMessage(env,{text:'2026-10-21 14:35',reply_to_message:{message_id:99}},3));assert.equal((await publicationSummary(env,now)).last,Date.parse('2026-10-21T14:35:00+03:00'));}finally{restore();}});

test('deferring an already published draft cannot erase its publication record',async()=>{const restore=mock();try{const env=await setup();await publicationAction(env,'mark',id,1,10,now);assert.match(await publicationAction(env,'defer',id,2,10,now+1000),/ertelenemez/);assert.equal((await publicationSummary(env,now+1000)).total,1);}finally{restore();}});

import {dailyAdvice,publicationAdvice} from '../src/publication-policy';
import {publicationCsv} from '../src/publication-report';
test('editorial ranges match the report, weekends and total counts without imposing a quota',()=>{
 assert.match(cadence(now-75*60000,now),/45–75/);
 assert.match(cadence(now-76*60000,now),/60–90/);
 assert.match(dailyAdvice(8,now),/8–12/);assert.match(dailyAdvice(12,now),/12\+/);
 assert.match(dailyAdvice(16,now),/16\+/);assert.match(dailyAdvice(20,now),/20\+/);
 assert.match(dailyAdvice(2,Date.parse('2026-10-24T12:00:00Z')),/Hafta sonu/);
 assert.match(publicationAdvice(null,0,now),/zorlama/);
});
test('publication report exports chronological gaps, API links and blank unknown metrics safely',async()=>{
 const env=await setup(),restore=mock();try{
 await env.DB.prepare('UPDATE drafts SET content=?,documents=? WHERE id=?').bind(JSON.stringify({headline:'=FORMULA("a")',body:'x',hashtags:[],category:'kap',template:'company'}),JSON.stringify([{url:'https://kap.org.tr',equity_codes:['ASELS','ASELS','bad']}]),id).run();
 await publicationAction(env,'mark',id,1,10,now);
 let csv=await publicationCsv(env,now+1000);assert.match(csv,/2026-10-22T15:00:00\+03:00/);assert.match(csv,/"manual"/);assert.match(csv,/"'=FORMULA/);assert.match(csv,/"1";"ASELS"/);assert.match(csv,/;"";""$/);assert.equal(csv.split('\r\n').length,2);
 await env.DB.prepare("INSERT INTO x_posts(id,draft_id,revision,day,state,content,media_key,created_at,finished_at,remote_id) VALUES('x',?,1,'2026-10-22','sent','text','image',?,?,'123456')").bind(id,now,now).run();
 csv=await publicationCsv(env,now+1000);assert.match(csv,/endeks_haber\/status\/123456/);assert.equal(csv.split('\r\n').length,2);assert.doesNotMatch(csv,/"manual"/);
 assert.equal((await publicationCsv(env,now+29*86400000)).split('\r\n').length,1);
 }finally{restore();}
});
test('plan and report commands never invoke AI or enqueue X publication',async()=>{
 const env=await setup(),restore=mock();try{
 assert.equal(await publicationMessage(env,{text:'/yayinplani'},1),true);
 assert.equal(await publicationMessage(env,{text:'/yayinraporu'},2),true);
 assert.equal(await xCount(env),0);
 }finally{restore();}
});
test('CSV keeps the true previous interval even when that post is outside the export window',async()=>{
 const env=await setup(),second='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',since=now-28*86400000;
 await env.DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,created_at,expires_at,message_id,delivery_state) SELECT ?,?,?,content,documents,verification,created_at,expires_at,11,'sent' FROM drafts WHERE id=?").bind(second,second,second,id).run();
 await env.DB.prepare("INSERT INTO publication_marks VALUES(?,'published',?,?)").bind(id,since-60000,since-60000).run();
 await env.DB.prepare("INSERT INTO publication_marks VALUES(?,'published',?,?)").bind(second,since+60000,since+60000).run();
 const csv=await publicationCsv(env,now);assert.equal(csv.split('\r\n').length,2);assert.match(csv,/"2.00"/);assert.doesNotMatch(csv,new RegExp(id));
});
