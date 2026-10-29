import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localDatabase} from '../src/local-adapters';
import {manualDocuments} from '../scripts/manual_reader';
import {createOwnerVisualRuntime,renderModelJob} from '../scripts/owner_visual_runtime';
import {collectVisualAlbum} from '../src/owner-visual-album';
import {enqueueEvidence} from '../src/ingest';
import {leaseJob} from '../src/bridge';
import {authorizedVisualSpec,visualHash,assertVisualReceipt,type VisualInput,type VisualAnalysis,type VisualLease} from '../src/owner-visual';
import type {Env,Draft,Document} from '../src/types';
const bytes=new Uint8Array([137,80,78,71,13,10,26,10]);
const input:VisualInput={kind:'image',message_id:42,source_message_ids:[41],owner_text:'',source_text:'Kaynak açıklaması',instructions:'',submitted_at:1800000000,images:[{bytes,source_message_id:41,caption:'Kaynak açıklaması'}]};
async function setup(){
 const files=new Map<string,Uint8Array>();const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));
 const env={DB,MODE:'dry_run',MEDIA:{put:async(k:string,v:Uint8Array)=>{files.set(k,v)},get:async(k:string)=>files.has(k)?{arrayBuffer:async()=>files.get(k)!.slice().buffer}:null}} as unknown as Env;
 return {env,files};
}
async function fixture(env:Env){
 const root=await mkdtemp(join(tmpdir(),'owner-visual-hook-'));const calls:any[]=[];
 await writeFile(join(root,'config.json'),JSON.stringify({enabled:true,budget_authorized:true,template_version:'bc-typographic-v1'}));
 const runtime=await createOwnerVisualRuntime(env,{root:process.cwd()+'/',python:'never-execute',vars:{SECTOR_OWNER_VISUAL_ENABLED:'true',SECTOR_OWNER_VISUAL_CONFIG:join(root,'config.json'),SECTOR_OWNER_VISUAL_BUDGET:join(root,'budget.sqlite'),SECTOR_OWNER_VISUAL_USAGE:join(root,'usage.jsonl'),SECTOR_OPENAI_API_KEY:'fake-offline-test-only'},invoke:async(value:any)=>{
  calls.push(value);
  if(value.operation==='analyze')return {complete:true,binding:value.request.binding,facts:[{id:'f1',kind:'row',label:'ASELS',value:'100 lot',source_sha256:value.request.assets[0]?.sha256??'owner_text'}],operations:value.request.instructions?[{id:'o1',instruction_id:'i0',kind:'presentation',quote:value.request.instructions,value:null}]:[],instruction_units:value.request.instructions?[{id:'i0',text:value.request.instructions}]:[],uncertainties:[],audit:{supported:true,issues:[],all_instructions_covered:true,binding:value.request.binding}} satisfies VisualAnalysis;
  return {cards:[{svg_hash:'a'.repeat(64),png_base64:Buffer.from(bytes).toString('base64')}],visual_result:{version:1,binding:value.request.binding,job_id:value.job.id,input_hash:value.job.input_hash,lease_token:value.job.lease_token,expected_revision:value.job.expected_revision,draft_hash:await visualHash(value.draft),spec:value.spec,pages:[{sha256:'a'.repeat(64),width:1536,height:864,row_ids:value.spec.rows.map((r:any)=>r.id),audit:{supported:true,issues:[],binding:value.request.binding,all_instructions_covered:true}}]}};
 }});env.OWNER_VISUAL=runtime;
 return {runtime,calls,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('disabled runtime does not read missing configuration or invoke a provider',async()=>{
 const {env}=await setup();let calls=0;const runtime=await createOwnerVisualRuntime(env,{root:'/missing/',python:'/missing/',vars:{SECTOR_OWNER_VISUAL_CONFIG:'/missing/config'},invoke:async()=>{calls++;throw Error('unexpected')}});
 assert.equal(runtime.enabled,false);await assert.rejects(runtime.analyze(input),/api_disabled/);assert.equal(calls,0);
});
test('manual direct text binds owner instructions without an OCR call',async()=>{
 const {env}=await setup();let seen:VisualInput|undefined;env.OWNER_VISUAL={enabled:true,analyze:async (v:VisualInput)=>{seen=v;return []}} as any;
 await manualDocuments(env,'text',JSON.stringify({text:'ASELS 100 lot',owner_message_text:'Başlığı kısa tut',editor_request:'Başlığı kısa tut',source_message_id:40,submitted_at:1800000000}),42,async()=>{throw Error('OCR must not run')});
 assert.equal(seen!.source_text,'ASELS 100 lot');assert.equal(seen!.instructions,'Başlığı kısa tut');assert.deepEqual(seen!.source_message_ids,[40]);assert.deepEqual(seen!.images,[]);
});
test('manual image hook keeps source caption separate from owner request and never invokes OCR',async()=>{
 const {env}=await setup();let seen:VisualInput|undefined;env.TELEGRAM_BOT_TOKEN='123:fake';env.TELEGRAM_VERIFIED_BOT_ID='123';env.OWNER_VISUAL={enabled:true,analyze:async (v:VisualInput)=>{seen=v;return []}} as any;
 const saved=globalThis.fetch;globalThis.fetch=async(url)=>String(url).includes('/getFile')?Response.json({ok:true,result:{file_path:'photos/source.jpg'}}):new Response(bytes);
 try{await manualDocuments(env,'image',JSON.stringify({text:'Kaynak açıklaması',source_caption_original:'Kaynak açıklaması',owner_message_text:'Tarih yazma',editor_request:'Tarih yazma',image:{file_id:'fake-file'},source_message_id:41}),42,async()=>{throw Error('OCR must not run')});}finally{globalThis.fetch=saved;}
 assert.equal(seen!.images[0].caption,'Kaynak açıklaması');assert.equal(seen!.images[0].source_message_id,41);assert.equal(seen!.owner_text,'Tarih yazma');assert.equal(seen!.instructions,'Tarih yazma');assert.deepEqual(seen!.images[0].bytes,bytes);
});
test('disabled manual hook fails before Telegram download or OCR',async()=>{
 const {env}=await setup();env.OWNER_VISUAL={enabled:false} as any;let calls=0;const saved=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('unexpected')};
 try{await assert.rejects(manualDocuments(env,'image',JSON.stringify({image:{file_id:'fake'},text:''}),42,async()=>{calls++;throw Error('unexpected')}),/api_disabled/);}finally{globalThis.fetch=saved;}assert.equal(calls,0);
});
test('source analysis reaches durable queue and lease; AI renderer is selected without code fallback',async()=>{
 const {env}=await setup();const f=await fixture(env);
 try{const docs=await f.runtime.analyze(input);const id=await enqueueEvidence(env,docs,'manual');assert.equal(await enqueueEvidence(env,docs,'manual'),id);const leased=await leaseJob(env);assert(leased);assert.equal(leased.id,id);assert.equal(leased.documents[0].owner_visual.request.binding,docs[0].owner_visual!.request.binding);
 const draft={card_headline:'Dağılım',card_body:'Kurum payları'} as Draft;let codeCalls=0;
 const result=await renderModelJob(env,leased,draft,async()=>{codeCalls++;return []});assert('visual_result' in result);assert.equal(codeCalls,0);assert.deepEqual(f.calls.map(c=>c.operation),['analyze','render']);
 await assert.rejects(assertVisualReceipt({...leased,lease_token:'wrong'},draft,result.visual_result,result.cards),/binding_mismatch/);
 await assert.rejects(assertVisualReceipt(leased,{...draft,card_body:'Değişik'},result.visual_result,result.cards),/binding_mismatch/);
 const receipt=structuredClone(result.visual_result!);receipt.spec.rows[0].value='101 lot';await assert.rejects(assertVisualReceipt(leased,draft,receipt,result.cards),/spec_unauthorized/);
 }finally{await f.cleanup();}
});
test('verified command document selects code rendering with visual API disabled',async()=>{
 const {env}=await setup();env.OWNER_VISUAL={enabled:false} as any;let calls=0;
 const job={id:'job',lease_token:'lease',input_hash:'hash',deadline:1,documents:[{source_id:'bot-query'} as Document]} satisfies VisualLease;
 const result=await renderModelJob(env,job,{} as Draft,async()=>{calls++;return [{svg_hash:'code',png_base64:'fake'}]});assert.equal(calls,1);assert.equal(result.cards[0].svg_hash,'code');
});
test('revision hook reloads exact source bytes and binds current draft revision',async()=>{
 const {env,files}=await setup();const f=await fixture(env);
 try{const docs=await f.runtime.analyze(input);const revised=await f.runtime.revise(docs,'Daha kısa yaz',{draft_id:'draft',revision:3,owner_message_id:45});const request=revised[0].owner_visual!.request;assert.deepEqual(request.edit_context,{draft_id:'draft',revision:3});assert.equal(request.owner_message_id,45);assert.equal(request.assets[0].sha256,docs[0].owner_visual!.request.assets[0].sha256);assert.notEqual(request.binding,docs[0].owner_visual!.request.binding);assert.equal(f.calls.length,2);
 files.clear();await assert.rejects(f.runtime.revise(docs,'Tekrar',{draft_id:'draft',revision:3}),/asset_missing/);assert.equal(f.calls.length,2);
 }finally{await f.cleanup();}
});
test('album groups two sources once, preserves per-image captions and rejects a late new member',async()=>{
 const {env}=await setup();env.OWNER_VISUAL={enabled:true} as any;const rows=[];
 for(let i=1;i<=2;i++){const row={update_id:i,message_id:40+i,kind:'image',input:JSON.stringify({owner_album:'album-test',received_at_ms:1000,text:'Kaynak '+i,source_caption_original:'Kaynak '+i,source_message_id:40+i,image:{file_id:'file'+i},owner_message_text:i===1?'Kısa yaz':''})};rows.push(row);await env.DB.prepare("INSERT INTO manual_requests(update_id,message_id,kind,input,state,created_at) VALUES(?,?,?,?,'queued',1)").bind(i,row.message_id,row.kind,row.input).run();}
 assert.equal(await collectVisualAlbum(env,rows[0],2000),null);const packed=await collectVisualAlbum(env,rows[0],3000);assert(packed);assert.deepEqual(packed.members,[1,2]);const value=JSON.parse(packed.input);assert.deepEqual(value.source_message_ids,[41,42]);assert.deepEqual(value.images.map((a:any)=>a.caption),['Kaynak 1','Kaynak 2']);assert.equal(value.editor_request,'Kısa yaz');assert.deepEqual(await collectVisualAlbum(env,rows[1],4000),packed);await assert.rejects(collectVisualAlbum(env,{...rows[0],update_id:3},4000),/late_member/);
});

import {submitJob,enqueueEdit} from '../src/bridge';
import {acceptHermes} from '../src/ai';
import {png} from '../scripts/render_local';
import {bytesHash} from '../src/media-set';
test('actual submit handler binds visual receipt, saves one draft and deduplicates completed result',async()=>{
 const {env}=await setup();env.AI_MODEL='gpt-6.1-terra';env.AI_EFFORT='low';const f=await fixture(env);
 try{const docs=await f.runtime.analyze(input),id=await enqueueEvidence(env,docs,'manual'),job=await leaseJob(env);assert(job);
 const candidate={headline:'📊 ASELS için pay miktarı açıklandı',body:'ASELS pay miktarı 100 lot olarak açıklandı.',card_headline:'ASELS pay miktarı',card_body:'Açıklanan miktar 100 lot oldu.',hashtags:['#Borsa','#ASELS'],entities:['ASELS'],event_key:'visual-test',category:'bist',importance:80,template:'info',claims:[{text:'ASELS: 100 lot',evidence:[{document:0,passage:'visual_source',quote:'Kaynakta okunan değerler: ASELS: 100 lot'}]}],uncertainties:[]} as Draft;
 const draft=acceptHermes(candidate,{supported:true,issues:[]},job.documents).draft;
 const rendered=await f.runtime.render(job,draft);const raw=await png('<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="864"><rect width="1536" height="864" fill="#080908"/></svg>'),sha=await bytesHash(raw);
 rendered.cards[0]={svg_hash:sha,png_base64:Buffer.from(raw).toString('base64')};rendered.visual_result.pages[0].sha256=sha;
 const payload={id,lease_token:job.lease_token,input_hash:job.input_hash,draft,audit:{supported:true,issues:[]},runtime:{model:env.AI_MODEL,effort:env.AI_EFFORT,provider:'openai-codex',tool_count:0,fallback_count:0},...rendered};
 await assert.rejects(submitJob(env,{...payload,visual_result:undefined}),/receipt_missing/);
 await assert.rejects(submitJob(env,{...payload,visual_result:{...rendered.visual_result,input_hash:'wrong'}}),/binding_mismatch/);
 const wrong=structuredClone(payload);wrong.visual_result.pages[0].sha256='0'.repeat(64);wrong.cards[0].svg_hash='0'.repeat(64);await assert.rejects(submitJob(env,wrong),/image_hash_mismatch/);
 const saved=await submitJob(env,payload);assert.equal(saved.duplicate,false);assert.equal((await submitJob(env,payload)).duplicate,true);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);
 const row=await env.DB.prepare('SELECT revision,delivery_state FROM drafts WHERE id=?').bind(saved.id).first<any>();assert.equal(row.revision,1);assert.equal(row.delivery_state,'waiting');
 let revisions=0;const original=f.runtime.revise;f.runtime.revise=async(...args)=>{revisions++;return original(...args)};
 await enqueueEdit(env,saved.id,1,'Daha kısa yaz',46);await enqueueEdit(env,saved.id,1,'Daha kısa yaz',46);assert.equal(revisions,1);
 const edit=await leaseJob(env);assert(edit);assert.equal(edit.kind,'edit');assert.deepEqual(edit.documents[0].owner_visual.request.edit_context,{draft_id:saved.id,revision:1});
 await assert.rejects(enqueueEdit(env,saved.id,1,'Başka düzenleme',47),/edit_in_progress/);
 const changedDraft=acceptHermes(candidate,{supported:true,issues:[]},edit.documents,edit.edit_request).draft;
 const editRendered=await f.runtime.render(edit,changedDraft);editRendered.cards[0]={svg_hash:sha,png_base64:Buffer.from(raw).toString('base64')};editRendered.visual_result.pages[0].sha256=sha;
 const editPayload={...payload,id:edit.id,lease_token:edit.lease_token,input_hash:edit.input_hash,draft:changedDraft,...editRendered};
 const badRevision=structuredClone(editPayload);badRevision.visual_result.expected_revision=0;await assert.rejects(submitJob(env,badRevision),/binding_mismatch/);
 await submitJob(env,editPayload);assert.equal((await env.DB.prepare('SELECT revision FROM drafts WHERE id=?').bind(saved.id).first<any>()).revision,2);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,1);

 }finally{await f.cleanup();}
});

