import {saveGallery} from './gallery-save';
import {readMedia} from './media-set';
import {scheduledSelection} from './newsroom';
import {recordNewsCandidate,newsPreferences} from './news-routing';
import {deliveryTarget} from './delivery-recovery';
import {announceNews,refreshNewsRequests} from './news-inbox';
import registry from '../sources.json';
import type {Env,Source,Document,Draft} from './types';
import {parseFeed} from './feed';
import {readPublic} from './network';
import {readDocument} from './article';
import {topicScore} from './editorial';
import {sha256} from './utils/text';
import {evidenceFamily,titleSimilarity} from './dedupe';
import {sendDraft,TelegramError} from './telegram';
type SourceRow={id:string;config:string;etag:string|null;modified:string|null;failures:number;last_ok:number|null;};
export type DraftRow={id:string;content:string;documents:string;verification:string;revision:number;state:string;expires_at:number;message_id:number|null;media_key:string|null;};
const now=()=>Math.floor(Date.now()/1000);
export const errorCode=(e:unknown)=>e instanceof Error&&/^[a-z][a-z\d_]{2,70}$/.test(e.message)?e.message:'operation_failed';
export async function seed(env:Env):Promise<void> {
 await env.DB.prepare("INSERT OR IGNORE INTO system_state(key,value) VALUES('news_preview_since',?)").bind(new Date(Date.now()-300_000).toISOString()).run();
 // Source state survives deployments. Registry changes never silently turn a
 // source back on after the owner disabled it.
 await env.DB.batch((registry as Source[]).map(s=>env.DB.prepare('INSERT INTO sources(id,config,enabled) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config').bind(s.id,JSON.stringify(s),Number(s.enabled))));
 await env.DB.prepare("INSERT OR IGNORE INTO system_state(key,value) VALUES('live_since',?)").bind(new Date(Date.now()-5*60_000).toISOString()).run();
}
export async function poll(env:Env):Promise<void> {
 const time=now();
 const cutoff=(await env.DB.prepare("SELECT value FROM system_state WHERE key='live_since'").first<{value:string}>())?.value;
 const due=await env.DB.prepare(`SELECT id,config,etag,modified,failures,last_ok FROM sources WHERE enabled=1 AND next_poll<=? AND lease_until<? ORDER BY COALESCE(json_extract(config,'$.editorial_priority'),50) DESC,next_poll,id LIMIT 18`).bind(time,time).all<SourceRow>();
 const rows=due.results??[];
 // At most three slow publishers occupy network slots simultaneously.
 for(let index=0;index<rows.length;index+=3)await Promise.all(rows.slice(index,index+3).map(async row=>{
  const lock=await env.DB.prepare('UPDATE sources SET lease_until=? WHERE id=? AND lease_until<?').bind(time+90,row.id,time).run();if(!lock.meta.changes)return;
  const source=JSON.parse(row.config) as Source;
  if(source.method==='bridge_pdf'||source.method==='reference'){await env.DB.prepare('UPDATE sources SET next_poll=?,lease_until=0 WHERE id=?').bind(time+3600,row.id).run();return;}
  try {
   const headers:Record<string,string>={};if(row.etag)headers['If-None-Match']=row.etag;if(row.modified)headers['If-Modified-Since']=row.modified;
   const feed=await readPublic(source.url,source.allowed_hosts,headers);
   if(feed.status===304){await env.DB.prepare('UPDATE sources SET next_poll=?,lease_until=0,last_error=NULL WHERE id=?').bind(time+source.poll_seconds,row.id).run();return;}
   const items=parseFeed(feed.text,source),dated=items.filter(i=>i.published_at&&Date.parse(i.published_at)<=Date.now()+5*60_000);
   const newest=Math.max(0,...dated.map(i=>Date.parse(i.published_at!)));
   // A valid feed with no recent story is not a transport failure. Metadata is still archived.
   const prefs=await newsPreferences(env);
   const legacy=(i:typeof items[number])=>!!i.published_at&&Date.now()-Date.parse(i.published_at)<24*3600_000&&(!cutoff||i.published_at>=cutoff)&&topicScore(i.title,i.summary,source.official).score>=(source.minimum_score??60);
   const decisions=new Map<string,Awaited<ReturnType<typeof recordNewsCandidate>>>();
   for(const i of items.slice(0,150))decisions.set(i.url,await recordNewsCandidate(env,i,source,legacy(i),Date.now(),prefs));
   const selected=prefs.mode==='active'?items.filter(i=>decisions.get(i.url)?.decision.route==='instant'&&decisions.get(i.url)?.decision.eligible&&!!i.published_at&&(!cutoff||i.published_at>=cutoff)):dated.filter(i=>Date.now()-Date.parse(i.published_at!)<24*3600_000&&(!cutoff||i.published_at!>=cutoff)&&topicScore(i.title,i.summary,source.official).score>=(source.minimum_score??60));
   const inserts=await Promise.all(selected.slice(0,25).map(async original=>{const i=prefs.mode==='active'?decisions.get(original.url)!.item:original;return env.DB.prepare('INSERT OR IGNORE INTO articles(id,source_id,url,title,summary,published_at,first_seen) VALUES(?,?,?,?,?,?,?)').bind(await sha256(i.url),source.id,i.url,i.title,i.summary,i.published_at!,time);}));
   if(inserts.length)await env.DB.batch(inserts);
   await env.DB.prepare('UPDATE sources SET next_poll=?,lease_until=0,etag=?,modified=?,failures=0,last_ok=?,last_error=NULL,last_count=? WHERE id=?').bind(time+source.poll_seconds,feed.headers.get('etag'),feed.headers.get('last-modified'),time,items.length,row.id).run();
  } catch(e) {
   const fails=row.failures+1,delay=Math.min(6*3600,source.poll_seconds*2**Math.min(fails,7));
   await env.DB.prepare('UPDATE sources SET next_poll=?,lease_until=0,failures=?,last_error=? WHERE id=?').bind(time+delay,fails,errorCode(e),row.id).run();
  }
 }));
}
export async function quota(env:Env,bucket='ai-budget'):Promise<boolean> {
 const day=new Date().toISOString().slice(0,10),key=bucket+':'+day;
 const limit=Math.max(0,Math.min(500,Math.floor(Number(env.AI_DAILY_DRAFT_LIMIT)||0)));
 const result=await env.DB.prepare("INSERT INTO system_state(key,value) SELECT ?, '1' WHERE ?>0 ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1 WHERE CAST(value AS INTEGER)<?").bind(key,limit,limit).run();
 return !!result.meta.changes;
}
export async function prepare(env:Env):Promise<void> {
 const pending=await env.DB.prepare("SELECT COUNT(*) AS count FROM drafts WHERE state IN ('pending','deferred') AND delivery_state IN ('waiting','sending')").first<{count:number}>();if((pending?.count??0)>=12)return;
 const time=now();
 const queue=await env.DB.prepare("SELECT a.*,s.config FROM articles a JOIN sources s ON s.id=a.source_id JOIN news_cards c ON c.article_id=a.id WHERE c.state='requested' AND a.status='queued' AND a.next_try<=? AND a.lease_until<? ORDER BY c.requested_at LIMIT 80").bind(time,time).all<{id:string;url:string;title:string;summary:string;published_at:string;attempts:number;config:string;document:string|null}>();
 const priority=(a:{title:string;summary:string;published_at:string;config:string})=>topicScore(a.title,a.summary,JSON.parse(a.config).official).score-(Date.now()-Date.parse(a.published_at))/3600_000*2;
 const selected=(queue.results??[]).sort((a,b)=>priority(b)-priority(a)).slice(0,2);
 for(const article of selected) {
  const lock=await env.DB.prepare('UPDATE articles SET lease_until=? WHERE id=? AND lease_until<?').bind(time+(['spk-x','fintables-x','sermaye-telegram'].includes(JSON.parse(article.config).id)?1800:360),article.id,time).run();if(!lock.meta.changes)continue;
  try {
   const source=JSON.parse(article.config) as Source;
   if(['spk-x','fintables-x'].includes(source.id)&&(!env.READ_SPK_X||!article.document))throw Error('x_reader_unavailable');
   if(source.id==='sermaye-telegram'&&(!env.READ_TELEGRAM_CHANNEL||!article.document))throw Error('channel_reader_unavailable');
   const documents=source.id==='sermaye-telegram'?await env.READ_TELEGRAM_CHANNEL!(article.document!):['spk-x','fintables-x'].includes(source.id)?await env.READ_SPK_X!(article.document!):[source.method==='bridge_pdf'&&article.document?JSON.parse(article.document) as Document:await readDocument(article,source)];
   if(!documents.length)throw Error('x_evidence_empty');
   for(const d of documents)d.family=evidenceFamily(d);const doc=documents[0];
   if(['spk-x','fintables-x','sermaye-telegram'].includes(source.id)){article.document=JSON.stringify({...JSON.parse(article.document!),cached_documents:documents});await env.DB.prepare('UPDATE articles SET document=?,document_expires=? WHERE id=?').bind(article.document,time+(source.id==='sermaye-telegram'?86400:7*86400),article.id).run();}
   if(doc.gallery_range){await saveGallery(env,article,doc,time);continue;}
   const kap=(registry as Source[]).find(s=>s.id==='kap');
   for(const url of doc.primary_urls??[])if(kap)try{documents.push(await readDocument({title:doc.title,url,summary:'',published_at:doc.published_at},kap));}catch{/* Missing primary document leaves attribution intact, never an invented official confirmation. */}
   // Merge closely matching reports before generating. Unrelated companies,
   // later dates and merely similar macro topics are not corroboration.
   const related=await env.DB.prepare("SELECT a.*,s.config FROM articles a JOIN sources s ON s.id=a.source_id WHERE a.id<>? AND a.status='queued' AND s.enabled=1 AND ABS(julianday(a.published_at)-julianday(?))<0.5 LIMIT 80").bind(article.id,article.published_at).all<{id:string;url:string;title:string;summary:string;published_at:string;config:string}>();
   const matched=(related.results??[]).filter(r=>JSON.parse(r.config).id!=='sermaye-telegram').filter(r=>titleSimilarity(article.title,r.title)>.68).slice(0,2);
   const relatedIds:string[]=[];
   const corroboration=await Promise.allSettled(matched.map(async r=>{
    const extra=await readDocument(r,JSON.parse(r.config));extra.family=evidenceFamily(extra);return {extra,id:r.id};
   }));
   for(const result of corroboration)if(result.status==='fulfilled'){documents.push(result.value.extra);relatedIds.push(result.value.id);}

   const jobs=await env.DB.prepare("SELECT COUNT(*) AS count FROM model_jobs WHERE state IN ('queued','leased')").first<{count:number}>();
   if((jobs?.count??0)>=4||!await quota(env,'news-request-budget')){await env.DB.prepare('UPDATE articles SET lease_until=0,next_try=? WHERE id=?').bind(time+30,article.id).run();break;}
   const jobId=crypto.randomUUID(),input=JSON.stringify(documents);
   const cachedXSource=['spk-x','fintables-x','sermaye-telegram'].includes(source.id);
   await env.DB.batch([
    env.DB.prepare("INSERT INTO model_jobs(id,article_id,documents,related_ids,input_hash,created_at,kind) VALUES(?,?,?,?,?,?,'news') ON CONFLICT(article_id,expected_revision) DO UPDATE SET documents=excluded.documents,related_ids=excluded.related_ids,input_hash=excluded.input_hash,created_at=excluded.created_at,kind='news',state='queued',error=NULL,lease_until=0 WHERE model_jobs.state IN ('needs_review','expired','paused')").bind(jobId,article.id,input,JSON.stringify(relatedIds),await sha256(input),time),
    env.DB.prepare("UPDATE articles SET status='model_queued',document=?,document_expires=?,lease_until=0 WHERE id=?").bind(cachedXSource?article.document:JSON.stringify(doc),time+(cachedXSource&&source.id!=='sermaye-telegram'?7*86400:24*3600),article.id),
    env.DB.prepare("UPDATE news_cards SET state='model_queued' WHERE article_id=? AND state='requested'").bind(article.id)
   ]);
  } catch(e) {
   const count=article.attempts+1,permanent=/^gallery_/.test(errorCode(e));
   await env.DB.prepare('UPDATE articles SET lease_until=0,status=?,attempts=?,next_try=?,error=? WHERE id=?').bind(permanent||count>=3?'needs_review':'queued',count,time+Math.min(3600,120*2**count),errorCode(e),article.id).run();
  }
 }
}
export async function deliver(env:Env):Promise<void> {
 if(env.MODE!=='telegram_review'||!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)return;
 const time=now();
 await env.DB.prepare("UPDATE drafts SET state='pending',delivery_state='waiting',revision=revision+1 WHERE state='deferred' AND defer_until<=? AND expires_at>?").bind(time,time).run();
 const row=await env.DB.prepare("SELECT * FROM drafts WHERE state='pending' AND delivery_state='waiting' AND next_delivery<=? AND expires_at>? AND lease_until<? AND NOT EXISTS (SELECT 1 FROM model_jobs j WHERE j.result_draft=drafts.id AND j.kind='initial' AND NOT EXISTS (SELECT 1 FROM news_cards c WHERE c.article_id=j.article_id AND c.state IN ('requested','model_queued'))) ORDER BY created_at LIMIT 1").bind(time,time,time).first<DraftRow>();if(!row)return;
 const lock=await env.DB.prepare("UPDATE drafts SET lease_until=?,delivery_state='sending',delivery_attempts=delivery_attempts+1 WHERE id=? AND lease_until<? AND delivery_state='waiting'").bind(time+120,row.id,time).run();if(!lock.meta.changes)return;
 try {
  if(!row.media_key)throw Error('draft_media_missing');const {images}=await readMedia(env,row.media_key,row.content);
  const target=await deliveryTarget(env,row.id,row.message_id);
  if(target)await env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('telegram_target:'+row.id,String(target)).run();
  const automaticKap=await env.DB.prepare("SELECT 1 FROM model_jobs WHERE result_draft=? AND kind='kap' LIMIT 1").bind(row.id).first();
  if(automaticKap){
   const decision=env.KAP_DELIVERY_CHECK?.(JSON.parse(row.documents))??'hold';
   if(decision!=='allow'){
    await env.DB.prepare('UPDATE drafts SET delivery_state=?,lease_until=0,delivery_attempts=delivery_attempts-1,next_delivery=? WHERE id=?').bind(decision==='suppress'?'suppressed':'waiting',time+30,row.id).run();
    return;
   }
  }
  const current=await env.DB.prepare("SELECT 1 FROM drafts WHERE id=? AND revision=? AND media_key=? AND content=? AND state='pending' AND delivery_state='sending' AND expires_at>?").bind(row.id,row.revision,row.media_key,row.content,now()).first();if(!current)return;
  const message=await sendDraft(env,row.id,row.revision,JSON.parse(row.content),JSON.parse(row.documents),images.length>1?images:images[0],row.verification,target);
  await env.DB.batch([
   env.DB.prepare("UPDATE drafts SET lease_until=0,delivery_state='sent',delivered_at=?,message_id=? WHERE id=? AND revision=? AND delivery_state='sending'").bind(time,message,row.id,row.revision),
   env.DB.prepare("INSERT INTO system_state(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM drafts WHERE id=? AND revision=? AND message_id=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind('telegram_photo:'+row.id,String(message),row.id,row.revision,message),
   ...(images.length>1?[env.DB.prepare("INSERT INTO system_state(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM drafts WHERE id=? AND revision=? AND message_id=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind('telegram_control:'+row.id,String(message),row.id,row.revision,message)]:[])]);
 } catch(e) {
  // Retrying an ambiguous timeout can duplicate a card already accepted by
  // Telegram. Only an explicit API rejection is eligible for an automatic retry.
  const attempts=await env.DB.prepare('SELECT delivery_attempts FROM drafts WHERE id=?').bind(row.id).first<{delivery_attempts:number}>();
  const retry=e instanceof TelegramError&&e.code===429&&(attempts?.delivery_attempts??3)<3;
  await env.DB.prepare("UPDATE drafts SET lease_until=0,delivery_state=?,next_delivery=? WHERE id=? AND revision=? AND delivery_state='sending'").bind(retry?'waiting':e instanceof TelegramError&&e.code>=400&&e.code<500?'failed':'uncertain',time+(e instanceof TelegramError?e.retryAfter:300),row.id,row.revision).run();
 }
}
export async function tick(env:Env):Promise<void> {
 const time=now();
 const lease=await env.DB.prepare("INSERT INTO system_state(key,value) VALUES('tick_lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER)<?").bind(String(time+300),time).run();
 if(!lease.meta.changes)return;
 try {await seed(env);await poll(env);await announceNews(env);await scheduledSelection(env);await refreshNewsRequests(env);await prepare(env);await deliver(env);}
 finally {await env.DB.prepare("UPDATE system_state SET value='0' WHERE key='tick_lease'").run();}
 await env.DB.batch([
  env.DB.prepare('DELETE FROM edits WHERE expires_at<?').bind(now()),
  env.DB.prepare("UPDATE drafts SET state='expired',delivery_state='expired' WHERE expires_at<? AND state IN ('pending','deferred','needs_review')").bind(now()),
  env.DB.prepare("UPDATE drafts SET delivery_state='uncertain',lease_until=0 WHERE delivery_state='sending' AND lease_until<?").bind(now()),
  env.DB.prepare("INSERT INTO system_state(key,value) VALUES('last_tick',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(new Date().toISOString())]);
 await cleanupRawDocuments(env);
 await env.DB.prepare('DELETE FROM news_candidates WHERE expires_at<?').bind(Date.now()).run();
}
export async function cleanupRawDocuments(env:Env,time=now()):Promise<void>{
 await env.DB.batch([
  env.DB.prepare('UPDATE articles SET document=NULL WHERE document_expires<? AND document IS NOT NULL').bind(time),
  env.DB.prepare("UPDATE model_jobs SET documents='[]' WHERE state IN ('complete','failed','expired','cancelled') AND documents!='[]'"),
  env.DB.prepare("UPDATE model_jobs SET state='expired',documents='[]' WHERE created_at<? AND state IN ('queued','retry_pending','needs_review')").bind(time-24*3600)
 ]);
}
