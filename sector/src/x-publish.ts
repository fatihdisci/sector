import {readMedia,bytesHash} from './media-set';
import {xTextValid} from './x-text';
import {preparePublication,snapshotStatement} from './publication-snapshot';
import {refreshPublicationCard,publicationSummary} from './publication-assistant';
import {postText} from './editorial';
import {telegram} from './telegram';
import type {DraftRow} from './pipeline';
import type {Env} from './types';
export const X_LIMIT=20;
export const xDay=(ms=Date.now())=>new Date(ms+10800000).toISOString().slice(0,10);
export const xEnabled=(env:Env)=>env.MODE==='telegram_review'&&env.X_PUBLISH_ENABLED==='true';
export function xDraftEligible(d:{revision:number;state:string;expires_at:number;media_key:string|null;delivery_state:string;verification:string},revision:number,media:string|null,now=Date.now()):boolean{
 return d.revision===revision&&d.state==='pending'&&d.expires_at>Math.floor(now/1000)&&!!media&&d.media_key===media&&d.delivery_state==='sent'&&d.verification!=='needs_review';
}
export async function xCount(env:Env,day=xDay()){
 return (await env.DB.prepare("SELECT COUNT(*) n FROM x_posts WHERE day=? AND state IN ('queued','uploading','posting','sent','uncertain')").bind(day).first<{n:number}>())!.n;
}
export async function requestX(env:Env,data:string,messageId:number,callbackId:string){
 let text='';
 if(!xEnabled(env))text='X paylaşımı henüz etkin değil.';
 else if(data==='xcount')text=`Bugün kullanılan / ayrılan: ${await xCount(env)}/${X_LIMIT}. Sayaç İstanbul saatiyle 00:00’da yenilenir.`;
 else {
  const match=data.match(/^xpost:([a-f\d-]{36}):(\d{1,6})$/);
  const row=match?await env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(match[1]).first<DraftRow&{delivery_state:string}>():null;
  if(!row||row.message_id!==messageId||!xDraftEligible(row,Number(match![2]),row.media_key))text='Kart güncellenmiş, süresi dolmuş veya paylaşılabilir değil. Güncel kartı kullan.';
  else if(!xTextValid(postText(JSON.parse(row.content))))text='Metin 25.000 karakterlik uzun gönderi sınırını aşıyor veya geçersiz karakter içeriyor. Metin kesilmedi; otomatik zincir oluşturulmaz.';
  else {
   const result=await env.DB.prepare(`INSERT OR IGNORE INTO x_posts(id,draft_id,revision,day,state,content,media_key,created_at,update_id)
    SELECT ?,?,?,?,'queued',?,?,?,? WHERE
    (SELECT COUNT(*) FROM x_posts WHERE day=? AND state IN ('queued','uploading','posting','sent','uncertain'))<?
    AND NOT EXISTS(SELECT 1 FROM x_posts WHERE draft_id=? AND state IN ('queued','uploading','posting','sent','uncertain')) AND NOT EXISTS(SELECT 1 FROM publication_marks WHERE draft_id=? AND state='published')`)
    .bind(crypto.randomUUID(),row.id,row.revision,xDay(),postText(JSON.parse(row.content)),row.media_key,Date.now(),env.TELEGRAM_UPDATE_ID??null,xDay(),X_LIMIT,row.id,row.id).run();
   if(result.meta.changes){const s=await publicationSummary(env);text=`Sıraya alındı. API ${await xCount(env)}/${X_LIMIT}. ${s.note}`;}
   else {
    const manual=await env.DB.prepare("SELECT 1 FROM publication_marks WHERE draft_id=? AND state='published'").bind(row.id).first();
    const old=await env.DB.prepare("SELECT state FROM x_posts WHERE draft_id=? AND state IN ('queued','uploading','posting','sent','uncertain')").bind(row.id).first<{state:string}>();
    text=manual?'Bu içerik elle paylaşıldı olarak işaretli. Tekrar gönderilmedi.':old?old.state==='sent'?'Bu içerik X’te zaten paylaşıldı.':old.state==='uncertain'?'Önceki gönderimin sonucu belirsiz. Çift paylaşımı önlemek için tekrar gönderilmiyor; X hesabını kontrol et.':'Bu içerik zaten paylaşım sırasında.':`Günlük paylaşım bütçesi doldu (${X_LIMIT}/${X_LIMIT}). Yarın 00:00’a kadar paylaşım durduruldu.`;
   }
  }
 }
 await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:callbackId,text,show_alert:'true'})).catch(()=>{});
}
export interface XTransport {identity():Promise<{id:string;username:string}>;upload(png:Uint8Array):Promise<string>;post(text:string,mediaId:string|string[]):Promise<string>;}
export class XHttpError extends Error {constructor(public status:number,public reason?:'long_text_rejected'){super(reason?'x_'+reason:'x_http_'+status);}}
// Must be called by a separate consumer. An interrupted POST is never replayed.
export async function publishX(env:Env,api:XTransport,clock=Date.now){
 if(!xEnabled(env))return;
 await env.DB.prepare("UPDATE x_posts SET state='uncertain',error='interrupted_post' WHERE state='posting' AND started_at<?").bind(clock()-180000).run();
 await env.DB.prepare("UPDATE x_posts SET state='failed',error='interrupted_upload' WHERE state='uploading' AND started_at<?").bind(clock()-180000).run();
 await env.DB.prepare("UPDATE x_posts SET state='expired',error='day_changed' WHERE state='queued' AND day!=?").bind(xDay(clock())).run();
 const row=await env.DB.prepare("SELECT * FROM x_posts WHERE state='queued' ORDER BY created_at LIMIT 1").first<{id:string;draft_id:string;revision:number;content:string;media_key:string;day:string}>();if(!row)return;
 const claimed=await env.DB.prepare("UPDATE x_posts SET state='uploading',started_at=? WHERE id=? AND state='queued'").bind(clock(),row.id).run();if(!claimed.meta.changes)return;
 let posting=false;
 try{
  const draft=await env.DB.prepare('SELECT revision,state,expires_at,media_key,delivery_state,verification,content FROM drafts WHERE id=?').bind(row.draft_id).first<{revision:number;state:string;expires_at:number;media_key:string;delivery_state:string;verification:string;content:string}>();
  if(!draft||!xDraftEligible(draft,row.revision,row.media_key,clock()))throw Error('x_stale_draft');
  const identity=await api.identity();if(identity.username.toLowerCase()!=='endeks_haber')throw Error('x_wrong_account');
  if(postText(JSON.parse(draft.content))!==row.content||!xTextValid(row.content))throw Error('x_text_capacity_or_revision');
  const {images}=await readMedia(env,row.media_key,draft.content);
  if(images.some(b=>b.length>5000000||b[0]!==137||b[1]!==80))throw Error('x_image_invalid');
  const hashes=await Promise.all(images.map(bytesHash)),snapshot=await preparePublication(env,row.draft_id,row.revision),mediaIds:string[]=[];
  for(const image of images){const mediaId=await api.upload(image);if(!/^\d+$/.test(mediaId)||mediaIds.includes(mediaId))throw Error('x_media_response_invalid');mediaIds.push(mediaId);}
  const latest=await env.DB.prepare('SELECT revision,state,expires_at,media_key,delivery_state,verification,content FROM drafts WHERE id=?').bind(row.draft_id).first<{revision:number;state:string;expires_at:number;media_key:string;delivery_state:string;verification:string;content:string}>();
  if(!latest||!xDraftEligible(latest,row.revision,row.media_key,clock())||xDay(clock())!==row.day)throw Error('x_stale_draft');
  if(latest.content!==draft.content)throw Error('x_stale_draft');const finalMedia=await readMedia(env,latest.media_key!,latest.content);if(JSON.stringify(await Promise.all(finalMedia.images.map(bytesHash)))!==JSON.stringify(hashes))throw Error('x_image_changed');
  const final=await env.DB.prepare(`UPDATE x_posts SET state='posting',started_at=? WHERE id=? AND state='uploading' AND day=? AND EXISTS(
   SELECT 1 FROM drafts d WHERE d.id=x_posts.draft_id AND d.revision=x_posts.revision AND d.state='pending' AND d.expires_at>? AND d.media_key=x_posts.media_key AND d.delivery_state='sent' AND d.verification!='needs_review')`)
   .bind(clock(),row.id,xDay(clock()),Math.floor(clock()/1000)).run();
  if(!final.meta.changes)throw Error('x_stale_draft');posting=true;
  const remote=await api.post(row.content,mediaIds.length===1?mediaIds[0]:mediaIds);
  const finished=clock();
  await env.DB.batch([env.DB.prepare("UPDATE x_posts SET state='sent',remote_id=?,finished_at=? WHERE id=?").bind(remote,finished,row.id),snapshotStatement(env,row.draft_id,'api',finished,snapshot,'https://x.com/endeks_haber/status/'+remote)]);
 }catch(e){
  const uncertain=posting&&!(e instanceof XHttpError&&[400,401,402,403,404,413,422,429].includes(e.status));
  const error=e instanceof XHttpError?e.message:e instanceof Error&&/^x_[a-z_]+$/.test(e.message)?e.message:'x_request_failed';
  await env.DB.prepare('UPDATE x_posts SET state=?,error=?,finished_at=? WHERE id=?').bind(uncertain?'uncertain':'failed',error,clock(),row.id).run();
 }
 const result=await env.DB.prepare('SELECT state,remote_id,error FROM x_posts WHERE id=?').bind(row.id).first<{state:string;remote_id:string;error:string}>();
 if(result?.state==='sent')await refreshPublicationCard(env,row.draft_id).catch(()=>{});
 const count=await xCount(env);
 const text=result?.state==='sent'?`X’te paylaşıldı. Bugün ${count}/${X_LIMIT}.\nhttps://x.com/endeks_haber/status/${result.remote_id}${count>=X_LIMIT?'\nGünlük paylaşım bütçesi doldu. Yeni paylaşım yarın 00:00’da açılır.':''}`:result?.state==='uncertain'?'X gönderiminin sonucu belirsiz. Çift paylaşımı önlemek için tekrar gönderilmeyecek; hesabını kontrol et.':result?.error==='x_long_text_rejected'?'X bu hesap/API erişimi için uzun metni kabul etmedi. Metin kesilmedi veya zincire çevrilmedi. Uzun gönderi abonelik/erişim hakkını kontrol et; otomatik tekrar yapılmayacak.':result?.error==='x_http_402'?'X kredi bakiyesi yetersiz. Kredi yükledikten sonra Paylaş düğmesine yeniden basabilirsin.':`X paylaşımı yapılamadı (${result?.error}). Kota kullanılmadı; sorunu giderdikten sonra yeniden Paylaş’a basabilirsin.`;
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
