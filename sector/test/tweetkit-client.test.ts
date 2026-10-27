import test from 'node:test';import assert from 'node:assert/strict';
import {decodeBridgeReply} from '../scripts/tweetkit_client';import {XHttpError,XPostUncertain} from '../src/x-publish';
test('bridge maps definite rejection to typed status and preserves uncertain ID',()=>{
 assert.throws(()=>decodeBridgeReply('{"error":"x_post_rejected","status":403}'),(e:unknown)=>e instanceof XHttpError&&e.status===403);
 assert.throws(()=>decodeBridgeReply('{"error":"x_post_uncertain","id":"123"}'),(e:unknown)=>e instanceof XPostUncertain&&e.remoteId==='123');
 assert.throws(()=>decodeBridgeReply('{"error":"x_post_rejected","status":500}'),(e:unknown)=>e instanceof Error&&!(e instanceof XHttpError));
});
