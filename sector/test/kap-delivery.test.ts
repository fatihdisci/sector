import {withKapTableEvidence} from '../src/kap-table-evidence';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {KapStore,CIRCUIT_WINDOW_MS} from '../src/kap/store';
import {KapDelivery} from '../src/kap-delivery';
import {parseDisclosure,fullText} from '../src/kap/parser';
import {completeKapDocuments} from '../src/kap-evidence';
import {localDatabase} from '../src/local-adapters';
import {pdfBytes} from '../src/pdf-transport';
import {enqueueEvidence} from '../src/ingest';
import {queueManual} from '../src/manual';
import type {Env,Document} from '../src/types';
const NOW=Date.now();
function page(summary='Açıklama',count=0){const date=new Date(NOW+3*3600_000).toISOString().replace(/-/g,'.').replace('T',' ').slice(0,19);
 const basic={disclosureIndex:101,title:'Payların Geri Alınmasına İlişkin Bildirim',companyTitle:'KAPEKS KİMYA A.Ş.',stockCode:'KPEKS',relatedStocks:null,disclosureClass:'ODA',disclosureType:'ODA',disclosureCategory:'ODA',publishDate:date,disclosureId:'a'.repeat(32),relatedDisclosureOid:null,isChanged:null,summary,attachmentCount:count};
 return `<script>self.__next_f.push(${JSON.stringify([1,JSON.stringify({disclosureBasic:basic})])})</script><div class="disclosureScrollableArea"><p>Tam metin işlem hakkında bilgi verir.</p><table><tr><td>İşlem Tarihi</td><td>20.10.2026</td></tr></table></div>`;
}
async function setup(){const s=new KapStore(':memory:');const l=s.claim('discovery',NOW)!;s.discover([{id:100,publishedAt:new Date(NOW-5000).toISOString()}],l,NOW-2000);
 const d=parseDisclosure(page(),101);s.save(d,s.claim('live',NOW)!,NOW,true);
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));const env={DB,MODE:'telegram_review',AI_DAILY_DRAFT_LIMIT:'240',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'42'} as Env;
 const docs=await completeKapDocuments(fullText(page(),101),async()=>{throw Error('no attachment');});return {s,env,docs};}
