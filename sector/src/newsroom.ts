import {detailedInterestReport} from './news-interest-report';
import {newsMenuCallback,refreshNewsMenu,interestSummary} from './news-menu';
import {digestDeliveryStatus,newsReadiness} from './news-readiness';
import type {Env} from './types';
import {telegram,TelegramError} from './telegram';
import {NEWS_RULE_VERSION,newsPreferences,searchNewsArchive} from './news-routing';
async function runtimeIdentity(env:Env){const r=await env.DB.prepare("SELECT value FROM system_state WHERE key='runtime_identity'").first<{value:string}>();return r?JSON.parse(r.value):{release:'unknown'};}
const send=(env:Env,text:string,extra:Record<string,string>={})=>{if(text.length>3900&&!extra.reply_markup){const file=new FormData();file.set('chat_id',env.TELEGRAM_CHAT_ID!);file.set('document',new Blob([text],{type:'text/plain;charset=utf-8'}),'endeks-editor.txt');return telegram(env,'sendDocument',file);}return telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text,...extra}));};
export async function newsroomMessage(env:Env,m:{text?:string;forward_origin?:unknown}){
 if(m.forward_origin)return false;
 const text=m.text??'';
 if(/^\/arsiv(?:\s|$)/.test(text)){const q=text.slice(6).trim();const rows=await searchNewsArchive(env,q);await send(env,rows.length?rows.map((r:any)=>`${r.id} · ${r.title}\n${r.route} · ${r.url}`).join('\n\n'):'Arşivde eşleşen kayıt yok.');return true;}
 const link=/^\/olay ([a-f0-9]{32}) ([a-f0-9]{32})$/.exec(text);if(link){const count=(await env.DB.prepare('SELECT COUNT(*) n FROM news_candidates WHERE id IN (?,?)').bind(link[1],link[2]).first<any>())?.n;if(count!==2){await send(env,'İki farklı ve kayıtlı aday kimliği gerekli.');return true;}await env.DB.prepare('INSERT OR IGNORE INTO news_event_links VALUES(?,?,?,?)').bind(link[1],link[2],env.TELEGRAM_USER_ID!,Date.now()).run();await send(env,'Olay ilişkisi sahibin onayıyla kaydedildi. Haberler bastırılmadı veya bağımsız teyit sayılmadı.');return true;}
 const review=/^\/aday ([a-f0-9]{32}) (instant|digest|archive)$/.exec(text);if(review){await env.DB.prepare('INSERT OR IGNORE INTO news_feedback VALUES(?,?,?,?)').bind(env.TELEGRAM_UPDATE_ID??Date.now(),review[1],'review:'+review[2],Date.now()).run();await send(env,'İnceleme etiketi kaydedildi; canlı rota değiştirilmedi.');return true;}
 if(text==='/golgerapor'){const prefs=await newsPreferences(env);await send(env,JSON.stringify({runtime:await runtimeIdentity(env),...await newsReadiness(env,prefs,NEWS_RULE_VERSION),interest_feedback:await interestSummary(env)},null,2));const file=new FormData();file.set('chat_id',env.TELEGRAM_CHAT_ID!);file.set('document',new Blob([await detailedInterestReport(env)],{type:'text/plain;charset=utf-8'}),'endeks-geri-bildirim.txt');await telegram(env,'sendDocument',file);return true;}
 if(text==='/haberfiltre'){const prefs=await newsPreferences(env);const counts=(await env.DB.prepare('SELECT route,legacy_eligible,COUNT(*) n FROM news_candidates GROUP BY route,legacy_eligible').all()).results;await send(env,`Çalışan sürüm/katalog: ${JSON.stringify(await runtimeIdentity(env))}\nHaber filtresi: ${prefs.mode}${prefs.requested_mode==='active'&&prefs.mode!=='active'?' (aktif istek hazırlık kontrolünde durduruldu)':''}. Seçki yapılandırması: ${prefs.digest_enabled?'açık':'kapalı'} (${prefs.digest_times.join(', ')} İstanbul). Seçki gönderimi: ${digestDeliveryStatus(prefs)?'açık':'kapalı'}${prefs.mode==='shadow'?' — gölge modda gönderim kapalı':''}.
${(prefs.readiness_reasons??[]).join('\n')}
${JSON.stringify(counts)}
İnceleme ve gerçek ölçümler: /golgerapor. /secki ile açık editör isteği kullanılabilir; otomatik gönderimi açmaz.`);return true;}
 if(text==='/secki'){await sendSelection(env);return true;}return false;
}
export const DIGEST_CATCHUP_MS=2*60*60*1000;
export async function selectionRows(env:Env,since=0,ids?:string[],now=Date.now()){
 // Freshness is checked at selection time, not inherited from a stale eligible flag.
 return (await env.DB.prepare(`WITH eligible_rows AS (
 SELECT n.id,n.title,n.event_group,n.first_seen FROM news_candidates n
 WHERE n.route='digest' AND n.expires_at>? AND n.first_seen>=?
 AND ((n.published_at IS NULL AND ?=0) OR (n.eligible=1 AND julianday(n.published_at) BETWEEN julianday(?,'unixepoch') AND julianday(?,'unixepoch')))
 AND (? IS NULL OR n.id IN (SELECT value FROM json_each(?)))
 AND (? IS NOT NULL OR NOT EXISTS(SELECT 1 FROM news_digest_runs r,json_each(r.items) i
 JOIN news_candidates delivered ON delivered.id=i.value
 WHERE delivered.event_group=n.event_group AND r.state IN ('sending','sent','uncertain')))
 ), ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY event_group ORDER BY first_seen,id) position FROM eligible_rows)
 SELECT id,title FROM ranked WHERE position=1 ORDER BY first_seen,id LIMIT 10`).bind(now,since,since,(now-86400000)/1000,(now+300000)/1000,ids?JSON.stringify(ids):null,JSON.stringify(ids??[]),ids?1:null).all<{id:string;title:string}>()).results;
}

