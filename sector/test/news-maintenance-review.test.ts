import test from'node:test';import assert from'node:assert/strict';import anchor from'../src/data/news-maintenance-anchor.json';import{validateMaintenanceReview}from'../src/news-maintenance-review';import{canonical}from'../src/news-owner-review';import{sha256}from'../src/utils/text';
import {newsReviewArtifact} from '../scripts/news_review_artifact';
async function fixture(){const trusted=structuredClone(anchor),binding={fixture:'parent-policy'},schedule={fixture:'approved-hours'};trusted.parent_state_hash=await sha256(canonical({binding,schedule}));const artifact={files:{...trusted.runtime_files},catalog_hash:trusted.parent_artifact.catalog_hash,hash:''};artifact.hash=await sha256(canonical({files:artifact.files,catalog_hash:artifact.catalog_hash}));const record={...trusted,actor:'owner',artifact_hash:artifact.hash};return{trusted,input:{record,artifact,binding,schedule,owner:'owner',rule:trusted.rule,catalog:trusted.catalog,scope:trusted.scope,activated_at:trusted.activated_at,schedule_since:trusted.schedule_since,now:trusted.recorded_at+1000}};}
test('approved maintenance binds exact new sources to unchanged editorial/schedule parents',async()=>{const f=await fixture(),before=canonical({binding:f.input.binding,schedule:f.input.schedule});const r=await validateMaintenanceReview(f.input,f.trusted);assert(r.valid);assert.equal(canonical({binding:f.input.binding,schedule:f.input.schedule}),before);assert.equal(r.parent_artifact.hash,f.trusted.parent_artifact.hash);});
test('maintenance rejects forged source, changed parent/time/cutoff/catalog/scope and runtime',async()=>{for(const mutate of [(i:any)=>i.record=null,(i:any)=>i.record.approval_source='fake',(i:any)=>i.owner='wrong',(i:any)=>i.record.recorded_at++,(i:any)=>i.binding.fixture='changed',(i:any)=>i.schedule.fixture='changed',(i:any)=>i.rule='wrong',(i:any)=>i.catalog='wrong',(i:any)=>i.scope='wrong',(i:any)=>i.activated_at++,(i:any)=>i.schedule_since++,(i:any)=>i.artifact.hash='wrong',(i:any)=>i.artifact.files['src/pipeline.ts']='wrong']){const f=await fixture();mutate(f.input);assert.equal((await validateMaintenanceReview(f.input,f.trusted)).valid,false);}});
test('official artifact generator matches the owner-approved source and rejects later drift',async()=>{
 const actual=await newsReviewArtifact(process.cwd());
 const mismatches=Object.keys(anchor.runtime_files as Record<string,string>).filter(path=>actual.files[path]!== (anchor.runtime_files as Record<string,string>)[path]);
 assert.deepEqual(mismatches,[]);
 const f=await fixture();(f.input as any).artifact=actual;f.input.record.artifact_hash=actual.hash;
 const result=await validateMaintenanceReview(f.input,f.trusted);
 assert.equal(result.valid,true,result.reasons.join('; '));
 const drifted=structuredClone(actual);drifted.files['scripts/image_reader.ts']='0'.repeat(64);drifted.hash=await sha256(canonical({files:drifted.files,catalog_hash:drifted.catalog_hash}));
 (f.input as any).artifact=drifted;f.input.record.artifact_hash=drifted.hash;
 const rejected=await validateMaintenanceReview(f.input,f.trusted);
 assert.equal(rejected.valid,false);
 assert(rejected.reasons.some(reason=>reason.includes('çalışan kaynak parmak izi')));
});