test('KAP enqueues complete evidence idempotently, never marks model preparation as delivered',async()=>{
 const {s,env,docs}=await setup();try{let reads=0;const c=new KapDelivery(s,env,async()=>{reads++;return docs;},()=>NOW);
 assert.equal((await c.run()).state,'model_queued');await c.run();assert.equal(reads,1);
 assert.equal(s.row<{state:string}>('SELECT state FROM queue')!.state,'model_queued');assert.equal(s.row<{sent_at:number|null}>('SELECT sent_at FROM queue')!.sent_at,null);
 const job=await env.DB.prepare('SELECT id,documents FROM model_jobs').first<{id:string;documents:string}>();assert(job);assert(JSON.parse(job.documents)[0].body.includes('20.10.2026'));
 assert.equal(await enqueueEvidence(env,docs,'kap'),job.id);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<{n:number}>())!.n,1);
 }finally{s.close();}
});
test('KAP missing or unreadable PDF never enters the model or sends a metadata-only fallback',async()=>{
 const p=fullText(page('Özet',1),101);await assert.rejects(()=>completeKapDocuments(p,async()=>{throw Error('unreadable');}),/attachments_incomplete/);
 const withLink={...p,attachmentStatus:'links_available',attachments:[{url:'https://www.kap.org.tr/tr/api/file/download/'+'a'.repeat(32),label:'ek.pdf',contentStatus:'not_fetched' as const}]};
 await assert.rejects(()=>completeKapDocuments(withLink,async()=>{throw Error('pdf_page_unreadable');}),/pdf_page_unreadable/);
 const {s,env}=await setup();try{const c=new KapDelivery(s,env,async()=>{throw Error('pdf_page_unreadable');},()=>NOW);assert.equal((await c.run()).state,'evidence_failed');assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<{n:number}>())!.n,0);assert.equal(s.row<{sent_at:number|null}>('SELECT sent_at FROM queue')!.sent_at,null);}finally{s.close();}
});
test('all KAP PDFs retain every page and visual evidence, while spans preserve table column meaning',async()=>{
 const html=page().replace('</div>','<table><tr><th rowspan="2">İşlem</th><th colspan="2">Tutar</th></tr><tr><td>Alım</td><td>Satım</td></tr><tr><td>20.10.2026</td><td>100</td><td>0</td></tr></table></div>');
 const p=fullText(html,101);assert.deepEqual(p.tables[1][1],['İşlem','Alım','Satım']);
 const docs=await completeKapDocuments({...p,expectedAttachments:1,attachments:[{url:'https://www.kap.org.tr/tr/api/file/download/'+'a'.repeat(32),label:'ek.pdf',contentStatus:'not_fetched'}]},async()=>({body:'Bütün sayfalar',passages:[{id:'page1',text:'İşlem 20.10.2026'}],images:['source/page.png'],coverage:{complete:true,page_count:1,pages:[{page:1}]}}));
 assert.equal(docs.length,2);assert.equal(docs[1].images?.length,1);assert.equal(docs[1].coverage?.complete,true);
});
test('KAP preference recheck excludes breakers before expensive reading; no notifications in dry run',async()=>{
 const {s,env}=await setup();try{const row=s.row<{metadata:string}>('SELECT metadata FROM disclosures')!;const d=JSON.parse(row.metadata);d.summary='Devre Kesici';s.run('UPDATE disclosures SET metadata=?',JSON.stringify(d));let reads=0;
 const c=new KapDelivery(s,env,async()=>{reads++;return [];},()=>NOW);assert.equal((await c.run()).state,'idle');assert.equal(reads,0);assert.equal(s.row<{state:string}>('SELECT state FROM queue')!.state,'suppressed');
 assert.equal((await new KapDelivery(s,{...env,MODE:'dry_run'},async()=>[],()=>NOW).run()).state,'disabled');
 }finally{s.close();}
});
test('ticker scope is rechecked at the final Telegram send boundary',async()=>{
 const {s,env,docs}=await setup();try{
  const c=new KapDelivery(s,env,async()=>docs,()=>NOW),meta=JSON.parse(s.row<{metadata:string}>('SELECT metadata FROM disclosures')!.metadata);
  meta.subjectCodes=['TEST'];meta.relatedCodes=['TEST'];meta.issuerCode='TEST';s.run('UPDATE disclosures SET metadata=?',JSON.stringify(meta));
  assert.equal(c.deliveryDecision(docs),'suppress');assert.equal(s.row<{state:string}>('SELECT state FROM queue')!.state,'suppressed');
  assert.equal(s.row<{n:number}>('SELECT COUNT(*) n FROM disclosures')!.n,1);assert.equal(s.row<{n:number}>('SELECT COUNT(*) n FROM feed')!.n,1);
 }finally{s.close();}
});
test('KAP PDF transport accepts exact serialized byte arrays, never arbitrary prefixes or corrupt lengths',()=>{
 const pdf=new TextEncoder().encode('%PDF-1.7 test');assert.deepEqual(pdfBytes(pdf),pdf);
 const h=Buffer.from('aced0005757200025b42acf317f8060854e00200007870','hex'),len=Buffer.alloc(4);len.writeUInt32BE(pdf.length);const bytes=Buffer.concat([h,len,pdf]);assert.deepEqual([...pdfBytes(bytes)],[...pdf]);
 bytes[26]++;assert.throws(()=>pdfBytes(bytes),/length/);assert.throws(()=>pdfBytes(new TextEncoder().encode('junk %PDF-1.7')),/invalid/);
});
test('manual intake requires owner and private chat; same Telegram update queues only once',async()=>{
 const {s,env}=await setup();try{const m={message_id:3,from:{id:7},chat:{id:42,type:'private'},text:'https://www.cnbce.com/test'};
 assert.equal(await queueManual(env,10,{...m,from:{id:8}}),false);assert.equal(await queueManual(env,10,{...m,chat:{id:42,type:'group'}}),false);
 assert.equal(await queueManual(env,10,m),true);assert.equal(await queueManual(env,10,m),true);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM manual_requests').first<{n:number}>())!.n,1);
 assert.equal(await queueManual(env,11,{...m,text:undefined,document:{file_id:'safe',file_name:'bildirim.pdf'}}),true);
 }finally{s.close();}
});

