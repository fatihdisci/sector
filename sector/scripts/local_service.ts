import {createOwnerVisualRuntime,renderModelJob} from './owner_visual_runtime';
import {loadModelSelection,runModelJob} from './model_runner';
import {modelFailureCode,type ModelStage} from './model_failure';
import {withModelHeartbeat} from './model_heartbeat';
import{pollChannel,channelDocuments,CHANNEL_POLL_MS}from'../src/telegram-channel';
import{channelTransport}from'./channel_reader';
import {newsReviewArtifact} from './news_review_artifact';
import {newsPreferences} from '../src/news-routing';
import {maintenanceApproved} from '../src/news-maintenance-request';
import {maintenanceCandidateForRuntime} from '../src/news-maintenance-store';
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
import {tweetkitClient,tweetkitReady} from './tweetkit_client';
import {awaitActivation} from './startup_gate';
import {saveTelegramUpdates,processTelegramUpdates} from '../src/telegram-inbox';
import {redesignOne} from '../src/card-redesign';
import {recordModelReview} from '../src/model-recovery';
import {readFile,writeFile,open,unlink,access} from 'node:fs/promises';
import {homedir} from 'node:os';
import {localDatabase,localMedia} from '../src/local-adapters';
import {prepare} from '../src/pipeline';
import {announceNews,refreshNewsRequests} from '../src/news-inbox';
import {tick,seed,deliver,errorCode} from '../src/pipeline';
import {leaseJob,submitJob,ingestOfficial} from '../src/bridge';
import {telegram} from '../src/telegram';
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
const env={...secrets,DB:await localDatabase(directory+'/sector-haber.sqlite',(await readFile('migrations/0001_sector.sql','utf8'))+'\n'+(await readFile('migrations/0008_kap_previews.sql','utf8'))),MEDIA:await localMedia(directory+'/media'),MODE:'telegram_review',AI_MODEL:'gpt-6.1-terra',AI_EFFORT:'low',AI_DAILY_DRAFT_LIMIT:'240'} as Env;
const modelSelection=await loadModelSelection(process.env);
env.AI_PROVIDER=modelSelection.provider;env.AI_API_CONFIG=modelSelection.api;
env.OWNER_VISUAL=await createOwnerVisualRuntime(env,{root:process.cwd()+'/',python:`${homedir()}/.hermes/hermes-agent/venv/bin/python`});
env.RENDER_REPORT=png;
env.READ_SPK_X=async manifest=>{const post=JSON.parse(manifest);return post.cached_documents??(post.url?.startsWith('https://x.com/fintables/status/')?fintablesPostDocuments(post,readPdf,readImage):spkPostDocuments(post,readPdf,readImage));};
env.READ_TELEGRAM_CHANNEL=async raw=>{const m=JSON.parse(raw);if(Date.now()-m.captured_at>86400000)throw Error('channel_evidence_expired');return m.cached_documents??channelDocuments(raw,channelTransport,readImage,readPdf);};
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
 const started=Date.now();let stage:ModelStage='lease';
 try {
  const paused=await env.DB.prepare("SELECT value FROM system_state WHERE key='model_paused_until'").first<{value:string}>();
  if(Number(paused?.value??0)>Date.now()){await pause(30_000);continue;}
  job=await leaseJob(env);if(!job){await pause(2_000);continue;}
  stage='generate';const output=await runModelJob(job,{python:`${homedir()}/.hermes/hermes-agent/venv/bin/python`,root:process.cwd()+'/',home:homedir(),profile:`${homedir()}/.hermes/profiles/sectorhaber`,hermesRoot:`${homedir()}/.hermes/hermes-agent`,selection:modelSelection});
  stage='decode';const result=JSON.parse(output) as {draft:Draft;audit:unknown;runtime:unknown};
  if(modelSelection.provider==='openai-codex')await writeFile(directory+'/last-model-result.json',JSON.stringify({job_id:job.id,result}),{mode:0o600});
  stage='review';await recordModelReview(env,job.id,result.audit);
  const documents=job.documents as Document[];result.draft=acceptHermes(result.draft,result.audit,documents,job.kind==='edit'?job.edit_request:null).draft;
  stage='render';const date=new Date().toLocaleDateString('tr-TR',{timeZone:'Europe/Istanbul'});
 const renderJob=job;const rendered=await renderModelJob(env,renderJob,result.draft,async()=>{const svgs=draftCards(result.draft,renderJob.card_theme==='navy'||renderJob.card_theme==='paper'?renderJob.card_theme:undefined,renderJob.card_layout);const cards=[];for(const svg of svgs)cards.push({svg_hash:await sha256(svg),png_base64:Buffer.from(await png(svg)).toString('base64')});return cards;});const {cards}=rendered;
  stage='submit';const delivered=await submitJob(env,{id:job.id,lease_token:job.lease_token,input_hash:job.input_hash,...result,...rendered,card_date:date,cards});
  stage='delivery';await deliver(env);await status('model_health',{ok:true,at:new Date().toISOString(),draft_id:delivered.id,duration_ms:Date.now()-started});
 }catch(e){if(job)await env.DB.prepare("UPDATE model_jobs SET state='needs_review',error=? WHERE id=? AND state='leased'").bind(modelFailureCode(e,stage),job.id).run();await status('model_health',{ok:false,at:new Date().toISOString(),code:modelFailureCode(e,stage),stage,duration_ms:Date.now()-started});if(e instanceof Error&&['quota_paused','hermes_auth_unavailable'].includes(e.message))await status('model_paused_until',Date.now()+3600_000);await pause(e instanceof Error&&['quota_paused','hermes_auth_unavailable','subscription_turn_failed','hermes_job_failed'].includes(e.message)?60_000:2_000);}
}}
async function newsLoop(){let official=0;while(!stopping()){try{await tick(env);await status('collector_health',{ok:true,at:new Date().toISOString()});if(Date.now()-official>10*60_000){try{await scanOfficial(async(_path,value)=>ingestOfficial(env,value as Record<string,unknown>),directory+'/official-state.json');official=Date.now();await status('official_health',{ok:true,at:new Date().toISOString()});}catch(e){await status('official_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}}}catch(e){await status('collector_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}if(Date.now()-lastArtifactCleanup>=60*60_000){try{await cleanupSourceArtifacts();lastArtifactCleanup=Date.now();}catch(e){await status('artifact_cleanup_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}}await pause(60_000);}}
async function buybackLoop(){while(!stopping()){try{
 const result=await pollBuybacks(env,{readImage:readBuybackImage,indices:async()=>{let db:DatabaseSync|undefined;try{db=new DatabaseSync(directory+'/kap/kap.sqlite',{readOnly:true});if(Number(db.prepare('PRAGMA application_id').get()!.application_id)!==0x534B4150)return null;const row=db.prepare("SELECT value FROM settings WHERE key='indices'").get();return row?JSON.parse(String(row.value)):null;}catch{return null;}finally{db?.close();}}});
 await status('buyback_report_health',{ok:!['needs_review','blocked_existing'].includes(result.state),at:new Date().toISOString(),...result});
 }catch(e){await status('buyback_report_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}await pause(10*60_000);}}
async function channelLoop(){while(!stopping()){let delay=CHANNEL_POLL_MS;try{const result=await pollChannel(env,channelTransport);if(result.state==='ok')await announceNews(env,true);await status('telegram_channel_health',{ok:true,at:new Date().toISOString(),...result});}catch(e){delay=60_000;await status('telegram_channel_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}await pause(delay);}}
async function fintablesXLoop(){while(!stopping()){try{await pollFintablesX(env);}catch(e){await status('fintables_x_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}await pause(10_000);}}
async function spkXLoop(){while(!stopping()){try{await pollSpkX(env);}catch(e){await status('spk_x_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}await pause(10_000);}}
async function designLoop(){while(!stopping()){try{await redesignOne(env,png);}catch(e){await status('design_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});}await pause(1000);}}
async function xLoop(){while(!stopping()){try{
 if(await tweetkitReady()){env.X_PUBLISH_ENABLED='true';await publishX(env,tweetkitClient({longNotesEnabled:process.env.X_LONG_NOTE_ENABLED==='true'}));await refreshXButton(env);}else env.X_PUBLISH_ENABLED=undefined;
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
async function telegramLoop(maintenance?:{owner:string;chat:string;deadline:number;artifact:string}):Promise<boolean>{
 let offset=Number((await env.DB.prepare("SELECT value FROM system_state WHERE key='telegram_offset'").first<{value:string}>())?.value??0);
 while(!stopping()&&(!maintenance||Date.now()<maintenance.deadline)){try{
  const result=await telegram(env,'getUpdates',new URLSearchParams({offset:String(offset),timeout:'15',allowed_updates:JSON.stringify(['callback_query','message'])}));
  const updates=result as unknown as {update_id:number}[];
  offset=await saveTelegramUpdates(env,updates)??offset;
  if(maintenance&&Date.now()>=maintenance.deadline)break;
  await processTelegramUpdates(env,update=>worker.fetch(new Request('https://local.sector/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':env.TELEGRAM_WEBHOOK_SECRET!,'Content-Type':'application/json'},body:JSON.stringify(update)}),env,{waitUntil:()=>{}} as unknown as ExecutionContext),undefined,maintenance);
  await status('telegram_health',{ok:true,at:new Date().toISOString()});
  if(maintenance&&await maintenanceApproved(env,maintenance.artifact)&&(await newsPreferences(env)).mode==='active')return true;
 }catch(e){await status('telegram_health',{ok:false,at:new Date().toISOString(),code:errorCode(e)});await pause(10_000);}}
 return false;
}
async function telegramCommandsLoop(){
 let retry=0;
 while(!stopping()){
  try{await registerTelegramCommands(env);retry=0;await status('telegram_commands_health',{ok:true,at:new Date().toISOString(),count:TELEGRAM_COMMANDS.length});await pause(24*3600_000);}
  catch(e){retry++;await status('telegram_commands_health',{ok:false,at:new Date().toISOString(),code:errorCode(e),retry});await pause(Math.min(15*60_000,30_000*retry));}
 }
}
try{await withServiceLock(lock,()=>unlink(lockPath),async()=>{
 const maintenanceMode=process.env.SECTOR_MAINTENANCE_MODE;
 if(maintenanceMode!==undefined&&maintenanceMode!=='1')throw Error('maintenance_configuration_invalid');
 const maintenanceDeadline=Number(process.env.SECTOR_MAINTENANCE_DEADLINE);
 let alreadyActive=false;if(maintenanceMode==='1'){try{await access(`${directory}/releases/${process.env.SECTOR_RELEASE_ID}/active`);alreadyActive=true;}catch{/* staged release */}}
 if(maintenanceMode==='1'&&(!/^[a-f0-9]{32}$/.test(process.env.SECTOR_RELEASE_ID??'')||!env.TELEGRAM_USER_ID||!env.TELEGRAM_CHAT_ID||![env.TELEGRAM_USER_ID,env.TELEGRAM_CHAT_ID].every(v=>/^[1-9]\d*$/.test(v)&&Number.isSafeInteger(Number(v)))||(!alreadyActive&&(!Number.isSafeInteger(maintenanceDeadline)||maintenanceDeadline<=Date.now()||maintenanceDeadline>Date.now()+900000))))throw Error('maintenance_configuration_invalid');
 if(maintenanceMode!=='1'||alreadyActive)await seed(env);
 const artifact=await newsReviewArtifact(process.cwd());
 if(maintenanceMode==='1'&&!alreadyActive&&!await maintenanceCandidateForRuntime(env,artifact.hash,maintenanceDeadline))throw Error('maintenance_candidate_mismatch');
 await status('runtime_identity',{release:process.env.SECTOR_RELEASE_ID??'unknown',catalog:{version:COMPANY_CATALOG_VERSION,companies:new Set(catalogEntities.map(c=>c.code)).size,issuers:COMPANY_CATALOG_PROVENANCE.issuer_count,equity_codes:COMPANY_CATALOG_PROVENANCE.equity_count},news_review_artifact:artifact,at:new Date().toISOString()});
 let filter:{requested:string;mode:string;reasons:string[]}={requested:'unknown',mode:'unavailable',reasons:['Haber filtresi okunamadı.']};
 try{const raw=await env.DB.prepare("SELECT value FROM system_state WHERE key='news_filter_preferences'").first<{value:string}>();const requested=raw?(JSON.parse(raw.value).mode==='active'?'active':'shadow'):'shadow';const prefs=await newsPreferences(env);filter={requested,mode:prefs.mode,reasons:prefs.readiness_reasons??[]};}catch{/* fail closed in installer */}
 const writeReady=async(maintenance?:string)=>writeFile(directory+'/service-ready.json',JSON.stringify({pid:process.pid,release:process.env.SECTOR_RELEASE_ID??'',started_at:new Date().toISOString(),news_filter:filter,...(maintenance?{maintenance}:{})}),{mode:0o600});
 if(maintenanceMode==='1'&&alreadyActive&&filter.requested==='active'&&filter.mode!=='active')throw Error('sector_news_filter_not_active');
 await writeReady(maintenanceMode==='1'&&!alreadyActive?'waiting':undefined);
 if(maintenanceMode==='1'&&!alreadyActive){
  if(!await telegramLoop({owner:env.TELEGRAM_USER_ID!,chat:env.TELEGRAM_CHAT_ID!,deadline:maintenanceDeadline,artifact:artifact.hash}))throw Error('maintenance_approval_timeout');
  const prefs=await newsPreferences(env);filter={requested:prefs.requested_mode??'shadow',mode:prefs.mode,reasons:prefs.readiness_reasons??[]};if(filter.requested!=='active'||filter.mode!=='active')throw Error('sector_news_filter_not_active');
  await writeReady('approved');
 }
 if(!await awaitActivation(directory,process.env.SECTOR_RELEASE_ID,()=>stopping()))return;
 if(maintenanceMode==='1'&&!alreadyActive)await seed(env);
 if(await tweetkitReady())env.X_PUBLISH_ENABLED='true';
 await cleanupSourceArtifacts().catch(()=>0);lastArtifactCleanup=Date.now();
 // Never replay requests accepted by an earlier publisher after activation.
 if(maintenanceMode!=='1'||alreadyActive)await env.DB.prepare("UPDATE x_posts SET state='expired',error='publisher_restart' WHERE state='queued' AND NOT EXISTS (SELECT 1 FROM x_schedules s WHERE s.post_id=x_posts.id)").run();
 if(process.argv.includes('--prepare-once')){await tick(env);console.log('Sources scanned and model jobs prepared.');return;}
 if(process.argv.includes('--model-once')){ // run one fully checked job for commissioning
  const stopCheck=setInterval(async()=>{const completed=await env.DB.prepare("SELECT COUNT(*) AS n FROM model_jobs WHERE state='complete'").first<{n:number}>();if((completed?.n??0)>0){shutdown.stop();clearInterval(stopCheck);}},1000);
  try{await withModelHeartbeat(env,modelLoop);}finally{clearInterval(stopCheck);}return;
 }
 await Promise.all([channelLoop(),buybackLoop(),spkXLoop(),fintablesXLoop(),newsLoop(),withModelHeartbeat(env,modelLoop),telegramLoop(),telegramCommandsLoop(),deliveryLoop(),kapLoop(),manualLoop(),reportCacheLoop(),requestsLoop(),designLoop(),xLoop()]);
});}finally{shutdown.dispose();}
