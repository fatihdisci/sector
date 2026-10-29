import {isOwner,telegram} from './telegram';
import {boundedBytes} from './pdf-transport';
import {sha256} from './utils/text';
import {bytesHash,storeMedia} from './media-set';
import type {Env,Draft,Document} from './types';
import type {InputMessage} from './manual';
export type ReadyPackage={version:1;kind:'owner_ready_post';id:string;text:string;text_sha256:string;sources:string[];media:{png_base64:string;sha256:string}[];sha256:string};
export const READY_HELP='Hazır tweeti ve 1–4 PNG görselini borsa-cakali-post.json paketinde, açıklaması /hazir olacak şekilde dosya olarak gönder. Metin ve görseller değiştirilmeden onay kartına alınır. X paylaşımı veya zamanlama ayrıca karttan seçilir. Paket en fazla 18 MB, metin en fazla 4096 karakterdir. Değişiklik için yeni paket oluştur.';
export async function readyPackageHash(p:Omit<ReadyPackage,'sha256'>){return sha256(JSON.stringify({version:p.version,kind:p.kind,id:p.id,text:p.text,text_sha256:p.text_sha256,sources:p.sources,media:p.media.map(m=>({sha256:m.sha256}))}));}
function png(base64:string){
 if(typeof base64!=='string'||base64.length>6_700_000||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw Error('ready_png_invalid');
 const b=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));if(b.length<50||b.length>5_000_000||![137,80,78,71,13,10,26,10].every((n,i)=>b[i]===n))throw Error('ready_png_invalid');
 const v=new DataView(b.buffer);if(v.getUint32(16)<1||v.getUint32(20)<1||v.getUint32(16)>4096||v.getUint32(20)>4096||v.getUint32(16)*v.getUint32(20)>16_000_000)throw Error('ready_png_dimensions');
 let pos=8,idat=false,end=false,index=0;
 while(pos+12<=b.length){const len=v.getUint32(pos);if(len>b.length-pos-12)throw Error('ready_png_invalid');const type=String.fromCharCode(...b.slice(pos+4,pos+8));let crc=0xffffffff;for(let i=pos+4;i<pos+8+len;i++){crc^=b[i];for(let k=0;k<8;k++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}if(((crc^0xffffffff)>>>0)!==v.getUint32(pos+8+len))throw Error('ready_png_crc');if(index++===0&&(type!=='IHDR'||len!==13))throw Error('ready_png_invalid');if(type==='IDAT'&&len)idat=true;pos+=len+12;if(type==='IEND'){if(len||pos!==b.length)throw Error('ready_png_invalid');end=true;break;}}
 if(!idat||!end)throw Error('ready_png_invalid');return b;
}
export async function validateReadyPackage(value:unknown){
 const p=value as ReadyPackage;if(!p||p.version!==1||p.kind!=='owner_ready_post'||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(p.id)||typeof p.text!=='string'||!p.text.trim()||p.text.length>4096||p.text.includes('\0')||!Array.isArray(p.sources)||p.sources.length<1||p.sources.length>10||new Set(p.sources).size!==p.sources.length||!Array.isArray(p.media)||p.media.length<1||p.media.length>4)throw Error('ready_package_invalid');
 for(const url of p.sources){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||url.length>2000)throw Error('ready_source_invalid');}
 if(p.text_sha256!==await sha256(p.text)||p.sha256!==await readyPackageHash(p))throw Error('ready_package_hash');
 const images=[];for(const m of p.media){if(!m||!/^[a-f0-9]{64}$/.test(m.sha256))throw Error('ready_image_hash');const b=png(m.png_base64);if(await bytesHash(b)!==m.sha256)throw Error('ready_image_hash');images.push(b);}
 if(images.reduce((n,b)=>n+b.length,0)>12_000_000||new Set(p.media.map(m=>m.sha256)).size!==images.length)throw Error('ready_media_capacity');return {package:p,images};
}
export async function importReadyPost(env:Env,value:unknown){
 const {package:p,images}=await validateReadyPackage(value),key='owner_ready_package:'+p.id;
 if(!env.TELEGRAM_USER_ID||!env.TELEGRAM_CHAT_ID)throw Error('ready_owner_missing');
 const reservation=JSON.stringify({hash:p.sha256,owner:env.TELEGRAM_USER_ID,chat:env.TELEGRAM_CHAT_ID});
 await env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) VALUES(?,?)').bind(key,reservation).run();
 const prior=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{value:string}>();if(prior?.value!==reservation)throw Error('ready_package_immutable');
 const existing=await env.DB.prepare('SELECT event_key FROM drafts WHERE id=?').bind(p.id).first<{event_key:string}>();if(existing){if(existing.event_key!=='owner-ready:'+p.id)throw Error('ready_id_conflict');return {id:p.id,duplicate:true};}
 const draft:Draft={tweet_style:'owner_ready',headline:'Hazır yayın paketi',body:p.text,hashtags:[],category:'bist',importance:100,template:'news',claims:[],entities:[],event_key:'owner-ready:'+p.id,uncertainties:[],source_notes:['Sahibin hazır metin ve görsel paketi; AI doğrulaması yapılmadı.'],card_headline:'Hazır yayın paketi',card_body:''};
 const content=JSON.stringify(draft),media='drafts/'+p.id+'/1-ready.png',time=Math.floor(Date.now()/1000),docs:Document[]=p.sources.map((url,i)=>({source_id:'owner-ready',source_name:'Sahibin hazır paketi',family:'owner-ready',official:false,url,title:'Hazır yayın kaynağı '+(i+1),body:p.text,published_at:null,passages:[]}));
 await storeMedia(env,media,draft,images);
 const binding=JSON.stringify({package_hash:p.sha256,text_sha256:p.text_sha256,content_sha256:await sha256(content),images:p.media.map(m=>m.sha256),revision:1});
 await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO drafts(id,event_key,fingerprint,content,documents,verification,state,created_at,expires_at,media_key) VALUES(?,?,?,?,?,?,'pending',?,?,?)").bind(p.id,draft.event_key,p.sha256,content,JSON.stringify(docs),'owner_provided',time,time+86400,media),env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) VALUES(?,?)').bind('owner_ready_binding:'+p.id,binding)]);
 return {id:p.id,duplicate:false};
}
export async function assertReadyPost(env:Env,id:string,revision:number,content:string,images:Uint8Array[]){
 const d=JSON.parse(content)as Draft;if(d.tweet_style!=='owner_ready')return;
 const row=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind('owner_ready_binding:'+id).first<{value:string}>();const b=JSON.parse(row?.value??'null');
 if(!b||revision!==b.revision||b.content_sha256!==await sha256(content)||b.text_sha256!==await sha256(d.body)||JSON.stringify(b.images)!==JSON.stringify(await Promise.all(images.map(bytesHash))))throw Error('ready_binding_mismatch');
}
export async function readyPostMessage(env:Env,updateId:number,m:InputMessage):Promise<boolean>{
 env={...env,TELEGRAM_UPDATE_ID:updateId};
 const text=m.text??m.caption??'';if(text.trim()!=='/hazir')return false;
 if(!m.from||!m.chat||!isOwner(env,String(m.from.id),String(m.chat.id),m.chat.type))return false;
 if(env.MODE!=='telegram_review')return true;
 if(!m.document||m.forward_origin){await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:READY_HELP}));return true;}
 try{
  if(m.document.file_name!=='borsa-cakali-post.json'||!Number.isSafeInteger(m.document.file_size)||m.document.file_size!<=0||m.document.file_size!>18_000_000)throw Error('ready_file_invalid');
  const meta=await telegram(env,'getFile',new URLSearchParams({file_id:m.document.file_id}));if(typeof meta.file_path!=='string'||!/^[a-zA-Z0-9_./-]+$/.test(meta.file_path)||meta.file_path.includes('..'))throw Error('ready_file_invalid');
  const response=await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${meta.file_path}`,{signal:AbortSignal.timeout(20_000)});if(!response.ok)throw Error('ready_file_read');const bytes=await boundedBytes(response,18_000_000);if(bytes.length!==m.document.file_size)throw Error('ready_file_length');
  const result=await importReadyPost(env,JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:result.duplicate?'Bu paket zaten kayıtlı. Mevcut onay kartını kullan; yeniden içerik veya paylaşım oluşturulmadı.':'Hazır paket alındı. Tweet ve görseller değiştirilmeden onay kartına gelecek. X paylaşımı veya zamanlama henüz yapılmadı.'}));
 }catch{await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:'Hazır paket doğrulanamadı veya teslim sonucu belirsiz. İçerik yeniden üretilmedi, X paylaşımı yapılmadı. Aynı paket kimliğini değiştirmeden kontrol et; yeni kimlikle kör tekrar gönderme.'}));}
 return true;
}
