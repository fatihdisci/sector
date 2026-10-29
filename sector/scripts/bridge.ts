import {createOwnerVisualRuntime,renderModelJob} from './owner_visual_runtime';
import {localMedia} from '../src/local-adapters';
import type {Env} from '../src/types';
import {loadModelSelection,runModelJob} from './model_runner';
import {isCardLayout} from '../src/card-layout';
import {readFile,writeFile,mkdir,unlink,open} from 'node:fs/promises';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {png} from './render_local';
import {draftCards} from '../src/card-pages';
import {sha256} from '../src/utils/text';
import {acceptHermes} from '../src/ai';
import type {Draft,Document} from '../src/types';
import {scanOfficial} from './official_bridge';
type Config={url:string;token:string;hermesPython:string;hermesRoot:string;profile:string};
const root=fileURLToPath(new URL('../',import.meta.url));
const configPath=process.env.SECTOR_CONFIG??`${homedir()}/Library/Application Support/sector-haber/bridge.json`;
const config=JSON.parse(await readFile(configPath,'utf8')) as Config;
const modelSelection=await loadModelSelection(process.env);
const visualEnv={MEDIA:await localMedia(`${homedir()}/Library/Application Support/sector-haber/media`)}as Env;
visualEnv.OWNER_VISUAL=await createOwnerVisualRuntime(visualEnv,{root,python:config.hermesPython});
const base=new URL(config.url);if(base.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(base.hostname))throw new Error('https_required');
async function api(path:string,payload:unknown):Promise<unknown> {
 const r=await fetch(new URL(path,base),{method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(40_000)});
 if(!r.ok)throw new Error(`bridge_http_${r.status}`);return r.json();
}
async function run():Promise<void> {
 if(Date.now()-lastOfficial>10*60_000){try{await scanOfficial(api,configPath+'.official-state');lastOfficial=Date.now();}catch{lastOfficial=Date.now()-8*60_000;}}
 const job=await api('/api/bridge/lease',{}) as Record<string,unknown>|null;if(!job)return;
 job.profile=config.profile;
 const output=await runModelJob(job,{python:config.hermesPython,root,home:homedir(),profile:config.profile,hermesRoot:config.hermesRoot,selection:modelSelection});
 const result=JSON.parse(output) as {draft:Draft;audit:unknown;runtime:unknown};
 const documents=job.documents as Document[];result.draft=acceptHermes(result.draft,result.audit,documents,job.kind==='edit'?job.edit_request as string:null).draft;
 const date=new Date().toLocaleDateString('tr-TR',{timeZone:'Europe/Istanbul'});
 const rendered=await renderModelJob(visualEnv,job as any,result.draft,async()=>{const svgs=draftCards(result.draft,job.card_theme==='navy'||job.card_theme==='paper'?job.card_theme:undefined,isCardLayout(job.card_layout)?job.card_layout:undefined);const cards=[];for(const svg of svgs)cards.push({svg_hash:await sha256(svg),png_base64:Buffer.from(await png(svg)).toString('base64')});return cards;});const {cards}=rendered;
 await api('/api/bridge/result',{id:job.id,lease_token:job.lease_token,input_hash:job.input_hash,...result,...rendered,card_date:date,cards});
}
const lockPath=configPath+'.lock';let lock;
try{lock=await open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));}
catch{try{const pid=Number(await readFile(lockPath,'utf8'));process.kill(pid,0);throw new Error('bridge_already_running');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;await unlink(lockPath);lock=await open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));}}
let stopping=false;process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
let lastOfficial=0;
try {do {try{await run();await writeFile(configPath+'.status',JSON.stringify({checked_at:new Date().toISOString(),ok:true}),{mode:0o600});}catch{await writeFile(configPath+'.status',JSON.stringify({checked_at:new Date().toISOString(),ok:false,error:'bridge_job_or_connection_failed'}),{mode:0o600});}if(process.argv.includes('--once')||stopping)break;await new Promise(r=>setTimeout(r,30_000));}while(!stopping);}
finally{await lock.close();await unlink(lockPath).catch(()=>{});}
