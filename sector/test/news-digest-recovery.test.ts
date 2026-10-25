import test,{mock} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {localDatabase} from '../src/local-adapters';import {scheduledSelection,selectionRows} from '../src/newsroom';import {DEFAULT_NEWS_PREFERENCES,recordNewsCandidate} from '../src/news-routing';import {reviewFixture} from './news-readiness-fixture';import type {Env,Source} from '../src/types';import {TelegramError} from '../src/telegram';
const t=Date.parse('2026-10-25T09:30:00Z');
async function setup(times=['12:30','18:30']){const env={DB:await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'))} as Env;const p={...DEFAULT_NEWS_PREFERENCES,entities:[{name:'Example',code:'TEST',verified:true}],mode:'active' as const,approved_by_owner:true,digest_enabled:true,digest_times:times,activated_at:t-3600000};await env.DB.prepare('INSERT INTO system_state VALUES(?,?)').bind('news_filter_preferences',JSON.stringify(p)).run();await reviewFixture(env,p,t);return env;}
test('bounded catchup: 90m yes, 2h boundary no; repeated runs once; Istanbul day no replay',async()=>{mock.timers.enable({apis:['Date'],now:t});try{
 for(const [delay,expected] of [[90*60000,1],[2*3600000,0],[24*3600000,0]]){const env=await setup();let n=0;await scheduledSelection(env,t+delay,async()=>{n++;});await scheduledSelection(env,t+delay,async()=>{n++;});assert.equal(n,expected);}
 const env=await setup(['12:00','12:30']);let n=0;await scheduledSelection(env,t+60000,async()=>{n++;});await scheduledSelection(env,t+60000,async()=>{n++;});assert.equal(n,1);assert.equal((await env.DB.prepare('SELECT id FROM news_digest_runs').first<any>()).id,'2026-10-25:12:30');
 }finally{mock.timers.reset();}});
test('oldest fresh candidates advance across bounded batches; expired records and preactivation excluded',async()=>{mock.timers.enable({apis:['Date'],now:t});try{const env=await setup();
 // Keep readiness fixtures separate; direct selection covers 35 distinct real-shaped event groups.
 await env.DB.prepare("DELETE FROM news_candidates").run();
 for(let i=0;i<35;i++){await recordNewsCandidate(env,{title:'Piyasa haftalık değerlendirme '+i,summary:'Yatırımcılar için haftalık piyasa değerlendirmesi ve farklı dönem '+i,url:'https://example.com/'+i,published_at:new Date(t-60000).toISOString()},{id:'test'} as Source,false,t-35000+i*1000);}
 const first=await selectionRows(env,t-3600000,undefined,t);assert.equal(first.length,10);assert.deepEqual(first.map(x=>Number(x.title.split(' ').at(-1))),Array.from({length:10},(_,i)=>i));
 await env.DB.prepare("INSERT INTO news_digest_runs(id,state,created_at,items) VALUES('first','sent',?,?)").bind(t,JSON.stringify(first.map(x=>x.id))).run();
 const next=await selectionRows(env,t-3600000,undefined,t);assert.equal(next.length,10);assert(!next.some(x=>first.some(y=>x.id===y.id)));
 await env.DB.prepare("UPDATE news_candidates SET published_at='2026-10-23T00:00:00Z' WHERE id=?").bind(next[0].id).run();assert(!(await selectionRows(env,t-3600000,undefined,t)).some(x=>x.id===next[0].id));
 assert.equal((await selectionRows(env,t+1,undefined,t)).length,0);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM news_candidates').first<any>()).n,35);
 }finally{mock.timers.reset();}});
test('429 retry retains bounded receipt and uncertain transport never repeats',async()=>{mock.timers.enable({apis:['Date'],now:t});try{for(const uncertain of [false,true]){const env=await setup();let n=0;const send=async()=>{n++;if(n===1)throw uncertain?Error('unknown'):new TelegramError(429,1,'retryable');};await scheduledSelection(env,t+3600000,send);await scheduledSelection(env,t+3602000,send);await scheduledSelection(env,t+3603000,send);assert.equal(n,uncertain?1:2);}}
 finally{mock.timers.reset();}});
test('retry drops stale frozen IDs without sending; receipts record only actual rendered IDs',async()=>{mock.timers.enable({apis:['Date'],now:t});try{
 const env=await setup();let n=0;const sender=async()=>{n++;throw new TelegramError(429,1,'retryable');};await scheduledSelection(env,t+3600000,sender);
 await env.DB.prepare("UPDATE news_candidates SET expires_at=?").bind(t).run();await scheduledSelection(env,t+3602000,sender);assert.equal(n,1);assert.equal((await env.DB.prepare('SELECT state FROM news_digest_runs').first<any>()).state,'empty');
 const second=await setup();let sent:string[]=[];await scheduledSelection(second,t,async(_e,_s,ids)=>{sent=ids!.slice(0,1);return sent;});assert.deepEqual(JSON.parse((await second.DB.prepare('SELECT actual_items AS items FROM news_digest_pages').first<any>()).items),sent);
 }finally{mock.timers.reset();}});
