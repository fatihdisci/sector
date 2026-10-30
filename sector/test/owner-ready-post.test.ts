import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile}from'node:fs/promises';
import {localDatabase}from'../src/local-adapters';import {queueManual}from'../src/manual';import {deliver}from'../src/pipeline';import {importReadyPost,readyPackageHash,validateReadyPackage,assertReadyPost,type ReadyPackage}from'../src/owner-ready-post';import {bytesHash,readMedia}from'../src/media-set';import {sha256}from'../src/utils/text';import {postText,validateDraft}from'../src/editorial';import {enqueueEdit}from'../src/bridge';import {requestRedesign}from'../src/card-redesign';import {draftKeyboard}from'../src/telegram-ui';import {telegramCommands}from'../src/telegram-commands';import {manualDocuments}from'../scripts/manual_reader';import type{Env,Draft}from'../src/types';
const image=await readFile('assets/visual-templates/bc-v1/01-yatay-takas.png');
async function packet(text='Metin aynen kalır.\n\n#ASELS #borsa  '){const p={version:1 as const,kind:'owner_ready_post'as const,id:crypto.randomUUID(),text,text_sha256:await sha256(text),sources:['https://t.me/b0pt_bot'],media:[{png_base64:image.toString('base64'),sha256:await bytesHash(image)}]};return {...p,sha256:await readyPackageHash(p)};}
async function env(){const media=new Map<string,Uint8Array>();return {DB:await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),MEDIA:{put:async(k:string,b:Uint8Array)=>media.set(k,b),get:async(k:string)=>media.has(k)?{arrayBuffer:async()=>media.get(k)!.slice().buffer}:null,delete:async(k:string)=>media.delete(k)},MODE:'telegram_review',BOT_WORKFLOW_MODE:'news_only',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'42',TELEGRAM_BOT_TOKEN:'123:fixture',TELEGRAM_VERIFIED_BOT_ID:'123',X_PUBLISH_ENABLED:'true'}as unknown as Env;}
const owner={message_id:8,from:{id:7},chat:{id:42,type:'private'}};
test('real manual handler imports an owner document and delivers exact media + approval card without model or X queue',async()=>{
 const e=await env(),p=await packet('Uzun hazır metin. '.repeat(90)+'\n#ASELS'),raw=JSON.stringify(p),original=fetch,calls:{method:string;body:any}[]=[];let id=90;
 globalThis.fetch=async(url,init)=>{const method=String(url).split('/').pop()!;calls.push({method,body:init?.body});if(method==='getFile')return Response.json({ok:true,result:{file_path:'documents/package.json'}});if(method==='package.json')return new Response(raw);return Response.json({ok:true,result:{message_id:id++}});};
 try{
  assert(await queueManual(e,11,{...owner,caption:'/hazir',document:{file_id:'f',file_name:'borsa-cakali-post.json',file_size:new TextEncoder().encode(raw).length}}));
  const row=await e.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(p.id).first<any>();assert(row);assert.equal(postText(JSON.parse(row.content)),p.text);
  await deliver(e);const sent=await e.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(p.id).first<any>();assert.equal(sent.delivery_state,'sent');
  const caption=calls.filter(c=>c.method==='sendMessage').at(-1)!.body as URLSearchParams;assert.equal(caption.get('text'),p.text);assert(caption.get('reply_markup')!.includes('xpost:'));assert(!caption.get('reply_markup')!.includes('Düzenle'));
  assert.deepEqual(calls.map(c=>c.method),['getFile','package.json','sendMessage','sendPhoto','sendMessage']);
  const png=(calls.find(c=>c.method==='sendPhoto')!.body as FormData).get('photo')as Blob;assert.equal(await bytesHash(new Uint8Array(await png.arrayBuffer())),p.media[0].sha256);
  assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<any>()).n,0);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM manual_requests').first<any>()).n,0);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);
  const data=await readMedia(e,sent.media_key,sent.content);await assertReadyPost(e,sent.id,1,sent.content,data.images);
  assert.equal((await importReadyPost(e,p)).duplicate,true);await assert.rejects(()=>importReadyPost(e,{...p,text:'farklı'}));
  await assert.rejects(()=>enqueueEdit(e,p.id,1,'değiştir'),/immutable/);assert.match(await requestRedesign(e,`design:${p.id}:1`,sent.message_id,123),/sabittir/);
  const altered=JSON.stringify({...JSON.parse(sent.content),body:'bozuldu'});await assert.rejects(()=>assertReadyPost(e,p.id,1,altered,data.images),/binding/);
  const after=calls.length;await deliver(e);assert.equal(calls.length,after);
 }finally{globalThis.fetch=original;}
});
test('hash mismatch, missing or fifth media, corrupt PNG and changed package ID contents fail closed',async()=>{
 const p=await packet();for(const v of [{...p,media:[]},{...p,media:[...p.media,...p.media,...p.media,...p.media,...p.media]},{...p,text:'değişti'},{...p,sha256:'0'.repeat(64)}])await assert.rejects(()=>validateReadyPackage(v));
 const bad={...p,media:[{...p.media[0],png_base64:p.media[0].png_base64.slice(0,-8)}]};bad.sha256=await readyPackageHash(bad);await assert.rejects(()=>validateReadyPackage(bad));
 const e=await env();await importReadyPost(e,p);const different=await packet('Başka içerik');different.id=p.id;different.sha256=await readyPackageHash(different);await assert.rejects(()=>importReadyPost(e,different),/immutable/);
 assert.throws(()=>validateDraft({tweet_style:'owner_ready'},[]),/forbidden/);
});
test('uncertain approval-card delivery is not resent or reset by importing the same package',async()=>{
 const e=await env(),p=await packet(),original=fetch;await importReadyPost(e,p);let photos=0,controls=0;
 globalThis.fetch=async(url)=>{if(String(url).endsWith('/sendPhoto')){photos++;return Response.json({ok:true,result:{message_id:90}});}controls++;throw Error('transport uncertain');};
 try{await deliver(e);assert.equal((await e.DB.prepare('SELECT delivery_state FROM drafts WHERE id=?').bind(p.id).first<any>()).delivery_state,'uncertain');await importReadyPost(e,p);await deliver(e);assert.equal(photos,1);assert.equal(controls,1);}finally{globalThis.fetch=original;}
});
test('news-only routing blocks data and image jobs but preserves normal manual news, KAP menu and preferences',async()=>{
 const e=await env(),original=fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({ok:true,result:{message_id:91}});};
 try{
  assert.equal(await queueManual(e,1,{...owner,from:{id:99},caption:'/hazir'}),false);assert.equal(calls,0);
  await queueManual(e,2,{...owner,text:'/piyasayd'});await queueManual(e,3,{...owner,photo:[{file_id:'f',width:100,height:100}]});assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM manual_requests').first<any>()).n,0);
  await queueManual(e,4,{...owner,text:'Şirket yeni yatırımı için açıklama yaptı. Ayrıntılı haber metni burada.'});assert.equal((await e.DB.prepare('SELECT kind FROM manual_requests WHERE update_id=4').first<any>()).kind,'text');
  e.OWNER_VISUAL={enabled:false,analyze:async()=>{throw Error('visual must not run');}}as any;const docs=await manualDocuments(e,'text',JSON.stringify({text:'Şirket yeni yatırım planını duyurdu. Bu haberin ayrıntıları açıklandı.'}),8);assert(docs.length);
  const names=telegramCommands(e).map(c=>c.command);assert(names.includes('hazir'));assert(names.includes('devrekesici'));assert(names.includes('gerialim'));assert(!names.includes('piyasayd'));assert(!names.includes('akd'));
  assert(telegramCommands({...e,BOT_WORKFLOW_MODE:'full'}).some(c=>c.command==='piyasayd'));
 }finally{globalThis.fetch=original;}
});
test('imported card uses the real webhook owner/message gate for immediate and 15/30/60 minute queues (isolated DB only)',async()=>{
 const {default:worker}=await import('../src/worker');const original=fetch;globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:90}});
 try{for(const delay of [0,15,30,60]){
  const e=await env(),p=await packet();e.TELEGRAM_WEBHOOK_SECRET='fixture-secret';await importReadyPost(e,p);await deliver(e);
  const row=await e.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(p.id).first<any>();
  const callback=async(actor:number,message:number,data:string,update:number)=>worker.fetch(new Request('https://local.test/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'fixture-secret'},body:JSON.stringify({update_id:update,callback_query:{id:'fixture-'+update,from:{id:actor},message:{message_id:message,chat:{id:42,type:'private'}},data}})}),e,{waitUntil:()=>{}}as any);
  await callback(99,row.message_id,`xchoose:${delay}:${p.id}:1`,1);await callback(7,row.message_id+1,`xchoose:${delay}:${p.id}:1`,2);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);
  await callback(7,row.message_id,`xpost:${p.id}:1`,3);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);
  const start=Date.now();await callback(7,row.message_id,`xchoose:${delay}:${p.id}:1`,4);await callback(7,row.message_id,`xchoose:${delay}:${p.id}:1`,4);
  const q=await e.DB.prepare('SELECT x.content,x.state,s.due_at,s.media_hashes FROM x_posts x JOIN x_schedules s ON s.post_id=x.id').first<any>();assert.equal(q.content,p.text);assert.equal(q.state,'queued');assert(q.due_at>=start+delay*60000&&q.due_at<Date.now()+delay*60000+1000);assert.deepEqual(JSON.parse(q.media_hashes),p.media.map(m=>m.sha256));assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,1);
 }}finally{globalThis.fetch=original;}
});

