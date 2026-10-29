import {readFile} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {apiSettings,type ApiSettings} from '../src/model-route';
export type ModelSelection={provider:'openai-codex'|'openai-api';api?:ApiSettings;budgetPath?:string;telemetryPath?:string};
// Invoked only by the selected service at startup. Disabled does not read a file/key.
export async function loadModelSelection(vars:NodeJS.ProcessEnv,read=readFile):Promise<ModelSelection>{
 const provider=vars.SECTOR_MODEL_PROVIDER??'openai-codex';
 if(provider==='openai-codex')return {provider};
 if(provider!=='openai-api'||vars.SECTOR_OPENAI_API_ENABLED!=='true')throw Error('api_disabled');
 const path=vars.SECTOR_OPENAI_API_CONFIG,budgetPath=vars.SECTOR_OPENAI_API_BUDGET,telemetryPath=vars.SECTOR_OPENAI_API_USAGE;
 if(!path||!budgetPath||!telemetryPath||![path,budgetPath,telemetryPath].every(isAbsolute)||new Set([path,budgetPath,telemetryPath]).size!==3)throw Error('api_explicit_paths_required');
 if(!vars.SECTOR_OPENAI_API_KEY?.trim()||/[\r\n]/.test(vars.SECTOR_OPENAI_API_KEY))throw Error('api_key_missing_or_invalid');
 const raw=JSON.parse(await read(path,'utf8'));
 return {provider,api:apiSettings(raw),budgetPath,telemetryPath};
}
export type RunnerOptions={python:string;root:string;home:string;profile:string;hermesRoot:string;selection:ModelSelection;vars?:NodeJS.ProcessEnv};
export function modelInvocation(job:Record<string,unknown>,options:RunnerOptions){
 const {selection}=options,vars=options.vars??process.env;
 const base={PATH:vars.PATH??'',HOME:options.home};
 if(selection.provider==='openai-codex'){
  if(job.provider!=='openai-codex')throw Error('model_route_mismatch');
  return {script:options.root+'scripts/hermes_job.py',env:{...base,HERMES_HOME:options.profile,PYTHONPATH:options.hermesRoot,...(vars.SECTOR_USAGE_DIR?{SECTOR_USAGE_DIR:vars.SECTOR_USAGE_DIR}:{})},input:{...job,profile:options.profile}};
 }
 const c=apiSettings(selection.api);
 if(job.provider!=='openai-api'||job.model!==c.model||job.effort!==c.reasoning_effort)throw Error('model_route_mismatch');
 const key=vars.SECTOR_OPENAI_API_KEY;
 if(!key?.trim()||/[\r\n]/.test(key))throw Error('api_key_missing_or_invalid');
 if(!selection.budgetPath||!selection.telemetryPath)throw Error('api_explicit_paths_required');
 return {script:options.root+'scripts/api_job.py',env:{...base,SECTOR_OPENAI_API_ENABLED:'true',SECTOR_OPENAI_API_KEY:key},input:{job,config:c,budget_path:selection.budgetPath,telemetry_path:selection.telemetryPath}};
}
export async function runModelJob(job:Record<string,unknown>,options:RunnerOptions,spawnProcess=spawn):Promise<string>{
 const invocation=modelInvocation(job,options);
 if(typeof job.deadline!=='number'||job.deadline*1000<=Date.now())throw Error('model_deadline_expired');
 return new Promise((resolve,reject)=>{
  const child=spawnProcess(options.python,[invocation.script],{cwd:options.root,env:invocation.env,stdio:['pipe','pipe','pipe']});
  let output='',diagnostic='',bytes=0,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},Math.min(500_000,job.deadline as number*1000-Date.now()));
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>500_000){timedOut=true;child.kill('SIGKILL');}else output+=chunk.toString();});
  child.stderr.on('data',chunk=>{if(diagnostic.length<2000)diagnostic+=chunk.toString();});
  child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timer);reject(Error(selectionError(options.selection.provider)));});
  child.on('close',code=>{
   clearTimeout(timer);
   if(code===0&&!timedOut){resolve(output);return;}
   let reason=selectionError(options.selection.provider);
   if(options.selection.provider==='openai-codex')try{const value=JSON.parse(diagnostic);if(['quota_paused','hermes_auth_unavailable','subscription_turn_failed','provider_timeout','provider_unavailable','provider_request_invalid','JSONDecodeError'].includes(value.error))reason=value.error;}catch{}
   // API failures never become an existing retryable subscription error.
   reject(Error(reason));
  });
  child.stdin.end(JSON.stringify(invocation.input));
 });
}
const selectionError=(provider:string)=>provider==='openai-api'?'api_job_failed_no_retry':'hermes_job_failed';