export async function sendSelection(env:Env,since=0,ids?:string[]){
 const rows=await selectionRows(env,since,ids);
 if(ids&&!rows.length)return [];
 await send(env,rows.length?'Toplu seçki · Hazırlanmasını istediğin habere dokun.':'Seçkide güncel aday yok.',{reply_markup:JSON.stringify({inline_keyboard:rows.map(r=>[{text:r.title.slice(0,85),callback_data:'pick:'+r.id}])})});
 return rows.map(r=>r.id);
}
export async function newsroomCallback(env:Env,data:string,messageId:number,update:number):Promise<string|null>{
 const menu=await newsMenuCallback(env,data,messageId,update);if(menu!==null)return menu;
 const feedback=/^nf:(reason|irrelevant|repeat|digest):([a-f0-9-]{36})$/.exec(data);
 if(feedback){const row=await env.DB.prepare('SELECT n.* FROM news_cards c JOIN news_candidates n ON n.article_id=c.article_id WHERE c.id=? AND c.message_id=?').bind(feedback[2],messageId).first<any>();if(!row)return 'Bu kartta yeni filtre kararı bulunmuyor.';
  if(['reason','irrelevant'].includes(feedback[1])){await refreshNewsMenu(env,feedback[2],messageId,'more');return 'Güncel menü açıldı.';}
  await env.DB.prepare('INSERT OR IGNORE INTO news_feedback VALUES(?,?,?,?)').bind(update,row.id,feedback[1],Date.now()).run();return 'Geri bildirim kaydedildi. Şirket susturulmadı; kalıcı kural değiştirilmedi.';
 }
 const pick=/^pick:([a-f0-9]{32})$/.exec(data);if(!pick)return null;
 const row=await env.DB.prepare('SELECT n.*,s.enabled FROM news_candidates n JOIN sources s ON s.id=n.source_id WHERE n.id=? AND n.expires_at>?').bind(pick[1],Date.now()).first<any>();
 if(!row)return 'Kayıt süresi dolmuş.';
 const existing=await env.DB.prepare('SELECT state FROM news_cards WHERE article_id=?').bind(row.article_id).first();if(existing)return 'Bu aday için bir kart veya içerik isteği zaten var.';
 if(!row.published_at&&await env.DB.prepare("SELECT 1 FROM manual_requests WHERE kind='url' AND json_extract(input,'$.url')=? AND (state IN ('queued','reading','model_queued','complete') OR error='delivery_uncertain') LIMIT 1").bind(row.url).first())return 'Bu kaynak için mevcut bir istek var; aynı iş yeniden oluşturulmadı.';
 const status=await send(env,'İsteğin alındı: '+row.title+'\nTam metin okunup denetlenecek.');
 const time=Math.floor(Date.now()/1000),id=crypto.randomUUID();
 if(!row.published_at){await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO manual_requests(update_id,message_id,kind,input,created_at) VALUES(?,?,'url',?,?)").bind(update,Number(status.message_id),JSON.stringify({url:row.url,text:'',editor_request:''}),time),env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) VALUES(?,?)').bind('manual_status:'+update,String(status.message_id))]);return 'Tarih doğrulanmadan güncelmiş gibi sunulmayacak; tam kaynak mevcut manuel denetimle okunacak.';}

 await env.DB.batch([
 env.DB.prepare('INSERT OR IGNORE INTO articles(id,source_id,url,title,summary,published_at,first_seen) VALUES(?,?,?,?,?,?,?)').bind(row.article_id,row.source_id,row.url,row.title,row.summary,row.published_at,time),
 env.DB.prepare("INSERT OR IGNORE INTO news_cards(id,article_id,state,message_id,created_at,requested_at) VALUES(?,?,'requested',?,?,?)").bind(id,row.article_id,Number(status.message_id),time,time)
 ]);return 'Açık isteğin alındı; mevcut tam metin ve denetim akışıyla hazırlanacak.';
}
export async function scheduledSelection(env:Env,now=Date.now(),sender:(env:Env,since:number,ids?:string[])=>Promise<void|string[]>=sendSelection){
 await env.DB.prepare("UPDATE news_digest_runs SET state='uncertain',error='interrupted_send' WHERE state='sending' AND created_at<?").bind(now-120000).run();
 const prefs=await newsPreferences(env);if(!digestDeliveryStatus(prefs))return;
 const day=new Date(now+10800000).toISOString().slice(0,10),slot=prefs.digest_times.map(clock=>({clock,at:Date.parse(day+'T'+clock+':00+03:00')})).filter(s=>s.at<=now&&s.at>=prefs.activated_at&&now-s.at<DIGEST_CATCHUP_MS).sort((a,b)=>a.at-b.at).at(-1);if(!slot)return;
 const key=day+':'+slot.clock;
 const claim=await env.DB.prepare("INSERT INTO news_digest_runs(id,state,created_at,attempts) VALUES(?,'sending',?,1) ON CONFLICT(id) DO UPDATE SET state='sending',created_at=excluded.created_at,attempts=attempts+1 WHERE news_digest_runs.state='retry' AND news_digest_runs.next_try<=? AND news_digest_runs.attempts<3").bind(key,now,now).run();if(!claim.meta.changes)return;
 const previous=await env.DB.prepare('SELECT items FROM news_digest_runs WHERE id=?').bind(key).first<{items:string}>();
 let ids=JSON.parse(previous?.items??'[]') as string[];
 if(!ids.length){ids=(await selectionRows(env,prefs.activated_at,undefined,now)).map(r=>r.id);await env.DB.prepare('UPDATE news_digest_runs SET items=? WHERE id=?').bind(JSON.stringify(ids),key).run();}
 if(ids.length){ids=(await selectionRows(env,prefs.activated_at,ids,now)).map(r=>r.id);await env.DB.prepare('UPDATE news_digest_runs SET items=? WHERE id=?').bind(JSON.stringify(ids),key).run();}
 if(!ids.length){await env.DB.prepare("UPDATE news_digest_runs SET state='empty' WHERE id=?").bind(key).run();return;}
 try{const delivered=await sender(env,prefs.activated_at,ids);const actual=Array.isArray(delivered)?delivered:ids;await env.DB.prepare('UPDATE news_digest_runs SET state=?,items=? WHERE id=?').bind(actual.length?'sent':'empty',JSON.stringify(actual),key).run();}
 catch(e){const retry=e instanceof TelegramError&&e.code===429;await env.DB.prepare('UPDATE news_digest_runs SET state=?,error=?,next_try=? WHERE id=?').bind(retry?'retry':e instanceof TelegramError&&e.failure==='permanent'?'failed':'uncertain','selection_delivery_failed',now+(e instanceof TelegramError?e.retryAfter:60)*1000,key).run();}
}
