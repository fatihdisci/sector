import {createHmac,randomBytes} from 'node:crypto';
import {XHttpError,type XTransport} from '../src/x-publish';
export interface XKeys {consumer_key:string;consumer_secret:string;access_token:string;access_secret:string;}
export const validXKeys=(v:unknown):v is XKeys=>!!v&&typeof v==='object'&&['consumer_key','consumer_secret','access_token','access_secret'].every(k=>typeof (v as Record<string,unknown>)[k]==='string'&&/^[!-~]{10,500}$/.test((v as Record<string,string>)[k]));
const enc=(s:string)=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export function oauthHeader(method:string,url:string,keys:XKeys,nonce=randomBytes(16).toString('hex'),timestamp=String(Math.floor(Date.now()/1000))){
 const params:Record<string,string>={oauth_consumer_key:keys.consumer_key,oauth_token:keys.access_token,oauth_nonce:nonce,oauth_timestamp:timestamp,oauth_signature_method:'HMAC-SHA1',oauth_version:'1.0'};
 const u=new URL(url);const all=[...Object.entries(params),...u.searchParams.entries()].map(([k,v])=>[enc(k),enc(v)]).sort(([a,b],[c,d])=>a<c?-1:a>c?1:b<d?-1:b>d?1:0);
 const base=[method.toUpperCase(),u.origin+u.pathname,all.map(p=>p.join('=')).join('&')].map(enc).join('&');
 params.oauth_signature=createHmac('sha1',enc(keys.consumer_secret)+'&'+enc(keys.access_secret)).update(base).digest('base64');
 return 'OAuth '+Object.entries(params).sort().map(([k,v])=>`${enc(k)}="${enc(v)}"`).join(', ');
}
export function xClient(keys:XKeys,fetcher:typeof fetch=fetch):XTransport{
 if(!validXKeys(keys))throw Error('x_keys_invalid');
 async function call(path:string,method:string,body?:BodyInit){
  const url='https://api.x.com'+path;
  const response=await fetcher(url,{method,body,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:oauthHeader(method,url,keys),...(typeof body==='string'?{'Content-Type':'application/json'}:{})}});
  if(!response.ok){
   // Classify only an explicit length/long-post rejection; never expose raw API bodies.
   let reason:'long_text_rejected'|undefined;
   if(path==='/2/tweets'&&[400,403,422].includes(response.status))try{
    const raw=await response.text();if(raw.length<=16_384){const v=JSON.parse(raw),parts=[v.detail,v.title,...(Array.isArray(v.errors)?v.errors.flatMap((e:any)=>[e.message,e.detail]):[])].filter(x=>typeof x==='string').join(' ');
     if(/(?:tweet|post|text).{0,80}(?:too long|longer than|maximum.{0,20}characters|exceeds.{0,30}(?:length|character))|(?:not allowed|not authorized|not eligible).{0,80}(?:long(?:er|form| form)? (?:tweet|post))|(?:long(?:er|form| form)? (?:tweet|post)).{0,80}(?:premium|required|not allowed)/i.test(parts))reason='long_text_rejected';
    }
   }catch{/* Status still determines definite rejection versus uncertain outcome. */}
   throw new XHttpError(response.status,reason);
  }
  const result=await response.json() as {data?:{id?:string;username?:string}};
  if(!result.data?.id||!/^\d+$/.test(result.data.id))throw Error('x_response_invalid');return result.data;
 }
 return {identity:async()=>{const d=await call('/2/users/me','GET');if(!d.username)throw Error('x_response_invalid');return {id:d.id!,username:d.username};},
 upload:async bytes=>{const form=new FormData();form.set('media',new Blob([bytes as BlobPart],{type:'image/png'}),'endeks.png');form.set('media_category','tweet_image');return (await call('/2/media/upload','POST',form)).id!;},
 post:async(text,mediaId)=>(await call('/2/tweets','POST',JSON.stringify({text,media:{media_ids:Array.isArray(mediaId)?mediaId:[mediaId]}}))).id!};
}
