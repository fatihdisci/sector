import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {modelRoute,apiSettings,type ApiSettings} from '../src/model-route';
import {loadModelSelection,modelInvocation,runModelJob,type RunnerOptions} from '../scripts/model_runner';
import {localDatabase} from '../src/local-adapters';
import {enqueueEvidence} from '../src/ingest';
import {leaseJob,submitJob} from '../src/bridge';
import {draftCards} from '../src/card-pages';
import {png} from '../scripts/render_local';
import {sha256} from '../src/utils/text';
import {retryKapModel} from '../src/model-recovery';
import type {Env,Document,Draft} from '../src/types';
const settings=():ApiSettings=>({enabled:true,budget_authorized:true,reasoning_effort:'low',model:'approved-mock-model',approved_models:['approved-mock-model'],hard_limit_micro_usd:1000000,window_id:'test-window',expires_at:Date.now()/1000+600,input_token_ceiling:20000,max_output_tokens:1000,input_micro_usd_per_million:1000000,cached_micro_usd_per_million:500000,output_micro_usd_per_million:2000000,rate_table_model:'approved-mock-model',rate_table_valid_from:Date.now()/1000-60,rate_table_expires_at:Date.now()/1000+900,rate_table_source:'https://developers.openai.com/api/docs/pricing',context_window_tokens:24000});
const original={AI_MODEL:'gpt-6.1-terra',AI_EFFORT:'low' as const};
const opts=(api=false):RunnerOptions=>({python:'/unused/python',root:'/unused/',home:'/unused',profile:'/unused/sectorhaber',hermesRoot:'/unused/hermes',selection:api?{provider:'openai-api',api:settings(),budgetPath:'/unused/budget',telemetryPath:'/unused/usage'}:{provider:'openai-codex'},vars:{PATH:'/unused',SECTOR_OPENAI_API_KEY:'FAKE-KEY'}});
test('default route and runner preserve Hermes without reading API config or inheriting key',async()=>{
 let reads=0;const vars={SECTOR_OPENAI_API_KEY:'FAKE'};
 const selected=await loadModelSelection(vars,async()=>{reads++;throw Error('unexpected')});
 assert.equal(selected.provider,'openai-codex');assert.equal(reads,0);assert.deepEqual(modelRoute(original),{provider:'openai-codex',model:'gpt-6.1-terra',effort:'low'});
 const invocation=modelInvocation({provider:'openai-codex'},opts());assert.match(invocation.script,/hermes_job.py$/);assert(!JSON.stringify(invocation.env).includes('FAKE'));assert(!('SECTOR_OPENAI_API_KEY'in invocation.env));
});
test('API requires opt-in, key and complete authorized nonexpired pricing before selection',async()=>{
 let reads=0;const read=async()=>{reads++;return JSON.stringify(settings())};
 await assert.rejects(()=>loadModelSelection({SECTOR_MODEL_PROVIDER:'openai-api'},read as any),/api_disabled/);
 const vars={SECTOR_MODEL_PROVIDER:'openai-api',SECTOR_OPENAI_API_ENABLED:'true',SECTOR_OPENAI_API_CONFIG:'/unused/config',SECTOR_OPENAI_API_BUDGET:'/unused/budget',SECTOR_OPENAI_API_USAGE:'/unused/usage'};
 await assert.rejects(()=>loadModelSelection(vars,read as any),/key_missing/);assert.equal(reads,0);
 const selected=await loadModelSelection({...vars,SECTOR_OPENAI_API_KEY:'FAKE'},read as any);assert.equal(selected.provider,'openai-api');assert.equal(reads,1);
 for(const patch of [{enabled:false},{budget_authorized:false},{model:null},{model:'gpt-6.1-terra'},{hard_limit_micro_usd:null},{expires_at:1},{rate_table_expires_at:1},{rate_table_model:'other'},{context_window_tokens:10}])assert.throws(()=>apiSettings({...settings(),...patch}));
});
test('API invocation has exact route and isolated key environment; mismatch never falls back',()=>{
 const o=opts(true),job={provider:'openai-api',model:'approved-mock-model',effort:'low'};
 const invocation=modelInvocation(job,o);assert.match(invocation.script,/api_job.py$/);assert('SECTOR_OPENAI_API_KEY'in invocation.env);assert.equal(invocation.env.SECTOR_OPENAI_API_KEY,'FAKE-KEY');assert(!('HERMES_HOME'in invocation.env));assert(!('api_key'in invocation.input));
 assert.throws(()=>modelInvocation({...job,provider:'openai-codex'},o),/mismatch/);assert.throws(()=>modelInvocation(job,{...o,vars:{}}),/key_missing/);assert.throws(()=>modelInvocation(job,opts()),/mismatch/);
});
test('subprocess failure becomes nonretryable API error without raw diagnostics or a second spawn',async()=>{
 let spawns=0;
 const spawnMock=()=>{spawns++;const child=new EventEmitter()as any;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdin.end=()=>{queueMicrotask(()=>{child.stderr.emit('data',Buffer.from('{"error":"SECRET provider message"}'));child.emit('close',1);});};child.kill=()=>{};return child;};
 await assert.rejects(()=>runModelJob({provider:'openai-api',model:'approved-mock-model',effort:'low',deadline:Date.now()/1000+30},opts(true),spawnMock as any),/^Error: api_job_failed_no_retry$/);assert.equal(spawns,1);
});
const doc:Document={source_id:'manual-input',source_name:'Resmî Test',family:'official-test',official:true,title:'Test Teknoloji yeni tesis planını açıkladı',url:'https://test.example.org/a',published_at:'2026-10-21T12:00:00Z',body:'Test Teknoloji, yeni üretim tesisi yatırımını planladığını açıkladı. Proje için izin başvuruları sürüyor.',passages:[{id:'p1',text:'Test Teknoloji, yeni üretim tesisi yatırımını planladığını açıkladı.'}]};
const draft:Draft={headline:'📊 Test Teknoloji üretim tesisi yatırımı planlıyor',body:'Şirketin yeni tesisi için izin başvuruları sürüyor.',card_headline:'Test Teknoloji yeni tesis planlıyor',card_body:'Üretim yatırımı için izin süreci devam ediyor.',entities:['Test Teknoloji'],event_key:'test-yeni-tesis-2026',category:'companies',importance:55,template:'company',claims:[{text:'Test Teknoloji üretim tesisi planlıyor.',evidence:[{document:0,passage:'p1',quote:doc.passages[0].text}]}],hashtags:['#Teknoloji','#Yatırım'],uncertainties:[]};
async function setup(){const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));const objects=new Map();const env={DB,MEDIA:{put:async(k:string,v:unknown)=>objects.set(k,v),delete:async(k:string)=>objects.delete(k)},MODE:'dry_run',...original,AI_DAILY_DRAFT_LIMIT:'240',AI_PROVIDER:'openai-api',AI_API_CONFIG:settings()}as unknown as Env;const id=await enqueueEvidence(env,[doc],'manual');return {env,id,objects};}
test('real bridge leases selected model, enforces route/lease/evidence, submits once without X publication',async()=>{
 const {env,id,objects}=await setup();const leased=await leaseJob(env);assert(leased);assert.equal(leased.id,id);assert.equal(leased.provider,'openai-api');assert.equal(leased.model,'approved-mock-model');assert.equal(leased.effort,'low');assert.deepEqual(leased.allowed_tools,[]);assert.equal(await leaseJob(env),null);
 const cards=[];for(const svg of draftCards(draft,leased.card_theme,leased.card_layout))cards.push({svg_hash:await sha256(svg),png_base64:Buffer.from(await png(svg)).toString('base64')});
 const payload={id,lease_token:leased.lease_token,input_hash:leased.input_hash,draft,audit:{supported:true,issues:[]},runtime:{model:leased.model,effort:'low',provider:'openai-api',tool_count:0,fallback_count:0},cards};
 await assert.rejects(()=>submitJob(env,{...payload,input_hash:'wrong'}),/invalid_job_lease/);await assert.rejects(()=>submitJob(env,{...payload,runtime:{...payload.runtime,provider:'openai-codex'}}),/model_route_mismatch/);await assert.rejects(()=>submitJob(env,{...payload,runtime:{...payload.runtime,tool_count:1}}),/model_route_mismatch/);await assert.rejects(()=>submitJob(env,{...payload,draft:{...draft,body:'Şirket 999 milyar TL kazandı.'}}),/unsupported_number_or_unit|claim_number_mismatch/);
 const result=await submitJob(env,payload);assert(!result.duplicate);assert.equal(objects.size,1);assert((await submitJob(env,payload)).duplicate);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);
});
test('disabled API cannot claim a queued job and uncertain API failure is not automatic KAP retry',async()=>{
 const {env,id}=await setup();env.AI_API_CONFIG={...env.AI_API_CONFIG!,enabled:false};await assert.rejects(()=>leaseJob(env),/disabled/);assert.equal((await env.DB.prepare('SELECT state FROM model_jobs WHERE id=?').bind(id).first<any>()).state,'queued');
 await env.DB.prepare("UPDATE model_jobs SET state='needs_review',kind='kap',error='api_job_failed_no_retry' WHERE id=?").bind(id).run();assert.equal(await retryKapModel(env,id,Math.floor(Date.now()/1000)+120),false);assert.equal((await env.DB.prepare('SELECT state FROM model_jobs WHERE id=?').bind(id).first<any>()).state,'needs_review');
});

