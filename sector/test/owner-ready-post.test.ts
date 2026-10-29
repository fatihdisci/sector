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