test('focused preferences suppress existing routine queue entries without deleting source records',async()=>{
 const {s}=await setup();try{
  const row=s.row<{metadata:string}>('SELECT metadata FROM disclosures')!;
  const d=JSON.parse(row.metadata);d.title='Özel Durum Açıklaması (Genel)';d.summary='Yönetim Kurulu Üye Değişikliği';
  s.run('UPDATE disclosures SET metadata=?',JSON.stringify(d));
  s.configure({...s.prefs(),priorityIndices:false,otherCompanies:'topics',otherTopics:['business','financial','buyback','share_trade','dividend','capital']});
  assert.equal(s.row<{state:string}>('SELECT state FROM queue')!.state,'suppressed');
  assert.equal(s.rows('SELECT * FROM disclosures').length,1);assert.equal(s.rows('SELECT * FROM feed').length,1);
 }finally{s.close();}
});

test('KAP table units stay scoped to their exact column and row',()=>{
 const doc={source_id:'kap',official:true,body:'Original',passages:[{id:'table5',text:JSON.stringify([['İşlem Tarihi |','İşlem Fiyatı (TL/Adet) |','Sermayeye Oranı (%) |','Pay Miktarı |'],['21.10.2026 |','104,233 |','0,04412 |','75.000 |']])}]} as Document;
 const out=withKapTableEvidence([doc])[0],row=out.passages.find(p=>p.id==='table5row1')!;
 assert.match(row.text,/İşlem Fiyatı \(TL\/Adet\): 104,233 TL/);
 assert.match(row.text,/Sermayeye Oranı \(%\): %0,04412/);
 assert.match(row.text,/Pay Miktarı: 75.000$/);
 assert(!row.text.includes('21.10.2026 TL'));
 assert.deepEqual(withKapTableEvidence([out]),[out]);assert.equal(out.passages[0].text,doc.passages[0].text);
});

