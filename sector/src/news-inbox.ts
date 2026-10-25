import {previewMarkup,refreshNewsMenu} from './news-menu';
import {recordNewsCandidate,newsPreferences} from './news-routing';
import {retryDraftDelivery,deliveryTarget} from './delivery-recovery';
import {topicScore} from './editorial';
import type {Source} from './types';
import {telegram,TelegramError} from './telegram';
import {titleSimilarity} from './dedupe';
import type {Env} from './types';
export function previewText(source:string,title:string,summary:string):string {
 const clean=(s:string)=>s.replace(/\s+/g,' ').trim();
 const t=clean(title),s=clean(summary);
 return [source,t,s&&s!==t?(s.length>700?s.slice(0,697)+'…':s):''].filter(Boolean).join('\n\n').slice(0,3500);
}
export function previewDuplicate(a:string,b:string):boolean {
 const numbers=(s:string)=>[...s.matchAll(/\d+(?:[.,]\d+)*/g)].map(m=>m[0]).join('|');
 const subject=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(' ').slice(0,2).join(' ');
 return subject(a)===subject(b)&&numbers(a)===numbers(b)&&titleSimilarity(a,b)>=.9;
}

type ProgressCard={id:string;message_id:number;title:string;summary:string;url:string;config:string;status:string;error?:string|null;job_state:string|null;delivery_state:string|null};
export function newsProgressNote(row:Pick<ProgressCard,'status'|'job_state'|'delivery_state'|'error'>,paused=false):string {
 if(row.delivery_state==='sent')return 'Tweet ve görsel hazırlandı.';
 if(row.delivery_state==='waiting'||row.delivery_state==='sending')return 'Tweet ve görsel hazır, Telegram’a iletiliyor.';
 if(row.status==='needs_review')return 'Kaynak eksiksiz okunamadı. İnceleme gerekiyor; eksik veriden içerik üretilmedi.';
 if(row.status==='queued'&&row.error)return 'Kaynak okuma hatası oluştu; sınırlı yeniden deneme bekleniyor.';
 if(row.job_state==='leased')return 'Tweet ve görsel hazırlanıyor; kaynak ve sayılar kontrol ediliyor.';
 if(paused||row.job_state==='paused')return 'İsteğin kaydedildi. İçerik hazırlama geçici olarak beklemede; otomatik devam edecek.';
 if(row.job_state==='queued'||row.job_state==='retry_pending')return 'İsteğin sırada. Önce başlayan içerik tamamlanınca hazırlanacak.';
 return 'Haberin tam metni okunuyor.';
}
async function showNewsProgress(env:Env,row:ProgressCard,note:string):Promise<boolean>{
 if(env.MODE!=='telegram_review')return true;
 const key='news_progress:'+row.id;
 const cached=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{value:string}>();
 const previous=cached?JSON.parse(cached.value):{};
 if(previous.unavailable||previous.note===note)return true;
 if(previous.retry_at>Date.now())return false;
 const save=(value:unknown)=>env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(value)).run();
 try{
  await telegram(env,'editMessageText',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,message_id:String(row.message_id),text:previewText(JSON.parse(row.config).name,row.title,row.summary)+'\n\n'+note,link_preview_options:JSON.stringify({is_disabled:true}),reply_markup:JSON.stringify(await previewMarkup(env,row.id,row.url))}));
  await save({note});
  return true;
 }catch(e){
  if(e instanceof TelegramError&&e.code>=400&&e.code<500&&e.code!==429){await save({unavailable:true});return true;}
  await save({retry_at:Date.now()+(e instanceof TelegramError&&e.code===429?e.retryAfter:30)*1000});return false;
 }
}
export async function requestNews(env:Env,id:string,messageId:number,confirmedRevision?:number):Promise<string> {
 const row=await env.DB.prepare('SELECT * FROM news_cards WHERE id=? AND message_id=?').bind(id,messageId).first<{article_id:string;state:string}>();
 if(!row)return 'Bu haber kartı artık kullanılamıyor.';
 const existing=await env.DB.prepare('SELECT d.id,d.delivery_state,d.revision,a.url FROM articles a LEFT JOIN model_jobs j ON j.article_id=a.id AND j.expected_revision=0 JOIN drafts d ON d.id=COALESCE(a.draft_id,j.result_draft) WHERE a.id=?').bind(row.article_id).first<{id:string;delivery_state:string;revision:number;url:string}>();
 if(existing){
  const result=await retryDraftDelivery(env,existing.id,confirmedRevision);
  if(result==='sent'){await env.DB.prepare("UPDATE news_cards SET state='complete' WHERE id=?").bind(id).run();return 'Bu haberin tweet ve görseli zaten hazırlandı.';}
  if(result==='queued'){await env.DB.prepare("UPDATE news_cards SET state='model_queued' WHERE id=?").bind(id).run();return 'Hazır tweet ve görselin teslimatı sıraya alındı. Yeniden AI kullanılmayacak.';}
  if(result==='confirm'){
   if(env.MODE==='telegram_review')await refreshNewsMenu(env,id,messageId,'more');
   return 'Teslimat belirsiz; mesaj gelmiş olabilir. Yeniden gönderim için karttaki onay düğmesini kullan.';
  }
  return 'Hazır taslak için güvenli yeniden deneme sınırı veya süre doldu; yeniden içerik üretilmedi.';
 }

 if(['requested','model_queued'].includes(row.state))return 'Hazırlama isteğin zaten sırada.';
 if(row.state==='complete')return 'Bu haberin tweet ve görseli zaten hazırlandı.';
 if(!['sent','failed'].includes(row.state))return 'Bu kart için işlem yapılamıyor.';
 const claimed=await env.DB.prepare("UPDATE news_cards SET state='requested',requested_at=? WHERE id=? AND state IN ('sent','failed')").bind(Math.floor(Date.now()/1000),id).run();
 if(!claimed.meta.changes)return 'Hazırlama isteğin zaten sırada.';
 await env.DB.prepare("UPDATE articles SET status='queued',attempts=0,next_try=0,lease_until=0,error=NULL WHERE id=? AND status NOT IN ('prepared','duplicate')").bind(row.article_id).run();
 return 'Tam haber okunup tweet ve görsel hazırlanacak.';
}
export async function announceNews(env:Env):Promise<void> {
 if(env.MODE!=='telegram_review')return;
 const time=Math.floor(Date.now()/1000);
 await env.DB.prepare("UPDATE news_cards SET state='uncertain' WHERE state='sending' AND next_try<?").bind(time).run();
 const cutoff=(await env.DB.prepare("SELECT value FROM system_state WHERE key='news_preview_since'").first<{value:string}>())?.value??new Date(Date.now()-300_000).toISOString();
 // Already displayed stories and uncertain sends are never replayed after restart.
 const prefs=await newsPreferences(env);
 const unevaluated=(await env.DB.prepare("SELECT a.*,s.config FROM articles a JOIN sources s ON s.id=a.source_id LEFT JOIN news_candidates n ON n.article_id=a.id WHERE n.id IS NULL AND a.status='queued' AND s.enabled=1 AND s.id!='kap' AND NOT EXISTS(SELECT 1 FROM model_jobs j WHERE j.article_id=a.id AND j.kind IN ('manual','kap','edit')) ORDER BY a.first_seen ASC,a.id LIMIT 150").all<any>()).results;
 for(const a of unevaluated){const source=JSON.parse(a.config) as Source;await recordNewsCandidate(env,a,source,topicScore(a.title,a.summary,source.official).score>=(source.minimum_score??60),Date.now(),prefs);}
 // Two priority slots keep urgent developments ahead; a third, age-reserved slot
 // guarantees progress for eligible stories waiting >=10 minutes under sustained arrivals.
 // Eligibility and send-state exclusions are applied before either LIMIT.
 const rows=await env.DB.prepare(`WITH eligible AS (
 SELECT a.*,s.config,c.id AS card_id,c.state AS card_state,
 COALESCE(n.first_seen,a.first_seen*1000) AS queue_at,
 ${prefs.mode==='active'?"CASE WHEN json_extract(n.confidence,'$.event') IN ('rate','macro_data','regulation','halt') OR json_extract(n.confidence,'$.stage')='denied' THEN 100 ELSE 0 END + COALESCE(json_extract(n.confidence,'$.priority'),0)":'0'} AS priority,
 COALESCE(json_extract(s.config,'$.editorial_priority'),50) AS source_priority
 FROM articles a JOIN sources s ON s.id=a.source_id LEFT JOIN news_cards c ON c.article_id=a.id LEFT JOIN news_candidates n ON n.article_id=a.id
 WHERE (n.id IS NULL OR (${prefs.mode==='active'?"n.eligible=1 AND n.route='instant'":'n.legacy_eligible=1'})) AND s.enabled=1 AND a.status='queued' AND a.published_at>=? AND (c.id IS NULL OR (c.state='waiting' AND c.next_try<=?))
 ), oldest AS (SELECT id FROM eligible WHERE queue_at<=? ORDER BY queue_at ASC,id LIMIT 1),
 priority_slots AS (SELECT id FROM eligible WHERE id NOT IN (SELECT id FROM oldest) ORDER BY priority DESC,(julianday(published_at)*1440+source_priority/10) DESC,id LIMIT (SELECT CASE WHEN EXISTS(SELECT 1 FROM oldest) THEN 2 ELSE 3 END))
 SELECT * FROM eligible WHERE id IN (SELECT id FROM oldest) OR id IN (SELECT id FROM priority_slots)
 ORDER BY CASE WHEN id IN (SELECT id FROM oldest) THEN 1 ELSE 0 END ASC,priority DESC,(julianday(published_at)*1440+source_priority/10) DESC,id LIMIT 3`).bind(cutoff,time,Date.now()-600000).all<{id:string;title:string;summary:string;url:string;published_at:string;config:string;card_id:string|null}>();
 for(const a of rows.results??[]){
  const source=JSON.parse(a.config) as Source;if(prefs.mode!=='active'&&topicScore(a.title,a.summary,source.official).score<(source.minimum_score??60))continue;
  const id=a.card_id??crypto.randomUUID();
  if(!a.card_id){
   const existing=await env.DB.prepare("SELECT c.id,a.title FROM news_cards c JOIN articles a ON a.id=c.article_id WHERE c.state!='duplicate' AND ABS(julianday(a.published_at)-julianday(?))<0.25").bind(a.published_at).all<{id:string;title:string}>();
   const grouped=prefs.mode==='active'?await env.DB.prepare("SELECT c.id FROM news_cards c JOIN news_candidates n ON n.article_id=c.article_id WHERE n.event_group=(SELECT event_group FROM news_candidates WHERE article_id=?) AND c.state!='duplicate' LIMIT 1").bind(a.id).first<{id:string}>():null;
   const parent=prefs.mode==='active'?grouped:(existing.results??[]).find(r=>previewDuplicate(a.title,r.title));
   const inserted=await env.DB.prepare("INSERT OR IGNORE INTO news_cards(id,article_id,state,created_at,parent_id) VALUES(?,?,?,?,?)").bind(id,a.id,parent?'duplicate':'waiting',time,parent?.id??null).run();
   if(!inserted.meta.changes||parent)continue;
  }
  const locked=await env.DB.prepare("UPDATE news_cards SET state='sending',next_try=? WHERE id=? AND state='waiting'").bind(time+120,id).run();if(!locked.meta.changes)continue;
  try{
   const sent=await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:previewText(JSON.parse(a.config).name,a.title,a.summary),link_preview_options:JSON.stringify({is_disabled:true}),reply_markup:JSON.stringify(await previewMarkup(env,id,a.url))}));
   await env.DB.prepare("UPDATE news_cards SET state='sent',message_id=? WHERE id=?").bind(Number(sent.message_id),id).run();
  }catch(e){const retry=e instanceof TelegramError&&e.code===429;await env.DB.prepare('UPDATE news_cards SET state=?,next_try=? WHERE id=?').bind(retry?'waiting':'uncertain',time+(e instanceof TelegramError?e.retryAfter:300),id).run();}
 }
}
export async function refreshNewsRequests(env:Env):Promise<void>{
 const paused=Number((await env.DB.prepare("SELECT value FROM system_state WHERE key='model_paused_until'").first<{value:string}>())?.value??0)>Date.now();
 const rows=await env.DB.prepare(`SELECT c.id,c.message_id,c.state,a.title,a.summary,a.url,a.error,a.status,s.config,j.state AS job_state,d.id AS draft_id,d.message_id AS draft_message_id,d.delivery_state FROM news_cards c JOIN articles a ON a.id=c.article_id JOIN sources s ON s.id=a.source_id LEFT JOIN model_jobs j ON j.article_id=a.id AND j.expected_revision=0 LEFT JOIN drafts d ON d.id=COALESCE(j.result_draft,a.draft_id) WHERE c.state IN ('requested','model_queued')`).all<{id:string;message_id:number;state:string;title:string;summary:string;url:string;error:string|null;status:string;config:string;job_state:string|null;delivery_state:string|null;draft_id:string|null;draft_message_id:number|null}>();
 for(const r of rows.results??[]){
  if(r.delivery_state==='sent'){if(await showNewsProgress(env,r,newsProgressNote(r,paused)))await env.DB.prepare("UPDATE news_cards SET state='complete' WHERE id=?").bind(r.id).run();continue;}
  if(r.status!=='needs_review'&&!['needs_review','expired'].includes(r.job_state??'')&&!['uncertain','failed','suppressed'].includes(r.delivery_state??'')){await showNewsProgress(env,r,newsProgressNote(r,paused));continue;}
  const changed=await env.DB.prepare("UPDATE news_cards SET state='failed' WHERE id=? AND state IN ('requested','model_queued')").bind(r.id).run();
  const deliveryProblem=['uncertain','failed','suppressed'].includes(r.delivery_state??'');
  const known=r.draft_id?await deliveryTarget(env,r.draft_id,r.draft_message_id):undefined;
  const note=r.delivery_state==='suppressed'?'Bu içerik güncel gönderim tercihlerine göre kapatıldı.':deliveryProblem?(r.delivery_state==='uncertain'&&!known?'Tweet ve görsel hazır, ancak teslimat doğrulanamadı. Mesaj gelmiş olabilir. Aynı düğme güvenli yeniden gönderim seçeneğini açar.':'Tweet ve görsel hazır. Teslimatı aynı düğmeyle yeniden deneyebilirsin; AI tekrar çalışmaz.'):r.error?.startsWith('gallery_')?'Galerinin sayfa ve tablo bütünlüğü doğrulanamadı. Eksik veriden içerik üretilmedi. Kaynak düzeltildikten sonra yeniden deneyebilirsin.':'Taslak doğrulanamadı. Aynı düğmeyle yeniden deneyebilirsin.';
  if(changed.meta.changes&&env.MODE==='telegram_review')await telegram(env,'editMessageText',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,message_id:String(r.message_id),text:previewText(JSON.parse(r.config).name,r.title,r.summary)+'\n\n'+note,link_preview_options:JSON.stringify({is_disabled:true}),reply_markup:JSON.stringify(await previewMarkup(env,r.id,r.url))})).catch(()=>{});
 }
}
