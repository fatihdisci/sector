import {refreshNewsRequests} from '../src/news-inbox';
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {localDatabase} from '../src/local-adapters';import {enqueueEdit} from '../src/bridge';import {hashtagOnlyRequest} from '../src/hashtag-edit';
import {readMedia,bytesHash} from '../src/media-set';import {draftCard} from '../src/card';import {validateDraft,postText} from '../src/editorial';import type {Env,Draft,Document} from '../src/types';
const id='11111111-1111-4111-8111-111111111111',key=`drafts/${id}/1.png`;
const text='Selçuk Ecza Deposu şirket hakkında yaptırım olmadığını açıkladı.';
const doc:Document={source_id:'fixture',source_name:'Resmî fixture',family:'official-fixture',official:true,url:'https://example.org/seleca',title:'Selçuk Ecza açıklaması',body:text,passages:[{id:'p',text}],published_at:'2026-10-28T11:30:00Z'};
const draft:Draft={headline:'📢 Selçuk Ecza yaptırım olmadığını açıkladı',body:text,card_headline:'Selçuk Ecza açıklaması',card_body:text,template:'company',category:'companies',importance:60,hashtags:['#Borsa','#BIST','#SPK'],entities:['Selçuk Ecza'],claims:[{text,evidence:[{document:0,passage:'p',quote:text}]}],event_key:'fixture',uncertainties:[]};
async function fixture(){const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),files=new Map<string,Uint8Array>([[key,new Uint8Array([137,80,78,71,10,20])]]);const env={DB,MEDIA:{get:async(k:string)=>files.has(k)?{arrayBuffer:async()=>files.get(k)!.slice().buffer}:null,put:async(k:string,b:Uint8Array)=>{files.set(k,b.slice());},delete:async(k:string)=>{files.delete(k);}}} as unknown as Env;await DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,state,revision,created_at,expires_at,media_key,message_id,delivery_state) VALUES(?,?,?,?,?,'official_attributed','pending',1,1,?,?,100,'sent')").bind(id,'event','hash',JSON.stringify(draft),JSON.stringify([doc]),Math.floor(Date.now()/1000)+3600,key).run();return env;}
test('exact owner SELEC edit appends once, preserves image bytes/card hash and queues no model work',async()=>{
 const env=await fixture(),original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('no network allowed');};try{
  await enqueueEdit(env,id,1,'tweetin sonuna #SELEC ekle görseli değiştirme');
  const row=await env.DB.prepare('SELECT content,media_key,revision,documents FROM drafts WHERE id=?').bind(id).first<any>();const out=JSON.parse(row.content) as Draft;
  assert.deepEqual(out.hashtags,['#Borsa','#BIST','#SPK','#SELEC']);assert(postText(out).endsWith('#SELEC'));assert.deepEqual({...out,hashtags:draft.hashtags},draft);assert.equal(out.body,draft.body);assert.equal(out.card_headline,draft.card_headline);assert.equal(out.card_body,draft.card_body);assert.deepEqual(out.claims,draft.claims);assert.equal(row.documents,JSON.stringify([doc]));
  assert.equal(await bytesHash((await readMedia(env,key)).images[0]),await bytesHash((await readMedia(env,row.media_key,row.content)).images[0]));assert.equal(draftCard(out),draftCard(draft));assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<any>()).n,0);
  await assert.rejects(enqueueEdit(env,id,1,'tweetin sonuna #SELEC ekle görseli değiştirme'),/stale_edit/);
  await env.DB.prepare("UPDATE drafts SET delivery_state='sent' WHERE id=?").bind(id).run();await enqueueEdit(env,id,2,'tweetin sonuna #SELEC ekle görseli değiştirme');assert.equal((await env.DB.prepare('SELECT revision FROM drafts WHERE id=?').bind(id).first<any>()).revision,2);
  assert.throws(()=>validateDraft(out,[doc]),/incomplete_draft/); // Automatic generation still has its original limit.
 }finally{globalThis.fetch=original;}
});
test('unrelated/negated edits stay on existing flow and unsupported symbols cannot complete',async()=>{
 for(const request of ['tweetin sonuna #SELEC ekleme görseli değiştirme','görseli değiştir','tweeti kısalt'])assert.equal(hashtagOnlyRequest(request),null);
 const env=await fixture();await assert.rejects(enqueueEdit(env,id,1,'tweetin sonuna #THYAO ekle görseli değiştirme'),/unsupported_editor_hashtag/);assert.equal((await env.DB.prepare('SELECT revision FROM drafts WHERE id=?').bind(id).first<any>()).revision,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<any>()).n,0);
});

