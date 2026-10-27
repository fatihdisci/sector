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
async function setup(){const s=new KapStore(':memory:');const codes=['KPEKS','KTLEV','ASTOR',...Array.from({length:97},(_,i)=>'T'+String(i).padStart(3,'0'))];s.set('indices',{bist30:codes.slice(0,30),bist100:codes,checkedAt:new Date(NOW).toISOString(),source:'https://www.kap.org.tr/tr/Endeksler',sourceSha256:'a'.repeat(64)});const l=s.claim('discovery',NOW)!;s.discover([{id:100,publishedAt:new Date(NOW-5000).toISOString()}],l,NOW-2000);
 const d=parseDisclosure(page(),101);s.save(d,s.claim('live',NOW)!,NOW,true);
 const DB=await localDatabase(':memory:',(await readFile('migrations/0001_sector.sql','utf8'))+'\n'+(await readFile('migrations/0008_kap_previews.sql','utf8')));const env={DB,MODE:'telegram_review',AI_DAILY_DRAFT_LIMIT:'240',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'42'} as Env;
 const docs=await completeKapDocuments(fullText(page(),101),async()=>{throw Error('no attachment');});return {s,env,docs};}
import worker from '../src/worker';
test('activation preserves unrelated old queue rows and continues legacy processing',async()=>{
 const {s,env}=await setup();try{
  for(const [i,state] of ['ready','preparing','model_queued','sent'].entries())s.run('INSERT INTO queue(id,source_ref,kind,state,created_at,available_at,payload) VALUES(?,?,?,?,?,?,?)','old'+i,'old'+i,'instant',state,NOW-1,NOW-1,'{}');
  const before=s.rows("SELECT * FROM queue WHERE id LIKE 'old%' ORDER BY id");
  let reads=0;const c=new KapDelivery(s,env,async()=>{reads++;throw Error('fixture_unreadable');},()=>NOW+10);
  assert.equal((await c.run()).state,'evidence_failed');assert.equal(reads,1);assert.deepEqual(s.rows("SELECT * FROM queue WHERE id LIKE 'old%' ORDER BY id"),before);
  assert.equal(s.get('selection_activation'),NOW+10);
 }finally{s.close();}
});
test('preview requires owner and message before single job',async()=>{
 const {s,env,docs}=await setup();let now=NOW+10;const original=globalThis.fetch;let reads=0;
 Object.assign(env,{TELEGRAM_BOT_TOKEN:'9:test',TELEGRAM_VERIFIED_BOT_ID:'9',TELEGRAM_WEBHOOK_SECRET:'secret'});
 globalThis.fetch=async(_input,init)=>{const body=init?.body as URLSearchParams;return Response.json({ok:true,result:body?.get('text')?.includes('Hazırlama')?{}:{message_id:321}})};
 try{
  s.set('selection_activation',NOW-1);
  const c=new KapDelivery(s,env,async()=>{reads++;return docs},()=>now);
  assert.equal((await c.run()).state,'awaiting_selection');assert.equal(reads,0);
  const p=await env.DB.prepare('SELECT * FROM kap_previews').first<{id:string;state:string}>();assert.equal(p!.state,'sent');
  const callback=async(actor:number,message:number,update:number)=>worker.fetch(new Request('https://local.sector/telegram/webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':'secret','Content-Type':'application/json'},body:JSON.stringify({update_id:update,callback_query:{id:String(update),data:'kap:prepare:'+p!.id,from:{id:actor},message:{message_id:message,chat:{id:42,type:'private'}}}})}),env,{waitUntil(){}} as unknown as ExecutionContext);
  await callback(8,321,1);await callback(7,322,2);
  assert.equal((await env.DB.prepare('SELECT state FROM kap_previews').first<{state:string}>())!.state,'sent');
  await Promise.all([callback(7,321,3),callback(7,321,4)]);
  now+=6000;assert.equal((await c.run()).state,'model_queued');assert.equal(reads,1);
  await env.DB.prepare("UPDATE kap_previews SET state='cancelled' WHERE id=?").bind(p!.id).run();
  await callback(7,321,5);await c.run();assert.equal((await env.DB.prepare('SELECT state FROM kap_previews WHERE id=?').bind(p!.id).first<{state:string}>())!.state,'cancelled');assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<{n:number}>())!.n,1);
 }finally{globalThis.fetch=original;s.close();}
});
test('more than 100 waiting previews do not starve a newer candidate',async()=>{
 const {s,env}=await setup();const original=globalThis.fetch;let sends=0,reads=0;Object.assign(env,{TELEGRAM_BOT_TOKEN:'9:test',TELEGRAM_VERIFIED_BOT_ID:'9'});
 globalThis.fetch=async()=>{sends++;return Response.json({ok:true,result:{message_id:1000+sends}})};
 try{
  s.set('selection_activation',NOW-10);
  const source=s.row<{metadata:string;decision:string}>('SELECT metadata,decision FROM disclosures WHERE id=101')!;
  for(let i=0;i<105;i++){
   const id=1000+i,key='waiting-'+i,d=JSON.parse(source.metadata);d.id=id;d.url='https://www.kap.org.tr/tr/Bildirim/'+id;d.sourceRef=key;
   s.run('INSERT INTO disclosures(id,source_ref,correction,published_at,first_seen,metadata,decision,silent) VALUES(?,?,0,?,?,?,?,0)',id,key,d.publishedAt,NOW,JSON.stringify(d),source.decision);
   s.run("INSERT INTO queue(id,source_ref,kind,state,created_at,available_at,payload) VALUES(?,?,'instant','ready',?,?, '{}')",key,key,NOW,NOW-1);
   s.run('INSERT INTO queue_members(disclosure_id,queue_id) VALUES(?,?)',id,key);
   await env.DB.prepare("INSERT INTO kap_previews(queue_id,id,state,message_id) VALUES(?,?,'sent',?)").bind(key,crypto.randomUUID(),i+1).run();
  }
  const c=new KapDelivery(s,env,async()=>{reads++;throw Error('unexpected_read')},()=>NOW+10);
  for(let i=0;i<106&&sends===0;i++)await c.run();
  assert.equal(sends,1);assert.equal(reads,0);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM kap_previews').first<{n:number}>())!.n,106);
 }finally{globalThis.fetch=original;s.close();}
});
test('ambiguous preview send is not sent again',async()=>{
 const {s,env}=await setup();const original=globalThis.fetch;let sends=0,reads=0,now=NOW+10;Object.assign(env,{TELEGRAM_BOT_TOKEN:'9:test',TELEGRAM_VERIFIED_BOT_ID:'9'});
 globalThis.fetch=async()=>{sends++;throw Error('timeout_after_possible_acceptance')};
 try{
  s.set('selection_activation',NOW-1);
  const c=new KapDelivery(s,env,async()=>{reads++;throw Error('unexpected_read')},()=>now);
  assert.equal((await c.run()).state,'needs_review');
  assert.equal((await env.DB.prepare('SELECT state FROM kap_previews').first<{state:string}>())!.state,'uncertain');
  now+=6000;assert.equal((await c.run()).state,'needs_review');assert.equal(sends,1);assert.equal(reads,0);
 }finally{globalThis.fetch=original;s.close();}
});

