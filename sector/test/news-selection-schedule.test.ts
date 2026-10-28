import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {approveMaintenanceRequest} from '../src/news-maintenance-request';
import {validateSelectionScheduleSuccessor} from '../src/news-schedule-review';
import {HOURLY_SELECTION_SCHEDULE,selectionIsQuiet} from '../src/news-selection-schedule';
import {dueSelectionSlot,sendSelection} from '../src/newsroom';
import {localDatabase} from '../src/local-adapters';
import {canonical} from '../src/news-owner-review';
import {sha256} from '../src/utils/text';

test('daily slots cover each TRT hour including midnight; only 00:00–07:59 is quiet',()=>{
 assert.deepEqual(HOURLY_SELECTION_SCHEDULE.times,Array.from({length:24},(_,h)=>`${String(h).padStart(2,'0')}:00`));
 assert.equal(dueSelectionSlot(Date.parse('2026-10-28T00:00:30+03:00'),HOURLY_SELECTION_SCHEDULE.times,0)?.clock,'00:00');
 assert.equal(dueSelectionSlot(Date.parse('2026-10-28T23:00:30+03:00'),HOURLY_SELECTION_SCHEDULE.times,0)?.clock,'23:00');
 assert.equal(dueSelectionSlot(Date.parse('2026-10-28T23:59:00+03:00'),HOURLY_SELECTION_SCHEDULE.times,0)?.clock,'23:00');
 assert.equal(dueSelectionSlot(Date.parse('2026-10-28T08:00:00+03:00'),HOURLY_SELECTION_SCHEDULE.times,Date.parse('2026-10-28T08:00:00+03:00'))?.clock,'08:00');
 for(const hour of [0,1,7])assert(selectionIsQuiet(Date.parse(`2026-10-28T${String(hour).padStart(2,'0')}:30:00+03:00`)));
 for(const hour of [8,9,23])assert(!selectionIsQuiet(Date.parse(`2026-10-28T${String(hour).padStart(2,'0')}:30:00+03:00`)));
});

test('scheduled selection sends Telegram silent flag only for quiet-hour pages',async()=>{
 const original=globalThis.fetch;let body:URLSearchParams|undefined;
 globalThis.fetch=(async(_input:any,init?:RequestInit)=>{body=init?.body as URLSearchParams;return Response.json({ok:true,result:{message_id:77}});}) as typeof fetch;
 try{
  const env:any={TELEGRAM_BOT_TOKEN:'123:fake',TELEGRAM_VERIFIED_BOT_ID:'123',TELEGRAM_CHAT_ID:'chat',DB:{prepare:()=>({bind(){return this;},async all(){return{results:[{id:'a'.repeat(32),title:'Önemli şirket haberi'}]};}})}};
  await sendSelection(env,0,undefined,{page:1,total:1,silent:true});assert.equal(body?.get('disable_notification'),'true');
  await sendSelection(env,0,undefined,{page:1,total:1,silent:false});assert.equal(body?.has('disable_notification'),false);
 }finally{globalThis.fetch=original;}
});

