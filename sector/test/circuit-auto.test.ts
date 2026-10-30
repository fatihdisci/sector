import {loadCircuitArtwork}from'../scripts/circuit_artwork';import{readMedia,bytesHash}from'../src/media-set';
import {test}from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{localDatabase}from'../src/local-adapters';import{pollCircuitAuto,circuitPollDelay,CIRCUIT_POLL_MS}from'../src/circuit-auto';import{report}from'../src/kap/reports';import{deliver}from'../src/pipeline';import type{Disclosure,Indices}from'../src/kap/parser';import type{Env}from'../src/types';import{postText}from'../src/editorial';
const at=Date.parse('2026-10-27T11:00:00+03:00');
function disclosure(id:number,ticker:string,published=at):Disclosure{return{id,sourceRef:String(id),url:'https://www.kap.org.tr/tr/Bildirim/'+id,title:'Pay Bazında Devre Kesici Bildirimi',summary:'Devre kesici uygulaması',company:'BORSA İSTANBUL A.Ş.',subjectCodes:[ticker],relatedCodes:[],issuerCode:null,issuerRaw:null,disclosureClass:'',disclosureType:'',category:'',fundType:null,isFund:false,oid:null,relatedOid:null,changeStatus:null,isCorrection:false,publishedAt:new Date(published).toISOString(),attachmentCount:0};}
async function setup(){const db=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));const map=new Map<string,Uint8Array>(),png=await readFile('assets/visual-templates/bc-v1/01-yatay-takas.png');let scans=0,renders=0,records:Disclosure[]=[];const indices:Indices={bist30:Array.from({length:30},(_,i)=>'A'+String(i).padStart(3,'0')),bist100:Array.from({length:100},(_,i)=>'A'+String(i).padStart(3,'0')),checkedAt:new Date(at).toISOString(),source:'https://www.kap.org.tr/tr/Endeksler'};
 const env={DB:db,MEDIA:{get:async(k:string)=>map.has(k)?{arrayBuffer:async()=>map.get(k)!.slice().buffer}:null,put:async(k:string,v:Uint8Array)=>map.set(k,v),delete:async(k:string)=>map.delete(k)},MODE:'telegram_review',CIRCUIT_AUTO_ENABLED:'true',CIRCUIT_GENERAL_IMAGE:await loadCircuitArtwork(process.cwd()),BOT_WORKFLOW_MODE:'news_only',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'42',TELEGRAM_BOT_TOKEN:'123:fixture',TELEGRAM_VERIFIED_BOT_ID:'123',X_PUBLISH_ENABLED:'true',KAP_REPORT:async(_kind:string,when:number,_prefs:unknown,purpose:unknown)=>{scans++;return report('circuit',records.map(disclosure=>({disclosure})),indices,when,'Fixture coverage',undefined,false,purpose==='automatic_batch');},RENDER_REPORT:async()=>{renders++;return png;}}as unknown as Env;
 return{env,set:(v:Disclosure[])=>{records=v;},counts:()=>({scans,renders})};}
