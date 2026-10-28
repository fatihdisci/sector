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
