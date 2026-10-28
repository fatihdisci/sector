import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {localDatabase} from '../src/local-adapters';import {saveTelegramUpdates,processTelegramUpdates} from '../src/telegram-inbox';import type {Env} from '../src/types';
test('maintenance consumes only authenticated owner maintenance updates and preserves other queued work and offset',async()=>{
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));const env={DB} as Env;
 const message=(id:number,user:number,text:string)=>({update_id:id,message:{from:{id:user},chat:{id:1,type:'private'},text}});
 const callback=(id:number,user:number,data:string)=>({update_id:id,callback_query:{from:{id:user},message:{message_id:42,chat:{id:1,type:'private'}},data}});
 const replied={...message(6,1,'/haberfiltre'),message:{...message(6,1,'/haberfiltre').message,reply_to_message:{message_id:9}}};
 await saveTelegramUpdates(env,[message(1,1,'/secki'),message(2,2,'/haberfiltre'),message(3,1,'/haberfiltre'),callback(4,1,'nm:approve:abc'),callback(5,1,'share:x'),replied],100);
 const seen:number[]=[];const dispatch=async(u:any)=>{seen.push(u.update_id);return new Response('{}');};
 await processTelegramUpdates(env,dispatch,100,{owner:'1',chat:'1'});assert.deepEqual(seen,[3,4]);
 const rows=(await DB.prepare('SELECT update_id,state FROM telegram_updates ORDER BY update_id').all<{update_id:number;state:string}>()).results;
 assert.deepEqual(rows.map(r=>r.state),['queued','queued','complete','complete','queued','queued']);assert.equal((await DB.prepare("SELECT value FROM system_state WHERE key='telegram_offset'").first<{value:string}>())?.value,'7');
 await processTelegramUpdates(env,dispatch,100,{owner:'1',chat:'1'});assert.deepEqual(seen,[3,4]);
 await processTelegramUpdates(env,dispatch,100);assert.deepEqual(seen,[3,4,1,2,5,6]);
 await assert.rejects(processTelegramUpdates(env,dispatch,100,{owner:'invalid',chat:'1'}),/maintenance_identity_invalid/);
});
