import test from 'node:test';import assert from 'node:assert/strict';import{modelFailureCode,type ModelStage}from'../scripts/model_failure';
test('unexpected model errors preserve safe stage while domain and uncertain failures remain unchanged',()=>{
 for(const stage of ['lease','generate','decode','review','render','submit','delivery']as ModelStage[])assert.equal(modelFailureCode(new TypeError('private secret data'),stage),`model_${stage}_failed`);
 for(const code of ['delivery_uncertain','semantic_review_failed','invalid_job_lease','quota_paused'])assert.equal(modelFailureCode(Error(code),'submit'),code);
});
