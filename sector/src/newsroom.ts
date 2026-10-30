import {exportNewsText} from './news-text-export';
import{channelMarketPreviewSQL}from'./channel-market-preview';
import {COMPANY_CATALOG_VERSION} from './news-company-catalog';
import {sha256} from './utils/text';
import {detailedInterestReport} from './news-interest-report';
import {newsMenuCallback,refreshNewsMenu,interestSummary} from './news-menu';
import {digestDeliveryStatus,newsReadiness} from './news-readiness';
import type {Env} from './types';
import {telegram,TelegramError} from './telegram';
import {NEWS_RULE_VERSION,newsPreferences,searchNewsArchive} from './news-routing';
import {createMaintenanceRequest} from './news-maintenance-request';
import {selectionIsQuiet} from './news-selection-schedule';
async function runtimeIdentity(env:Env){const r=await env.DB.prepare("SELECT value FROM system_state WHERE key='runtime_identity'").first<{value:string}>();return r?JSON.parse(r.value):{release:'unknown'};}
const send=(env:Env,text:string,extra:Record<string,string>={})=>{if(text.length>3900&&!extra.reply_markup){const file=new FormData();file.set('chat_id',env.TELEGRAM_CHAT_ID!);file.set('document',new Blob([text],{type:'text/plain;charset=utf-8'}),'endeks-editor.txt');return telegram(env,'sendDocument',file);}return telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text,...extra}));};
export async function newsroomMessage(env:Env,m:{text?:string;forward_origin?:unknown}){
 if(m.forward_origin)return false;
 const text=m.text??'';
 if(/^\/arsiv(?:\s|$)/.test(text)){const q=text.slice(6).trim();const rows=await searchNewsArchive(env,q);await send(env,rows.length?rows.map((r:any)=>`${r.id} · ${r.title}\n${r.route} · ${r.url}`).join('\n\n'):'Arşivde eşleşen kayıt yok.');return true;}
 const link=/^\/olay ([a-f0-9]{32}) ([a-f0-9]{32})$/.exec(text);if(link){const count=(await env.DB.prepare('SELECT COUNT(*) n FROM news_candidates WHERE id IN (?,?)').bind(link[1],link[2]).first<any>())?.n;if(count!==2){await send(env,'İki farklı ve kayıtlı aday kimliği gerekli.');return true;}await env.DB.prepare('INSERT OR IGNORE INTO news_event_links VALUES(?,?,?,?)').bind(link[1],link[2],env.TELEGRAM_USER_ID!,Date.now()).run();await send(env,'Olay ilişkisi sahibin onayıyla kaydedildi. Haberler bastırılmadı veya bağımsız teyit sayılmadı.');return true;}
 const review=/^\/aday ([a-f0-9]{32}) (instant|digest|archive)$/.exec(text);if(review){await env.DB.prepare('INSERT OR IGNORE INTO news_feedback VALUES(?,?,?,?)').bind(env.TELEGRAM_UPDATE_ID??Date.now(),review[1],'review:'+review[2],Date.now()).run();await send(env,'İnceleme etiketi kaydedildi; canlı rota değiştirilmedi.');return true;}
 if(text==='/golgerapor'){const prefs=await newsPreferences(env);await send(env,JSON.stringify({runtime:await runtimeIdentity(env),...await newsReadiness(env,prefs,NEWS_RULE_VERSION),interest_feedback:await interestSummary(env)},null,2));const file=new FormData();file.set('chat_id',env.TELEGRAM_CHAT_ID!);file.set('document',new Blob([await detailedInterestReport(env)],{type:'text/plain;charset=utf-8'}),'endeks-geri-bildirim.txt');await telegram(env,'sendDocument',file);return true;}
 if(text==='/haberfiltre'){const prefs=await newsPreferences(env);const counts=(await env.DB.prepare('SELECT route,legacy_eligible,COUNT(*) n FROM news_candidates GROUP BY route,legacy_eligible').all()).results;const times=prefs.selection_times??prefs.digest_times;await send(env,`Çalışan sürüm/katalog: ${JSON.stringify(await runtimeIdentity(env))}\nHaber filtresi: ${prefs.mode}${prefs.requested_mode==='active'&&prefs.mode!=='active'?' (aktif istek hazırlık kontrolünde durduruldu)':''}. Seçki yapılandırması: ${prefs.digest_enabled?'açık':'kapalı'} (${times.join(', ')} İstanbul${prefs.selection_quiet_hours?' · 00:00–08:00 sessiz':''}). Seçki gönderimi: ${digestDeliveryStatus(prefs)?'açık':'kapalı'}${prefs.mode==='shadow'?' — gölge modda gönderim kapalı':''}.
${(prefs.readiness_reasons??[]).join('\n')}
${JSON.stringify(counts)}
İnceleme ve gerçek ölçümler: /golgerapor. /secki ile açık editör isteği kullanılabilir; otomatik gönderimi açmaz.`);await createMaintenanceRequest(env,(text,extra)=>send(env,text,extra));return true;}
 if(text==='/secki'){await sendSelection(env);return true;}return false;
}
export const DIGEST_CATCHUP_MS=2*60*60*1000;
function isQuietHour(now:number,quiet:{start:number;end:number}){const hour=new Date(now+3*60*60_000).getUTCHours();return hour>=quiet.start&&hour<quiet.end&&selectionIsQuiet(now);}
export function dueSelectionSlot(now:number,times:string[],earliest:number){const day=new Date(now+10800000).toISOString().slice(0,10);return times.map(clock=>({clock,at:Date.parse(day+'T'+clock+':00+03:00')})).filter(s=>s.at<=now&&s.at>=earliest&&now-s.at<DIGEST_CATCHUP_MS).sort((a,b)=>a.at-b.at).at(-1)??null;}
export async function selectionRows(env:Env,since=0,ids?:string[],now=Date.now(),limit=10){
 // Freshness is checked at selection time, not inherited from a stale eligible flag.
 return (await env.DB.prepare(`WITH eligible_rows AS (
 SELECT n.id,n.title,n.event_group,n.first_seen FROM news_candidates n
 WHERE n.route='digest' AND NOT EXISTS(SELECT 1 FROM articles a WHERE a.id=n.article_id AND ${channelMarketPreviewSQL()}) AND n.expires_at>? AND n.first_seen>=?
 AND ((n.published_at IS NULL AND ?=0) OR (n.eligible=1 AND julianday(n.published_at) BETWEEN julianday(?,'unixepoch') AND julianday(?,'unixepoch')))
 AND (? IS NULL OR n.id IN (SELECT value FROM json_each(?)))
 AND (? IS NOT NULL OR NOT EXISTS(SELECT 1 FROM news_digest_runs r,json_each(r.items) i
 JOIN news_candidates delivered ON delivered.id=i.value
 WHERE delivered.event_group=n.event_group AND r.state IN ('sending','sent','uncertain') AND NOT EXISTS(SELECT 1 FROM news_digest_pages p WHERE p.slot_id=r.id)))
 AND (? IS NOT NULL OR NOT EXISTS(SELECT 1 FROM news_digest_pages p,json_each(CASE WHEN p.state='sent' THEN p.actual_items ELSE p.items END) i JOIN news_candidates delivered ON delivered.id=i.value WHERE delivered.event_group=n.event_group AND p.state IN ('pending','retry','sending','sent','uncertain')))
 ), ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY event_group ORDER BY first_seen,id) position FROM eligible_rows)
 SELECT id,title FROM ranked WHERE position=1 ORDER BY first_seen,id LIMIT ?`).bind(now,since,since,(now-86400000)/1000,(now+300000)/1000,ids?JSON.stringify(ids):null,JSON.stringify(ids??[]),ids?1:null,ids?1:null,limit).all<{id:string;title:string}>()).results;
}

