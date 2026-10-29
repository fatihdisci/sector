import {telegram,TelegramError,keyboard} from './telegram';
import {postText} from './editorial';import {publicationState} from './telegram-ui';
import {bytesHash} from './media-set';import {sha256} from './utils/text';
import type {Draft,Document,Env} from './types';
// One immutable revision has two individually journaled external effects. A
// known album is never uploaded again just because its control message failed.
async function effect<T>(env:Env,key:string,send:()=>Promise<T>):Promise<T>{
 const prior=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{value:string}>();const old=prior?JSON.parse(prior.value):null;
 if(old?.state==='sent')return old.result;
 if(old&&['sending','uncertain'].includes(old.state))throw new TelegramError(0,60,'uncertain');
 const claimed=await env.DB.prepare(`INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE json_extract(system_state.value,'$.state') IN ('retryable','failed')`).bind(key,JSON.stringify({state:'sending'})).run();
 if(!claimed.meta.changes)throw new TelegramError(0,60,'uncertain');
 try{const result=await send();await env.DB.prepare('UPDATE system_state SET value=? WHERE key=?').bind(JSON.stringify({state:'sent',result}),key).run();return result;}
 catch(e){const state=e instanceof TelegramError?e.failure==='permanent'?'failed':e.failure:'uncertain';await env.DB.prepare('UPDATE system_state SET value=? WHERE key=?').bind(JSON.stringify({state}),key).run();throw e;}
}
export async function sendAlbum(env:Env,id:string,revision:number,draft:Draft,docs:Document[],images:Uint8Array[],oldMessage:number|undefined,fetcher:typeof fetch){
 if(images.length<(draft.tweet_style==='owner_ready'?1:2)||images.length>4)throw Error('multi_card_capacity_exceeded');
 const caption=postText(draft);if(caption.length>4096)throw Error('telegram_caption_too_long');
 const prefix=`telegram_bundle:${id}:${revision}`,hash=await sha256(JSON.stringify([draft,await Promise.all(images.map(bytesHash))]));
 const source=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(prefix).first<{value:string}>();
 if(source&&source.value!==hash)throw Error('telegram_bundle_revision_mismatch');
 await env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) VALUES(?,?)').bind(prefix,hash).run();
 const frozen=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(prefix).first<{value:string}>();if(frozen?.value!==hash)throw Error('telegram_bundle_revision_mismatch');
 const eligible=async()=>{const row=await env.DB.prepare('SELECT revision,state,content,expires_at,delivery_state FROM drafts WHERE id=?').bind(id).first<{revision:number;state:string;content:string;expires_at:number;delivery_state:string}>();if(!row||row.revision!==revision||row.state!=='pending'||row.expires_at<=Date.now()/1000||row.content!==JSON.stringify(draft)||!['waiting','sending','sent'].includes(row.delivery_state))throw Error('stale_album');const publication=await publicationState(env,id);if(publication.published||publication.api)throw Error('stale_album');};
 await eligible();
 if(oldMessage)try{await telegram(env,'editMessageReplyMarkup',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,message_id:String(oldMessage),reply_markup:JSON.stringify({inline_keyboard:[]})}),fetcher);}catch(e){if(!(e instanceof TelegramError&&e.code===400))throw e;}
 const ids=await effect<number[]>(env,prefix+':album',async()=>{
  await eligible();const form=new FormData();form.set('chat_id',env.TELEGRAM_CHAT_ID!);
  if(images.length===1){form.set('photo',new Blob([images[0] as BlobPart],{type:'image/png'}),'borsa-cakali.png');const single=await telegram(env,'sendPhoto',form,fetcher);if(!Number.isSafeInteger(single.message_id))throw new TelegramError(0,60,'uncertain');return [Number(single.message_id)];}
  form.set('media',JSON.stringify(images.map((_,i)=>({type:'photo',media:`attach://p${i}`}))));images.forEach((b,i)=>form.set('p'+i,new Blob([b as BlobPart],{type:'image/png'}),`borsa-cakali-${i+1}.png`));
  const result=await telegram(env,'sendMediaGroup',form,fetcher) as unknown as {message_id:number}[];
  if(!Array.isArray(result)||result.length!==images.length||result.some(m=>!Number.isSafeInteger(m.message_id)))throw new TelegramError(0,60,'uncertain');return result.map(m=>m.message_id);
 });
 await eligible();
 return effect<number>(env,prefix+':control',async()=>{
  await eligible();const markup=keyboard(id,revision,docs,caption,env.X_PUBLISH_ENABLED==='true',draft,await publicationState(env,id));
  const result=await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:caption,reply_parameters:JSON.stringify({message_id:ids[0]}),reply_markup:JSON.stringify(markup),link_preview_options:JSON.stringify({is_disabled:true})}),fetcher);
  if(!Number.isSafeInteger(result.message_id))throw new TelegramError(0,60,'uncertain');return Number(result.message_id);
 });
}
