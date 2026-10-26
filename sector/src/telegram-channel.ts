import{sha256}from'./utils/text';import type{Env,Source,Document}from'./types';import{readDocument}from'./article';import registry from'../sources.json';
export const CHANNEL='SermayeBorsasi',CHANNEL_ID=2426639373,CHANNEL_SOURCE='sermaye-telegram';
export interface ChannelMessage{observed_at?:number;id:number;at:string;edited_at:string|null;text:string;links:string[];group:string|null;media:'image'|'pdf'|'unsupported'|null;size:number;fingerprint:string;bytes_base64?:string;sha256?:string;}
export interface ChannelBatch{channel:string;peer_id:number;baseline:boolean;latest_id:number;messages:ChannelMessage[];}
export interface ChannelManifest{version:1;channel:typeof CHANNEL;peer_id:typeof CHANNEL_ID;url:string;messages:ChannelMessage[];hash:string;captured_at:number;}
export type ChannelTransport=(mode:'channel-scan'|'channel-read',value:unknown)=>Promise<any>;
interface State{baseline_id:number;cursor:number;next:number;pending:ChannelMessage[];seen:Record<string,{hash:string;ids:number[];at:number}>;last_ok:number;}
const MAX_PENDING=200,SETTLE=60_000;
function validate(m:ChannelMessage,now:number){if(!Number.isSafeInteger(m.id)||m.id<=0||!Number.isFinite(Date.parse(m.at))||Date.parse(m.at)>now+300000||m.edited_at!==null&&(!Number.isFinite(Date.parse(m.edited_at))||Date.parse(m.edited_at)>now+300000)||typeof m.text!=='string'||m.text.length>100000||!Array.isArray(m.links)||m.links.length>8||m.links.some(u=>typeof u!=='string'||!/^https?:\/\//.test(u))||!['image','pdf','unsupported',null].includes(m.media)||!Number.isSafeInteger(m.size)||m.size<0||!/^[a-f0-9]{64}$/.test(m.fingerprint)||m.group!==null&&!/^\d+$/.test(m.group))throw Error('channel_manifest_invalid');}
export async function pollChannel(env:Env,transport:ChannelTransport,now=Date.now()){
 const source=await env.DB.prepare('SELECT enabled FROM sources WHERE id=?').bind(CHANNEL_SOURCE).first<{enabled:number}>();if(!source?.enabled)return{state:'disabled'};
 const key='sermaye_channel_state',saved=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{value:string}>(),state:State|null=saved?JSON.parse(saved.value):null;
 if(state?.next&&state.next>now)return{state:'waiting'};
 const lock=await env.DB.prepare("INSERT INTO system_state(key,value) VALUES('sermaye_channel_lease',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(system_state.value AS INTEGER)<=?").bind(String(now+120000),now).run();if(!lock.meta.changes)return{state:'busy'};
 try{
  const batch:ChannelBatch=await transport('channel-scan',{channel:CHANNEL,after_id:state?.cursor??null,baseline_id:state?.baseline_id??null});
  if(batch.channel!==CHANNEL||batch.peer_id!==CHANNEL_ID||!Number.isSafeInteger(batch.latest_id)||batch.latest_id<0||!Array.isArray(batch.messages)||batch.messages.length>70||batch.baseline!==!state)throw Error('channel_identity_mismatch');
  if(state&&batch.latest_id<state.cursor)throw Error('channel_cursor_regressed');
  for(const m of batch.messages)validate(m,now);
  const next:State=state?structuredClone(state):{baseline_id:batch.latest_id,cursor:batch.latest_id,next:0,pending:[],seen:{},last_ok:now};
  if(!state&&batch.messages.length)throw Error('channel_baseline_invalid');
  const pending=new Map(next.pending.map(m=>[m.id,m]));
  for(const m of batch.messages){if(m.id<=next.baseline_id||m.id>batch.latest_id)throw Error('channel_cursor_invalid');if(!m.text.trim()&&!m.media)continue;const previous=pending.get(m.id);pending.set(m.id,{...m,observed_at:previous?.fingerprint===m.fingerprint?previous.observed_at??now:now});}
  if(pending.size>MAX_PENDING)throw Error('channel_pending_capacity');
  const groups=new Map<string,ChannelMessage[]>();for(const m of pending.values()){const g=m.group?'album:'+m.group:'post:'+m.id;groups.set(g,[...(groups.get(g)??[]),m]);}
  const inserts=[];let fresh=0,corrections=0;
  for(const[g,members]of groups){members.sort((a,b)=>a.id-b.id);const old=next.seen[g],hash=await sha256(members.map(m=>m.fingerprint).join('|'));
   if(old?.hash===hash){for(const m of members)pending.delete(m.id);continue;}
   if(now-Math.max(...members.map(m=>m.group?m.observed_at??now:Date.parse(m.edited_at??m.at)))<SETTLE)continue;
   if(members.length>10||old&&old.ids.some(id=>!members.some(m=>m.id===id)))throw Error('channel_album_incomplete');
   const url=`https://t.me/${CHANNEL}/${members[0].id}`,manifest:ChannelManifest={version:1,channel:CHANNEL,peer_id:CHANNEL_ID,url,messages:members,hash,captured_at:now};
   const text=members.map(m=>m.text).filter(Boolean).join('\n\n'),media=members.some(m=>m.media),summary=(text||'Görsel tablo içeriği; değerler içerik oluşturma isteğinde okunacak.')+(media&&/teorik eşleşme|piyasa raporu|kurum akd|bist ?100/i.test(text)?'\n\nBorsa İstanbul piyasa tablosu. Tür, kanal başlığından alındı; değerler henüz okunmadı.':''),title=(old?'Düzeltme: ':'')+(text.split('\n').find(s=>s.trim())?.slice(0,200)||'Piyasa / kurum verileri — görsel'),articleUrl=url+'?endeks_revision='+hash.slice(0,16),at=old?members.map(m=>m.edited_at??m.at).sort().at(-1)!:members[0].at;
   inserts.push(env.DB.prepare('INSERT OR IGNORE INTO articles(id,source_id,url,title,summary,published_at,first_seen,document,document_expires) VALUES(?,?,?,?,?,?,?,?,?)').bind(await sha256(articleUrl),CHANNEL_SOURCE,articleUrl,title,summary.slice(0,8000),at,Math.floor(now/1000),JSON.stringify(manifest),Math.floor(now/1000)+86400));
   next.seen[g]={hash,ids:members.map(m=>m.id),at:now};for(const m of members)pending.delete(m.id);fresh++;if(old)corrections++;
  }
  next.pending=[...pending.values()];next.cursor=batch.latest_id;next.last_ok=now;next.next=now+60000;
  next.seen=Object.fromEntries(Object.entries(next.seen).sort((a,b)=>b[1].at-a[1].at).slice(0,2000));
  await env.DB.batch([...inserts,env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify(next)),env.DB.prepare('UPDATE sources SET last_ok=?,last_error=NULL,failures=0,last_count=? WHERE id=?').bind(Math.floor(now/1000),fresh,CHANNEL_SOURCE)]);
  return{state:state?'ok':'baseline',new_count:fresh,corrections,pending:next.pending.length,cursor:next.cursor,baseline:next.baseline_id};
 }catch(e){const code=e instanceof Error&&/^(?:channel|bot_account|bot_query)_[a-z_]+$/.test(e.message)?e.message:'channel_read_failed';await env.DB.prepare('UPDATE sources SET last_error=?,failures=failures+1 WHERE id=?').bind(code,CHANNEL_SOURCE).run();throw Error(code);}
 finally{await env.DB.prepare("UPDATE system_state SET value='0' WHERE key='sermaye_channel_lease' AND value=?").bind(String(now+120000)).run();}
}
export async function channelDocuments(raw:string,transport:ChannelTransport,image:(b:Uint8Array)=>Promise<Partial<Document>>,pdf:(b:Uint8Array)=>Promise<Partial<Document>>,now=Date.now(),load=(url:string,source:Source)=>readDocument({url,title:'Bağlantılı haber',summary:'',published_at:null},source)):Promise<Document[]>{
 const m:ChannelManifest=JSON.parse(raw);if(m.version!==1||m.channel!==CHANNEL||m.peer_id!==CHANNEL_ID||!Array.isArray(m.messages)||!m.messages.length||m.messages.length>10||m.url!==`https://t.me/${CHANNEL}/${m.messages[0].id}`)throw Error('channel_manifest_invalid');
 for(const row of m.messages)validate(row,now);
 if(m.hash!==await sha256(m.messages.map(r=>r.fingerprint).join('|'))||!Number.isFinite(m.captured_at)||now-m.captured_at>86400000)throw Error('channel_evidence_expired');
 const loaded=await transport('channel-read',{channel:CHANNEL,messages:m.messages.map(r=>({id:r.id,fingerprint:r.fingerprint}))});
 if(loaded.channel!==CHANNEL||loaded.peer_id!==CHANNEL_ID||loaded.messages?.length!==m.messages.length)throw Error('channel_identity_mismatch');
 const caption=m.messages.map(row=>row.text).filter(Boolean).join('\n\n');
 const docs:Document[]=[],base={source_id:CHANNEL_SOURCE,source_name:'Sermaye Borsası (@SermayeBorsasi)',family:'telegram-sermayeborsasi',official:false,language:'tr'};
 for(let i=0;i<m.messages.length;i++){const expected=m.messages[i],row:ChannelMessage=loaded.messages[i];validate(row,now);if(row.id!==expected.id||row.fingerprint!==expected.fingerprint)throw Error('channel_message_changed');
  const url=`https://t.me/${CHANNEL}/${row.id}`;
  if(row.text.trim())docs.push({...base,url,title:row.text.split('\n')[0].slice(0,220),body:row.text,published_at:row.at,passages:[{id:'channel_message',text:row.text},{id:'channel_provenance',text:JSON.stringify({id:row.id,version:m.hash,edited_at:row.edited_at,captured_at:m.captured_at})}]});
  if(row.media){if(row.media==='unsupported')throw Error('channel_media_unsupported');if(!row.bytes_base64||!/^[a-f0-9]{64}$/.test(row.sha256??''))throw Error('channel_media_missing');const bytes=Uint8Array.from(atob(row.bytes_base64),c=>c.charCodeAt(0));if(bytes.length>20000000||[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')!==row.sha256)throw Error('channel_media_invalid');const e=await(row.media==='pdf'?pdf:image)(bytes);if(!e.coverage?.complete||!e.body||!e.passages?.length)throw Error('channel_media_incomplete');docs.push({...base,...e,body:e.body,passages:[...e.passages,{id:'channel_context',text:JSON.stringify({message_id:row.id,posted_at:row.at,edited_at:row.edited_at,caption,version:m.hash,note:'Kanal yayın zamanı kaynak ölçüm tarihi değildir; görsel/başlık dönem çelişkisi korunmalıdır.'})}],url,title:'Sermaye Borsası kaynak görseli',published_at:row.at});}
  for(const link of row.links){const u=new URL(link);if(['t.me','telegram.me'].includes(u.hostname))continue;const source=(registry as Source[]).find(s=>s.enabled&&s.allowed_hosts.includes(u.hostname)&&!['reference','bridge_pdf'].includes(s.method??'rss'));if(!source)throw Error('channel_link_unsupported');docs.push(await load(link,source));}
 }
 if(!docs.length||docs.length>20||JSON.stringify(docs).length>3500000)throw Error('channel_evidence_limit');return docs;
}