async function activate(c:Awaited<ReturnType<typeof setup>>){assert.equal((await pollCircuitAuto(c.env,at-120000)).state,'scope_baseline');}
test('120-second gate, holiday/half-day/weekend and unknown-calendar checks make no source call',async()=>{
 const c=await setup();assert.equal(CIRCUIT_POLL_MS,120000);
 for(const date of ['2026-10-29T11:00:00+03:00','2026-10-28T13:00:00+03:00','2026-10-31T11:00:00+03:00','2027-01-05T11:00:00+03:00','2026-10-27T20:00:00+03:00'])assert.equal((await pollCircuitAuto(c.env,Date.parse(date))).state,'closed');
 assert.deepEqual(c.counts(),{scans:0,renders:0});assert.equal((await pollCircuitAuto(c.env,at)).state,'scope_baseline');assert.equal((await pollCircuitAuto(c.env,at+119999)).state,'waiting');assert.equal((await pollCircuitAuto(c.env,at+120000)).state,'empty');assert.deepEqual(c.counts(),{scans:2,renders:0});assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,0);
 const half=await setup();assert.equal((await pollCircuitAuto(half.env,Date.parse('2026-10-28T11:00:00+03:00'))).state,'scope_baseline');
});
test('one ready photo per poll includes every new ticker without index filtering; IDs dedup and later events stay separate without model/X',async(t)=>{
 t.mock.method(Date,'now',()=>at);const c=await setup();await activate(c);c.set([disclosure(1,'A000'),disclosure(2,'ZZZZ'),disclosure(3,'A050')]);const original=globalThis.fetch,methods:string[]=[];
 globalThis.fetch=async(url)=>{methods.push(String(url).split('/').pop()!);return Response.json({ok:true,result:{message_id:90+methods.length}});};
 try{
  const first=await pollCircuitAuto(c.env,at);assert.equal(first.state,'updated');assert(first.id);await deliver(c.env);assert.deepEqual(methods,['sendPhoto']);const row=await c.env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(first.id).first<any>(),d=JSON.parse(row.content);assert.equal(d.revision,undefined);assert.equal(row.revision,1);assert.equal(postText(d),'#A000 #A050 #ZZZZ\n\nDevre kesici uygulandı. Bu 3 hissede de sürekli işlemlere ara verildi.\n\n#Borsa #BIST');assert(postText(d).includes('#ZZZZ'));assert.deepEqual(d.card_data.report.events.map((e:any)=>e.id),[1,2,3]);const art=await readMedia(c.env,row.media_key,row.content);assert.equal(await bytesHash(art.images[0]),c.env.CIRCUIT_GENERAL_IMAGE!.sha256);
  assert.equal((await pollCircuitAuto(c.env,at+120000)).state,'unchanged');
  c.set([disclosure(1,'A000'),disclosure(1,'A000'),disclosure(2,'ZZZZ'),disclosure(3,'A050'),disclosure(4,'A000',at+240000)]);const second=await pollCircuitAuto(c.env,at+240000);assert.equal(second.state,'updated');assert.notEqual(second.id,first.id);await deliver(c.env);assert.deepEqual(methods,['sendPhoto','sendPhoto']);const next=JSON.parse((await c.env.DB.prepare('SELECT content FROM drafts WHERE id=?').bind(second.id!).first<any>()).content);assert.deepEqual(next.card_data.report.events.map((e:any)=>e.id),[4]);assert.equal(postText(next),'#A000\n\nDevre kesici uygulandı. Sürekli işlemlere ara verildi.\n\n#Borsa #BIST');assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,2);assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<any>()).n,0);assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);assert.equal(c.counts().renders,0);
 }finally{globalThis.fetch=original;}
});
test('new batch preserves earlier scheduled/sent/uncertain draft and post without editing or replay',async()=>{
 for(const state of ['queued','uncertain','sent']){
  const c=await setup();await activate(c);c.set([disclosure(1,'A000')]);const first=await pollCircuitAuto(c.env,at);const before=await c.env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(first.id!).first<any>();
  await c.env.DB.prepare('INSERT INTO x_posts(id,draft_id,revision,day,state,content,media_key,created_at) VALUES(?,?,1,?,?,?,?,?)').bind('x',first.id!,'2026-10-27',state,postText(JSON.parse(before.content)),before.media_key,at).run();
  c.set([disclosure(1,'A000'),disclosure(2,'A050',at+120000)]);assert.equal((await pollCircuitAuto(c.env,at+120000)).state,'updated');const after=await c.env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(first.id!).first<any>();assert.equal(after.content,before.content);assert.equal(after.revision,1);assert.equal(c.counts().renders,0);assert.equal((await c.env.DB.prepare('SELECT state FROM x_posts').first<any>()).state,state);
  const observed=JSON.parse((await c.env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind('circuit_batch_seen:2026-10-27').first<any>()).value);assert.equal(observed.ids.length,2);
 }
});