test('real owner maintenance callback creates one exact-hour successor without changing the old schedule or preferences',async()=>{
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));const env:any={DB,TELEGRAM_USER_ID:'owner',TELEGRAM_CHAT_ID:'private'};
 const parent={version:1,times:['10:30','14:30','18:30','22:30'],approval_source:'prior-owner-review'};
 const candidate:any={state:'pending',selection_schedule:HOURLY_SELECTION_SCHEDULE,created_at:1,expires_at:Date.now()+60_000};candidate.hash='a'.repeat(64);const raw=JSON.stringify(candidate),digest=await sha256(raw),nonce='123e4567-e89b-42d3-a456-426614174000',message=56;
 const request={nonce,owner:'owner',chat:'private',message,artifact:candidate.hash,candidate_digest:digest,expires_at:Date.now()+60_000,state:'pending'};
 const originalPrefs=JSON.stringify({mode:'active',digest_times:parent.times,activated_at:1});
 await DB.batch([
  DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?)').bind('news_schedule_transition',JSON.stringify(parent)),
  DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?)').bind('news_filter_preferences',originalPrefs),
  DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?)').bind('news_maintenance_candidate',raw),
  DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?)').bind('news_maintenance_request:'+nonce,JSON.stringify(request))
 ]);
 assert.equal(await approveMaintenanceRequest(env,nonce,'intruder','private',message),'Bu düğme geçersiz veya süresi dolmuş.');
 assert.equal(await approveMaintenanceRequest(env,nonce,'owner','private',message+1),'Bu düğme geçersiz veya süresi dolmuş.');
 assert.equal(await DB.prepare("SELECT 1 FROM system_state WHERE key='news_schedule_successor'").first(),null);
 assert.match(await approveMaintenanceRequest(env,nonce,'owner','private',message),/saatlik seçki ayarı kaydedildi/);
 const saved=JSON.parse((await DB.prepare("SELECT value FROM system_state WHERE key='news_schedule_successor'").first<any>()).value);
 assert.deepEqual(saved.times,HOURLY_SELECTION_SCHEDULE.times);assert.equal(saved.approval_source,'maintenance_owner_callback');assert.equal(saved.artifact_hash,candidate.hash);assert.equal(saved.actor,'owner');assert.equal(saved.chat,'private');assert.equal(saved.message,message);
 assert.equal((await DB.prepare("SELECT value FROM system_state WHERE key='news_schedule_transition'").first<any>()).value,JSON.stringify(parent));
 assert.equal((await DB.prepare("SELECT value FROM system_state WHERE key='news_filter_preferences'").first<any>()).value,originalPrefs);
 assert.equal(await approveMaintenanceRequest(env,nonce,'owner','private',message),'Bu bakım onayı zaten kaydedildi.');
 assert.equal((await DB.prepare("SELECT COUNT(*) n FROM system_state WHERE key='news_schedule_successor'").first<any>()).n,1);
});

test('successor validates only against an exact approved artifact callback and unchanged parent schedule',async()=>{
 const files={'src/news-selection-schedule.ts':'source-hash'},catalog_hash='catalog',artifact={files,catalog_hash,hash:await sha256(canonical({files,catalog_hash}))};
 const nonce='123e4567-e89b-42d3-a456-426614174000',now=Date.now(),parent={times:['10:30','14:30','18:30','22:30']},candidate={state:'pending',hash:artifact.hash,selection_schedule:HOURLY_SELECTION_SCHEDULE,previous_artifact_hash:'b'.repeat(64)},candidate_raw=JSON.stringify(candidate),candidate_digest=await sha256(candidate_raw);
 const request={state:'approved',nonce,owner:'owner',chat:'private',message:56,artifact:artifact.hash,candidate_digest,expires_at:now+1000};
 const event={nonce,owner:'owner',chat:'private',message:56,artifact:artifact.hash,candidate_digest,approved_at:now};
 const record={version:1,approval_source:'maintenance_owner_callback',parent_schedule_hash:await sha256(canonical(parent)),times:[...HOURLY_SELECTION_SCHEDULE.times],timezone:'Europe/Istanbul',quiet_hours:{start:0,end:8},artifact_hash:artifact.hash,nonce,actor:'owner',chat:'private',message:56,applied_at:now};
 const input={record,parent,chain:{candidate_raw,request,event,parents:[]},runtimeArtifact:artifact,owner:'owner',chat:'private',now};
 assert.deepEqual((await validateSelectionScheduleSuccessor(input)).times,HOURLY_SELECTION_SCHEDULE.times);
 for(const mutate of [(x:any)=>x.record.actor='other',(x:any)=>x.record.message++,(x:any)=>x.record.artifact_hash='f'.repeat(64),(x:any)=>x.parent.times=['12:30'],(x:any)=>x.chain.event.owner='other',(x:any)=>x.chain.request.state='pending',(x:any)=>x.record.nonce='replay']){
  const bad=structuredClone(input);mutate(bad);assert.equal((await validateSelectionScheduleSuccessor(bad)).valid,false);
 }
});
