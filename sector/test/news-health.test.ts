import test from 'node:test';
import assert from 'node:assert/strict';
import {newsFilterHealth} from '../src/news-health';

test('health exposes effective mode and generic failure reason only',()=>{
 const shadow=newsFilterHealth('shadow',['private owner binding detail','credential-shaped-value']);
 assert.deepEqual(shadow,{mode:'shadow',reason:'readiness_not_passed'});
 assert.deepEqual(newsFilterHealth('active'),{mode:'active',reason:null});
 assert.deepEqual(newsFilterHealth('unavailable'),{mode:'unavailable',reason:'readiness_unavailable'});
 assert(!JSON.stringify(shadow).includes('private'));
 assert(!JSON.stringify(shadow).includes('credential'));
});