import {recordModelReview,retryKapModel} from '../src/model-recovery';
test('KAP review failures retry with delay and bounded budget; exhausted review stays visible',async()=>{
 const {s,env,docs}=await setup();let ms=NOW;const consumer=new KapDelivery(s,env,async()=>docs,()=>ms);
 try{
  await consumer.run();const job=(await env.DB.prepare('SELECT id FROM model_jobs').first<{id:string}>())!;const seconds=Math.floor(NOW/1000);
  const fail=async()=>{await env.DB.prepare("UPDATE model_jobs SET state='needs_review',error='semantic_review_failed' WHERE id=?").bind(job.id).run();await recordModelReview(env,job.id,{supported:false,issues:['Wrong passage reference']},Math.floor(ms/1000));};
  await fail();assert.equal((await consumer.run()).state,'needs_review');
  ms=NOW+31_000;assert.equal((await consumer.run()).state,'model_retry_queued');
  assert.equal(await retryKapModel(env,job.id,seconds+32),false);
  await fail();ms=NOW+60_000;assert.equal((await consumer.run()).state,'needs_review');
  ms=NOW+332_000;assert.equal((await consumer.run()).state,'model_retry_queued');
  await fail();ms=NOW+700_000;assert.equal((await consumer.run()).state,'needs_review');
  const review=await env.DB.prepare('SELECT retries,issues FROM model_reviews WHERE job_id=?').bind(job.id).first<{retries:number;issues:string}>();
  assert.equal(review!.retries,2);assert.match(review!.issues,/Wrong passage/);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<{n:number}>())!.n,1);
  assert.equal(s.row<{sent_at:number|null}>('SELECT sent_at FROM queue')!.sent_at,null);
 }finally{s.close();}
});
test('recovery never replays completed/uncertain delivery, incomplete evidence or old jobs',async()=>{
 const {s,env,docs}=await setup();try{
  const id=await enqueueEvidence(env,docs,'kap'),sec=Math.floor(NOW/1000);
  for(const values of [
   {error:'semantic_review_failed',result:'existing',input:JSON.stringify(docs),created:sec},
   {error:'telegram_timeout',result:null,input:JSON.stringify(docs),created:sec},
   {error:'semantic_review_failed',result:null,input:'[]',created:sec},
   {error:'semantic_review_failed',result:null,input:JSON.stringify(docs),created:sec-86401}
  ]){
   await env.DB.prepare("UPDATE model_jobs SET state='needs_review',error=?,result_draft=?,documents=?,created_at=? WHERE id=?").bind(values.error,values.result,values.input,values.created,id).run();
   assert.equal(await retryKapModel(env,id,sec),false);
  }
 }finally{s.close();}
});
test('KAP reconciliation recognizes a delivered draft even after queue entered review',async()=>{
 const {s,env,docs}=await setup();try{
  const c=new KapDelivery(s,env,async()=>docs,()=>NOW);await c.run();
  await env.DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,state,created_at,expires_at,delivery_state,delivered_at,message_id) VALUES('receipt','event','fp','{}','[]','official','pending',0,9999999999,'sent',100,123)").run();
  await env.DB.prepare("UPDATE model_jobs SET state='complete',result_draft='receipt',documents='[]'").run();s.run("UPDATE queue SET state='needs_review'");
  await c.run();assert.equal(s.row<{state:string}>('SELECT state FROM queue')!.state,'sent');assert.equal(s.row<{message_id:number}>('SELECT message_id FROM kap_model_jobs')!.message_id,123);
 }finally{s.close();}
});
import {deliver} from '../src/pipeline';
test('closing a KAP topic while AI runs blocks the final photo, retains the evidence and never replays on re-enable',async()=>{
 const {s,env,docs}=await setup(),old=globalThis.fetch;let sends=0;
 try{
  // Business topic: the established share-transaction override is unchanged.
  const metadata=JSON.parse(s.row<{metadata:string}>('SELECT metadata FROM disclosures')!.metadata);metadata.title='Yeni İş İlişkisi';metadata.summary='Yeni sözleşme';s.run('UPDATE disclosures SET metadata=?',JSON.stringify(metadata));
  const consumer=new KapDelivery(s,env,async()=>docs,()=>NOW);await consumer.run();
  await env.DB.prepare("UPDATE model_jobs SET state='leased'").run();
  s.configure({...s.prefs(),priorityIndices:false,otherCompanies:'off'});
  const sec=Math.floor(NOW/1000);
  await env.DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,created_at,expires_at,media_key) VALUES('closed','e','f',?,?,'official',?,?,'card.png')").bind(JSON.stringify({headline:'📢 Yeni iş',body:'Sözleşme açıklandı.',hashtags:['#Borsa','#BIST']}),JSON.stringify(docs),sec,sec+3600).run();
  await env.DB.prepare("UPDATE model_jobs SET state='complete',result_draft='closed'").run();
  Object.assign(env,{TELEGRAM_BOT_TOKEN:'123:test',TELEGRAM_VERIFIED_BOT_ID:'123',MEDIA:{get:async()=>({arrayBuffer:async()=>new Uint8Array([1]).buffer})},KAP_DELIVERY_CHECK:(documents:Document[])=>consumer.deliveryDecision(documents)});
  globalThis.fetch=async()=>{sends++;return Response.json({ok:true,result:{message_id:88}});};
  await deliver(env);assert.equal(sends,0);assert.equal((await env.DB.prepare("SELECT delivery_state FROM drafts WHERE id='closed'").first<any>()).delivery_state,'suppressed');
  s.configure({...s.prefs(),otherCompanies:'important'});await consumer.run();await deliver(env);assert.equal(sends,0);assert.equal(s.rows('SELECT * FROM disclosures').length,1);assert.equal(s.rows('SELECT * FROM feed').length,1);
 }finally{s.close();globalThis.fetch=old;}
});
test('KAP preference changes during source reading remain suppressed after re-enabling',async()=>{
 const {s,env,docs}=await setup();try{
  const d=JSON.parse(s.row<{metadata:string}>('SELECT metadata FROM disclosures')!.metadata);d.title='Yeni İş İlişkisi';s.run('UPDATE disclosures SET metadata=?',JSON.stringify(d));
  const consumer=new KapDelivery(s,env,async()=>{
   s.configure({...s.prefs(),priorityIndices:false,otherCompanies:'off'});
   s.configure({...s.prefs(),otherCompanies:'important'});return docs;
  },()=>NOW);
  assert.equal((await consumer.run()).state,'suppressed');assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<any>()).n,0);
 }finally{s.close();}
});

