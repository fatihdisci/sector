import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {localDatabase} from '../src/local-adapters';import {newsPreferences,DEFAULT_NEWS_PREFERENCES,NEWS_RULE_VERSION} from '../src/news-routing';
import {newsReadiness} from '../src/news-readiness';import {COMPANY_CATALOG_VERSION} from '../src/news-company-catalog';
import {canonical} from '../src/news-owner-review';import {sha256} from '../src/utils/text';import anchor from '../src/data/news-maintenance-anchor.json';
import {reviewFixture} from './news-readiness-fixture';import type {Env} from '../src/types';
import {stageMaintenanceCandidate} from '../src/news-maintenance-request';

test('synthetic approved successor activates newsPreferences only while its entire owner chain matches',async()=>{
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));const env={DB,TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'7'} as Env;
 const now=Date.now(),prefs={...DEFAULT_NEWS_PREFERENCES,mode:'active' as const,approved_by_owner:true,digest_enabled:true,activated_at:now-60000,entities:[{name:'Örnek Holding',code:'TEST',verified:true}]};
 const put=async(k:string,v:unknown)=>DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k,JSON.stringify(v)).run();
 await put('news_filter_preferences',prefs);await reviewFixture(env,prefs,now-10);const base=await newsReadiness(env,prefs,NEWS_RULE_VERSION,now);
 const saved=structuredClone(anchor),trusted=anchor as any;
 try{
  Object.assign(trusted,{parent_state_hash:await sha256(canonical({binding:null,schedule:null})),rule:NEWS_RULE_VERSION,catalog:COMPANY_CATALOG_VERSION,scope:base.hashes.scope,activated_at:prefs.activated_at,schedule_since:undefined,recorded_at:now-1000});
  const files={...trusted.runtime_files},catalog_hash=trusted.parent_artifact.catalog_hash,oldHash=await sha256(canonical({files,catalog_hash}));
  const record={...trusted,actor:'7',artifact_hash:oldHash};await put('news_maintenance_transition',record);
  const nextFiles={...files,'src/style.ts':'f'.repeat(64)},hash=await sha256(canonical({files:nextFiles,catalog_hash})),artifact={files:nextFiles,catalog_hash,hash};await put('runtime_identity',{news_review_artifact:{files,catalog_hash,hash:oldHash}});
  const candidate={state:'pending',hash,rule:trusted.rule,catalog:trusted.catalog,scope:trusted.scope,activated_at:trusted.activated_at,parent_state_hash:trusted.parent_state_hash,previous_artifact_hash:oldHash,created_at:now-500,expires_at:now+60000};const raw=JSON.stringify(candidate),digest=await sha256(raw);
  const racing={prepare:(sql:string)=>{const statement=DB.prepare(sql);if(!sql.startsWith('INSERT OR IGNORE INTO system_state(key,value) SELECT'))return statement;return{bind:(...args:any[])=>{const bound=statement.bind(...args);return{run:async()=>{await put('news_owner_review_binding',{changed:true});return bound.run();}};}};}};
  await assert.rejects(stageMaintenanceCandidate({...env,DB:racing as any},raw,artifact,now),/candidate_parent_changed/);assert.equal(await DB.prepare("SELECT value FROM system_state WHERE key='news_maintenance_candidate'").first(),null);await DB.prepare("DELETE FROM system_state WHERE key='news_owner_review_binding'").run();
  assert.equal(await stageMaintenanceCandidate(env,raw,artifact,now),'staged');assert.equal(await stageMaintenanceCandidate(env,raw,artifact,now),'already_staged');await assert.rejects(stageMaintenanceCandidate(env,JSON.stringify({...candidate,scope:'changed'}),artifact,now));
  await put('runtime_identity',{news_review_artifact:artifact});
  const request={state:'approved',owner:'7',chat:'7',message:123,nonce:'n',artifact:hash,candidate_digest:digest,expires_at:now+30000},event={owner:'7',chat:'7',message:123,nonce:'n',artifact:hash,candidate_digest:digest,approved_at:now-100};
  assert.equal((await newsPreferences(env)).mode,'shadow');await put('news_maintenance_request:n',request);await put('news_maintenance_approval:n',event);assert.equal((await newsPreferences(env)).mode,'active');
  await put('news_maintenance_approval:n',{...event,approved_at:request.expires_at});assert.equal((await newsPreferences(env)).mode,'shadow');
  await put('news_maintenance_approval:n',event);await put('news_maintenance_candidate',{...candidate,hash:'b'.repeat(64)});assert.equal((await newsPreferences(env)).mode,'shadow');
  await put('news_maintenance_candidate',candidate);await put('news_owner_review_binding',{changed:true});assert.equal((await newsPreferences(env)).mode,'shadow');
 }finally{for(const key of Object.keys(trusted))delete trusted[key];Object.assign(trusted,saved);}
});
