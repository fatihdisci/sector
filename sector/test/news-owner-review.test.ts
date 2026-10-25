import test from 'node:test';import assert from 'node:assert/strict';
import {canonical,approvalCanonical,validateOwnerReview,type OwnerReviewRow} from '../src/news-owner-review';
import {sha256} from '../src/utils/text';
const now=Date.parse('2026-10-25T06:00:00Z'),hash='a'.repeat(64);
async function fixture(){
 const snapshot=Array.from({length:12},(_,i)=>({id:String(i).padStart(32,'0'),title:'Synthetic '+i,summary:'Explicit offline example; not a production approval.',url:'https://example.org/'+i,published_at:'2026-10-23T00:00:00.000Z',source_id:'fixture',legacy_eligible:i%2}));
 const code_files={'src/news-routing.ts':hash,'src/news-company-catalog.ts':hash,'src/newsroom.ts':hash,'src/news-readiness.ts':hash};
 const p={context:'fresh_publication_owner_review',approval_source:'offline-explicit-owner-question-and-answer',rule_version:'fixture-rule',catalog_version:'fixture-catalog',code_hash:await sha256(approvalCanonical(code_files)),catalog_hash:hash,scope_hash:hash,sample_hash:'',code_files,rows:snapshot.map((r,i)=>({candidate_id:r.id,label:i<2?'instant':i<10?'digest':'archive',title:r.title,url:r.url,published_at:r.published_at,basis:'fresh fixture'}))};p.sample_hash=await sha256(approvalCanonical(p.rows));
 const trusted={...p,snapshot_hash:await sha256(canonical(snapshot)),basis:'fresh fixture',adapter_version:1};
 const rows:OwnerReviewRow[]=p.rows.map(r=>({candidate_id:r.candidate_id,actor:'owner',label:r.label,context:p.context,approval_source:p.approval_source,rule_version:p.rule_version,catalog_version:p.catalog_version,code_hash:p.code_hash,catalog_hash:p.catalog_hash,scope_hash:p.scope_hash,sample_hash:p.sample_hash,evidence:JSON.stringify({current_observation:{title:r.title,url:r.url},approved_context:r.basis}),recorded_at:now}));
 const files={...code_files,'src/news-owner-review.ts':hash},artifact={files,catalog_hash:hash,hash:await sha256(canonical({files,catalog_hash:hash}))};
 return {trusted,input:{rows,binding:{version:1,package:p,snapshot},artifact,owner:'owner',rule:p.rule_version,catalog:p.catalog_version,scope:p.scope_hash,now,evaluate:(r:{id:string})=>({route:p.rows.find(x=>x.candidate_id===r.id)!.label,reasons:['fixture']})}};
}
test('validated fresh context computes 12 labels, 2/8/2, without claiming historical performance',async()=>{
 const {trusted,input}=await fixture();const r=await validateOwnerReview(input,trusted);assert.equal(r.valid,true);assert.equal(r.reviewed,12);assert.deepEqual(r.distribution,{instant:2,digest:8,archive:2});assert.equal(r.metrics.critical_misses,0);assert.match(r.note!,/tarihsel/);
});
test('fake source, stale hashes/code, wrong owner, missing/duplicate rows fail closed',async()=>{
 const mutations=[(i:any)=>i.rows[0].approval_source='forged',(i:any)=>delete i.binding.package.approval_source,(i:any)=>i.rows[0].code_hash='b'.repeat(64),(i:any)=>i.artifact.files['src/news-routing.ts']='b'.repeat(64),(i:any)=>i.catalog='stale',(i:any)=>i.scope='stale',(i:any)=>i.rows.pop(),(i:any)=>i.rows[1]=i.rows[0],(i:any)=>i.rows[0].actor='intruder',(i:any)=>i.rows[0].recorded_at=now+1,(i:any)=>i.binding.snapshot[0].summary='changed',(i:any)=>i.binding.package.rows[0].label='archive',(i:any)=>i.rows[0].evidence='{}',(i:any)=>i.artifact=null];
 for(const mutate of mutations){const {trusted,input}=await fixture();mutate(input);const r=await validateOwnerReview(input,trusted);assert.equal(r.valid,false);assert.equal(r.reviewed,0);assert(r.reasons.length);}
});
test('cryptographically complete but unbalanced sample cannot pass coverage floors',async()=>{
 for(const missing of ['legacy','route']){const {trusted,input}=await fixture();
  if(missing==='legacy'){input.binding.snapshot.forEach(r=>r.legacy_eligible=1);trusted.snapshot_hash=await sha256(canonical(input.binding.snapshot));}
  else{input.rows.forEach(r=>r.label='digest');input.binding.package.rows.forEach(r=>r.label='digest');trusted.sample_hash=input.binding.package.sample_hash=await sha256(approvalCanonical(input.binding.package.rows));input.rows.forEach(r=>r.sample_hash=trusted.sample_hash);}
  const r=await validateOwnerReview(input,trusted);assert.equal(r.valid,false);assert(r.reasons.some(x=>x.includes('Üç rota')));
 }
});
test('fresh rerun errors remain measurable, approvals cannot force expected output',async()=>{
 const {trusted,input}=await fixture();input.evaluate=()=>({route:'archive',reasons:['regression']});const r=await validateOwnerReview(input,trusted);assert.equal(r.valid,true);assert.equal(r.metrics.critical_misses,2);assert.equal(r.metrics.important_archived,10);
});