import {leaseJob,submitJob} from '../src/bridge';
import {draftCard} from '../src/card';
import {png} from '../scripts/render_local';
import {sha256} from '../src/utils/text';
import type {Draft} from '../src/types';
test('frozen circuit group reads all official members and delivers one branded photo with source button',async()=>{
 const {s,env}=await setup();const images=new Map<string,Uint8Array>();Object.assign(env,{AI_MODEL:'gpt-6.1-terra',AI_EFFORT:'low',TELEGRAM_BOT_TOKEN:'123:test',TELEGRAM_VERIFIED_BOT_ID:'123',MEDIA:{put:async(k:string,b:Uint8Array)=>images.set(k,b),get:async(k:string)=>images.has(k)?{arrayBuffer:async()=>images.get(k)!.buffer}:null}});
 const previous=globalThis.fetch;let photos=0;const reads:number[]=[];
 globalThis.fetch=async(url,options)=>{assert.match(String(url),/^https:\/\/api\.telegram\.org\//);if(String(url).endsWith('/sendPhoto')){photos++;const form=options!.body as FormData;assert.match(String(form.get('caption')),/KTLEV.*ASTOR/);const buttons=JSON.parse(String(form.get('reply_markup')));assert(buttons.inline_keyboard.flat().some((b:any)=>b.text==='Diğer'));}return Response.json({ok:true,result:{message_id:99}});};
 try{
  s.run("UPDATE queue SET state='suppressed'");s.configure({...s.prefs(),circuitNotifications:true},NOW);
  const l=s.claim('reconcile',NOW)!;const base=JSON.parse(s.row<{metadata:string}>('SELECT metadata FROM disclosures')!.metadata);
  for(const [id,code] of [[102,'KTLEV'],[103,'ASTOR']] as const)s.save({...base,id,sourceRef:'kap:'+id,url:'https://www.kap.org.tr/tr/Bildirim/'+id,title:'Devre Kesici Uygulaması',publishedAt:new Date(NOW+1000).toISOString(),subjectCodes:[code],relatedCodes:[code]},l,NOW+1000,false);
  const end=(Math.floor((NOW+1000)/CIRCUIT_WINDOW_MS)+1)*CIRCUIT_WINDOW_MS; s.freeze(s.claim('groups',end)!,end);
  const consumer=new KapDelivery(s,env,async id=>{reads.push(id);const code=id===102?'KTLEV':'ASTOR',text=code+' payında tek fiyat emir toplama işlemi başlamıştır.';return [{source_id:'kap',source_name:'KAP',family:'kap',official:true,url:'https://www.kap.org.tr/tr/Bildirim/'+id,title:code+' — Devre Kesici Uygulaması',body:text,published_at:new Date(NOW).toISOString(),equity_codes:[code],passages:[{id:'p1',text}]}];},()=>end+1000);
  assert.equal((await consumer.run()).state,'model_queued');await consumer.run();assert.deepEqual(reads,[102,103]);
  env.KAP_DELIVERY_CHECK=docs=>consumer.deliveryDecision(docs);
  const job=(await leaseJob(env))!,documents=job.documents as Document[];assert.equal(documents.length,2);
  const draft:Draft={card_data:{tickers:['KTLEV','ASTOR']},headline:'📢 KTLEV ve ASTOR paylarında devre kesici uygulandı',body:'Her iki payda tek fiyat emir toplama işlemi başladı.',card_headline:'KTLEV ve ASTOR paylarında devre kesici',card_body:'Tek fiyat emir toplama işlemi başladı.',hashtags:['#Borsa','#BIST','#DevreKesici'],category:'bist',importance:94,template:'circuit',entities:['KTLEV','ASTOR'],event_key:'circuit-ktlev-astor',uncertainties:[],claims:documents.map((d,i)=>({text:d.body,evidence:[{document:i,passage:'p1',quote:d.body}]}))};
  const svg=draftCard(draft,[],'',false,job.card_theme,job.card_layout);assert.match(svg,/ENDEKS HABER/);assert.match(svg,/DEVRE KESİCİ/);
  await submitJob(env,{id:job.id,lease_token:job.lease_token,input_hash:job.input_hash,draft,audit:{supported:true,issues:[]},runtime:{model:'gpt-6.1-terra',effort:'low',provider:'openai-codex',tool_count:0,fallback_count:0},card_date:'',svg_hash:await sha256(svg),png_base64:Buffer.from(await png(svg)).toString('base64')});
  await deliver(env);await deliver(env);assert.equal(photos,1);
  await consumer.run();assert.equal(s.row<{state:string}>("SELECT state FROM queue WHERE kind='circuit'")!.state,'sent');
 }finally{globalThis.fetch=previous;s.close();}
});
test('circuit preference off during reading prevents the group from entering AI',async()=>{
 const {s,env}=await setup();try{s.run("UPDATE queue SET kind='circuit',payload='{}'");s.configure({...s.prefs(),circuitNotifications:true},NOW);s.run("UPDATE disclosures SET metadata=json_set(metadata,'$.title','Devre Kesici Uygulaması')");
  const c=new KapDelivery(s,env,async()=>{s.configure({...s.prefs(),circuitNotifications:false},NOW+1);return [];},()=>NOW+1);
  assert.equal((await c.run()).state,'suppressed');assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<{n:number}>())!.n,0);
 }finally{s.close();}
});

