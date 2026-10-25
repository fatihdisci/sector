import {newsReviewArtifact} from './news_review_artifact';
import {COMPANY_CATALOG_VERSION,COMPANY_CATALOG_PROVENANCE,catalogEntities} from '../src/news-company-catalog';
import {kapDeliveryHealth} from '../src/kap-health';
import {pollBuybacks} from '../src/buyback-pipeline';
import {readBuybackImage} from './buyback_reader';
import {DatabaseSync} from 'node:sqlite';
import {pollFintablesX,fintablesPostDocuments} from '../src/fintables-x';
import {pollSpkX,spkPostDocuments} from '../src/spk-x';
import {readImage} from './image_reader';
import {KapReports} from './kap_reports';
import {publishX,refreshXButton} from '../src/x-publish';
import {xClient,validXKeys} from './x_client';
import {awaitActivation} from './startup_gate';
import {saveTelegramUpdates,processTelegramUpdates} from '../src/telegram-inbox';
import {redesignOne} from '../src/card-redesign';
import {recordModelReview} from '../src/model-recovery';
import {readFile,writeFile,open,unlink,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {localDatabase,localMedia} from '../src/local-adapters';
import {prepare} from '../src/pipeline';
import {refreshNewsRequests} from '../src/news-inbox';
import {tick,seed,deliver,errorCode} from '../src/pipeline';
import {leaseJob,submitJob,ingestOfficial} from '../src/bridge';
import {telegram} from '../src/telegram';
import {observeAccountPosts,sendDailyAccountReport} from '../src/nitter-daily-report';
import {registerTelegramCommands,TELEGRAM_COMMANDS} from '../src/telegram-commands';
import {KapStore} from '../src/kap/store';
import {KapDelivery} from '../src/kap-delivery';
import {kapDocuments} from '../src/kap-evidence';
import {readPdf,cleanupPdfArtifacts} from './pdf_reader';
import {createShutdownController,withServiceLock} from './service-lifecycle';
import {pdfRoot} from './pdf_reader';
import {isAbsolute,resolve} from 'node:path';
import {runManual} from './manual_reader';
import {draftCards} from '../src/card-pages';
import {sha256} from '../src/utils/text';
import {acceptHermes} from '../src/ai';
import {png} from './render_local';
import {scanOfficial} from './official_bridge';
import worker from '../src/worker';
import type {Env,Document,Draft} from '../src/types';
const directory=`${homedir()}/Library/Application Support/sector-haber`;
const secrets=JSON.parse(await readFile(directory+'/secrets.json','utf8'));
const env={...secrets,DB:await localDatabase(directory+'/sector-haber.sqlite',await readFile('migrations/0001_sector.sql','utf8')),MEDIA:await localMedia(directory+'/media'),MODE:'telegram_review',AI_MODEL:'gpt-6-luna',AI_EFFORT:'medium',AI_DAILY_DRAFT_LIMIT:'240'} as Env;
try{const keys=JSON.parse(await readFile(directory+'/x-credentials.json','utf8'));if(validXKeys(keys))env.X_PUBLISH_ENABLED='true';}catch{/* X stays disabled until credentials are saved locally. */}
env.RENDER_REPORT=png;
env.READ_SPK_X=async manifest=>{const post=JSON.parse(manifest);return post.cached_documents??(post.url?.startsWith('https://x.com/fintables/status/')?fintablesPostDocuments(post,readPdf,readImage):spkPostDocuments(post,readPdf,readImage));};
await seed(env);
const lockPath=directory+'/service.lock';let lock;
try{lock=await open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));}
catch{try{const pid=Number(await readFile(lockPath,'utf8'));process.kill(pid,0);throw new Error('service_already_running');}catch(e){if((e as NodeJS.ErrnoException).code!=='ESRCH')throw e;await unlink(lockPath);lock=await open(lockPath,'wx',0o600);await lock.writeFile(String(process.pid));}}
const shutdown=createShutdownController(process),pause=shutdown.pause;
const stopping=()=>shutdown.stopping;
async function status(key:string,value:unknown){await env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value)).run();}
async function cleanupSourceArtifacts(){
 const protectedPaths=new Set<string>();
 const collect=(value:unknown):void=>{if(typeof value==='string'){if(isAbsolute(value))protectedPaths.add(resolve(value));return;}if(Array.isArray(value)){for(const item of value)collect(item);return;}if(value&&typeof value==='object')for(const item of Object.values(value))collect(item);};
 const jobs=await env.DB.prepare("SELECT documents FROM model_jobs WHERE state IN ('queued','retry_pending','leased','needs_review')").all<{documents:string}>();
 for(const row of jobs.results??[])try{collect(JSON.parse(row.documents));}catch{/* ignore malformed stale evidence */}
 const articles=await env.DB.prepare("SELECT document FROM articles WHERE status IN ('queued','model_queued') AND document IS NOT NULL").all<{document:string}>();
 for(const row of articles.results??[])try{collect(JSON.parse(row.document));}catch{/* ignore malformed stale evidence */}
 await cleanupPdfArtifacts(pdfRoot,Date.now(),24*3600_000,[...protectedPaths]);
}
let lastArtifactCleanup=0;
async function modelLoop(){while(!stopping()){let job:Awaited<ReturnType<typeof leaseJob>>=null;
 const started=Date.now();
 try {
  const paused=await env.DB.prepare("SELECT value FROM system_state WHERE key='model_paused_until'").first<{value:string}>();
  if(Number(paused?.value??0)>Date.now()){await pause(30_000);continue;}
  job=await leaseJob(env);if(!job){await pause(2_000);continue;}
  const output=await new Promise<string>((resolve,reject)=>{
   const child=spawn(`${homedir()}/.hermes/hermes-agent/venv/bin/python`,['scripts/hermes_job.py'],{env:{PATH:process.env.PATH??'',HOME:homedir(),HERMES_HOME:`${homedir()}/.hermes/profiles/sectorhaber`,PYTHONPATH:`${homedir()}/.hermes/hermes-agent`},stdio:['pipe','pipe','pipe']});let result='';
   let diagnostic='';const timer=setTimeout(()=>child.kill('SIGTERM'),500_000);child.stdout.on('data',chunk=>{result+=chunk.toString();if(result.length>500_000)child.kill('SIGTERM');});child.stderr.on('data',chunk=>{if(diagnostic.length<2000)diagnostic+=chunk.toString();});
   child.on('error',reject);child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(result);else {let reason='hermes_job_failed';try{const value=JSON.parse(diagnostic);if(['quota_paused','hermes_auth_unavailable','subscription_turn_failed','JSONDecodeError'].includes(value.error))reason=value.error;}catch{}reject(new Error(reason));}});
   child.stdin.end(JSON.stringify({...job,profile:`${homedir()}/.hermes/profiles/sectorhaber`}));
  });
  const result=JSON.parse(output) as {draft:Draft;audit:unknown;runtime:unknown};
  await writeFile(directory+'/last-model-result.json',JSON.stringify({job_id:job.id,result}),{mode:0o600});
  await recordModelReview(env,job.id,result.audit);
  const documents=job.documents as Document[];result.draft=acceptHermes(result.draft,result.audit,documents).draft;
  const date=new Date().toLocaleDateString('tr-TR',{timeZone:'Europe/Istanbul'}),svgs=draftCards(result.draft,job.card_theme==='navy'||job.card_theme==='paper'?job.card_theme:undefined,job.card_layout);
 const cards=[];for(const svg of svgs)cards.push({svg_hash:await sha256(svg),png_base64:Buffer.from(await png(svg)).toString('base64')});
  const delivered=await submitJob(env,{id:job.id,lease_token:job.lease_token,input_hash:job.input_hash,...result,card_date:date,cards});
  await deliver(env);await status('model_health',{ok:true,at:new Date().toISOString(),draft_id:delivered.id,duration_ms:Date.now()-started});
 }catch(e){if(job)await env.DB.prepare("UPDATE model_jobs SET state='needs_review',error=? WHERE id=? AND state='leased'").bind(errorCode(e),job.id).run();await status('model_health',{ok:false,at:new Date().toISOString(),code:errorCode(e),duration_ms:Date.now()-started});if(e instanceof Error&&['quota_paused','hermes_auth_unavailable'].includes(e.message))await status('model_paused_until',Date.now()+3600_000);await pause(e instanceof Error&&['quota_paused','hermes_auth_unavailable','subscription_turn_failed','hermes_job_failed'].includes(e.message)?60_000:2_000);}
}}
async function newsLoop(){let official=0;while(!stopping()){try{await tick(env);await status('collector_health',{ok:true,at:new Date().toISOString()});if(Date.now()-official>10*60_000){try{await scanOfficial(async(_path,value)=>ingestOfficial(env,value as Record<string,unknown>),directory+'/official-state.json');official=Date.now();await status('official_health',{ok:true,at:new Date().toISOString()});}catch(e){await status('official_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}}}catch(e){await status('collector_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}if(Date.now()-lastArtifactCleanup>=60*60_000){try{await cleanupSourceArtifacts();lastArtifactCleanup=Date.now();}catch(e){await status('artifact_cleanup_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}}await pause(60_000);}}
async function buybackLoop(){while(!stopping()){try{
 const result=await pollBuybacks(env,{readImage:readBuybackImage,indices:async()=>{let db:DatabaseSync|undefined;try{db=new DatabaseSync(directory+'/kap/kap.sqlite',{readOnly:true});if(Number(db.prepare('PRAGMA application_id').get()!.application_id)!==0x534B4150)return null;const row=db.prepare("SELECT value FROM settings WHERE key='indices'").get();return row?JSON.parse(String(row.value)):null;}catch{return null;}finally{db?.close();}}});
 await status('buyback_report_health',{ok:!['needs_review','blocked_existing'].includes(result.state),at:new Date().toISOString(),...result});
 }catch(e){await status('buyback_report_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}await pause(10*60_000);}}
async function fintablesXLoop(){while(!stopping()){try{await pollFintablesX(env);}catch(e){await status('fintables_x_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}await pause(10_000);}}
async function spkXLoop(){while(!stopping()){try{await pollSpkX(env);}catch(e){await status('spk_x_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}await pause(10_000);}}
async function xAccountReportLoop(){let nextPoll=0;while(!stopping()){
 const now=Date.now();
 if(now>=nextPoll){try{await observeAccountPosts(env,now);}catch(e){await status('nitter_account_health',{ok:false,at:now,code:errorCode(e)});}nextPoll=Date.now()+5*60_000;}
 try{const result=await sendDailyAccountReport(env,Date.now());if(result.state==='sent')await status('nitter_daily_report_health',{ok:true,at:new Date().toISOString(),state:'sent'});}catch(e){await status('nitter_daily_report_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}
 await pause(15_000);
}}
async function designLoop(){while(!stopping()){try{await redesignOne(env,png);}catch(e){await status('design_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}await pause(1000);}}
async function xLoop(){while(!stopping()){try{
 const keys=JSON.parse(await readFile(directory+'/x-credentials.json','utf8'));
 if(validXKeys(keys)){env.X_PUBLISH_ENABLED='true';await publishX(env,xClient(keys));await refreshXButton(env);}
 }catch{env.X_PUBLISH_ENABLED=undefined;}await pause(2000);}}
async function deliveryLoop(){while(!stopping()){try{await deliver(env);}catch(e){await status('delivery_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}await pause(10_000);}}
async function kapLoop(){
 // Absence of the separate KAP database must not create/bootstrap one here.
 const path=directory+'/kap/kap.sqlite';let store:KapStore|undefined,consumer:KapDelivery|undefined;
 while(!stopping()){try{
  if(!store){await access(path);store=new KapStore(path);consumer=new KapDelivery(store,env,id=>kapDocuments(id,readPdf));const reports=new KapReports(store);env.KAP_REPORT=(kind,at,prefs)=>reports.build(kind,at,Date.now(),prefs);env.KAP_DELIVERY_CHECK=documents=>consumer!.deliveryDecision(documents);}
  const result=await consumer!.run();await status('kap_delivery_health',{...kapDeliveryHealth(result.state),review_pending:consumer?consumer.reviewSummary():[],at:new Date().toISOString(),...result});
 }catch(e){await status('kap_delivery_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}
 await pause(5_000);}
 delete env.KAP_DELIVERY_CHECK;store?.close();
}
async function requestsLoop(){while(!stopping()){try{await refreshNewsRequests(env);await prepare(env);}catch(e){await status('news_requests_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}await pause(5_000);}}
async function reportCacheLoop(){let store:KapStore|undefined,reports:KapReports|undefined;while(!stopping()){try{if(!store){await access(directory+'/kap/kap.sqlite');store=new KapStore(directory+'/kap/kap.sqlite');reports=new KapReports(store);}await reports!.cacheOne();}catch(e){await status('kap_report_health',{ok:false,code:errorCode(e)});}await pause(5_000);}store?.close();}
async function manualLoop(){while(!stopping()){try{await runManual(env);}catch(e){await status('manual_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}await pause(5_000);}}
async function telegramLoop(){
 let offset=Number((await env.DB.prepare("SELECT value FROM system_state WHERE key='telegram_offset'").first<{value:string}>())?.value??0);
 while(!stopping()){try{
  const result=await telegram(env,'getUpdates',new URLSearchParams({offset:String(offset),timeout:'15',allowed_updates:JSON.stringify(['callback_query','message'])}));
  const updates=result as unknown as {update_id:number}[];
  offset=await saveTelegramUpdates(env,updates)??offset;
  await processTelegramUpdates(env,update=>worker.fetch(new Request('https://local.sector/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':env.TELEGRAM_WEBHOOK_SECRET!,'Content-Type':'application/json'},body:JSON.stringify(update)}),env,{waitUntil:()=>{}} as unknown as ExecutionContext));
  await status('telegram_health',{ok:true,at:new Date().toISOString()});
 }catch(e){await status('telegram_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});await pause(10_000);}}
}
async function telegramCommandsLoop(){
 let retry=0;
 while(!stopping()){
  try{await registerTelegramCommands(env);retry=0;await status('telegram_commands_health',{ok:true,at:new Date().toISOString(),count:TELEGRAM_COMMANDS.length});await pause(24*3600_000);}
  catch(e){retry++;await status('telegram_commands_health',{ok:false,at:new Date().toISOString(),code:errorCode(e),retry});await pause(Math.min(15*60_000,30_000*retry));}
 }
}
try{await withServiceLock(lock,()=>unlink(lockPath),async()=>{
 await status('runtime_identity',{release:process.env.SECTOR_RELEASE_ID??'unknown',catalog:{version:COMPANY_CATALOG_VERSION,companies:new Set(catalogEntities.map(c=>c.code)).size,issuers:COMPANY_CATALOG_PROVENANCE.issuer_count,equity_codes:COMPANY_CATALOG_PROVENANCE.equity_count},news_review_artifact:await newsReviewArtifact(process.cwd()),at:new Date().toISOString()});
 await writeFile(directory+'/service-ready.json',JSON.stringify({pid:process.pid,release:process.env.SECTOR_RELEASE_ID??'',started_at:new Date().toISOString()}),{mode:0o600});
 await cleanupSourceArtifacts().catch(()=>0);lastArtifactCleanup=Date.now();
 if(!await awaitActivation(directory,process.env.SECTOR_RELEASE_ID,()=>stopping()))return;
 if(process.argv.includes('--prepare-once')){await tick(env);console.log('Sources scanned and model jobs prepared.');return;}
 if(process.argv.includes('--model-once')){ // run one fully checked job for commissioning
  const stopCheck=setInterval(async()=>{const completed=await env.DB.prepare("SELECT COUNT(*) AS n FROM model_jobs WHERE state='complete'").first<{n:number}>();if((completed?.n??0)>0){shutdown.stop();clearInterval(stopCheck);}},1000);
  try{await modelLoop();}finally{clearInterval(stopCheck);}return;
 }
 await Promise.all([buybackLoop(),spkXLoop(),fintablesXLoop(),xAccountReportLoop(),newsLoop(),modelLoop(),telegramLoop(),telegramCommandsLoop(),deliveryLoop(),kapLoop(),manualLoop(),reportCacheLoop(),requestsLoop(),designLoop(),xLoop()]);
});}finally{shutdown.dispose();}