test('missing source identity and damaged preserved media do not report a completed edit',async()=>{
 const env=await fixture();await env.DB.prepare('UPDATE drafts SET documents=? WHERE id=?').bind(JSON.stringify([{...doc,body:'Başka bir şirket açıklaması',title:'Başka şirket'}]),id).run();
 await assert.rejects(enqueueEdit(env,id,1,'tweetin sonuna #SELEC ekle görseli değiştirme'),/unsupported_editor_hashtag/);
 assert.equal((await env.DB.prepare('SELECT revision FROM drafts WHERE id=?').bind(id).first<any>()).revision,1);
 const broken=await fixture(),put=broken.MEDIA.put.bind(broken.MEDIA);(broken.MEDIA as any).put=async(k:any,b:any,o:any)=>put(k,new Uint8Array([137,80,99]),o);
 await assert.rejects(enqueueEdit(broken,id,1,'tweetin sonuna #SELEC ekle görseli değiştirme'),/media_set_invalid|editor_image_changed/);
 assert.equal((await broken.DB.prepare('SELECT revision FROM drafts WHERE id=?').bind(id).first<any>()).revision,1);
});
test('parallel owner edits use revision CAS and a racing state change blocks the edit',async()=>{
 const env=await fixture(),request='tweetin sonuna #SELEC ekle görseli değiştirme';
 const results=await Promise.allSettled([enqueueEdit(env,id,1,request),enqueueEdit(env,id,1,request)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await env.DB.prepare('SELECT revision FROM drafts WHERE id=?').bind(id).first<any>()).revision,2);
 const racing=await fixture(),put=racing.MEDIA.put.bind(racing.MEDIA);(racing.MEDIA as any).put=async(k:any,b:any,o:any)=>{await put(k,b,o);await racing.DB.prepare("UPDATE drafts SET state='expired' WHERE id=?").bind(id).run();};
 await assert.rejects(enqueueEdit(racing,id,1,request),/stale_edit/);assert.equal((await racing.DB.prepare('SELECT revision FROM drafts WHERE id=?').bind(id).first<any>()).revision,1);
});

import {periodOnlyRequest,notifyEditFailures} from '../src/hashtag-edit';
async function periodFixture(){const env=await fixture(),d={...draft,headline:'📢 Kapanışa doğru — Selçuk Ecza açıklaması',card_headline:'Kapanışa doğru — Selçuk Ecza açıklaması'},docs=[{...doc,market_data:{kind:'institutional',broker:'Selçuk Ecza',submitted_at:1793192184,editorial_period:'Kapanışa doğru'}}];await env.DB.prepare('UPDATE drafts SET content=?,documents=?').bind(JSON.stringify(d),JSON.stringify(docs)).run();env.RENDER_REPORT=async(svg)=>new Uint8Array([137,80,78,71,...new TextEncoder().encode(svg)]);return {env,d,docs};}
test('pure period edit uses actual enqueue path without a model and preserves all facts/source data',async()=>{
 const {env,d,docs}=await periodFixture();const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('network forbidden');};try{
 await enqueueEdit(env,id,1,'Görselin ve tweetin başlığını gün sonu olarak değiştir');
 const row=await env.DB.prepare('SELECT * FROM drafts').first<any>(),out=JSON.parse(row.content);
 assert.match(out.headline,/Gün sonu/);assert.match(out.card_headline,/Gün sonu/);assert.deepEqual({...out,headline:d.headline,card_headline:d.card_headline},d);assert.equal(row.documents,JSON.stringify(docs));assert.equal(row.revision,2);assert.equal(row.delivery_state,'waiting');assert.notEqual(row.media_key,key);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<any>()).n,0);
 await assert.rejects(enqueueEdit(env,id,1,'Görselin ve tweetin başlığını gün sonu olarak değiştir'),/stale_edit/);
 }finally{globalThis.fetch=old;}
});
test('period targets preserve tweet or card bytes and reject broad/negated requests',async()=>{
 const a=await periodFixture();await enqueueEdit(a.env,id,1,'tweet başlığını gün sonu olarak değiştir');const ar=await a.env.DB.prepare('SELECT * FROM drafts').first<any>();assert.equal(JSON.parse(ar.content).card_headline,a.d.card_headline);assert.equal(await bytesHash((await readMedia(a.env,key)).images[0]),await bytesHash((await readMedia(a.env,ar.media_key,ar.content)).images[0]));
 const b=await periodFixture();await enqueueEdit(b.env,id,1,'görselin başlığını gün sonu olarak değiştir');assert.equal(JSON.parse((await b.env.DB.prepare('SELECT content FROM drafts').first<any>()).content).headline,b.d.headline);
 for(const text of ['gün sonu yazma','görselin başlığını gün sonu olarak değiştirme','görselin ve tweetin başlığını gün sonu olarak değiştir sayıları da değiştir','tweeti kısalt'])assert.equal(periodOnlyRequest(text),false);
 const bad=await periodFixture();bad.env.RENDER_REPORT=async()=>{throw Error('render_failed');};await assert.rejects(enqueueEdit(bad.env,id,1,'Görselin ve tweetin başlığını gün sonu olarak değiştir'),/render_failed/);assert.equal((await bad.env.DB.prepare('SELECT revision FROM drafts').first<any>()).revision,1);
 const race=await periodFixture();const done=await Promise.allSettled([1,2].map(()=>enqueueEdit(race.env,id,1,'Görselin ve tweetin başlığını gün sonu olarak değiştir')));assert.equal(done.filter(r=>r.status==='fulfilled').length,1);
});
test('future edit failure sends one truthful private owner notice; old jobs and uncertain sends never replay',async()=>{
 const env=await fixture();Object.assign(env,{TELEGRAM_USER_ID:'1',TELEGRAM_CHAT_ID:'2',TELEGRAM_BOT_TOKEN:'3:fake',TELEGRAM_VERIFIED_BOT_ID:'3'});
 await env.DB.prepare("INSERT INTO sources(id,config,enabled) VALUES('fixture','{}',1)").run();await env.DB.prepare("INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen,status) VALUES('a','fixture','https://example.org/a','fixture','','2026-10-28',1,'drafted')").run();
 await env.DB.prepare("INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,kind,draft_id,expected_revision,state,error) VALUES('failed','a','[]','hash',1,'edit',?,1,'needs_review','provider_timeout')").bind(id).run();
 let calls=0;const old=globalThis.fetch;globalThis.fetch=async(_url,options)=>{calls++;const body=options?.body as URLSearchParams;assert.equal(body.get('chat_id'),'2');assert.match(body.get('text')!,/yanıt süresi doldu/);return Response.json({ok:true,result:{message_id:123}});};try{
 await notifyEditFailures(env);assert.equal(calls,0);
 await env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?)').bind('edit_notice:failed',JSON.stringify({state:'pending',owner:'1',chat:'2'})).run();
 await Promise.all([refreshNewsRequests(env),refreshNewsRequests(env)]);assert.equal(calls,1);await notifyEditFailures(env);assert.equal(calls,1);
 await env.DB.prepare('UPDATE system_state SET value=? WHERE key=?').bind(JSON.stringify({state:'pending',owner:'wrong',chat:'2'}),'edit_notice:failed').run();await notifyEditFailures(env);assert.equal(calls,1);
 await env.DB.prepare('UPDATE system_state SET value=? WHERE key=?').bind(JSON.stringify({state:'pending',owner:'1',chat:'2'}),'edit_notice:failed').run();globalThis.fetch=async()=>{calls++;throw Error('unknown_send');};await notifyEditFailures(env);await notifyEditFailures(env);assert.equal(calls,2);assert.equal(JSON.parse((await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind('edit_notice:failed').first<any>()).value).state,'uncertain');
 }finally{globalThis.fetch=old;}
});

