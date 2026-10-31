import {isOwner,telegram} from './telegram';
import {readMedia,bytesHash} from './media-set';
import {enqueueX,xDraftEligible,xEnabled} from './x-publish';
import {postText} from './editorial';
import type {Env} from './types';import type {InputMessage} from './manual';
const TTL=15*60_000;
const draftLabel=(content:string)=>postText(JSON.parse(content)).split('\n')[0].slice(0,180);
export function parseIstanbulSchedule(text:string,now=Date.now()):number|null{
 const m=/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/.exec(text.trim());if(!m)return null;
 const [,d,mo,y,h,mi]=m,t=Date.parse(`${y}-${mo}-${d}T${h}:${mi}:00+03:00`);if(!Number.isFinite(t)||t<=now)return null;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(t),v=(k:string)=>parts.find(p=>p.type===k)?.value;
 return v('year')===y&&v('month')===mo&&v('day')===d&&v('hour')===h&&v('minute')===mi?t:null;
}
export const istanbulScheduleLabel=(t:number)=>new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(t)+' Türkiye saati';
async function available(env:Env,draftId:string){return !await env.DB.prepare("SELECT 1 FROM x_posts WHERE draft_id=? AND state IN ('queued','uploading','posting','sent','uncertain') UNION ALL SELECT 1 FROM publication_marks WHERE draft_id=? AND state='published' LIMIT 1").bind(draftId,draftId).first();}
export async function scheduleCallback(env:Env,data:string,messageId:number,callbackId:string):Promise<boolean>{
 const open=/^xdate:([a-f0-9-]{36}):(\d{1,6})$/.exec(data),confirm=/^xat:([a-f0-9-]{36})$/.exec(data);if(!open&&!confirm)return false;
 let answer='Plan geçersiz veya süresi dolmuş; güncel karttan yeniden seç.';
 if(!env.TELEGRAM_USER_ID||!env.TELEGRAM_CHAT_ID||!Number.isSafeInteger(env.TELEGRAM_UPDATE_ID)||!xEnabled(env))answer='X paylaşımı henüz etkin değil.';
 else if(open){
  const row=await env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(open[1]).first<any>(),revision=Number(open[2]);
  if(row&&row.message_id===messageId&&xDraftEligible(row,revision,row.media_key)&&await available(env,row.id)&&!JSON.parse(row.content).circuit_artwork){
   const {images}=await readMedia(env,row.media_key,row.content),hashes=JSON.stringify(await Promise.all(images.map(bytesHash)));
   const id=crypto.randomUUID();await env.DB.prepare("INSERT OR IGNORE INTO x_schedule_intents(id,owner_id,chat_id,draft_id,revision,card_message_id,content,media_key,media_hashes,created_update_id,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id,env.TELEGRAM_USER_ID,env.TELEGRAM_CHAT_ID,row.id,revision,messageId,row.content,row.media_key,hashes,env.TELEGRAM_UPDATE_ID,Date.now()+TTL).run();
   const i=await env.DB.prepare('SELECT * FROM x_schedule_intents WHERE created_update_id=?').bind(env.TELEGRAM_UPDATE_ID).first<any>();
   if(i?.state==='input'&&i.expires_at>Date.now()&&i.owner_id===env.TELEGRAM_USER_ID&&i.chat_id===env.TELEGRAM_CHAT_ID){
    const prompt=await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID,text:'Bu mesaja yanıt vererek paylaşım tarihini ve saatini yaz. Biçim: GG.AA.YYYY SS:DD (Türkiye saati).\nÖrnek: 31.10.2026 14:00\nİçerik: '+draftLabel(row.content),reply_markup:JSON.stringify({force_reply:true,selective:true})}));
    if(Number.isSafeInteger(prompt.message_id)&&Number(prompt.message_id)>0){await env.DB.prepare("UPDATE x_schedule_intents SET prompt_message_id=? WHERE id=? AND state='input'").bind(prompt.message_id,i.id).run();answer='Tarih ve saati açılan mesaja yanıt olarak yaz. Henüz plan oluşturulmadı.';}
   }
  }
 }else if(confirm){
  const i=await env.DB.prepare('SELECT * FROM x_schedule_intents WHERE id=? AND owner_id=? AND chat_id=? AND confirmation_message_id=?').bind(confirm[1],env.TELEGRAM_USER_ID,env.TELEGRAM_CHAT_ID,messageId).first<any>();
  if(i?.state==='consumed')answer='Bu plan daha önce onaylandı; tekrar oluşturulmadı.';
  else if(i?.state==='confirm'&&i.expires_at>Date.now()&&i.due_at>Date.now()){
   const row=await env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(i.draft_id).first<any>();
   if(row&&row.content===i.content&&row.media_key===i.media_key&&row.message_id===i.card_message_id)answer=await enqueueX(env,row,i.revision,i.card_message_id,i.due_at,{id:i.id,messageId});
  }
 }
 await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:callbackId,text:answer,show_alert:'true'})).catch(()=>{});return true;
}
export async function scheduleMessage(env:Env,m:InputMessage):Promise<boolean>{
 if(!m.from||!m.chat||!isOwner(env,String(m.from.id),String(m.chat.id),m.chat.type)||m.forward_origin||!m.text||!m.reply_to_message)return false;
 const i=await env.DB.prepare('SELECT * FROM x_schedule_intents WHERE owner_id=? AND chat_id=? AND prompt_message_id=?').bind(env.TELEGRAM_USER_ID!,env.TELEGRAM_CHAT_ID!,m.reply_to_message.message_id).first<any>();if(!i)return false;
 if(i.expires_at<=Date.now()||!['input','confirm'].includes(i.state)||i.state==='confirm'&&i.input_message_id!==m.message_id){await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:'Bu tarih isteği tamamlanmış veya süresi dolmuş. Onay ekranını kullan ya da güncel karttan yeni tarih seç.'}));return true;}
 const due=parseIstanbulSchedule(m.text);let error='Geçerli ve gelecekte bir Türkiye tarihi/saati yaz: GG.AA.YYYY SS:DD. Henüz plan oluşturulmadı.';
 const row=await env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(i.draft_id).first<any>();
 if(!xEnabled(env)||!row||!xDraftEligible(row,i.revision,i.media_key)||row.content!==i.content||row.message_id!==i.card_message_id||!await available(env,i.draft_id))error='Kart değişmiş veya paylaşımı mevcut; güncel kartı kullan.';
 else if(due){
  const changed=await env.DB.prepare("UPDATE x_schedule_intents SET due_at=?,input_message_id=?,state='confirm' WHERE id=? AND ((state='input' AND input_message_id IS NULL) OR (state='confirm' AND input_message_id=? AND due_at=?)) AND expires_at>?").bind(due,m.message_id,i.id,m.message_id,due,Date.now()).run();
  if(changed.meta.changes){
   const sent=await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:`${istanbulScheduleLabel(due)} için planlansın mı?\nİçerik: ${draftLabel(row.content)}\nOnay yalnız bu metin, görsel ve sürüm içindir.`,reply_markup:JSON.stringify({inline_keyboard:[[{text:'Bu tarih ve saatte paylaş',callback_data:'xat:'+i.id}]]})}));
   if(Number.isSafeInteger(sent.message_id)&&Number(sent.message_id)>0)await env.DB.prepare("UPDATE x_schedule_intents SET confirmation_message_id=? WHERE id=? AND state='confirm' AND input_message_id=?").bind(sent.message_id,i.id,m.message_id).run();
   return true;
  }
 }
 await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:error}));return true;
}
