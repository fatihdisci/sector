import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {localDatabase} from '../src/local-adapters';import {newsPreferences,DEFAULT_NEWS_PREFERENCES,NEWS_RULE_VERSION} from '../src/news-routing';
import {newsReadiness} from '../src/news-readiness';import {COMPANY_CATALOG_VERSION} from '../src/news-company-catalog';
import {canonical,type ReviewArtifact} from '../src/news-owner-review';import {sha256} from '../src/utils/text';import anchor from '../src/data/news-maintenance-anchor.json';
import {reviewFixture} from './news-readiness-fixture';import type {Env} from '../src/types';
import {stageMaintenanceCandidate,createMaintenanceRequest,approveMaintenanceRequest} from '../src/news-maintenance-request';
import {loadMaintenanceSuccessor,maintenanceCandidateForRuntime} from '../src/news-maintenance-store';import {validateMaintenanceReview} from '../src/news-maintenance-review';
test('real staging/readiness supports three approvals, rejects replay and preserves active rollback while a candidate waits',async()=>{
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),env={DB,TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'7'} as Env;
 const now=Date.now(),prefs={...DEFAULT_NEWS_PREFERENCES,mode:'active' as const,approved_by_owner:true,digest_enabled:true,activated_at:now-60000,entities:[{name:'Örnek Holding',code:'TEST',verified:true}]};
 const put=async(k:string,v:unknown)=>DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k,JSON.stringify(v)).run();
 await put('news_filter_preferences',prefs);await reviewFixture(env,prefs,now-10);const baseReadiness=await newsReadiness(env,prefs,NEWS_RULE_VERSION,now);
 const saved=structuredClone(anchor),trusted=anchor as any;
 try{
  Object.assign(trusted,{parent_state_hash:await sha256(canonical({binding:null,schedule:null})),rule:NEWS_RULE_VERSION,catalog:COMPANY_CATALOG_VERSION,scope:baseReadiness.hashes.scope,activated_at:prefs.activated_at,schedule_since:undefined,recorded_at:now-10000});
  const files={...trusted.runtime_files},catalog_hash=trusted.parent_artifact.catalog_hash,base:ReviewArtifact={files,catalog_hash,hash:await sha256(canonical({files,catalog_hash}))};
  const record={...trusted,actor:'7',artifact_hash:base.hash};await put('news_maintenance_transition',record);await put('runtime_identity',{news_review_artifact:base});
  let previous=base;const approved:ReviewArtifact[]=[],raws:string[]=[],nonces:string[]=[];
  for(let n=1;n<=3;n++){
   const nextFiles={...files,'src/style.ts':String(n).repeat(64)},artifact={files:nextFiles,catalog_hash,hash:await sha256(canonical({files:nextFiles,catalog_hash}))};
   const candidate={state:'pending',hash:artifact.hash,rule:trusted.rule,catalog:trusted.catalog,scope:trusted.scope,activated_at:trusted.activated_at,parent_state_hash:trusted.parent_state_hash,previous_artifact_hash:previous.hash,created_at:Date.now(),expires_at:Date.now()+60000},raw=JSON.stringify(candidate);
   if(n>1){
    await assert.rejects(stageMaintenanceCandidate({...env,TELEGRAM_CHAT_ID:undefined},raw,artifact),/candidate_parent_invalid/);
    await assert.rejects(stageMaintenanceCandidate(env,JSON.stringify({...candidate,previous_artifact_hash:'f'.repeat(64)}),artifact),/candidate_parent_invalid/);
   }
   if(n===2){
    const racing={...env,DB:{prepare:DB.prepare.bind(DB),batch:async(statements:any)=>{await put('news_owner_review_binding',{changed:true});return DB.batch(statements);}} as any};
    await assert.rejects(stageMaintenanceCandidate(racing,raw,artifact),/candidate_parent_changed/);await DB.prepare("DELETE FROM system_state WHERE key='news_owner_review_binding'").run();
    assert.equal(await DB.prepare("SELECT value FROM system_state WHERE key='news_maintenance_staged_candidate'").first(),null);
   }
   assert.equal(await stageMaintenanceCandidate(env,raw,artifact),'staged');assert.equal(await stageMaintenanceCandidate(env,raw,artifact),'already_staged');
   assert.equal(await maintenanceCandidateForRuntime(env,artifact.hash,candidate.expires_at-1),true);assert.equal(await maintenanceCandidateForRuntime(env,previous.hash,candidate.expires_at-1),false);assert.equal(await maintenanceCandidateForRuntime(env,artifact.hash,candidate.expires_at),false);
   if(n>1)assert.match(await approveMaintenanceRequest(env,nonces[n-2],'7','7',n-1),/geçersiz/);
   // Existing active release stays valid before approval, including rollback releases.
   assert.equal((await newsPreferences(env)).mode,'active');
   await put('runtime_identity',{news_review_artifact:artifact});assert.equal((await newsPreferences(env)).mode,'shadow');
   let callback='';await createMaintenanceRequest({...env,TELEGRAM_UPDATE_ID:100+n},async(_text,extra)=>{callback=JSON.parse(extra.reply_markup).inline_keyboard[0][0].callback_data;return{message_id:n};});const nonce=callback.split(':').at(-1)!;
   assert.match(await approveMaintenanceRequest(env,nonce,'wrong','7',n),/geçersiz/);assert.equal((await newsPreferences(env)).mode,'shadow');
   assert.match(await approveMaintenanceRequest(env,nonce,'7','7',n),/kaydedildi/);assert.equal((await newsPreferences(env)).mode,'active');
   assert.match(await approveMaintenanceRequest(env,nonce,'7','7',n),/zaten/);
   for(const old of approved){await put('runtime_identity',{news_review_artifact:old});assert.equal((await newsPreferences(env)).mode,'active');}
   await put('runtime_identity',{news_review_artifact:artifact});approved.push(artifact);raws.push(raw);nonces.push(nonce);previous=artifact;
  }
  const successor=await loadMaintenanceSuccessor(env,previous);assert.equal(successor?.parents?.length,2);
  const validate=(s:any)=>validateMaintenanceReview({record,artifact:previous,binding:null,schedule:null,owner:'7',ownerChat:'7',rule:trusted.rule,catalog:trusted.catalog,scope:trusted.scope,activated_at:trusted.activated_at,now:Date.now(),successor:s});
  assert.equal((await validate(successor)).valid,true);const bad=structuredClone(successor!);bad.parents![0].event.artifact='f'.repeat(64);assert.equal((await validate(bad)).valid,false);
  await assert.rejects(stageMaintenanceCandidate(env,raws[0],approved[0]),/candidate_parent_invalid|candidate_replay/);
  const replay=JSON.stringify({...JSON.parse(raws[0]),previous_artifact_hash:previous.hash,created_at:Date.now()});await assert.rejects(stageMaintenanceCandidate(env,replay,approved[0]),/candidate_replay/);
  assert.equal((await DB.prepare("SELECT COUNT(*) n FROM system_state WHERE key LIKE 'news_maintenance_approval:%'").first<any>()).n,3);
  const oldApproval=await DB.prepare('SELECT value FROM system_state WHERE key=?').bind('news_maintenance_approval:'+nonces[0]).first<any>();assert.equal(JSON.parse(oldApproval.value).artifact,approved[0].hash);
  await put('news_maintenance_approval:'+nonces[0],{...JSON.parse(oldApproval.value),owner:'wrong'});assert.equal((await newsPreferences(env)).mode,'shadow');
  await DB.prepare('UPDATE system_state SET value=? WHERE key=?').bind(oldApproval.value,'news_maintenance_approval:'+nonces[0]).run();assert.equal((await newsPreferences(env)).mode,'active');
  // Original legacy pointer remains readable by the pre-chain rollback release.
  assert.equal((await DB.prepare("SELECT value FROM system_state WHERE key='news_maintenance_candidate'").first<any>()).value,raws[0]);
 }finally{for(const key of Object.keys(trusted))delete trusted[key];Object.assign(trusted,saved);}
});
