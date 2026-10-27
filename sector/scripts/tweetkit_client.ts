import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {XHttpError,XPostUncertain,type XTransport} from '../src/x-publish';
const root=join(homedir(),'Library/Application Support/sector-haber');
const python=join(root,'tweetkit-venv/bin/python');
type Reply={id?:string;username?:string;error?:string;status?:number};
export function decodeBridgeReply(out:string):Reply {
 let result:Reply;try{result=JSON.parse(out) as Reply;}catch{throw Error('x_bridge_invalid');}
 if(!result||typeof result!=='object')throw Error('x_bridge_invalid');
 if(result.error){
  if(result.error==='x_post_uncertain'&&/^\d+$/.test(result.id??''))throw new XPostUncertain(result.id!);
  if(result.error==='x_post_rejected'&&[400,401,403,404,413,422,429].includes(result.status??0))throw new XHttpError(result.status!);
  throw Error(/^x_[a-z_]+$/.test(result.error)?result.error:'x_bridge_failed');
 }
 return result;
}
export async function tweetkitReady():Promise<boolean>{try{await access(python);return true;}catch{return false;}}
export function tweetkitClient():XTransport {
 const invoke=(request:Record<string,unknown>):Promise<Reply>=>new Promise((resolve,reject)=>{
  const child=spawn(python,['scripts/tweetkit_bridge.py'],{env:{HOME:homedir(),PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','ignore']});
  let out=''; let finished=false;
  const done=(err?:Error,value?:Reply)=>{if(finished)return;finished=true;clearTimeout(timer);err?reject(err):resolve(value!);};
  const timer=setTimeout(()=>{child.kill('SIGKILL');done(Error('x_bridge_timeout'));},150000);
  child.stdout.on('data',data=>{out+=data.toString();if(out.length>4096){child.kill('SIGKILL');done(Error('x_bridge_invalid'));}});
  child.on('error',()=>done(Error('x_bridge_unavailable')));
  child.on('close',code=>{if(code!==0)return done(Error('x_bridge_failed'));try{done(undefined,decodeBridgeReply(out));}catch(e){done(e instanceof Error?e:Error('x_bridge_invalid'));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
 });
 return {
  identity:async()=>{const r=await invoke({op:'identity'});if(r.id!=='335502216'||r.username!=='endeks_haber')throw Error('x_wrong_account');return {id:r.id,username:r.username};},
  upload:async image=>{if(image.length>5000000||!Buffer.from(image).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('x_image_invalid');const r=await invoke({op:'upload',image:Buffer.from(image).toString('base64')});if(!/^\d+$/.test(r.id??''))throw Error('x_bridge_invalid');return r.id!;},
  post:async(text,media)=>{const ids=Array.isArray(media)?media:[media];if(!ids.length||ids.length>4||ids.some(id=>!/^\d+$/.test(id)))throw Error('x_media_invalid');const r=await invoke({op:'post',text,media:ids});if(!/^\d+$/.test(r.id??''))throw Error('x_post_uncertain');return r.id!;}
 };
}