import {withOverviewEvidence} from '../src/market-overview';import {repairDraftStyle} from '../src/style';
test('exact BIST100 screenshot heading request edits cached overview without source refetch or model',async()=>{
 const fixtureData=JSON.parse(await readFile('test/fixtures/market-overview-26431.json','utf8')),docs=withOverviewEvidence([fixtureData.document]);
 const raw={headline:'📊 Gün ortası — BIST 100 görünümü',body:'Kaynak tablosunda endeks seviyesi 11.004,37 puan.',card_headline:'Gün ortası — BIST 100 görünümü',card_body:'Görselde işlem hacmi 49,7 milyar TL.',template:'market',category:'bist',hashtags:['#Borsa','#BIST'],importance:65,entities:['BIST 100'],event_key:'fixture-market-overview',claims:[],uncertainties:[],source_notes:['Kaynak veri tarihi ayrıca teyit edilmedi.']} as Draft;
 const before=repairDraftStyle(raw,docs),env=await fixture();await env.DB.prepare('UPDATE drafts SET content=?,documents=?').bind(JSON.stringify(before),JSON.stringify(docs)).run();let svg='';env.RENDER_REPORT=async(s)=>{svg=s;return new Uint8Array([137,80,78,71,...new TextEncoder().encode(s)]);};
 const fetcher=globalThis.fetch;globalThis.fetch=async()=>{throw Error('no source/model calls');};try{await enqueueEdit(env,id,1,'başlığı gün sonu yap');}finally{globalThis.fetch=fetcher;}
 const row=await env.DB.prepare('SELECT content,documents,revision FROM drafts').first<any>(),after=JSON.parse(row.content);
 assert.match(after.headline,/Gün sonu/);assert.equal(after.card_headline,'Gün sonu');assert(svg.includes('Gün sonu'));assert.deepEqual({...after,headline:before.headline,card_headline:before.card_headline},before);assert.equal(row.documents,JSON.stringify(docs));assert.equal(row.revision,2);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<any>()).n,0);
});
