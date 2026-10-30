import type {Draft,Env} from './types';
import {sha256} from './utils/text';
export const READY_CONTENT_TYPES=['news','kap','market_overview','circuit','buyback','general_buyback','broker_flow','akd','custody','institutional','volume','midas','ipo','theoretical_ipo','theoretical_movers'] as const;
export type ReadyContentType=typeof READY_CONTENT_TYPES[number];
export type ReadyPublication={content_type:ReadyContentType;quote_tweet_id?:string};
const headings={theoretical_ipo:'Son halka arzlarda teorik eşleşme verileri',theoretical_movers:'Teorik eşleşmede en çok yükselenler düşenler'};
const closing='Veriler anlıktır değişebilir.';
export function readyPublication(value:{content_type?:unknown;quote_tweet_id?:unknown}):ReadyPublication|undefined{
 if(value.content_type===undefined&&value.quote_tweet_id===undefined)return;
 if(!READY_CONTENT_TYPES.includes(value.content_type as ReadyContentType)||value.quote_tweet_id!==undefined&&(typeof value.quote_tweet_id!=='string'||! /^[1-9]\d{4,24}$/.test(value.quote_tweet_id)))throw Error('ready_quote_metadata_invalid');
 return {content_type:value.content_type as ReadyContentType,...(value.quote_tweet_id!==undefined?{quote_tweet_id:value.quote_tweet_id as string}:{})};
}
export function formatReadyUpdate(text:string,meta?:ReadyPublication){
 if(!meta)return text;
 const theoretical=meta.content_type in headings;
 if(theoretical){
  const lines=text.trim().split('\n');if(!/teorik eşleşme/iu.test(lines[0]))throw Error('ready_theoretical_heading_required');lines.shift();
  const body=lines.filter(s=>!/^\s*(?:kaynak|saat|veri saati|güncelleme saati)\s*[:—-]/iu.test(s)).join('\n').trim().replace(/Veriler anlıktır[,]? değişebilir[.!]?\s*$/iu,'').trim();
  return ((meta.quote_tweet_id?'Güncelleme: ':'')+headings[meta.content_type as keyof typeof headings]+'\n\n'+body+'\n\n'+closing).replace(/#[\p{L}\p{N}_]+/gu,s=>s.toLocaleLowerCase('tr-TR'));
 }
 return meta.quote_tweet_id&&!/^Güncelleme[:\s]/u.test(text)?'Güncelleme: '+text:text;
}
export function validateReadyPublicationText(text:string,meta?:ReadyPublication){
 if(!meta)return;
 if(meta.quote_tweet_id&&!text.startsWith('Güncelleme: '))throw Error('ready_quote_update_heading');
 if(meta.content_type in headings){
  const first=(meta.quote_tweet_id?'Güncelleme: ':'')+headings[meta.content_type as keyof typeof headings];
  if(text.split('\n')[0]!==first||!text.endsWith(closing)||/(?:https?:\/\/|t\.me\/|\b\d{1,2}:\d{2}\b)|(?:^|\n)\s*(?:kaynak|saat)\s*[:—-]/iu.test(text)||[...text.matchAll(/#[\p{L}\p{N}_]+/gu)].some(m=>m[0]!==m[0].toLocaleLowerCase('tr-TR')))throw Error('ready_theoretical_text_invalid');
 }
}
function publishedType(content:string):ReadyContentType|undefined{
 const d=JSON.parse(content)as Draft;if(d.tweet_style!=='owner_ready')return;
 const meta=readyPublication(d.owner_ready_publication??{});if(meta)return meta.content_type;
 // Existing immutable receipts can establish the two previously posted theoretical chains.
 const h=d.body.split('\n')[0].replace(/^[^\p{L}\p{N}]+/u,'').replace(/^Güncelleme:\s*/u,'');
 return Object.entries(headings).find(([,title])=>h===title)?.[0]as ReadyContentType|undefined;
}
export async function assertQuoteParent(env:Env,meta?:ReadyPublication){
 if(!meta?.quote_tweet_id)return;
 const rows=await env.DB.prepare("SELECT p.remote_id,s.content,s.text,s.media_hash FROM x_posts p JOIN publication_snapshots s ON s.draft_id=p.draft_id AND s.revision=p.revision AND s.method='api' AND s.text=p.content AND s.remote_url='https://x.com/borsacakali/status/'||p.remote_id WHERE p.state='sent' AND p.remote_id IS NOT NULL AND s.media_hash IS NOT NULL ORDER BY s.published_at DESC,p.finished_at DESC LIMIT 500").all<{remote_id:string;content:string;text:string;media_hash:string}>();
 const previous=(rows.results??[]).find(r=>publishedType(r.content)===meta.content_type);
 if(!previous||previous.remote_id!==meta.quote_tweet_id||!/^[a-f0-9]{64}$/.test(previous.media_hash))throw Error('ready_quote_parent_unverified');
 return sha256(JSON.stringify({remote_id:previous.remote_id,content:previous.content,text:previous.text,media_hash:previous.media_hash}));
}
export async function queuedReadyQuote(env:Env,postId:string,content:string){
 const d=JSON.parse(content)as Draft,meta=readyPublication(d.owner_ready_publication??{});
 if(meta&&d.tweet_style!=='owner_ready')throw Error('ready_quote_metadata_invalid');
 validateReadyPublicationText(d.body,meta);const parent=await assertQuoteParent(env,meta);if(meta?.quote_tweet_id&&d.owner_ready_publication?.parent_receipt_hash!==parent)throw Error('ready_quote_parent_binding');
 const row=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind('x_quote:'+postId).first<{value:string}>();
 const expected=meta?.quote_tweet_id?JSON.stringify({content_hash:await sha256(content),...meta}):null;
 if((row?.value??null)!==expected)throw Error('ready_quote_queue_binding');
 return meta?.quote_tweet_id;
}
