import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadModelSelection,type ModelSelection} from './model_runner';
const execute=promisify(execFile);
type Options={runtime:string;python:string;app:string;gate?:(root:string)=>Promise<void>;credential?:()=>Promise<string>};
/** API remains opt-in. Only this news process holds the key; never global process.env or plist. */
export async function loadNewsModelRuntime(vars:NodeJS.ProcessEnv,o:Options):Promise<{selection:ModelSelection;vars:NodeJS.ProcessEnv}>{
 const control=join(o.runtime,'news-api-provider.json');
 try{await lstat(control);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw Error('news_api_control_unreadable');if(vars.SECTOR_MODEL_PROVIDER==='openai-api')throw Error('news_api_control_required');return{selection:await loadModelSelection(vars),vars};}
 const s=await lstat(control);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.uid!==process.getuid?.())throw Error('news_api_private_file_required');
 const c=JSON.parse(await readFile(control,'utf8'));
 if(c.version!==1||c.provider!=='openai-api'||c.enabled!==true||c.purpose!=='news_text_only'||Object.keys(c).length!==4)throw Error('news_api_provider_not_approved');
 if(vars.SECTOR_OWNER_VISUAL_ENABLED==='true')throw Error('news_api_visual_forbidden');
 // Python validates the shared atomic budget, explicit budget policy and rates before lookup.
 try{await (o.gate??(async root=>{const r=await execute(o.python,[join(o.app,'scripts/news_api_preflight.py'),root,'--startup'],{timeout:15000,maxBuffer:4096});if(JSON.parse(r.stdout).ready!==true)throw Error();}))(o.runtime);}catch{throw Error('news_api_preflight_failed');}
 let key:string;
 try{key=await(o.credential??(async()=>{const r=await execute('/usr/bin/security',['find-generic-password','-s','sectorhaber-openai-api','-a','sectorhaber-news','-w'],{timeout:15000,maxBuffer:16384});return r.stdout.replace(/[\r\n]+$/,'');}))();}catch{throw Error('news_api_keychain_unavailable');}
 if(!key?.trim()||key.length>8192||/[\r\n\0]/.test(key))throw Error('news_api_keychain_invalid');
 const childVars={...vars,SECTOR_MODEL_PROVIDER:'openai-api',SECTOR_OPENAI_API_ENABLED:'true',SECTOR_OPENAI_API_CONFIG:join(o.runtime,'news-api-config.json'),SECTOR_OPENAI_API_BUDGET:join(o.runtime,'news-api-budget.sqlite'),SECTOR_OPENAI_API_USAGE:join(o.runtime,'news-api-usage.jsonl'),SECTOR_OPENAI_API_KEY:key};
 try{return {selection:await loadModelSelection(childVars),vars:childVars};}catch{throw Error('news_api_configuration_invalid');}
}

/** The normal, stricter gate must pass before a job is leased or a canary runs. */
export async function newsApiBudgetAvailable(o:Pick<Options,'runtime'|'python'|'app'>,run=execute):Promise<boolean>{
 try{const r=await run(o.python,[join(o.app,'scripts/news_api_preflight.py'),o.runtime],{timeout:15000,maxBuffer:4096});return JSON.parse(r.stdout).ready===true;}catch{return false;}
}
