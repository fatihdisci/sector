import {publicationState} from './telegram-ui';
import {refreshDraftMenu} from './card-menu';
import type {Env,Draft,Document} from './types';
import {telegram} from './telegram';import {enqueueEdit} from './bridge';
const now=()=>Math.floor(Date.now()/1000);
const send=(env:Env,text:string,extra:Record<string,string>={})=>telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text,...extra}));
export function evidenceView(d:Draft,docs:Document[],verification:string){
 return {sources:docs.map(doc=>({name:doc.source_name,url:doc.url,official:doc.official,period:doc.published_at,...(doc.buyback_evidence?{report_evidence:doc.buyback_evidence}:{}),owner_correction:doc.source_id==='editor-correction'})),claims:(d.claims??[]).map(c=>({claim:c.text,excerpts:(c.evidence??[]).map(e=>({source:e.document,passage:e.passage,quote:e.quote.slice(0,240)}))})),uncertainties:d.uncertainties,source_notes:d.source_notes??[],verification};
}
export function tableView(d:Draft,docs:Document[]){
 const data=d.card_data;if(data?.overview){const o=data.overview;return [...o.panels.flatMap(p=>p.rows.map((r,i)=>({path:`overview.${p.key}.${i}`,subject:r.label,value:r.value,unit:null,direction:p.key,period:docs[0]?.published_at??null}))),...o.brokers.flatMap(b=>b.rows.map((r,i)=>({path:`overview.brokers.${b.side}.${i}`,subject:r.name,value:`${r.net} · ${r.share} · ${r.total}`,unit:null,direction:b.side,period:docs[0]?.published_at??null})))];}if(data?.report?.buyback)return data.report.buyback.rows.map((r,i)=>({path:`report.buyback.rows.${i}`,subject:r.ticker,value:r.nominal,unit:'nominal pay tutarı (kaynak)',direction:'buyback',price:r.price,amount:r.amount,period:r.day}));if(data?.report?.general)return data.report.general.rows.map((r,i)=>({path:`report.general.rows.${i}`,subject:r.ticker,value:r.lots,unit:'lot',direction:'buyback',price:r.price,amount:r.amount,period:data.report!.general!.day}));if(data?.report)return data.report.rows.map((r,i)=>({path:`report.rows.${i}`,subject:r.label,value:r.value,unit:null,direction:'report',period:docs[0]?.published_at??null}));if(data?.tickers?.length)return data.tickers.map((ticker,i)=>({path:`tickers.${i}`,subject:ticker,value:null,unit:null,direction:'circuit',period:docs[0]?.published_at??null}));return (['buy','sell','holdings','metrics'] as const).flatMap(side=>(data?.[side]??[]).map((r,i)=>({path:`${side}.${i}`,subject:r.label,value:r.value,unit:r.value.match(/(?:TL|USD|EUR|lot|adet|%)/gi)?.join(' ')??null,direction:side,period:data?.as_of??null,published_at:docs[0]?.published_at??null})));
}
export async function editorCallback(env:Env,data:string,messageId:number):Promise<string|null>{
 const m=/^ed:(data|evidence|correct|layout):([a-f0-9-]{36}):(\d+)$/.exec(data);if(!m)return null;
 const row=await env.DB.prepare("SELECT * FROM drafts WHERE id=? AND revision=? AND message_id=? AND state='pending' AND expires_at>?").bind(m[2],Number(m[3]),messageId,now()).first<any>();if(!row)return 'Kart güncellenmiş veya süresi dolmuş.';
 const d=JSON.parse(row.content) as Draft,docs=JSON.parse(row.documents) as Document[];
 if(m[1]==='layout'){
  if(d.template==='circuit'||d.card_data?.report||d.card_data?.overview)return 'Bu şablon tek sabit düzen kullanır.';
  await refreshDraftMenu(env,row.id,'layouts');return '';
 }
 if(m[1]==='correct'){
  if(d.card_data?.overview)return 'Bu piyasa tablosunda hücre düzeltme henüz desteklenmiyor; tablo ve kanıt görünümünü kullanabilirsin.';
  const publication=await publicationState(env,row.id);if(publication.published||publication.api)return 'Yayınlanmış veya paylaşımı süren kart düzeltilemez.';
  const p=await send(env,'Hücreyi bu mesaja yanıtlayarak düzelt: buy.0.value = 123 lot\nAlanlar: buy / sell / holdings / metrics, sıfırdan başlayan satır, label / value. Düzeltme kullanıcı beyanı olarak kaydedilecek ve mevcut denetimden geçecek.',{reply_markup:JSON.stringify({force_reply:true,selective:true})});
  await env.DB.prepare('INSERT OR REPLACE INTO editor_prompts VALUES(?,?,?,?,?,?)').bind(env.TELEGRAM_USER_ID!,row.id,row.revision,Number(p.message_id),'cell',now()+900).run();return 'Düzeltilecek hücreyi yanıtla.';
 }
 const result=m[1]==='data'?tableView(d,docs):evidenceView(d,docs,row.verification),text=JSON.stringify(result,null,2);
 if(text.length<3900)await send(env,text);else {const f=new FormData();f.set('chat_id',env.TELEGRAM_CHAT_ID!);f.set('document',new Blob([text],{type:'application/json'}),'endeks-editor-'+m[1]+'.json');await telegram(env,'sendDocument',f);}return 'Editör görünümü açıldı.';
}
export async function editorMessage(env:Env,m:any,update:number){
 if(m.forward_origin)return false;
 if(m.text==='/durum'){
  const health=(await env.DB.prepare("SELECT key,value FROM system_state WHERE key IN ('telegram_channel_health','collector_health','model_health','delivery_health','telegram_health','spk_x_health','fintables_x_health','nitter_account_health','buyback_report_health','kap_delivery_health','runtime_identity','model_paused_until')").all<{key:string;value:string}>()).results;
  const jobs=(await env.DB.prepare('SELECT state,COUNT(*) n,MIN(created_at) oldest FROM model_jobs GROUP BY state').all()).results;
  const sources=(await env.DB.prepare('SELECT s.id,last_ok,failures,last_error,(SELECT MAX(published_at) FROM news_candidates n WHERE n.source_id=s.id) latest_publication FROM sources s WHERE enabled=1').all()).results;
  const deliveries=(await env.DB.prepare('SELECT delivery_state,COUNT(*) n,MIN(created_at) oldest FROM drafts GROUP BY delivery_state').all()).results;
  const quotas=(await env.DB.prepare("SELECT key,value FROM system_state WHERE key LIKE 'news-request-budget:%' OR key LIKE 'kap-ai-budget:%' OR key LIKE 'ai-budget:%'").all()).results;
  const used=(await env.DB.prepare("SELECT COUNT(*) n FROM x_posts WHERE day=? AND state IN ('queued','uploading','posting','sent','uncertain')").bind(new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Istanbul'})).first<any>())?.n??0;
  const buyback_reports=(await env.DB.prepare("SELECT url,day,state,error FROM buyback_reports WHERE state IN ('needs_review','blocked_existing') ORDER BY created_at DESC LIMIT 10").all()).results;
  const summary=JSON.stringify({buyback_reports,health:health.map(h=>{let v:any={};try{v=JSON.parse(h.value);}catch{}return {key:h.key,...(typeof v==='number'?{until:v}:{ok:v.ok,at:v.at,code:v.code,state:v.state,attention:v.attention,review_pending:v.review_pending,release:v.release,catalog:v.catalog})};}),jobs,sources,deliveries,quotas,x_api:{used,limit:20}});if(summary.length<=3900)await send(env,summary);else{const file=new FormData();file.set('chat_id',env.TELEGRAM_CHAT_ID!);file.set('document',new Blob([summary],{type:'application/json'}),'endeks-durum.json');await telegram(env,'sendDocument',file);}return true;
 }
 const prompt=await env.DB.prepare('SELECT * FROM editor_prompts WHERE user_id=? AND message_id=? AND expires_at>?').bind(env.TELEGRAM_USER_ID!,m.reply_to_message?.message_id??0,now()).first<any>();if(!prompt)return false;
 const publication=await publicationState(env,prompt.draft_id);if(publication.published||publication.api){await send(env,'Yayın durumu değişmiş; bu düzeltme uygulanmadı.');return true;}
 const match=/^(buy|sell|holdings|metrics)\.(\d+)\.(label|value)\s*=\s*(.{1,200})$/u.exec(m.text??'');
 if(!match){await send(env,'Biçim: buy.0.value = 123 lot');return true;}
 const row=await env.DB.prepare("SELECT content FROM drafts WHERE id=? AND revision=? AND state='pending' AND delivery_state='sent' AND expires_at>?").bind(prompt.draft_id,prompt.revision,now()).first<{content:string}>();
 if(!row){await send(env,'Güncel kartı açıp yeniden dene.');return true;}
 const content=JSON.parse(row.content),before=content.card_data?.[match[1]]?.[Number(match[2])]?.[match[3]];if(typeof before!=='string'){await send(env,'Bu hücre bulunamadı. Önce veri görünümünü aç.');return true;}
 const busy=await env.DB.prepare("SELECT id FROM model_jobs WHERE draft_id=? AND expected_revision=? UNION ALL SELECT CAST(update_id AS TEXT) id FROM card_redesigns WHERE draft_id=? AND state IN ('queued','rendering') LIMIT 1").bind(prompt.draft_id,prompt.revision,prompt.draft_id).first();if(busy){await send(env,'Bu sürümün düzenleme işi zaten var. Tamamlanmasını bekle ve güncel kartı kullan.');return true;}
 const path=`${match[1]}.${match[2]}.${match[3]}`,after=match[4].trim();
 await env.DB.prepare('INSERT OR IGNORE INTO editor_corrections(update_id,draft_id,revision,path,before_value,after_value,created_at) VALUES(?,?,?,?,?,?,?)').bind(update,prompt.draft_id,prompt.revision,path,before,after,now()).run();
 const existing=await env.DB.prepare("SELECT id FROM model_jobs WHERE draft_id=? AND expected_revision=? AND kind='edit'").bind(prompt.draft_id,prompt.revision).first();
 if(!existing)await enqueueEdit(env,prompt.draft_id,prompt.revision,`Editör hücre düzeltmesi: ${path}: ${before} → ${after}. Tweet ve görseli aynı düzeltilmiş satırdan yeniden hazırla. Kullanıcı beyanını bağımsız resmî teyit sayma. Önceki kaynakla farkı source_notes içinde koru.`);
 await env.DB.prepare('DELETE FROM editor_prompts WHERE user_id=?').bind(env.TELEGRAM_USER_ID!).run();await send(env,'Önce/sonra farkı kaydedildi. Güncel veriyle tweet ve görsel mevcut denetim akışında yeniden hazırlanacak.');return true;
}
