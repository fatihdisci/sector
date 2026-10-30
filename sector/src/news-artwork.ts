import {kapNews} from './kap-artwork';
import type {Draft,Document,Env} from './types';
import {bytesHash} from './media-set';
export type NewsArtwork={id:string;sha256:string;bytes:Uint8Array;width:number;height:number};
/** Ordinary news only. Owner packages and structured market/report inputs keep their media. */
export function newsArtworkEligible(d:Draft,documents:Document[]){
 return !kapNews(d,documents)&&d.tweet_style!=='owner_ready'&&!d.automated_daily&&!d.circuit_artwork&&!d.card_data?.report&&!d.card_data?.overview&&!['circuit','akd','custody','theoretical','institutional','broker_flow'].includes(d.template)&&!documents.some(x=>x.owner_visual||x.market_data||x.market_movers||x.source_layout||x.gallery_range||x.buyback_evidence);
}
export async function validateNewsArtwork(a:NewsArtwork){
 if(!/^breaking-[1-4]$/.test(a.id)||a.bytes.length<1000||a.bytes.length>5_000_000||a.width<=a.height||a.width>4096||a.height>4096||![137,80,78,71,13,10,26,10].every((x,i)=>a.bytes[i]===x)||await bytesHash(a.bytes)!==a.sha256)throw Error('news_artwork_invalid');
 const v=new DataView(a.bytes.buffer,a.bytes.byteOffset,a.bytes.byteLength);if(v.getUint32(16)!==a.width||v.getUint32(20)!==a.height)throw Error('news_artwork_dimensions');
}
/** Persist the random choice before media storage so retries and edits cannot reselect it. */
export async function selectNewsArtwork(env:Env,key:string,prior?:Draft['news_artwork']):Promise<NewsArtwork>{
 const pool=env.NEWS_GENERAL_IMAGES;if(!pool||pool.length!==4||new Set(pool.map(a=>a.id)).size!==4||new Set(pool.map(a=>a.sha256)).size!==4)throw Error('news_artwork_unavailable');
 const stateKey='news_artwork_choice:'+key;
 let row=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(stateKey).first<{value:string}>();
 if(!row){const a=prior?pool.find(a=>a.id===prior.id&&a.sha256===prior.sha256):pool[crypto.getRandomValues(new Uint32Array(1))[0]%4];if(!a)throw Error('news_artwork_unavailable');
  await env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) VALUES(?,?)').bind(stateKey,JSON.stringify({id:a.id,sha256:a.sha256})).run();
  row=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(stateKey).first<{value:string}>();
 }
 const selected=JSON.parse(row?.value??'null'),a=pool.find(a=>a.id===selected?.id&&a.sha256===selected?.sha256);if(!a||prior&&(a.id!==prior.id||a.sha256!==prior.sha256))throw Error('news_artwork_binding');await validateNewsArtwork(a);return a;
}
export async function assertNewsArtwork(content:string,images:Uint8Array[]){const d=JSON.parse(content)as Draft;if(d.news_artwork&&(images.length!==1||!/^breaking-[1-4]$/.test(d.news_artwork.id)||await bytesHash(images[0])!==d.news_artwork.sha256))throw Error('news_artwork_binding');}