test('MKK settlement is suppressed before reading and at final delivery without deleting history',async()=>{
 for(const final of [false,true]){
  const {s,env,docs}=await setup();try{
   const d=JSON.parse(s.row<{metadata:string}>('SELECT metadata FROM disclosures')!.metadata);
   d.company='MERKEZİ KAYIT KURULUŞU A.Ş.';
   d.title='Borçlanma Araçları, Yatırım Fonları ve Varant İtfa/Kupon/Getiri/Nakdi Uzlaşı Ödeme İşlemleri / AKMEN';
   s.run('UPDATE disclosures SET metadata=?',JSON.stringify(d));let reads=0;
   const c=new KapDelivery(s,env,async()=>{reads++;return docs;},()=>NOW);
   if(final)assert.equal(c.deliveryDecision(docs),'suppress');else await c.run();
   assert.equal(reads,0);assert.equal(s.row<{state:string}>('SELECT state FROM queue')!.state,'suppressed');
   assert.equal(s.row<{n:number}>('SELECT count(*) n FROM disclosures')!.n,1);
  }finally{s.close();}
 }
});
test('KAP model evidence carries verified per-subject membership from the official index snapshot',async()=>{
 const {s,env,docs}=await setup();try{
  const pool=Array.from({length:99},(_,i)=>'A'+String(i).padStart(4,'0'));
  s.set('indices',{bist30:['KPEKS',...pool.slice(0,29)],bist100:['KPEKS',...pool],checkedAt:new Date(NOW).toISOString(),source:'https://www.kap.org.tr/tr/Endeksler'});
  assert.equal((await new KapDelivery(s,env,async()=>docs,()=>NOW).run()).state,'model_queued');
  const job=await env.DB.prepare('SELECT documents FROM model_jobs').first<{documents:string}>();const loaded=JSON.parse(job!.documents) as Document[];
  assert.deepEqual(loaded[0].index_membership?.bist30,['KPEKS']);assert.deepEqual(loaded[0].index_membership?.bist100,['KPEKS']);
 }finally{s.close();}
});