test('literal title, removal, addition and date/time operations determine exact authorized image spec',()=>{
 const facts=[{id:'a',kind:'row',label:'ASELS',value:'100 lot',source_sha256:'x'},{id:'b',kind:'row',label:'THYAO',value:'200 lot',source_sha256:'x'}] as VisualAnalysis['facts'];
 const operations=[{id:'o1',instruction_id:'i0',kind:'title',quote:'Başlık Yeni başlık olsun',value:'Yeni başlık'},{id:'o2',instruction_id:'i1',kind:'remove',target:'b',quote:'THYAO çıkar',value:null},{id:'o3',instruction_id:'i2',kind:'add',quote:'Not Kaynak beyanı ekle',label:'Not',value:'Kaynak beyanı'},{id:'o4',instruction_id:'i3',kind:'date',quote:'Tarihi kaldır',value:null},{id:'o5',instruction_id:'i4',kind:'time',quote:'Saat 12:30 yaz',value:'12:30'}] as VisualAnalysis['operations'];
 const spec=authorizedVisualSpec({card_headline:'Eski',card_body:'Açıklama'} as Draft,{facts,operations} as VisualAnalysis);assert.equal(spec.title,'Yeni başlık');assert.deepEqual(spec.rows,[{id:'a',label:'ASELS',value:'100 lot'},{id:'add:o3',label:'Not',value:'Kaynak beyanı'}]);assert.equal(spec.date,null);assert.equal(spec.time,'12:30');assert.equal(spec.applied_operations.length,5);
 assert.throws(()=>authorizedVisualSpec({} as Draft,{facts,operations:[{...operations[2],value:'Uydurma'}]} as VisualAnalysis),/add_not_literal/);
});