export async function sendSelection(env:Env,since=0,ids?:string[],pageInfo?:{page:number;total:number;silent?:boolean}){
 const rows=await selectionRows(env,since,ids);
 if(ids&&!rows.length)return [];
 const sent=await send(env,rows.length?`Toplu seçki${pageInfo?' · '+pageInfo.page+'/'+pageInfo.total:''} · Ayrıntısını görmek istediğin habere dokun.`:'Seçkide güncel aday yok.',{...(pageInfo?.silent?{disable_notification:'true'}:{}),reply_markup:JSON.stringify({inline_keyboard:rows.map(r=>[{text:Array.from(r.title).slice(0,85).join(''),callback_data:'pick:'+r.id}])})});
 await env.DB.prepare('INSERT OR REPLACE INTO system_state(key,value) VALUES(?,?)').bind('selection_message:'+sent.message_id,JSON.stringify(rows.map(r=>r.id))).run();
 return {ids:rows.map(r=>r.id),message_id:Number(sent.message_id)};
}
export async function newsroomCallback(env:Env,data:string,messageId:number,update:number):Promise<string|null>{
 const exp=/^ngpt:([a-f0-9-]{36})$/.exec(data);if(exp)return exportNewsText(env,exp[1],messageId);
 const menu=await newsMenuCallback(env,data,messageId,update);if(menu!==null)return menu;
 const feedback=/^nf:(reason|irrelevant|repeat|digest):([a-f0-9-]{36})$/.exec(data);
 if(feedback){const row=await env.DB.prepare('SELECT n.* FROM news_cards c JOIN news_candidates n ON n.article_id=c.article_id WHERE c.id=? AND c.message_id=?').bind(feedback[2],messageId).first<any>();if(!row)return 'Bu kartta yeni filtre kararı bulunmuyor.';
  if(['reason','irrelevant'].includes(feedback[1])){await refreshNewsMenu(env,feedback[2],messageId,'more');return 'Güncel menü açıldı.';}
  await env.DB.prepare('INSERT OR IGNORE INTO news_feedback VALUES(?,?,?,?)').bind(update,row.id,feedback[1],Date.now()).run();return 'Geri bildirim kaydedildi. Şirket susturulmadı; kalıcı kural değiştirilmedi.';
 }
 const pick=/^pick:([a-f0-9]{32})$/.exec(data);if(!pick)return null;
 const row=await env.DB.prepare('SELECT n.*,s.enabled FROM news_candidates n JOIN sources s ON s.id=n.source_id WHERE n.id=? AND n.expires_at>?').bind(pick[1],Date.now()).first<any>();
 if(!row)return 'Kayıt süresi dolmuş.';
 const binding=await env.DB.prepare("SELECT 1 FROM system_state WHERE key=? AND EXISTS(SELECT 1 FROM json_each(system_state.value) j WHERE j.value=?) UNION SELECT 1 FROM news_digest_pages WHERE message_id=? AND state='sent' AND EXISTS(SELECT 1 FROM json_each(actual_items) WHERE value=?)").bind('selection_message:'+messageId,row.id,messageId,row.id).first();
 if(!binding)return 'Güncel seçki mesajını kullan.';
 const existing=await env.DB.prepare('SELECT state FROM news_cards WHERE article_id=?').bind(row.article_id).first();if(existing)return 'Bu haberin detay kartı zaten mevcut; karttaki ayrı işlemleri kullan.';
 const claim=await env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) VALUES(?,?)').bind('selection_detail:'+row.id,'claimed').run();if(!claim.meta.changes)return 'Detay kartı daha önce açıldı veya teslim sonucu belirsiz; otomatik tekrar yapılmadı.';
 const time=Math.floor(Date.now()/1000),id=crypto.randomUUID();
 await env.DB.prepare('INSERT OR IGNORE INTO articles(id,source_id,url,title,summary,published_at,first_seen) VALUES(?,?,?,?,?,?,?)').bind(row.article_id,row.source_id,row.url,row.title,row.summary,row.published_at??'',time).run();
 const {newsKeyboard}=await import('./telegram-ui');
 const source=await env.DB.prepare('SELECT config FROM sources WHERE id=?').bind(row.source_id).first<{config:string}>();
 const status=await send(env,[JSON.parse(source!.config).name,row.title,row.summary].filter(Boolean).join('\n\n').slice(0,3500),{link_preview_options:JSON.stringify({is_disabled:true}),reply_markup:JSON.stringify(newsKeyboard(id,row.url))});
 await env.DB.prepare("INSERT OR IGNORE INTO news_cards(id,article_id,state,message_id,created_at) VALUES(?,?,'sent',?,?)").bind(id,row.article_id,Number(status.message_id),time).run();return 'Haber ayrıntısı açıldı; içerik üretimi başlatılmadı.';
}
export async function scheduledSelection(env:Env,now=Date.now(),sender:(env:Env,since:number,ids?:string[],pageInfo?:{page:number;total:number;silent?:boolean})=>Promise<void|string[]|{ids:string[];message_id:number}>=sendSelection){
 const prefs=await newsPreferences(env);if(!digestDeliveryStatus(prefs))return;
 // Each uncertain page is quarantined independently; successful pages never repeat.
 await env.DB.prepare("UPDATE news_digest_pages SET state='uncertain',error='interrupted_send' WHERE state='sending' AND updated_at<?").bind(now-120000).run();
 await env.DB.prepare("UPDATE news_digest_pages SET state='deferred' WHERE state IN ('pending','retry') AND expires_at<=?").bind(now).run();
 await env.DB.prepare("UPDATE news_digest_runs SET state='uncertain',error='interrupted_send' WHERE state='sending' AND created_at<? AND NOT EXISTS(SELECT 1 FROM news_digest_pages p WHERE p.slot_id=news_digest_runs.id)").bind(now-120000).run();
 const times=prefs.selection_times??prefs.digest_times,since=prefs.selection_since??prefs.schedule_since??0,selectionCutoff=Math.max(prefs.activated_at,prefs.selection_since??prefs.activated_at),slot=dueSelectionSlot(now,times,Math.max(prefs.activated_at,since));if(!slot)return;
 const day=new Date(now+10800000).toISOString().slice(0,10),key=day+':'+slot.clock;
 const planHash=await sha256(JSON.stringify({version:1,rule:NEWS_RULE_VERSION,catalog:COMPANY_CATALOG_VERSION,scope:{entities:prefs.entities,watchlist:prefs.watchlist,times,activated_at:prefs.activated_at,selection_since:prefs.selection_since??null}}));
 let receipt=await env.DB.prepare('SELECT state,items,error FROM news_digest_runs WHERE id=?').bind(key).first<{state:string;items:string;error:string|null}>();
 if(!receipt){
  const ids=(await selectionRows(env,selectionCutoff,undefined,now,-1)).map(r=>r.id);
  // Freeze the winning slot snapshot first; page planning resumes idempotently after a crash.
  const snapshot=JSON.stringify(ids),hash=await sha256(snapshot);
  await env.DB.prepare("INSERT OR IGNORE INTO news_digest_runs(id,state,created_at,items,error) VALUES(?,'planning',?,?,?)").bind(key,now,snapshot,JSON.stringify({snapshot_sha256:hash,plan_hash:planHash})).run();
  receipt=await env.DB.prepare('SELECT state,items,error FROM news_digest_runs WHERE id=?').bind(key).first<{state:string;items:string;error:string|null}>();
 }
 if(!receipt||!['planning','paged'].includes(receipt.state))return;
 let savedPlan='';try{savedPlan=JSON.parse(receipt.error??'{}').plan_hash;}catch{}
 if(savedPlan!==planHash){await env.DB.batch([env.DB.prepare("UPDATE news_digest_runs SET state='blocked' WHERE id=?").bind(key),env.DB.prepare("UPDATE news_digest_pages SET state='deferred' WHERE slot_id=? AND state IN ('pending','retry')").bind(key)]);return;}
 if(receipt.state==='planning'){
  const frozen=JSON.parse(receipt.items) as string[],statements=[];
  for(let i=0;i<frozen.length;i+=10)statements.push(env.DB.prepare("INSERT OR IGNORE INTO news_digest_pages(slot_id,page,items,updated_at,expires_at) VALUES(?,?,?,?,?)").bind(key,i/10,JSON.stringify(frozen.slice(i,i+10)),now,slot.at+DIGEST_CATCHUP_MS));
  statements.push(env.DB.prepare("UPDATE news_digest_runs SET state=? WHERE id=? AND state='planning'").bind(frozen.length?'paged':'empty',key));
  await env.DB.batch(statements);if(!frozen.length)return;
 }
 // One bounded page per tick; a global per-slot pacing timestamp also respects 429.
 const paced=await env.DB.prepare("UPDATE news_digest_runs SET next_try=? WHERE id=? AND next_try<=? AND state='paged'").bind(now+1000,key,now).run();if(!paced.meta.changes)return;
 const page=await env.DB.prepare("SELECT page,items FROM news_digest_pages WHERE slot_id=? AND state IN ('pending','retry') AND next_try<=? AND attempts<3 ORDER BY page LIMIT 1").bind(key,now).first<{page:number;items:string}>();
 if(page){
  const claimed=await env.DB.prepare("UPDATE news_digest_pages SET state='sending',attempts=attempts+1,updated_at=? WHERE slot_id=? AND page=? AND state IN ('pending','retry')").bind(now,key,page.page).run();if(!claimed.meta.changes)return;
  await env.DB.prepare('UPDATE news_digest_runs SET next_try=? WHERE id=?').bind(now+1000,key).run();
  const planned=JSON.parse(page.items) as string[],ids=(await selectionRows(env,selectionCutoff,planned,now)).map(r=>r.id);
  try{
   const result=ids.length?await sender(env,prefs.activated_at,ids,{page:page.page+1,total:Math.ceil(JSON.parse(receipt.items).length/10),silent:!!prefs.selection_quiet_hours&&isQuietHour(now,prefs.selection_quiet_hours)}):[];
   const actual=Array.isArray(result)?result:result?.ids??ids;
   const messageId=result&&!Array.isArray(result)?result.message_id:null;
   if(actual.some(id=>!ids.includes(id))||new Set(actual).size!==actual.length)throw Error('invalid_delivery_receipt');
   await env.DB.prepare('UPDATE news_digest_pages SET state=?,actual_items=?,expired_count=?,updated_at=?,message_id=? WHERE slot_id=? AND page=?').bind(actual.length?'sent':'empty',JSON.stringify(actual),planned.length-actual.length,now,messageId,key,page.page).run();
  }catch(e){
   const retry=e instanceof TelegramError&&e.code===429,until=now+(e instanceof TelegramError?Math.max(1,e.retryAfter):60)*1000;
   await env.DB.prepare('UPDATE news_digest_pages SET state=?,error=?,next_try=?,updated_at=? WHERE slot_id=? AND page=?').bind(retry?'retry':e instanceof TelegramError&&e.failure==='permanent'?'failed':'uncertain','selection_delivery_failed',until,now,key,page.page).run();
   if(retry)await env.DB.prepare('UPDATE news_digest_runs SET next_try=? WHERE id=?').bind(until,key).run();
  }
 }
 await env.DB.prepare("UPDATE news_digest_pages SET state='failed',error='retry_budget_exhausted' WHERE slot_id=? AND state='retry' AND attempts>=3").bind(key).run();
 const states=(await env.DB.prepare('SELECT state FROM news_digest_pages WHERE slot_id=?').bind(key).all<{state:string}>()).results.map(r=>r.state);
 if(!states.some(s=>['pending','retry','sending'].includes(s)))await env.DB.prepare('UPDATE news_digest_runs SET state=? WHERE id=?').bind(states.includes('uncertain')?'uncertain':states.includes('failed')?'failed':states.includes('sent')?'sent':'empty',key).run();
}