test('local 120-second timer subtracts network work and honors shared next-at instead of drifting with RSS',()=>{assert.equal(circuitPollDelay({state:'updated'},at,at+13000),107000);assert.equal(circuitPollDelay({state:'waiting',next_at:at+120000},at+60000,at+60000),60000);assert.equal(circuitPollDelay({state:'not_ready'},at,at),2000);assert.equal(circuitPollDelay({state:'updated'},at,at+130000),250);});


test('real owner webhook DKB Paylaş goes immediately to one exact-art queue; wrong owner/message and uncertain replays stay blocked',async(t)=>{
 t.mock.method(Date,'now',()=>at);const c=await setup();await activate(c);c.set([disclosure(1,'A000')]);c.env.TELEGRAM_WEBHOOK_SECRET='fixture-secret';const original=fetch;globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:90}});
 try{const result=await pollCircuitAuto(c.env,at);await deliver(c.env);const {default:worker}=await import('../src/worker');const click=async(owner:number,message:number,update:number,data=`xpost:${result.id}:1`)=>worker.fetch(new Request('https://local.test/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','x-telegram-bot-api-secret-token':'fixture-secret'},body:JSON.stringify({update_id:update,callback_query:{id:'fixture-'+update,from:{id:owner},message:{message_id:message,chat:{id:42,type:'private'}},data}})}),c.env,{waitUntil:()=>{}}as any);
  await click(99,90,1);await click(7,91,2);assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);
  await click(7,90,3);await click(7,90,3);const post=await c.env.DB.prepare('SELECT x.id,x.state,s.due_at,s.media_hashes FROM x_posts x JOIN x_schedules s ON s.post_id=x.id').first<any>();assert.equal(post.state,'queued');assert.equal(post.due_at,at);assert.deepEqual(JSON.parse(post.media_hashes),[c.env.CIRCUIT_GENERAL_IMAGE!.sha256]);assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,1);
  await c.env.DB.prepare("UPDATE x_posts SET state='uncertain'").run();await click(7,90,4);assert.equal((await c.env.DB.prepare('SELECT state FROM x_posts').first<any>()).state,'uncertain');
 }finally{globalThis.fetch=original;}
});
test('DKB missing artwork binding cannot enqueue a publication',async(t)=>{
 t.mock.method(Date,'now',()=>at);const c=await setup();await activate(c);c.set([disclosure(1,'A000')]);const original=fetch;globalThis.fetch=async()=>Response.json({ok:true,result:{message_id:90}});
 try{const result=await pollCircuitAuto(c.env,at);await deliver(c.env);await c.env.DB.prepare("DELETE FROM system_state WHERE key LIKE 'circuit_artwork:%'").run();const{requestX}=await import('../src/x-publish');await requestX(c.env,`xpost:${result.id}:1`,90,'fixture');assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);}finally{globalThis.fetch=original;}
});

test('scope upgrade baselines old all-market state without replay; manual all-market stays intact',async()=>{
 const c=await setup();c.set([disclosure(1,'A000'),disclosure(2,'A050'),disclosure(3,'ZZZZ')]);
 const manual=await c.env.KAP_REPORT!('circuit',at);assert.equal(manual.draft.card_data!.report!.events!.length,3);
 await c.env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?)').bind('circuit_auto:2026-10-27',JSON.stringify({id:'old-draft',ids:[1,2,3],revision:7})).run();
 assert.equal((await pollCircuitAuto(c.env,at)).state,'scope_baseline');assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,0);
 c.set([disclosure(1,'A000'),disclosure(2,'A050'),disclosure(3,'ZZZZ'),disclosure(4,'A050',at+120000)]);assert.equal((await pollCircuitAuto(c.env,at+120000)).state,'updated');
 const row=await c.env.DB.prepare('SELECT content FROM drafts').first<any>(),d=JSON.parse(row.content);assert.deepEqual(d.card_data.report.events.map((e:any)=>e.id),[4]);assert(!JSON.stringify(d).includes('#ZZZZ'));
 const old=JSON.parse((await c.env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind('circuit_auto:2026-10-27').first<any>()).value);assert.equal(old.revision,7);
});
test('automatic all-market batch needs no index snapshot; manual daily report keeps its existing ranking rules',async()=>{
 const c=await setup();await activate(c);c.set([disclosure(1,'ZZZZ')]);const build=c.env.KAP_REPORT!;
 c.env.KAP_REPORT=async(...args)=>{const s=await build(...args);s.draft.card_data!.report!.circuit!.indices.snapshot=null;return s;};
 const result=await pollCircuitAuto(c.env,at);assert.equal(result.state,'updated');const d=JSON.parse((await c.env.DB.prepare('SELECT content FROM drafts WHERE id=?').bind(result.id!).first<any>()).content);assert.equal(d.body.split('\n')[0],'#ZZZZ');assert.equal(d.card_data.report.circuit.indices.status,'not_required');
 assert.throws(()=>report('circuit',[{disclosure:disclosure(1,'ZZZZ')}],null,at,'fixture'),/indices_unavailable/);
});