test('oversized album is rejected as a whole and cannot become a partial paid request',async()=>{
 const {env}=await setup();env.OWNER_VISUAL={enabled:true} as any;let first:any;
 for(let i=1;i<=5;i++){const row={update_id:i,message_id:100+i,kind:'image',input:JSON.stringify({owner_album:'too-many',received_at_ms:1,image:{file_id:'file'+i}})};first??=row;await env.DB.prepare("INSERT INTO manual_requests(update_id,message_id,kind,input,state,created_at) VALUES(?,?,?,?,'queued',1)").bind(i,row.message_id,row.kind,row.input).run();}
 await assert.rejects(collectVisualAlbum(env,first,5000),/source_limit/);assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM manual_requests WHERE state='needs_review' AND error='owner_visual_source_limit'").first<any>()).n,5);assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM manual_requests WHERE state='queued'").first<any>()).n,0);
});

test('racing current-revision change blocks an owner-visual edit before it can enqueue',async()=>{
 const {env}=await setup();const f=await fixture(env);try{
 const docs=await f.runtime.analyze(input);await enqueueEvidence(env,docs,'manual');const id='11111111-1111-4111-8111-111111111111';
 await env.DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,state,created_at,expires_at,revision) VALUES(?,'racing','f',?,?,'verified','pending',1,9999999999,1)").bind(id,JSON.stringify({output_preferences:{}}),JSON.stringify(docs)).run();await env.DB.prepare('UPDATE articles SET draft_id=?').bind(id).run();
 f.runtime.revise=async()=>{await env.DB.prepare('UPDATE drafts SET revision=2 WHERE id=?').bind(id).run();return docs;};
 await assert.rejects(enqueueEdit(env,id,1,'Kısa yaz',55),/revision_mismatch/);assert.equal((await env.DB.prepare("SELECT COUNT(*) n FROM model_jobs WHERE kind='edit'").first<any>()).n,0);
 }finally{await f.cleanup();}
});
