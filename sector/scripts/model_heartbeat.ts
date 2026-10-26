import type{Env}from'../src/types';
// A heartbeat measures worker liveness, not success of the last completed job.
// It owns no job/lease/delivery state and never retries external work.
export async function withModelHeartbeat<T>(env:Env,run:()=>Promise<T>,period=15_000):Promise<T>{
 let pending=Promise.resolve();
 const beat=(stopped=false)=>{pending=pending.catch(()=>{}).then(async()=>{await env.DB.prepare("INSERT INTO system_state(key,value) VALUES('model_worker_heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({at:new Date().toISOString(),stopped})).run();});return pending;};
 await beat();const timer=setInterval(()=>{void beat().catch(()=>{});},period);
 try{return await run();}finally{clearInterval(timer);await beat(true).catch(()=>{});}
}