test('a market-wide wave keeps every ticker and splits only Telegram display text without creating multiple tweets',async(t)=>{
 t.mock.method(Date,'now',()=>at);const c=await setup();await activate(c);c.set(Array.from({length:650},(_,i)=>disclosure(i+1,'Z'+String(i).padStart(4,'0'))));const original=fetch,methods:string[]=[],texts:string[]=[];globalThis.fetch=async(url,init)=>{const method=String(url).split('/').pop()!;methods.push(method);if(method==='sendMessage')texts.push((init!.body as URLSearchParams).get('text')!);return Response.json({ok:true,result:{message_id:90+methods.length}});};
 try{const result=await pollCircuitAuto(c.env,at);assert.equal(result.state,'updated');await deliver(c.env);const d=JSON.parse((await c.env.DB.prepare('SELECT content FROM drafts WHERE id=?').bind(result.id!).first<any>()).content);assert.equal(d.card_data.report.events.length,650);assert.equal(texts.join(''),postText(d));assert.deepEqual(methods,['sendPhoto','sendMessage','sendMessage']);assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);}finally{globalThis.fetch=original;}
});

test('market-level notice without named shares is archived without inventing a zero-share tweet',async()=>{
 const c=await setup();await activate(c);c.set([{...disclosure(1,'ZZZZ'),subjectCodes:[]}]);assert.equal((await pollCircuitAuto(c.env,at)).state,'unchanged');assert.equal((await c.env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,0);const seen=JSON.parse((await c.env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind('circuit_batch_seen:2026-10-27').first<any>()).value);assert.deepEqual(seen.ids,[1]);
});

test('all three owner-approved images are hash-bound once per draft and reused on retries',async()=>{
 const c=await setup(),{loadCircuitArtworkPool}=await import('../scripts/circuit_artwork'),{withCircuitArtwork,storeCircuitArtwork}=await import('../src/circuit-artwork');const pool=await loadCircuitArtworkPool('.');assert.equal(pool.length,3);c.env.CIRCUIT_IMAGES=pool;
 const draft={headline:'DKB',body:'DKB',hashtags:[],card_data:{report:{rows:[],footer:'',circuit:{}}}}as any;
 for(let i=0;i<3;i++){const key='choice-'+i;await c.env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?)').bind('circuit_artwork_choice:'+key,pool[i].sha256).run();const first=await withCircuitArtwork(c.env,draft,key),again=await withCircuitArtwork(c.env,draft,key);assert.equal(first.circuit_artwork!.sha256,pool[i].sha256);assert.deepEqual(again.circuit_artwork,first.circuit_artwork);const media='drafts/00000000-0000-4000-8000-00000000000'+i+'/1.png';await storeCircuitArtwork(c.env,media,first);const saved=await readMedia(c.env,media,JSON.stringify(first));assert.equal(await bytesHash(saved.images[0]),pool[i].sha256);}
 const key='random-choice';const selected=await withCircuitArtwork(c.env,draft,key);assert(pool.some(a=>a.sha256===selected.circuit_artwork!.sha256));assert.deepEqual((await withCircuitArtwork(c.env,draft,key)).circuit_artwork,selected.circuit_artwork);
});
