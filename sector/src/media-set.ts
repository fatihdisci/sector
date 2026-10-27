import type {Draft,Env} from './types';
import {sha256} from './utils/text';
import {draftCards,MAX_CARDS} from './card-pages';
import type {CardTheme} from './card-theme';import type {CardLayout} from './card-layout';
export interface MediaSet {version:1;content_hash:string;pages:{key:string;sha256:string}[];}
// Numeric primary filenames retain compatibility with the already deployed
// read-only panel. The full nonce hash prevents competing jobs sharing a path.
export async function revisionMediaKey(id:string,revision:number,nonce:string){return `drafts/${id}/${revision}${BigInt('0x'+await sha256(nonce)).toString().padStart(78,'0')}.png`;}
export const bytesHash=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b as BufferSource)),x=>x.toString(16).padStart(2,'0')).join('');
const validMediaKey=(key:string)=>/^drafts\/[a-f0-9-]+\/[a-zA-Z0-9.-]+\.png$/.test(key);
export async function mediaSet(env:Env,key:string,content?:string):Promise<MediaSet|null>{
 const r=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind('draft_media:'+key).first<{value:string}>();if(!r)return null;
 const s=JSON.parse(r.value) as MediaSet;
 if(s.version!==1||!Array.isArray(s.pages)||s.pages.length<1||s.pages.length>MAX_CARDS||s.pages[0].key!==key||new Set(s.pages.map(p=>p.key)).size!==s.pages.length||s.pages.some(p=>!validMediaKey(p.key)||!/^[a-f0-9]{64}$/.test(p.sha256))||content!==undefined&&s.content_hash!==await sha256(content))throw Error('media_set_invalid');
 return s;
}
export async function readMedia(env:Env,key:string,content?:string){
 if(!validMediaKey(key))throw Error('media_set_invalid');
 const set=await mediaSet(env,key,content),images:Uint8Array[]=[];
 for(const page of set?.pages??[{key,sha256:''}]){const o=await env.MEDIA.get(page.key);if(!o)throw Error('draft_media_missing');const b=new Uint8Array(await o.arrayBuffer());if(set&&(b.length>5_000_000||b[0]!==137||b[1]!==80||await bytesHash(b)!==page.sha256))throw Error('media_set_invalid');images.push(b);}
 return {set,images};
}
export async function storeMedia(env:Env,key:string,draft:Draft,images:Uint8Array[]){
 if(images.length<1||images.length>MAX_CARDS)throw Error('multi_card_capacity_exceeded');
 const pages=await Promise.all(images.map(async(b,i)=>({key:i?key.replace(/\.png$/,`-page-${i+1}.png`):key,sha256:await bytesHash(b)})));
 const value:MediaSet={version:1,content_hash:await sha256(JSON.stringify(draft)),pages};
 const prior=await mediaSet(env,key);if(prior&&JSON.stringify(prior)!==JSON.stringify(value))throw Error('media_set_immutable');
 await env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) VALUES(?,?)').bind('media_build:'+key,JSON.stringify(value)).run();
 const reservation=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind('media_build:'+key).first<{value:string}>();if(reservation?.value!==JSON.stringify(value))throw Error('media_set_immutable');
 try{for(let i=0;i<images.length;i++){if(images[i].length>5_000_000)throw Error('multi_card_capacity_exceeded');await env.MEDIA.put(pages[i].key,images[i],{httpMetadata:{contentType:'image/png'}});}
 await env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) VALUES(?,?)').bind('draft_media:'+key,JSON.stringify(value)).run();
 }catch(e){if(!prior)for(const page of pages)await env.MEDIA.delete(page.key);throw e;}
 return value;
}
export async function renderMedia(env:Env,key:string,d:Draft,render:(svg:string)=>Promise<Uint8Array>,theme?:CardTheme,layout?:CardLayout){
 const svgs=draftCards(d,theme,layout),images=[];for(const svg of svgs)images.push(await render(svg));await storeMedia(env,key,d,images);return images;
}
