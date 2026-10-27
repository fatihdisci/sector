import {readMedia,bytesHash} from './media-set';
import {xTextValid} from './x-text';
import {preparePublication,snapshotStatement} from './publication-snapshot';
import {refreshPublicationCard,publicationSummary} from './publication-assistant';
import {postText} from './editorial';
import {telegram} from './telegram';
import twitter from 'twitter-text';
import type {DraftRow} from './pipeline';
import type {Env} from './types';
export const xDay=(ms=Date.now())=>new Date(ms+10800000).toISOString().slice(0,10);
export const xEnabled=(env:Env)=>env.MODE==='telegram_review'&&env.X_PUBLISH_ENABLED==='true';
export function xDraftEligible(d:{revision:number;state:string;expires_at:number;media_key:string|null;delivery_state:string;verification:string},revision:number,media:string|null,now=Date.now()):boolean{
 return d.revision===revision&&d.state==='pending'&&d.expires_at>Math.floor(now/1000)&&!!media&&d.media_key===media&&d.delivery_state==='sent'&&d.verification!=='needs_review';
}
export async function xCount(env:Env,day=xDay()){
 return (await env.DB.prepare("SELECT COUNT(*) n FROM x_posts WHERE day=? AND state IN ('queued','uploading','posting','sent','uncertain')").bind(day).first<{n:number}>())!.n;
}
const MAX_SCHEDULE_LATE=5*60_000;
export async function requestX(env:Env,data:string,messageId:number,callbackId:string){
 let text='';
 const cancel=data.match(/^xcancel:([a-f\d-]{36}):(\d{1,6})$/);
 if(cancel){
  const result=await env.DB.prepare("UPDATE x_posts SET state='cancelled',finished_at=? WHERE draft_id=? AND revision=? AND state='queued' AND EXISTS(SELECT 1 FROM drafts d WHERE d.id=x_posts.draft_id AND d.message_id=?)").bind(Date.now(),cancel[1],Number(cancel[2]),messageId).run();
  text=result.meta.changes?'Plan iptal edildi.':'Plan bulunamadı veya gönderim başladı; X hesabını kontrol et.';
  if(result.meta.changes)await refreshPublicationCard(env,cancel[1]).catch(()=>{});
 }else if(!xEnabled(env))text='X paylaşımı henüz etkin değil.';
 else if(data==='xcount')text=`Bugün gönderilen, sıradaki veya sonucu belirsiz X işlemi: ${await xCount(env)}. Sayaç İstanbul saatiyle 00:00’da yenilenir.`;
 else {
  const menu=data.match(/^xpost:([a-f\d-]{36}):(\d{1,6})$/),choice=data.match(/^xchoose:(0|15|30|60):([a-f\d-]{36}):(\d{1,6})$/);
  const draftId=menu?.[1]??choice?.[2],revision=Number(menu?.[2]??choice?.[3]);
  const row=draftId?await env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(draftId).first<DraftRow&{delivery_state:string}>():null;
  if(!row||row.message_id!==messageId||!xDraftEligible(row,revision,row.media_key))text='Kart güncellenmiş, süresi dolmuş veya paylaşılabilir değil. Güncel kartı kullan.';
  else if(menu){
   const buttons=[['Hemen',0],['15 dakika sonra',15],['30 dakika sonra',30],['60 dakika sonra',60]] as const;
   await telegram(env,'editMessageReplyMarkup',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,message_id:String(messageId),reply_markup:JSON.stringify({inline_keyboard:[buttons.map(([label,n])=>({text:label,callback_data:`xchoose:${n}:${row.id}:${revision}`})),[{text:'Geri',callback_data:`dm:main:${row.id}:${revision}`}]]})}));
   text='Paylaşım zamanını seç.';
  }else if(!choice)text='Geçersiz seçim.';
  else if(!xTextValid(postText(JSON.parse(row.content))))text='Metin geçersiz veya 25.000 karakter sınırını aşıyor. Metin kesilmedi; otomatik zincir oluşturulmaz.';
  else {
   const now=Date.now(),due=now+Number(choice[1])*60_000,day=xDay(due),postId=crypto.randomUUID();
   try{
    const {images}=await readMedia(env,row.media_key!,row.content);
    if(!images.length||images.length>4||images.some(b=>b.length>5000000||b.length<8||[137,80,78,71,13,10,26,10].some((v,i)=>b[i]!==v)))throw Error('x_image_invalid');
    const hashes=JSON.stringify(await Promise.all(images.map(bytesHash)));
    const results=await env.DB.batch([
     env.DB.prepare(`INSERT OR IGNORE INTO x_posts(id,draft_id,revision,day,state,content,media_key,created_at,update_id)
      SELECT ?,?,?,?,'queued',?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM x_posts WHERE draft_id=? AND state IN ('queued','uploading','posting','sent','uncertain')) AND NOT EXISTS(SELECT 1 FROM publication_marks WHERE draft_id=? AND state='published')
      AND EXISTS(SELECT 1 FROM drafts WHERE id=? AND revision=? AND content=? AND media_key=? AND message_id=? AND state='pending' AND delivery_state='sent' AND verification!='needs_review' AND expires_at>?)`)
      .bind(postId,row.id,revision,day,postText(JSON.parse(row.content)),row.media_key,now,env.TELEGRAM_UPDATE_ID??null,row.id,row.id,row.id,revision,row.content,row.media_key,messageId,Math.floor(now/1000)),
     env.DB.prepare('INSERT INTO x_schedules(post_id,due_at,media_hashes) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM x_posts WHERE id=?)').bind(postId,due,hashes,postId)
    ]);
    if(results[0].meta.changes){text=`Planlandı: ${new Date(due).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'short'})} (Türkiye saati).`;await refreshPublicationCard(env,row.id).catch(()=>{});}
    else {const old=await env.DB.prepare("SELECT state FROM x_posts WHERE draft_id=? AND state IN ('queued','uploading','posting','sent','uncertain')").bind(row.id).first<{state:string}>();text=old?.state==='uncertain'?'Önceki gönderim belirsiz; otomatik tekrar yapılmaz.':old?'Bu içerik zaten planlı veya paylaşılmış.':'Plan oluşturulamadı; kartı ve yayın durumunu kontrol et.';}
   }catch{text='Görsel doğrulanamadı; plan oluşturulmadı.';}
  }
 }
 await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:callbackId,text,show_alert:'true'})).catch(()=>{});
}
export interface XTransport {preflight?(text:string,imageCount:number):void;identity():Promise<{id:string;username:string}>;upload(png:Uint8Array):Promise<string>;post(text:string,mediaId:string|string[]):Promise<string>;}
export interface XDiagnostic {stage:'create'|'readback'|'pre_submit';http_status?:number;codes?:number[];categories?:string[];shape?:Record<string,boolean>;media_ids?:string[];weighted_length?:number;}
export class XPostUncertain extends Error {constructor(public remoteId:string,public diagnostic?:XDiagnostic){super('x_post_uncertain');}}
export class XHttpError extends Error {constructor(public status:number,public reason?:'long_text_rejected',public diagnostic?:XDiagnostic){super(reason?'x_'+reason:'x_http_'+status);}}
export class XBridgeError extends Error {constructor(message:string,public diagnostic?:XDiagnostic){super(message);}}
// Must be called by a separate consumer. An interrupted POST is never replayed.
export async function publishX(env:Env,api:XTransport,clock=Date.now){
 if(!xEnabled(env))return;
 await env.DB.prepare("UPDATE x_posts SET state='uncertain',error='interrupted_post' WHERE state='posting' AND started_at<?").bind(clock()-180000).run();
 await env.DB.prepare("UPDATE x_posts SET state='failed',error='interrupted_upload' WHERE state='uploading' AND started_at<?").bind(clock()-180000).run();
 await env.DB.prepare("UPDATE x_posts SET state='expired',error='schedule_late' WHERE state='queued' AND EXISTS(SELECT 1 FROM x_schedules s WHERE s.post_id=x_posts.id AND s.due_at<?)").bind(clock()-MAX_SCHEDULE_LATE).run();
 await env.DB.prepare("UPDATE x_posts SET state='expired',error='day_changed' WHERE state='queued' AND day!=? AND NOT EXISTS(SELECT 1 FROM x_schedules s WHERE s.post_id=x_posts.id AND s.due_at>?)").bind(xDay(clock()),clock()).run();
 const row=await env.DB.prepare("SELECT x_posts.*,s.media_hashes FROM x_posts LEFT JOIN x_schedules s ON s.post_id=x_posts.id WHERE state='queued' AND (s.due_at IS NULL OR s.due_at<=?) ORDER BY COALESCE(s.due_at,created_at) LIMIT 1").bind(clock()).first<{id:string;draft_id:string;revision:number;content:string;media_key:string;day:string;media_hashes:string|null}>();if(!row)return;
 const claimed=await env.DB.prepare("UPDATE x_posts SET state='uploading',started_at=? WHERE id=? AND state='queued'").bind(clock(),row.id).run();if(!claimed.meta.changes)return;
 let posting=false,remote:string|null=null;const mediaIds:string[]=[];
 try{
  const draft=await env.DB.prepare('SELECT revision,state,expires_at,media_key,delivery_state,verification,content FROM drafts WHERE id=?').bind(row.draft_id).first<{revision:number;state:string;expires_at:number;media_key:string;delivery_state:string;verification:string;content:string}>();
  if(!draft||!xDraftEligible(draft,row.revision,row.media_key,clock()))throw Error('x_stale_draft');
  if(postText(JSON.parse(draft.content))!==row.content||!xTextValid(row.content))throw Error('x_text_capacity_or_revision');
  const {images}=await readMedia(env,row.media_key,draft.content);
  if(row.media_hashes&&JSON.stringify(await Promise.all(images.map(bytesHash)))!==row.media_hashes)throw Error('x_image_changed');
  api.preflight?.(row.content,images.length);
  const identity=await api.identity();if(identity.username.toLowerCase()!=='endeks_haber'||identity.id!=='335502216')throw Error('x_wrong_account');
  if(!images.length||images.length>4||images.some(b=>b.length>5000000||b.length<8||[137,80,78,71,13,10,26,10].some((v,i)=>b[i]!==v)))throw Error('x_image_invalid');
  const hashes=await Promise.all(images.map(bytesHash)),snapshot=await preparePublication(env,row.draft_id,row.revision);
  for(const image of images){const mediaId=await api.upload(image);if(!/^\d+$/.test(mediaId)||mediaIds.includes(mediaId))throw Error('x_media_response_invalid');mediaIds.push(mediaId);}
  const latest=await env.DB.prepare('SELECT revision,state,expires_at,media_key,delivery_state,verification,content FROM drafts WHERE id=?').bind(row.draft_id).first<{revision:number;state:string;expires_at:number;media_key:string;delivery_state:string;verification:string;content:string}>();
  if(!latest||!xDraftEligible(latest,row.revision,row.media_key,clock())||xDay(clock())!==row.day)throw Error('x_stale_draft');
  if(latest.content!==draft.content)throw Error('x_stale_draft');const finalMedia=await readMedia(env,latest.media_key!,latest.content);if(JSON.stringify(await Promise.all(finalMedia.images.map(bytesHash)))!==JSON.stringify(hashes))throw Error('x_image_changed');
  const final=await env.DB.prepare(`UPDATE x_posts SET state='posting',started_at=? WHERE id=? AND state='uploading' AND day=? AND EXISTS(
   SELECT 1 FROM drafts d WHERE d.id=x_posts.draft_id AND d.revision=x_posts.revision AND d.state='pending' AND d.expires_at>? AND d.media_key=x_posts.media_key AND d.delivery_state='sent' AND d.verification!='needs_review')`)
   .bind(clock(),row.id,xDay(clock()),Math.floor(clock()/1000)).run();
  if(!final.meta.changes)throw Error('x_stale_draft');posting=true;
  remote=await api.post(row.content,mediaIds.length===1?mediaIds[0]:mediaIds);
  const finished=clock();
  await env.DB.batch([env.DB.prepare("UPDATE x_posts SET state='sent',remote_id=?,finished_at=? WHERE id=?").bind(remote,finished,row.id),snapshotStatement(env,row.draft_id,'api',finished,snapshot,'https://x.com/endeks_haber/status/'+remote)]);
 }catch(e){
  const uncertain=posting&&!(e instanceof XHttpError&&[400,401,402,403,404,413,422,429].includes(e.status));
  const error=e instanceof XHttpError?e.message:e instanceof Error&&/^x_[a-z_]+$/.test(e.message)?e.message:'x_request_failed';
  await env.DB.prepare('UPDATE x_posts SET state=?,error=?,finished_at=?,remote_id=? WHERE id=?').bind(uncertain?'uncertain':'failed',error,clock(),e instanceof XPostUncertain?e.remoteId:remote,row.id).run();
  const supplied=e instanceof XHttpError||e instanceof XPostUncertain||e instanceof XBridgeError?e.diagnostic:undefined;
  const diagnostic:XDiagnostic=supplied??{stage:posting?'create':'pre_submit',categories:[error==='x_bridge_timeout'?'timeout':'unavailable']};
  diagnostic.media_ids=mediaIds;
  diagnostic.weighted_length=twitter.parseTweet(row.content).weightedLength;
  await env.DB.prepare("INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind('x_diagnostic:'+row.id,JSON.stringify(diagnostic)).run().catch(()=>{});
 }
 const result=await env.DB.prepare('SELECT state,remote_id,error FROM x_posts WHERE id=?').bind(row.id).first<{state:string;remote_id:string;error:string}>();
 if(result?.state==='sent')await refreshPublicationCard(env,row.draft_id).catch(()=>{});
 const count=await xCount(env);
 const text=result?.state==='sent'?`X’te paylaşıldı. Bugün ${count} X işlemi.\nhttps://x.com/endeks_haber/status/${result.remote_id}`:result?.state==='uncertain'?`X gönderiminin sonucu belirsiz. Çift paylaşımı önlemek için tekrar gönderilmeyecek; hesabını kontrol et.${result.remote_id?' https://x.com/endeks_haber/status/'+result.remote_id:''}`:result?.error==='x_long_text_rejected'?'X bu hesap/API erişimi için uzun metni kabul etmedi. Metin kesilmedi veya zincire çevrilmedi. Uzun gönderi abonelik/erişim hakkını kontrol et; otomatik tekrar yapılmayacak.':result?.error==='x_http_402'?'X kredi bakiyesi yetersiz. Kredi yükledikten sonra Paylaş düğmesine yeniden basabilirsin.':result?.error==='x_long_post_capability_required'?'Bu metin uzun gönderi gerektiriyor. Hesap yetkisi açıkça yapılandırılmadan görsel yüklenmedi veya gönderim yapılmadı.':result?.error==='x_long_post_media_unsupported'?'Uzun gönderi yolu bu bağlantıda yalnız tek görsel destekliyor; yükleme veya gönderim yapılmadı.':result?.error==='x_keychain_unavailable'||result?.error==='x_keychain_invalid'?'Ana X hesabının Keychain oturumu kullanılamıyor. Oturum erişimini kontrol et; resmî API kullanılmadı.':result?.error==='x_wrong_account'||result?.error==='x_identity_unverified'?'Ana X hesabının kimliği doğrulanamadı; paylaşım yapılmadı.':`X paylaşımı yapılamadı (${result?.error}). Sorunu giderdikten sonra yeniden Paylaş’a basabilirsin.`;
 await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text})).catch(()=>{});
}

// Add controls to recent delivered cards too, one edit per loop; no repost/upload.
export async function refreshXButton(env:Env){
 if(!xEnabled(env))return;
 const row=await env.DB.prepare(`SELECT * FROM drafts d WHERE delivery_state='sent' AND state='pending' AND message_id IS NOT NULL
 AND id IN (SELECT id FROM drafts WHERE delivery_state='sent' ORDER BY created_at DESC LIMIT 50)
 AND NOT EXISTS(SELECT 1 FROM system_state s WHERE s.key='x_button_v2:'||d.id AND s.value=CAST(d.revision AS TEXT)) ORDER BY created_at DESC LIMIT 1`).first<DraftRow>();
 if(!row)return;

 try{await refreshPublicationCard(env,row.id);}
 catch(e){if(!(e instanceof Error&&e.message==='telegram_http_400'))throw e;}
 await env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('x_button_v2:'+row.id,String(row.revision)).run();
}
