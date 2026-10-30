import {readFile,lstat,open,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
/** Explicit one-use internal check, using this service's private API environment.
 * No job/draft, Telegram, image, or publishing path is involved.
 */
export async function newsApiCanary(o:{runtime:string;app:string;python:string;release:string;vars:NodeJS.ProcessEnv},run=async()=>{
 const r=await execute(o.python,[join(o.app,'scripts/news_api_canary.py'),o.runtime],{env:o.vars,timeout:100000,maxBuffer:8192});return JSON.parse(r.stdout);
}){
 const request=join(o.runtime,'news-api-canary.json'),result=join(o.runtime,'news-api-canary-result.json');
 try{await lstat(result);return null;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw Error('api_canary_marker_unreadable');}
 let s;try{s=await lstat(request);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('api_canary_control_unreadable');}
 if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)throw Error('api_canary_private_control_required');
 const c=JSON.parse(await readFile(request,'utf8'));
 if(Object.keys(c).sort().join(',')!=='approved,expires_at,id,release,version'||c.version!==1||c.approved!==true||c.release!==o.release||!/^[a-f0-9-]{36}$/.test(c.id)||!Number.isSafeInteger(c.expires_at)||c.expires_at<=Date.now()||c.expires_at>Date.now()+600000||o.vars.SECTOR_MODEL_PROVIDER!=='openai-api')throw Error('api_canary_not_approved');
 let marker;try{marker=await open(result,'wx',0o600);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')return null;throw Error('api_canary_marker_failed');}
 await marker.writeFile(JSON.stringify({state:'started',id:c.id,release:o.release}));await marker.close();
 let receipt;try{receipt=await run();}catch{receipt={state:'failed_no_retry',error:'api_canary_failed_no_retry'};}
 const safe:Record<string,unknown>={state:receipt.state==='completed'?'completed':'failed_no_retry',id:c.id,release:o.release,at:new Date().toISOString()};
 for(const k of ['http_status','reserved_micro_usd','actual_cost_micro_usd'])if(Number.isSafeInteger(receipt[k])&&receipt[k]>=0)safe[k]=receipt[k];
 if(receipt.model==='gpt-6.1-terra')safe.model=receipt.model;
 if(receipt.effort==='medium')safe.effort='medium';
 if(receipt.ledger_state==='settled')safe.ledger_state='settled';
 if(receipt.usage&&typeof receipt.usage==='object')safe.usage=Object.fromEntries(['input_tokens','output_tokens','cached_tokens','reasoning_tokens'].filter(k=>Number.isSafeInteger(receipt.usage[k])&&receipt.usage[k]>=0).map(k=>[k,receipt.usage[k]]));
 await writeFile(result,JSON.stringify(safe),{mode:0o600});return safe;
}
