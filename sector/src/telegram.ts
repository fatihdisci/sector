import {sendAlbum} from './telegram-album';
import {draftKeyboard,publicationState,type PublicationState} from './telegram-ui';
import {sha256} from './utils/text';
import {postText} from './editorial';
import type {Env,Draft,Document} from './types';
export function isOwner(env:Env,from:string,chat:string,type:string):boolean {
 return !!env.TELEGRAM_USER_ID&&!!env.TELEGRAM_CHAT_ID&&type==='private'&&from===env.TELEGRAM_USER_ID&&chat===env.TELEGRAM_CHAT_ID;
}
export type TelegramFailure='retryable'|'permanent'|'uncertain';
export class TelegramError extends Error {
 constructor(public code:number,public retryAfter=60,public failure:TelegramFailure=code===429?'retryable':code>=400&&code<500?'permanent':'uncertain'){super(`telegram_http_${code}`);}
}
export async function telegram(env:Env,method:string,body:URLSearchParams|FormData,fetcher:typeof fetch=fetch):Promise<Record<string,unknown>> {
 if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_VERIFIED_BOT_ID||!env.TELEGRAM_BOT_TOKEN.startsWith(env.TELEGRAM_VERIFIED_BOT_ID+':'))throw new Error('telegram_identity_not_configured');
 const repeatable=/^(get|edit|answer)/.test(method),time=Math.floor(Date.now()/1000);
 // Journal mutations invoked by an update. Later DB failures/restarts may replay
 // the handler, but must not blindly replay a send/copy accepted by Telegram.
 let effect:string|undefined;
 if(env.TELEGRAM_UPDATE_ID!==undefined&&!/^(get|answer)/.test(method)){
  const fields=[];for(const [k,v] of body.entries())fields.push([k,typeof v==='string'?v:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await v.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('')]);
  effect=await sha256(JSON.stringify([env.TELEGRAM_UPDATE_ID,method,fields]));
  const previous=await env.DB.prepare('SELECT state,result,error_code FROM telegram_effects WHERE id=?').bind(effect).first<{state:string;result:string|null;error_code:number|null}>();
  if(previous?.state==='sent')return JSON.parse(previous.result??'{}');
  if(previous?.state==='permanent')throw new TelegramError(previous.error_code??400);
  if(previous&&['sending','uncertain'].includes(previous.state)&&!repeatable)throw new TelegramError(0,60,'uncertain');
  const claim=await env.DB.prepare("INSERT INTO telegram_effects(id,update_id,method,state,updated_at) VALUES(?,?,?,'sending',?) ON CONFLICT(id) DO UPDATE SET state='sending',updated_at=excluded.updated_at WHERE telegram_effects.state='retryable' OR (?=1 AND telegram_effects.state IN ('sending','uncertain'))").bind(effect,env.TELEGRAM_UPDATE_ID,method,time,Number(repeatable)).run();
  if(!claim.meta.changes)throw new TelegramError(0,60,'uncertain');
 }
 try{
  let result:Record<string,unknown>;
  try{
   const r=await fetcher(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{method:'POST',body,signal:AbortSignal.timeout(20_000)});
   const data=await r.json() as {ok:boolean;description?:string;error_code?:number;parameters?:{retry_after?:number};result:Record<string,unknown>};
   if(!r.ok||!data.ok){
    const code=data.error_code??r.status,retryAfter=Number(data.parameters?.retry_after??60);
    const wait=Number.isFinite(retryAfter)?Math.min(3600,Math.max(1,retryAfter)):60;
    if(code===400&&method.startsWith('edit')&&/^Bad Request: message is not modified(?:[:.]|$)/i.test(data.description??''))result={message_id:Number(body.get('message_id'))};
    else throw new TelegramError(code,wait,code===429?'retryable':code>=400&&code<500?'permanent':repeatable?'retryable':'uncertain');
   }else result=data.result;
  }catch(e){if(e instanceof TelegramError)throw e;throw new TelegramError(0,60,repeatable?'retryable':'uncertain');}
  if(effect)await env.DB.prepare("UPDATE telegram_effects SET state='sent',result=?,error_code=NULL,updated_at=? WHERE id=?").bind(JSON.stringify(Array.isArray(result)?result.map(m=>({message_id:m.message_id})):result?.message_id?{message_id:result.message_id}:{}),time,effect).run();
  return result;
 }catch(e){
  const failure=e instanceof TelegramError?e:new TelegramError(0,60,repeatable?'retryable':'uncertain');
  if(effect)await env.DB.prepare('UPDATE telegram_effects SET state=?,error_code=?,updated_at=? WHERE id=?').bind(failure.failure,failure.code,time,effect).run();
  throw failure;
 }
}
export function sourceKeyboard(docs:Document[]) {
 const urls=[...new Set(docs.map(d=>d.url))];
 if(!urls.length)throw new Error('source_url_missing');
 for(const value of urls){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw new Error('source_url_invalid');}
 return [[{text:'Kaynağı aç',url:urls[0]}]];
}
export function keyboard(id:string,revision:number,docs:Document[],_caption:string,publish=false,draft?:Draft,state:PublicationState={}) {
 return draftKeyboard(id,revision,docs,publish,draft,state);
}
export async function sendDraft(env:Env,id:string,revision:number,draft:Draft,docs:Document[],png:Uint8Array|Uint8Array[],_verification:string,existingMessageId?:number,fetcher:typeof fetch=fetch):Promise<number> {
 if(env.MODE!=='telegram_review')throw new Error('telegram_dry_run');
 if(draft.tweet_style==='owner_ready'||draft.tweet_style==='circuit_batch'&&postText(draft).length>1024)return sendAlbum(env,id,revision,draft,docs,Array.isArray(png)?png:[png],existingMessageId,fetcher);
 if(Array.isArray(png))return sendAlbum(env,id,revision,draft,docs,png,existingMessageId,fetcher);
 if(existingMessageId&&env.DB){const control=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind('telegram_control:'+id).first<{value:string}>();if(Number(control?.value)===existingMessageId){try{await telegram(env,'editMessageReplyMarkup',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,message_id:String(existingMessageId),reply_markup:JSON.stringify({inline_keyboard:[]})}),fetcher);}catch(e){if(!(e instanceof TelegramError&&e.code===400))throw e;}existingMessageId=undefined;}}
 const caption=postText(draft);
 // Fail before uploading anything; never produce an orphan photo or split post.
 if(caption.length>1024)throw new Error('telegram_caption_too_long');
 const markup=keyboard(id,revision,docs,caption,env.X_PUBLISH_ENABLED==='true',draft,env.DB?await publicationState(env,id):{});
 const form=new FormData();form.set('chat_id',env.TELEGRAM_CHAT_ID!);form.set('photo',new Blob([png as BlobPart],{type:'image/png'}),'borsa-cakali.png');
 form.set('reply_markup',JSON.stringify(markup));
 if(existingMessageId){
  form.set('message_id',String(existingMessageId));form.set('media',JSON.stringify({type:'photo',media:'attach://photo',caption}));
  const result=await telegram(env,'editMessageMedia',form,fetcher);return Number(result.message_id??existingMessageId);
 }
 form.set('caption',caption);
 const result=await telegram(env,'sendPhoto',form,fetcher);return Number(result.message_id);
}
