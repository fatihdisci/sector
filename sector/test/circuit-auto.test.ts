import {test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{localDatabase}from'../src/local-adapters';import{pollCircuitAuto,circuitPollDelay,CIRCUIT_POLL_MS}from'../src/circuit-auto';import{report}from'../src/kap/reports';import{deliver}from'../src/pipeline';import type{Disclosure,Indices}from'../src/kap/parser';import type{Env}from'../src/types';import{postText}from'../src/editorial';
const at=Date.parse('2026-10-27T11:00:00+03:00');
function disclosure(id:number,ticker:string):Disclosure{return{id,sourceRef:String(id),url:'https://www.kap.org.tr/tr/Bildirim/'+id,title:'Pay Bazında Devre Kesici Bildirimi',summary:'Devre kesici uygulaması',company:'BORSA İSTANBUL A.Ş.',subjectCodes:[ticker],relatedCodes:[],issuerCode:null,issuerRaw:null,disclosureClass:'',disclosureType:'',category:'',fundType:null,isFund:false,oid:null,relatedOid:null,changeStatus:null,isCorrection:false,publishedAt:new Date(at).toISOString(),attachmentCount:0};}
async function setup(){const db=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));const map=new Map<string,Uint8Array>(),png=await readFile('assets/visual-templates/bc-v1/01-yatay-takas.png');let scans=0,renders=0,records:Disclosure[]=[];const indices:Indices={bist30:Array.from({length:30},(_,i)=>'A'+String(i).padStart(3,'0')),bist100:Array.from({length:100},(_,i)=>'A'+String(i).padStart(3,'0')),checkedAt:new Date(at).toISOString(),source:'https://www.kap.org.tr/tr/Endeksler'};
 const env={DB:db,MEDIA:{get:async(k:string)=>map.has(k)?{arrayBuffer:async()=>map.get(k)!.slice().buffer}:null,put:async(k:string,v:Uint8Array)=>map.set(k,v),delete:async(k:string)=>map.delete(k)},MODE:'telegram_review',CIRCUIT_AUTO_ENABLED:'true',BOT_WORKFLOW_MODE:'news_only',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'42',TELEGRAM_BOT_TOKEN:'123:fixture',TELEGRAM_VERIFIED_BOT_ID:'123',X_PUBLISH_ENABLED:'true',KAP_REPORT:async(_kind:string,when:number)=>{scans++;return report('circuit',records.map(disclosure=>({disclosure})),indices,when,'Fixture coverage');},RENDER_REPORT:async()=>{renders++;return png;}}as unknown as Env;
 return{env,set:(v:Disclosure[])=>{records=v;},counts:()=>({scans,renders})};}
test('120-second gate, holiday/half-day/weekend and unknown-calendar checks make no source call',async()=>{
 const c=await setup();assert.equal(CIRCUIT_POLL_MS,120000);
 for(const date of ['2026-10-29T11:00:00+03:00','2026-10-28T13:00:00+03:00','2026-10-31T11:00:00+03:00','2027-01-05T11:00:00+03:00','2026-10-27T20:00:00+03:00'])assert.equal((await pollCircuitAuto(c.env,Date.parse(date))).state,'closed');
 assert.deepEqual(c.counts(),{scans:0,renders:0});assert.equal((await pollCircuitAuto(c.env,at)).state,'empty');assert.equal((await pollCircuitAuto(c.env,at+119999)).state,'waiting');assert.equal((await pollCircuitAuto(c.env,at+120000)).state,'empty');assert.deepEqual(c.counts(),{scans:2,renders:0});assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,0);
 const half=await setup();assert.equal((await pollCircuitAuto(half.env,Date.parse('2026-10-28T11:00:00+03:00'))).state,'empty');
});
test('all-market events dedup by KAP ID, repeated ticker events count, one daily draft updates one control without model/X',async(t)=>{
 t.mock.method(Date,'now',()=>at);
 const c=await setup();c.set([disclosure(1,'A000'),disclosure(2,'ZZZZ')]);const original=globalThis.fetch,methods:string[]=[];
 globalThis.fetch=async(url)=>{methods.push(String(url).split('/').pop()!);return Response.json({ok:true,result:{message_id:90}});};
 try{
  const first=await pollCircuitAuto(c.env,at);assert.equal(first.state,'updated');assert(first.id);await deliver(c.env);
  assert.deepEqual(methods,['sendMessage']);let row=await c.env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(first.id).first<any>();assert.equal(row.revision,1);const content=JSON.parse(row.content);assert(content.card_data.report.rows.some((r:any)=>r.label==='#ZZZZ'));assert(!JSON.stringify(methods).includes('Photo'));
  assert.equal((await pollCircuitAuto(c.env,at+120000)).state,'unchanged');assert.equal(c.counts().renders,1);
  c.set([disclosure(1,'A000'),disclosure(1,'A000'),disclosure(2,'ZZZZ'),disclosure(3,'A000')]);assert.equal((await pollCircuitAuto(c.env,at+240000)).state,'updated');await deliver(c.env);
  row=await c.env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(first.id).first<any>();assert.equal(row.revision,2);assert.deepEqual(methods,['sendMessage','editMessageText']);assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,1);assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<any>()).n,0);assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);
  const d=JSON.parse(row.content);assert.equal(d.card_data.report.events.length,3);assert.match(d.card_data.report.rows[0].value,/2 bildirim/);assert.match(d.headline,/kaç hissede/);assert.match(postText(d),/#a000/);
 }finally{globalThis.fetch=original;}
});
test('scheduled or uncertain publication freezes draft while accumulating observed IDs; no reset/replay/render',async()=>{
 for(const state of ['queued','uncertain','sent']){
  const c=await setup();c.set([disclosure(1,'A000')]);const first=await pollCircuitAuto(c.env,at);const before=await c.env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(first.id!).first<any>();
  await c.env.DB.prepare('INSERT INTO x_posts(id,draft_id,revision,day,state,content,media_key,created_at) VALUES(?,?,1,?,?,?,?,?)').bind('x',first.id!,'2026-10-27',state,postText(JSON.parse(before.content)),before.media_key,at).run();
  c.set([disclosure(1,'A000'),disclosure(2,'ZZZZ')]);assert.equal((await pollCircuitAuto(c.env,at+120000)).state,'publication_locked');const after=await c.env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(first.id!).first<any>();assert.equal(after.content,before.content);assert.equal(after.revision,1);assert.equal(c.counts().renders,1);assert.equal((await c.env.DB.prepare('SELECT state FROM x_posts').first<any>()).state,state);
  const observed=JSON.parse((await c.env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind('circuit_auto_observed:2026-10-27').first<any>()).value);assert.equal(observed.length,2);
 }
});

test('local 120-second timer subtracts network work and honors shared next-at instead of drifting with RSS',()=>{assert.equal(circuitPollDelay({state:'updated'},at,at+13000),107000);assert.equal(circuitPollDelay({state:'waiting',next_at:at+120000},at+60000,at+60000),60000);assert.equal(circuitPollDelay({state:'not_ready'},at,at),2000);assert.equal(circuitPollDelay({state:'updated'},at,at+130000),250);});
