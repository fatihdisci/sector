// Offline by default. No live service import, Telegram fetch or X consumer.
import {readFile,writeFile,access,chmod} from 'node:fs/promises';
import {resolve,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';import {spawn} from 'node:child_process';
import {homedir,tmpdir} from 'node:os';
import {localDatabase,localMedia} from '../src/local-adapters';
import {manualDocuments} from './manual_reader';
import {enqueueEvidence} from '../src/ingest';import {leaseJob,submitJob} from '../src/bridge';import {acceptHermes} from '../src/ai';
import {createOwnerVisualRuntime,renderModelJob} from './owner_visual_runtime';import {runModelJob,type ModelSelection} from './model_runner';
import type {Env,Draft} from '../src/types';
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
export interface TrialOptions {mode?:'dry-run'|'mock'|'real';bundle?:any;vars?:NodeJS.ProcessEnv;invokeVisual?:(value:any,env:NodeJS.ProcessEnv)=>Promise<any>;runText?:(job:any)=>Promise<any>;closePlan?:(bundle:any)=>Promise<void>;}
async function pythonCommand(bundle:any,operation:'preflight'|'finish'){
 return new Promise<void>((yes,no)=>{const script=operation==='preflight'?"import json,sys;from api_launcher import preflight;v=json.load(sys.stdin);preflight(v,promo_verifier=lambda e:e)":"import json,sys;from shared_api_budget import SharedBudget;v=json.load(sys.stdin);b=SharedBudget(v['budget_path'],v['text_config']['shared_budget']);b.close_unused_plan();b.db.close()";
 const c=spawn(bundle.python_path,['-c',script],{cwd:sourceRoot,env:{PATH:process.env.PATH??'',PYTHONPATH:sourceRoot+'scripts',TMPDIR:tmpdir()},stdio:['pipe','ignore','ignore']});c.on('error',()=>no(Error('trial_preflight_failed')));c.on('close',n=>n===0?yes():no(Error('trial_preflight_failed')));c.stdin.end(JSON.stringify(bundle));});
}
export async function runIsolatedTrial(options:TrialOptions={}){
 const mode=options.mode??'dry-run';if(mode==='dry-run')return {state:'dry_run',network:false,credential_lookup:false};
 const b=options.bundle,vars=options.vars??{};
 if(!b||b.enabled!==true)throw Error('trial_disabled');
 if(mode==='mock'&&(!options.invokeVisual||!options.runText||!options.closePlan))throw Error('trial_mock_transports_required');
 if(mode==='real'&&(vars.SECTOR_API_ISOLATED_REAL_APPROVED!=='true'||!vars.SECTOR_OPENAI_API_KEY||options.invokeVisual||options.runText||options.closePlan))throw Error('trial_real_approval_required');
 const root=resolve(b.trial_root),live=resolve(homedir(),'Library/Application Support/sector-haber');
 if(!isAbsolute(b.trial_root)||root===live||root.startsWith(live+'/')||b.media_backend!=='local'||resolve(b.media_path)!==root+'/media'||resolve(b.source_path)!==root+'/source.png'||resolve(b.budget_path)!==root+'/shared-budget.sqlite')throw Error('trial_isolation_required');
 await pythonCommand(b,'preflight');
 const dbPath=root+'/trial.sqlite';try{await access(dbPath);throw Error('trial_database_already_exists')}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const textPath=root+'/text.json',visualPath=root+'/visual.json';await writeFile(textPath,JSON.stringify(b.text_config),{mode:0o600});await writeFile(visualPath,JSON.stringify(b.visual_config),{mode:0o600});
 const DB=await localDatabase(dbPath,await readFile(sourceRoot+'migrations/0001_sector.sql','utf8'));await chmod(dbPath,0o600);
 const env={DB,MEDIA:await localMedia(b.media_path),MODE:'dry_run',AI_MODEL:'gpt-6.1-terra',AI_EFFORT:'low',AI_PROVIDER:'openai-api',AI_API_CONFIG:b.text_config}as Env;
 const baseVars={PATH:vars.PATH??'',HOME:homedir(),SECTOR_OPENAI_API_KEY:mode==='mock'?'OFFLINE-FAKE-NOT-A-CREDENTIAL':vars.SECTOR_OPENAI_API_KEY,SECTOR_OWNER_VISUAL_ENABLED:'true',SECTOR_OWNER_VISUAL_CONFIG:visualPath,SECTOR_OWNER_VISUAL_BUDGET:b.budget_path,SECTOR_OWNER_VISUAL_USAGE:root+'/visual-usage.jsonl'};
 env.OWNER_VISUAL=await createOwnerVisualRuntime(env,{root:sourceRoot,python:b.python_path,vars:baseVars,invoke:options.invokeVisual});
 const docs=await manualDocuments(env,'image',JSON.stringify({text:b.source_text??'',owner_message_text:b.owner_text??'',source_caption_original:b.caption??'',editor_request:b.instructions??'',submitted_at:b.submitted_at,source_message_id:1,image:{file_id:'isolated-local-source'}}),2,undefined,async()=>new Uint8Array(await readFile(b.source_path)));
 if(docs[0].owner_visual!.analysis.facts.length>8)throw Error('trial_source_exceeds_single_page');
 await enqueueEvidence(env,docs,'manual',b.instructions??'');const job=await leaseJob(env);if(!job)throw Error('trial_lease_missing');
 const selection:ModelSelection={provider:'openai-api',api:b.text_config,budgetPath:b.budget_path,telemetryPath:root+'/text-usage.jsonl'};
 const result=mode==='mock'?await options.runText!(job):JSON.parse(await runModelJob(job,{python:b.python_path,root:sourceRoot,home:homedir(),profile:'',hermesRoot:'',selection,vars:baseVars}));
 result.draft=acceptHermes(result.draft,result.audit,job.documents,job.edit_request).draft as Draft;
 const rendered=await renderModelJob(env,job,result.draft,async()=>{throw Error('trial_code_fallback_forbidden')});
 const delivered=await submitJob(env,{id:job.id,lease_token:job.lease_token,input_hash:job.input_hash,...result,...rendered});
 const duplicate=await submitJob(env,{id:job.id,lease_token:job.lease_token,input_hash:job.input_hash,...result,...rendered});
 const x=await DB.prepare('SELECT COUNT(*) n FROM x_posts').first<{n:number}>();if(x?.n!==0||!duplicate.duplicate)throw Error('trial_side_effect_or_replay');
 if(mode==='mock')await options.closePlan!(b);else await pythonCommand(b,'finish');
 const summary={state:'completed',mode,draft_id:delivered.id,duplicate_submit_deduplicated:true,x_jobs:0,telegram_calls:0,real_api:mode==='real',media_path:b.media_path};await writeFile(root+'/trial-summary.json',JSON.stringify(summary),{mode:0o600});return summary;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(!process.argv.includes('--approved-real'))console.log(JSON.stringify(await runIsolatedTrial()));else{let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>2_000_000)throw Error('trial_input_limit')}const r=await runIsolatedTrial({mode:'real',bundle:JSON.parse(raw),vars:process.env});console.log(JSON.stringify({state:r.state}));}}catch{console.error('{"error":"isolated_trial_failed_no_retry"}');process.exitCode=1;}
}
