import type {Env} from './types';
const seconds=()=>Math.floor(Date.now()/1000);
// Offset acknowledges durable storage, not successful external execution. One
// poison update cannot block later requests, and a crash cannot lose a batch.
export async function saveTelegramUpdates(env:Env,updates:{update_id:number}[],time=seconds()):Promise<number|null>{
 if(!updates.length)return null;
 if(updates.some(u=>!Number.isSafeInteger(u.update_id)||u.update_id<0))throw Error('invalid_update_id');
 const offset=Math.max(...updates.map(u=>u.update_id))+1;
 await env.DB.batch([
  ...updates.map(u=>env.DB.prepare('INSERT OR IGNORE INTO telegram_updates(update_id,payload,created_at) VALUES(?,?,?)').bind(u.update_id,JSON.stringify(u),time)),
  env.DB.prepare("INSERT INTO system_state(key,value) VALUES('telegram_offset',?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(system_state.value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)").bind(String(offset))
 ]);
 return offset;
}
export async function processTelegramUpdates(env:Env,dispatch:(value:unknown)=>Promise<Response>,time=seconds(),maintenance?:{owner:string;chat:string}):Promise<void>{
 if(maintenance&&(!/^[1-9]\d*$/.test(maintenance.owner)||!/^[1-9]\d*$/.test(maintenance.chat)||!Number.isSafeInteger(Number(maintenance.owner))||!Number.isSafeInteger(Number(maintenance.chat))))throw Error('maintenance_identity_invalid');
 const filter=maintenance?` AND json_valid(payload) AND ((json_extract(payload,'$.message.from.id')=? AND json_extract(payload,'$.message.chat.id')=? AND json_extract(payload,'$.message.chat.type')='private' AND json_extract(payload,'$.message.text')='/haberfiltre' AND json_type(payload,'$.message.reply_to_message') IS NULL AND json_type(payload,'$.message.forward_origin') IS NULL) OR (json_extract(payload,'$.callback_query.from.id')=? AND json_extract(payload,'$.callback_query.message.chat.id')=? AND json_extract(payload,'$.callback_query.message.chat.type')='private' AND json_extract(payload,'$.callback_query.data') GLOB 'nm:approve:*'))`:'';
 const args=maintenance?[Number(maintenance.owner),Number(maintenance.chat),Number(maintenance.owner),Number(maintenance.chat)]:[];
 await env.DB.prepare("UPDATE telegram_updates SET state='queued' WHERE state='processing' AND lease_until<=?"+filter).bind(time,...args).run();
 const rows=await env.DB.prepare("SELECT update_id,payload,attempts FROM telegram_updates WHERE state='queued' AND next_try<=?"+filter+" ORDER BY update_id LIMIT 10").bind(time,...args).all<{update_id:number;payload:string;attempts:number}>();
 for(const row of rows.results??[]){
  if(row.attempts>=3){await env.DB.prepare("UPDATE telegram_updates SET state='uncertain',payload='{}',error='update_interrupted',finished_at=? WHERE update_id=? AND state='queued'").bind(time,row.update_id).run();continue;}
  const lock=await env.DB.prepare("UPDATE telegram_updates SET state='processing',attempts=attempts+1,lease_until=? WHERE update_id=? AND state='queued'").bind(time+120,row.update_id).run();if(!lock.meta.changes)continue;
  let failure='retryable',code='update_dispatch_failed',delay=30;
  try{
   const response=await dispatch(JSON.parse(row.payload));
   if(response.ok){await env.DB.prepare("UPDATE telegram_updates SET state='complete',payload='{}',error=NULL,lease_until=0,finished_at=? WHERE update_id=?").bind(time,row.update_id).run();continue;}
   const result=await response.json() as {failure?:string;error?:string;retry_after?:number};
   if(['permanent','uncertain','retryable'].includes(result.failure??''))failure=result.failure!;
   if(typeof result.error==='string'&&/^[a-z][a-z0-9_]{2,70}$/.test(result.error))code=result.error;
   if(Number.isFinite(result.retry_after))delay=Math.min(3600,Math.max(1,result.retry_after!));
  }catch{/* Effect receipts prevent replay of successful or ambiguous sends. */}
  const state=failure==='uncertain'?'uncertain':failure==='permanent'||row.attempts+1>=3?'failed':'queued';
  await env.DB.prepare("UPDATE telegram_updates SET state=?,error=?,lease_until=0,next_try=?,finished_at=?,payload=CASE WHEN ?='queued' THEN payload ELSE '{}' END WHERE update_id=?").bind(state,code,time+Math.max(delay,30*2**row.attempts),state==='queued'?null:time,state,row.update_id).run();
 }
}
