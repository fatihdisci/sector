import twitter from 'twitter-text';
import {xTextValid} from '../src/x-text';
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {XBridgeError,XHttpError,XPostUncertain,type XDiagnostic,type XTransport} from '../src/x-publish';
const root=join(homedir(),'Library/Application Support/sector-haber');
const python=join(root,'tweetkit-venv/bin/python');
type Reply={id?:string;username?:string;error?:string;status?:number;diagnostic?:unknown};
export function sanitizeDiagnostic(value:unknown):XDiagnostic|undefined {
 if(!value||typeof value!=='object'||Array.isArray(value))return;
 const v=value as Record<string,unknown>;if(v.stage!=='create'&&v.stage!=='readback'&&v.stage!=='pre_submit')return;
 const result:XDiagnostic={stage:v.stage};
 if(typeof v.http_status==='number'&&Number.isInteger(v.http_status)&&v.http_status>=100&&v.http_status<=599)result.http_status=v.http_status;
 if(Array.isArray(v.codes))result.codes=v.codes.filter((x):x is number=>typeof x==='number'&&Number.isInteger(x)&&x>=0&&x<=999999).slice(0,8);
 const allowed=['length','rate_limit','auth','challenge','other','invalid_json','non_object_json','response_unavailable','timeout','transport_or_internal','unavailable'];
 if(Array.isArray(v.categories))result.categories=v.categories.filter((x):x is string=>typeof x==='string'&&allowed.includes(x)).slice(0,8);
 if(Array.isArray(v.media_ids))result.media_ids=v.media_ids.filter((x):x is string=>typeof x==='string'&&/^\d{1,24}$/.test(x)).slice(0,4);
 if(v.shape&&typeof v.shape==='object'&&!Array.isArray(v.shape)){const shape=v.shape as Record<string,unknown>;result.shape={};for(const key of ['errors','data','create_tweet','tweet_results','result','rest_id','nested_tweet','nested_rest_id'])if(typeof shape[key]==='boolean')result.shape[key]=shape[key] as boolean;}
 return result;
}
export function decodeBridgeReply(out:string):Reply {
 let result:Reply;try{result=JSON.parse(out) as Reply;}catch{throw Error('x_bridge_invalid');}
 if(!result||typeof result!=='object')throw Error('x_bridge_invalid');
 if(result.error){
  const diagnostic=sanitizeDiagnostic(result.diagnostic);
  if(result.error==='x_post_uncertain'&&/^\d+$/.test(result.id??''))throw new XPostUncertain(result.id!,diagnostic);
  if(result.error==='x_pre_submit_rejected'&&result.status===422)throw new XHttpError(422,undefined,diagnostic);
  if(result.error==='x_post_rejected'&&[400,401,403,404,413,422,429].includes(result.status??0))throw new XHttpError(result.status!,undefined,diagnostic);
  throw new XBridgeError(/^x_[a-z_]+$/.test(result.error)?result.error:'x_bridge_failed',diagnostic);
 }
 return result;
}
export async function tweetkitReady():Promise<boolean>{try{await access(python);return true;}catch{return false;}}
export function postingRoute(text:string,imageCount:number,longNotesEnabled=false):'standard'|'note' {
 if(!Number.isInteger(imageCount)||imageCount<1||imageCount>4)throw Error('x_media_invalid');
 if(Array.from(text).length>25000||!xTextValid(text))throw Error('x_text_capacity_or_revision');
 if(twitter.parseTweet(text).weightedLength<=280)return 'standard';
 if(!longNotesEnabled)throw Error('x_long_post_capability_required');

 return 'note';
}
export function tweetkitClient(options:{longNotesEnabled?:boolean}={}):XTransport {
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
  preflight:(text,count)=>{postingRoute(text,count,options.longNotesEnabled===true);},
  identity:async()=>{const r=await invoke({op:'identity'});if(r.id!=='335502216'||r.username!=='borsacakali')throw Error('x_wrong_account');return {id:r.id,username:r.username};},
  upload:async image=>{if(image.length>5000000||!Buffer.from(image).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('x_image_invalid');const r=await invoke({op:'upload',image:Buffer.from(image).toString('base64')});if(!/^\d+$/.test(r.id??''))throw Error('x_bridge_invalid');return r.id!;},
  post:async(text,media)=>{const ids=Array.isArray(media)?media:[media];if(!ids.length||ids.length>4||new Set(ids).size!==ids.length||ids.some(id=>!/^\d+$/.test(id)))throw Error('x_media_invalid');const route=postingRoute(text,ids.length,options.longNotesEnabled===true);const r=await invoke({op:'post',text,media:ids,weighted_length:twitter.parseTweet(text).weightedLength,long_note:route==='note',allow_long:options.longNotesEnabled===true});if(!/^\d+$/.test(r.id??''))throw Error('x_post_uncertain');return r.id!;}
 };
}
