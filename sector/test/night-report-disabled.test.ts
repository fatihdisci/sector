import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('local service does not start the night account observer or report',async()=>{
 const service=await readFile('scripts/local_service.ts','utf8');
 assert.doesNotMatch(service,/xAccountReportLoop|observeAccountPosts|sendDailyAccountReport|nitter-daily-report/);
 assert.match(service,/async function xLoop\(\)/);
 assert.match(service,/async function kapLoop\(\)/);
 assert.match(service,/async function channelLoop\(\)/);
});
