import test from 'node:test';import assert from 'node:assert/strict';
import {decodeBridgeReply,sanitizeDiagnostic,postingRoute} from '../scripts/tweetkit_client';import {XHttpError,XPostUncertain} from '../src/x-publish';
test('bridge maps definite rejection to typed status and preserves uncertain ID',()=>{
 assert.throws(()=>decodeBridgeReply('{"error":"x_post_rejected","status":403}'),(e:unknown)=>e instanceof XHttpError&&e.status===403);
 assert.throws(()=>decodeBridgeReply('{"error":"x_post_uncertain","id":"123"}'),(e:unknown)=>e instanceof XPostUncertain&&e.remoteId==='123');
 assert.throws(()=>decodeBridgeReply('{"error":"x_post_rejected","status":500}'),(e:unknown)=>e instanceof Error&&!(e instanceof XHttpError));
});
test('diagnostic retains only approved metadata and drops server text and secrets',()=>{
 const diagnostic=sanitizeDiagnostic({stage:'create',http_status:200,codes:[88,'DO_NOT_LEAK'],categories:['rate_limit','DO_NOT_LEAK'],media_ids:['12','secret'],shape:{data:true,authorization:'DO_NOT_LEAK',nested_tweet:true},message:'DO_NOT_LEAK',cookie:'DO_NOT_LEAK'});
 assert.deepEqual(diagnostic,{stage:'create',http_status:200,codes:[88],categories:['rate_limit'],media_ids:['12'],shape:{data:true,nested_tweet:true}});
 assert(!JSON.stringify(diagnostic).includes('DO_NOT_LEAK'));
 assert.throws(()=>decodeBridgeReply(JSON.stringify({error:'x_post_uncertain',id:'99',diagnostic})),(e:unknown)=>e instanceof XPostUncertain&&e.remoteId==='99'&&e.diagnostic?.http_status===200);
});

test('long text requires explicit capability and one image; standard stays on ordinary route',()=>{const text='a'.repeat(359);assert.throws(()=>postingRoute(text,1),/x_long_post_capability_required/);assert.equal(postingRoute(text,1,true),'note');for(const n of [1,2,3,4]){assert.equal(postingRoute(text,n,true),'note');assert.equal(postingRoute('short',n),'standard');}assert.throws(()=>postingRoute(text,5,true),/x_media_invalid/);assert.throws(()=>postingRoute('short',5),/x_media_invalid/);assert.equal(postingRoute('a'.repeat(280),4),'standard');});
test('raw URL and Unicode boundaries use code points plus weighted limit before upload',()=>{assert.throws(()=>postingRoute('https://example.com/'+'a'.repeat(25001),1,true),/x_text_capacity/);assert.equal(postingRoute('a'.repeat(25000),4,true),'note');assert.throws(()=>postingRoute('a'.repeat(25001),1,true),/x_text_capacity/);assert.equal(postingRoute('😀'.repeat(12500),1,true),'note');assert.throws(()=>postingRoute('😀'.repeat(12501),1,true),/x_text_capacity/);assert.throws(()=>decodeBridgeReply('{"error":"x_pre_submit_rejected","status":422,"diagnostic":{"stage":"pre_submit"}}'),(e:unknown)=>e instanceof XHttpError&&e.status===422);});