import {buildReadyPackage}from'../scripts/package_ready_post';import {capturePublication}from'../src/publication-snapshot';import {publishX,requestX,type XTransport}from'../src/x-publish';import {formatReadyUpdate,type ReadyContentType}from'../src/ready-quote';
async function typedPacket(type:ReadyContentType,quote?:string){return buildReadyPackage(crypto.randomUUID(),'Teorik eşleşme\n\n#ASTOR 100 TL\n\nKaynak: örnek\nSaat: 09:45\nVeriler anlıktır, değişebilir.',['https://example.org/verified'],[image],{content_type:type,...(quote?{quote_tweet_id:quote}:{})});}
async function priorPost(e:Env,type:ReadyContentType,remote='2115806252123279581',state='sent'){
 const p=await typedPacket(type);await importReadyPost(e,p);const row=await e.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(p.id).first<any>();
 await e.DB.prepare("INSERT INTO x_posts(id,draft_id,revision,day,state,content,media_key,created_at,finished_at,remote_id) VALUES(?,?,1,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),p.id,new Date().toISOString().slice(0,10),state,p.text,row.media_key,Date.now(),Date.now(),remote).run();await capturePublication(e,p.id,'api',Date.now(),'https://x.com/borsacakali/status/'+remote,1);return p;
}
test('theoretical update format is scoped; lowercase tags, no source/time, exact closing and separated headings',async()=>{
 const ipo=await typedPacket('theoretical_ipo'),movers=await typedPacket('theoretical_movers','2115806252123279581');
 assert(ipo.text.startsWith('Son halka arzlarda teorik eşleşme verileri\n'));assert(movers.text.startsWith('Güncelleme: Teorik eşleşmede en çok yükselenler düşenler\n'));for(const p of[ipo,movers]){assert(p.text.includes('#astor'));assert(!p.text.includes('Kaynak'));assert(!p.text.includes('09:45'));assert(p.text.endsWith('Veriler anlıktır değişebilir.'));await validateReadyPackage(p);}
 assert.equal(formatReadyUpdate('Normal haber #ABC\nSaat: 09:45'), 'Normal haber #ABC\nSaat: 09:45');
 const bad={...ipo,text:ipo.text.replace('#astor','#ASTOR')};bad.text_sha256=await sha256(bad.text);bad.sha256=await readyPackageHash(bad);await assert.rejects(validateReadyPackage(bad),/theoretical_text_invalid/);
 await assert.rejects(validateReadyPackage({...movers,quote_tweet_id:'2115806252123279582'}),/ready_package_hash/);
});
test('quote imports only a verified same-type published receipt; fake, wrong-chain and uncertain parents fail closed',async()=>{
 for(const state of['pending','failed','uncertain']){const e=await env();await priorPost(e,'theoretical_ipo','2115806252123279581',state);await assert.rejects(importReadyPost(e,await typedPacket('theoretical_ipo','2115806252123279581')),/parent_unverified/);}
 const e=await env();await priorPost(e,'theoretical_ipo');await assert.rejects(importReadyPost(e,await typedPacket('theoretical_movers','2115806252123279581')),/parent_unverified/);await assert.rejects(importReadyPost(e,await typedPacket('theoretical_ipo','9999999999999999999')),/parent_unverified/);
 const p=await typedPacket('theoretical_ipo','2115806252123279581');assert(!(await importReadyPost(e,p)).duplicate);assert((await importReadyPost(e,p)).duplicate);assert.equal((await e.DB.prepare("SELECT COUNT(*) n FROM x_posts WHERE state='queued'").first<any>()).n,0);
});
test('owner immediate and scheduled quote keeps exact media/target through queue, publishes once, retains immutable receipt',async()=>{
 const original=fetch;globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:90}});
 try{for(const delay of[0,15]){
  const e=await env();await priorPost(e,'theoretical_ipo');const p=await typedPacket('theoretical_ipo','2115806252123279581');await importReadyPost(e,p);await e.DB.prepare("UPDATE drafts SET delivery_state='sent',message_id=444 WHERE id=?").bind(p.id).run();
  await requestX(e,`xchoose:${delay}:${p.id}:1`,444,'cb');await requestX(e,`xchoose:${delay}:${p.id}:1`,444,'cb');const q=await e.DB.prepare('SELECT p.id,p.state,s.due_at,s.media_hashes FROM x_posts p JOIN x_schedules s ON s.post_id=p.id WHERE p.draft_id=?').bind(p.id).first<any>();assert(q);assert.deepEqual(JSON.parse(q.media_hashes),p.media.map(m=>m.sha256));
  const binding=JSON.parse((await e.DB.prepare('SELECT value FROM system_state WHERE key=?').bind('x_quote:'+q.id).first<any>()).value);assert.equal(binding.quote_tweet_id,p.quote_tweet_id);let posts=0,uploads=0;const api:XTransport={identity:async()=>({id:'335502216',username:'borsacakali'}),upload:async bytes=>{assert.equal(await bytesHash(bytes),p.media[0].sha256);uploads++;return'123'},post:async(text,mids,quote)=>{assert.equal(text,p.text);assert.equal(quote,p.quote_tweet_id);assert.equal(mids,'123');posts++;return'2115806252123279582'}};
  if(delay){await publishX(e,api,()=>q.due_at-100);assert.equal(posts,0);assert.equal(uploads,0);}
  await publishX(e,api,()=>q.due_at+100);await publishX(e,api,()=>q.due_at+200);assert.equal(posts,1);assert.equal(uploads,1);assert.equal((await e.DB.prepare('SELECT state FROM x_posts WHERE id=?').bind(q.id).first<any>()).state,'sent');assert((await importReadyPost(e,p)).duplicate);
  const snap=await e.DB.prepare("SELECT content FROM publication_snapshots WHERE draft_id=? AND method='api'").bind(p.id).first<any>();assert.equal(JSON.parse(snap.content).owner_ready_publication.quote_tweet_id,p.quote_tweet_id);
 }}finally{globalThis.fetch=original;}
});
test('changed queue quote binding cannot upload or post',async()=>{
 const original=fetch;globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:90}});
 try{const e=await env();await priorPost(e,'theoretical_ipo');const p=await typedPacket('theoretical_ipo','2115806252123279581');await importReadyPost(e,p);await e.DB.prepare("UPDATE drafts SET delivery_state='sent',message_id=444 WHERE id=?").bind(p.id).run();await requestX(e,`xchoose:0:${p.id}:1`,444,'cb');await e.DB.prepare("DELETE FROM system_state WHERE key LIKE 'x_quote:%'").run();let calls=0;await publishX(e,{identity:async()=>{calls++;return{id:'335502216',username:'borsacakali'}},upload:async()=>{calls++;return'123'},post:async()=>{calls++;return'456'}});assert.equal(calls,0);assert.equal((await e.DB.prepare('SELECT state FROM x_posts WHERE draft_id=?').bind(p.id).first<any>()).state,'failed');}finally{globalThis.fetch=original;}
});
test('quoted parent page/media receipt cannot change after package import',async()=>{
 const e=await env(),parent=await priorPost(e,'theoretical_ipo'),p=await typedPacket('theoretical_ipo','2115806252123279581');await importReadyPost(e,p);const row=await e.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(p.id).first<any>(),media=await readMedia(e,row.media_key,row.content);assert(JSON.parse(row.content).owner_ready_publication.parent_receipt_hash);await assertReadyPost(e,p.id,1,row.content,media.images);
 await e.DB.prepare("UPDATE publication_snapshots SET media_hash=? WHERE draft_id=?").bind('0'.repeat(64),parent.id).run();await assert.rejects(assertReadyPost(e,p.id,1,row.content,media.images),/parent_binding/);
});