test('KAP persistence failure after main job does not create another job on retry',async()=>{
 const {s,env,docs}=await setup();const original=globalThis.fetch;let now=NOW+10;
 Object.assign(env,{TELEGRAM_BOT_TOKEN:'9:test',TELEGRAM_VERIFIED_BOT_ID:'9'});
 globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:321}});
 try{
  s.set('selection_activation',NOW-1);
  const c=new KapDelivery(s,env,async()=>docs,()=>now);
  assert.equal((await c.run()).state,'awaiting_selection');
  await env.DB.prepare("UPDATE kap_previews SET state='selected' WHERE message_id=321").run();
  const originalRun=s.run.bind(s);let fail=true;
  s.run=((sql:string,...values:Parameters<typeof s.run> extends [string,...infer Rest] ? Rest : never)=>{
   if(fail&&sql.startsWith('UPDATE kap_model_jobs SET job_id=')){fail=false;throw Error('simulated_crash');}
   return originalRun(sql,...values);
  }) as typeof s.run;
  now+=6000;assert.equal((await c.run()).state,'evidence_failed');
  const before=await env.DB.prepare('SELECT id FROM model_jobs').first<{id:string}>();assert(before);
  assert.equal(s.row<{job_id:string|null}>('SELECT job_id FROM kap_model_jobs')!.job_id,null);
  now+=121000;assert.equal((await c.run()).state,'model_queued');
  assert.equal(s.row<{job_id:string}>('SELECT job_id FROM kap_model_jobs')!.job_id,before.id);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<{n:number}>())!.n,1);
 }finally{globalThis.fetch=original;s.close();}
});