test('explicit API medium crosses selector, invocation, lease and submit without changing Hermes low',async()=>{
 const api={...settings(),reasoning_effort:'medium' as const};assert.equal(modelRoute({...original,AI_PROVIDER:'openai-api',AI_API_CONFIG:api}).effort,'medium');assert.equal(modelRoute(original).effort,'low');
 const invocation=modelInvocation({provider:'openai-api',model:api.model,effort:'medium'},{...opts(true),selection:{...opts(true).selection,api}});assert.equal(invocation.input.job!.effort,'medium');
 assert.throws(()=>modelInvocation({provider:'openai-api',model:api.model,effort:'low'},{...opts(true),selection:{...opts(true).selection,api}}),/mismatch/);
 assert.throws(()=>apiSettings({...api,reasoning_effort:'high'}),/effort_not_approved/);assert.throws(()=>apiSettings({...api,reasoning_effort:undefined}),/effort_not_approved/);
 const {env,id}=await setup();env.AI_API_CONFIG=api;const leased=await leaseJob(env);assert(leased);assert.equal(leased.effort,'medium');
 const cards=await Promise.all(draftCards(draft,leased.card_theme,leased.card_layout).map(async svg=>({svg_hash:await sha256(svg),png_base64:Buffer.from(await png(svg)).toString('base64')})));
 const payload={id,lease_token:leased.lease_token,input_hash:leased.input_hash,draft,audit:{supported:true,issues:[]},runtime:{model:leased.model,effort:'medium',provider:'openai-api',tool_count:0,fallback_count:0},cards};
 await assert.rejects(submitJob(env,{...payload,runtime:{...payload.runtime,effort:'low'}}),/mismatch/);assert.equal((await submitJob(env,payload)).duplicate,false);
});
