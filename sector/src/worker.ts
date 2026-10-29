import {cardMenuCallback,refreshDraftMenu} from './card-menu';
import {publicationState} from './telegram-ui';
import {OUTPUT_LIMIT_MESSAGE} from './output-preferences';
import {editorMessage,editorCallback} from './editor-tools';
import {newsroomMessage,newsroomCallback} from './newsroom';
import {publicationAction,publicationMessage} from './publication-assistant';
import {requestX,xEnabled} from './x-publish';
import {requestRedesign} from './card-redesign';
import {requestNews} from './news-inbox';
import {newsPreferences} from './news-routing';
import {newsFilterHealth} from './news-health';
import {approveMaintenanceRequest} from './news-maintenance-request';
import {sendDraftAsset} from './draft-assets';
import registry from '../sources.json';
import {queueManual,type InputMessage} from './manual';
import {tick,seed,deliver,errorCode,type DraftRow} from './pipeline';
import {leaseJob,submitJob,enqueueEdit,ingestOfficial} from './bridge';
import {isOwner,telegram,sourceKeyboard,TelegramError} from './telegram';
import {parseCallback,transition} from './approval';
import type {Env,Status} from './types';
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function secretEqual(a:string,b:string):Promise<boolean>{
 if(!a||!b)return false;
 const hash=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [aa,bb]=await Promise.all([hash(a),hash(b)]);let diff=0;for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];return diff===0;
}
async function body(request:Request,max=80_000):Promise<Record<string,unknown>> {
 if(Number(request.headers.get('content-length'))>max)throw new Error('request_too_large');
 const reader=request.body?.getReader();if(!reader)throw new Error('empty_request');let length=0;const parts:Uint8Array[]=[];
 try {while(true){const v=await reader.read();if(v.done)break;length+=v.value.length;if(length>max)throw new Error('request_too_large');parts.push(v.value);}}
 finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
 const all=new Uint8Array(length);let at=0;for(const p of parts){all.set(p,at);at+=p.length;}const value=JSON.parse(new TextDecoder().decode(all));if(!value||Array.isArray(value)||typeof value!=='object')throw new Error('invalid_request');return value;
}
async function webhook(request:Request,env:Env):Promise<Response> {
 if(!await secretEqual(request.headers.get('x-telegram-bot-api-secret-token')??'',env.TELEGRAM_WEBHOOK_SECRET??''))return json({error:'unauthorized'},401);
 const update=await body(request);const id=update.update_id;if(!Number.isSafeInteger(id))return json({ok:true});
 env={...env,TELEGRAM_UPDATE_ID:Number(id)};
 const message=update.message as InputMessage|undefined;
 if(message?.chat&&message.from&&isOwner(env,String(message.from.id),String(message.chat.id),message.chat.type)) {
  if(await editorMessage(env,message,Number(id)))return json({ok:true});
  if(await newsroomMessage(env,message))return json({ok:true});
  if(await publicationMessage(env,message,Number(id)))return json({ok:true});
  const edit=await env.DB.prepare('SELECT * FROM edits WHERE user_id=? AND expires_at>?').bind(env.TELEGRAM_USER_ID!,Math.floor(Date.now()/1000)).first<{draft_id:string;revision:number;prompt_message_id:number}>();
  if(edit&&message.text&&message.reply_to_message?.message_id===edit.prompt_message_id) {
   try {const state=await publicationState(env,edit.draft_id);if(state.published||state.api)throw Error('publication_locked');await enqueueEdit(env,edit.draft_id,edit.revision,message.text,message.message_id);await env.DB.prepare('DELETE FROM edits WHERE user_id=?').bind(env.TELEGRAM_USER_ID!).run();}
   catch(e) {await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:e instanceof Error&&e.message==='unsupported_output_limit'?OUTPUT_LIMIT_MESSAGE:'Düzenleme kaydedilemedi. Karttaki Düzenle düğmesinden tekrar deneyebilirsin.'}));}
  } else await queueManual(env,Number(id),message);
  return json({ok:true});
 }
 const cb=update.callback_query as {id:string;data:string;from:{id:number};message?:{message_id:number;chat:{id:number;type:string}}}|undefined;
 if(!cb||!cb.message||!isOwner(env,String(cb.from?.id),String(cb.message.chat?.id),cb.message.chat?.type))return json({ok:true});
 const maintenance=cb.data?.match(/^nm:approve:([a-f0-9-]{36})$/);
 if(maintenance){const answer=await approveMaintenanceRequest(env,maintenance[1],String(cb.from.id),String(cb.message.chat.id),cb.message.message_id);await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:cb.id,text:answer})).catch(()=>{});return json({ok:true});}
 const kapPrepare=cb.data?.match(/^kap:prepare:([a-f0-9-]{36})$/);
 if(kapPrepare){
  const changed=await env.DB.prepare("UPDATE kap_previews SET state='selected',selected_at=? WHERE id=? AND message_id=? AND state='sent'").bind(Date.now(),kapPrepare[1],cb.message.message_id).run();
  const prior=await env.DB.prepare("SELECT state FROM kap_previews WHERE id=? AND message_id=?").bind(kapPrepare[1],cb.message.message_id).first<{state:string}>();
  await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:cb.id,text:changed.meta.changes||prior?.state==='selected'?'Hazırlama isteği alındı.':'Bu düğme kullanılamıyor.'})).catch(()=>{});
  return json({ok:true});
 }
 const menu=await cardMenuCallback(env,cb.data,cb.message.message_id);if(menu!==null){await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:cb.id,...(menu?{text:menu}:{})}));return json({ok:true});}
 const publication=cb.data?.match(/^dp:(mark|undo|defer|time):([a-f0-9-]{36}):(\d{1,6})$/);
 if(publication){
  const row=await env.DB.prepare("SELECT id FROM drafts WHERE id=? AND revision=? AND message_id=? AND state='pending' AND delivery_state='sent' AND expires_at>?").bind(publication[2],Number(publication[3]),cb.message.message_id,Math.floor(Date.now()/1000)).first<{id:string}>();
  let answer='Kart değişmiş veya süresi dolmuş; güncel kartı kullan.';
  if(row){const state=await publicationState(env,row.id),action=publication[1];
   const allowed=!state.api&&(action==='time'?state.manual:action==='undo'?(state.manual||state.deferred):!state.published);
   answer=allowed?await publicationAction(env,action,row.id,Number(id),cb.message.message_id):'Bu işlem mevcut yayın durumunda uygun değil.';
  }
  await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:cb.id,text:answer.slice(0,200),show_alert:'true'}));return json({ok:true});
 }
 // Revisionless legacy publication/copy controls cannot mutate current state.
 const legacy=cb.data?.match(/^pub:(?:mark|undo|defer|time|stats):([a-f0-9-]{36})$/)??cb.data?.match(/^asset:text:([a-f0-9-]{36}):\d+$/);
 if(legacy){const row=await env.DB.prepare("SELECT id FROM drafts WHERE id=? AND message_id=? AND delivery_state='sent'").bind(legacy[1],cb.message.message_id).first<{id:string}>();if(row)await refreshDraftMenu(env,row.id);await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:cb.id,text:row?'Güncel menü açıldı.':'Güncel kartı kullan.'}));return json({ok:true});}
 const oldApproval=cb.data?.match(/^s:(?:approve|reject|defer):([a-f0-9-]{36}):(\d{1,6})$/);
 if(oldApproval){const row=await env.DB.prepare("SELECT id FROM drafts WHERE id=? AND revision=? AND message_id=? AND state='pending' AND delivery_state='sent' AND expires_at>?").bind(oldApproval[1],Number(oldApproval[2]),cb.message.message_id,Math.floor(Date.now()/1000)).first<{id:string}>();if(row)await refreshDraftMenu(env,row.id);await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:cb.id,text:row?'Güncel menü açıldı.':'Bu eski düğme kullanılamıyor; güncel kartı kullan.'}));return json({ok:true});}
 const ed=await editorCallback(env,cb.data,cb.message.message_id);if(ed!==null){await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:cb.id,text:ed}));return json({ok:true});}
 const newsroom=await newsroomCallback(env,cb.data,cb.message.message_id,Number(id));if(newsroom!==null){await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:cb.id,text:newsroom.slice(0,190)}));return json({ok:true});}
 if(cb.data==='xcount'||cb.data?.startsWith('xpost:')||cb.data?.startsWith('xchoose:')||cb.data?.startsWith('xcancel:')){await requestX(env,cb.data,cb.message.message_id,cb.id);return json({ok:true});}
 if(cb.data?.startsWith('design:')){
  const parts=cb.data.split(':');const current=await env.DB.prepare("SELECT id FROM drafts WHERE id=? AND revision=? AND message_id=? AND delivery_state='sent' AND state='pending' AND expires_at>?").bind(parts[1],Number(parts[2]),cb.message.message_id,Math.floor(Date.now()/1000)).first();if(!current){await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:cb.id,text:'Güncel ve süresi geçmemiş kartı kullan.'}));return json({ok:true});}
  const publication=await publicationState(env,parts[1]);if(publication.published||publication.api){await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:cb.id,text:'Yayınlanmış veya paylaşımı süren kartın tasarımı değiştirilemez.'}));return json({ok:true});}
  const answer=await requestRedesign(env,cb.data,cb.message.message_id,Number(id));
  await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:cb.id,text:answer})).catch(()=>{});
  return json({ok:true});
 }
 if(cb.data?.startsWith('asset:')){
  await sendDraftAsset(env,cb.data,cb.message.message_id,Number(id),cb.id);
  return json({ok:true});
 }
 const retryNews=cb.data?.match(/^newsretry:([a-f0-9-]{36}):(\d+)$/);
 if(retryNews||/^news:[a-f0-9-]{36}$/.test(cb.data)){
  const answer=await requestNews(env,retryNews?.[1]??cb.data.slice(5),cb.message.message_id,retryNews?Number(retryNews[2]):undefined);
  await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:cb.id,text:answer})).catch(()=>{});
  return json({ok:true});
 }
 let answer='İşlem tamamlandı.';
 let callbackContext:Record<string,unknown>={update_id:id};
 try {
  const action=parseCallback(cb.data);
  const row=await env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(action.id).first<DraftRow>();
  callbackContext={update_id:id,draft_id:action.id,action:action.action,requested_revision:action.revision,actual_revision:row?.revision??null,requested_message:cb.message.message_id,actual_message:row?.message_id??null};
  if(!row)throw Error('draft_missing');if(row.revision!==action.revision)throw Error('revision_mismatch');if(row.message_id!==cb.message.message_id)throw Error('message_mismatch');
  const state=transition(row.state as Status,action.action,row.verification,row.expires_at<Math.floor(Date.now()/1000));
  if(action.action==='edit') {
   const publication=await publicationState(env,row.id);if(publication.published||publication.api)throw Error('publication_locked');
   const prompt=await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:'Bu mesaja yanıt olarak istediğin düzenlemeyi yaz. Metin kaynakla yeniden denetlenecek.',reply_markup:JSON.stringify({force_reply:true,selective:true})}));
   await env.DB.prepare('INSERT INTO edits(user_id,draft_id,revision,expires_at,prompt_message_id) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET draft_id=excluded.draft_id,revision=excluded.revision,expires_at=excluded.expires_at,prompt_message_id=excluded.prompt_message_id').bind(env.TELEGRAM_USER_ID!,row.id,row.revision,Math.floor(Date.now()/1000)+900,Number(prompt.message_id)).run();
   answer='Düzenleme isteğini gönder.';
  } else {
   const time=Math.floor(Date.now()/1000);
   const result=await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO actions(update_id,draft_id,action,actor,created_at) VALUES(?,?,?,?,?)').bind(id,row.id,action.action,env.TELEGRAM_USER_ID!,time),
    env.DB.prepare('UPDATE drafts SET state=?,revision=revision+1,defer_until=? WHERE id=? AND revision=? AND state=?').bind(state,action.action==='defer'?time+3600:null,row.id,row.revision,row.state)
   ]);
   if(!result[1].meta.changes)throw new Error('stale_callback');
   if(action.action==='approve') {
    answer='Taslak kaydedildi.';
   }else if(action.action==='defer')answer='1 saat ertelendi.';else answer='Reddedildi.';
   await telegram(env,'editMessageReplyMarkup',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,message_id:String(row.message_id),reply_markup:JSON.stringify({inline_keyboard:sourceKeyboard(JSON.parse(row.documents))})}));
  }
 }catch(e){if(e instanceof TelegramError)throw e;
  const reason=e instanceof Error&&['invalid_callback','draft_missing','revision_mismatch','message_mismatch','draft_expired','draft_already_resolved','publication_locked'].includes(e.message)?e.message:'callback_operation_failed';
  await env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('draft_callback_last_rejection',JSON.stringify({...callbackContext,reason,at:Math.floor(Date.now()/1000)})).run().catch(()=>{});
  answer=reason==='draft_expired'?'Bu kartın düzenleme süresi dolmuş.':reason==='publication_locked'?'Paylaşılmış veya paylaşımı süren kart düzenlenemez.':['revision_mismatch','message_mismatch','draft_missing'].includes(reason)?'Bu düğme güncel kartla eşleşmiyor; güncel kartı kullan.':reason==='draft_already_resolved'?'Bu kartın işlemi daha önce tamamlanmış.':'Düzenleme açılamadı; teknik hata kaydedildi. Kartın süresi dolduğu doğrulanmadı.';
 }
 await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:cb.id,text:answer})).catch(()=>{});
 return json({ok:true});
}
export default {
 async fetch(request:Request,env:Env,ctx:ExecutionContext):Promise<Response> {
  const url=new URL(request.url);
  if(url.pathname==='/health'){
   let newsFilter:{mode:'active'|'shadow'|'unavailable';reason:string|null};
   try{const p=await newsPreferences(env);newsFilter=newsFilterHealth(p.mode,p.readiness_reasons??[]);}
   catch{newsFilter=newsFilterHealth('unavailable',[]);}
   return json({service:'Borsa Çakalı',mode:env.MODE,x_publishing:xEnabled(env),model:'Hermes / '+env.AI_MODEL,news_filter:newsFilter});
  }
  if(url.pathname==='/telegram/webhook'&&request.method==='POST'){try{return await webhook(request,env);}catch(e){const failure=e instanceof TelegramError?e.failure:e instanceof SyntaxError||['invalid_request','request_too_large','empty_request','manual_input_limit'].includes(errorCode(e))?'permanent':'retryable';return json({error:errorCode(e),failure,retry_after:e instanceof TelegramError?e.retryAfter:30},failure==='retryable'?503:400);}}
  const bridge=url.pathname.startsWith('/api/bridge/');
  const key=bridge?env.BRIDGE_TOKEN:env.ADMIN_TOKEN;
  if(!await secretEqual(request.headers.get('authorization')??'',key?'Bearer '+key:''))return json({error:'unauthorized'},401);
  try {
   if(request.method==='POST'&&url.pathname==='/api/bridge/lease')return json(await leaseJob(env));
   if(request.method==='POST'&&url.pathname==='/api/bridge/official'){await seed(env);return json(await ingestOfficial(env,await body(request,500_000)));}
   if(request.method==='POST'&&url.pathname==='/api/bridge/result') {const result=await submitJob(env,await body(request,25_000_000));ctx.waitUntil(deliver(env));return json(result);}
   if(request.method==='POST'&&url.pathname==='/api/tick'){ctx.waitUntil(tick(env));return json({queued:true});}
   if(request.method==='GET'&&url.pathname==='/api/sources'){await seed(env);return json((await env.DB.prepare('SELECT id,enabled,next_poll,failures,last_ok,last_error,last_count FROM sources').all()).results);}
   const source=url.pathname.match(/^\/api\/sources\/([a-z0-9-]+)$/);
   if(request.method==='POST'&&source){const input=await body(request);const known=registry.find(s=>s.id===source[1]);if(!known||typeof input.enabled!=='boolean')return json({error:'invalid_source'},400);await env.DB.prepare('UPDATE sources SET enabled=?,next_poll=0 WHERE id=?').bind(Number(input.enabled),source[1]).run();return json({ok:true});}
   if(request.method==='GET'&&url.pathname==='/api/status')return json({x_publishing:xEnabled(env),mode:env.MODE,articles:(await env.DB.prepare('SELECT status,COUNT(*) AS count FROM articles GROUP BY status').all()).results,drafts:(await env.DB.prepare('SELECT state,delivery_state,COUNT(*) AS count FROM drafts GROUP BY state,delivery_state').all()).results,jobs:(await env.DB.prepare('SELECT state,COUNT(*) AS count FROM model_jobs GROUP BY state').all()).results});
   return json({error:'not_found'},404);
  }catch(e){return json({error:errorCode(e)},400);}
 },
 async scheduled(_event:ScheduledController,env:Env,_ctx:ExecutionContext){await tick(env);}
} satisfies ExportedHandler<Env>;
