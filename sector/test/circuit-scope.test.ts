import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import real from'./fixtures/circuit-scope-real.json';import proof from'../src/data/circuit-bist30-2026q4.json';
import{KapStore,CIRCUIT_WINDOW_MS}from'../src/kap/store';import{KapCollector}from'../src/kap/collector';import{KapDelivery}from'../src/kap-delivery';import{localDatabase}from'../src/local-adapters';
import{CIRCUIT_POLICY,CIRCUIT_LIGHT_TTL,CIRCUIT_LIGHT_MAX,circuitSnapshot,circuitScope,snapshotProblem,listingCircuit}from'../src/kap/circuit-scope';import{parseListing,type Disclosure,type Indices}from'../src/kap/parser';import{editorialPolicy,styleIssues}from'../src/style';
const NOW=Date.parse('2026-10-26T07:00:00Z');
const indices:Indices={bist30:proof.members,bist100:proof.members,checkedAt:new Date(NOW).toISOString(),source:proof.source,sourceSha256:proof.source_sha256};
const d=(id:number,code='ISCTR')=>({...real.find(r=>r.id===1686624)!,id,sourceRef:'kap:'+id,url:'https://www.kap.org.tr/tr/Bildirim/'+id,relatedCodes:[code],subjectCodes:[code],summary:code+'.E işlem sırasında Pay Bazında Devre Kesici Uygulaması devreye girmiştir',publishedAt:new Date(NOW).toISOString()})as Disclosure;
function setup(){const s=new KapStore(':memory:');s.set('notification_start',NOW-60000);s.set('bootstrap',{latest:100});s.run("UPDATE jobs SET cursor=100 WHERE name='live'");s.configure({...s.prefs(),circuitNotifications:true},NOW-60000);s.set('indices',indices);s.set('circuit_policy',{...CIRCUIT_POLICY,activated_at:NOW-50000});s.refreshCircuitIndex(indices,NOW);return s;}
test('real official scope fixtures distinguish BIST30 pay, outside pay and code-free market exception',()=>{
 const snap=circuitSnapshot(indices,NOW);assert.equal(circuitScope(real.find(r=>r.id===1686624)!as Disclosure,snap,null,NOW).reason,'bist30_pay');assert.equal(circuitScope(real.find(r=>r.id===1685154)!as Disclosure,snap,null,NOW).reason,'bist30_outside');
 for(const snapshot of [snap,null])assert.equal(circuitScope(real[0]as Disclosure,snapshot,'kap_circuit_index_stale',NOW).kind,'market');
 assert.equal(circuitScope({...d(101),relatedCodes:[],subjectCodes:[]},snap,null,NOW).kind,'review');assert.equal(circuitScope(d(101,'ZZZZZ'),snap,null,NOW).kind,'review');assert.equal(circuitScope({...d(101),company:'Örnek Şirket'},snap,null,NOW).kind,'review');
 const mixed=circuitScope({...d(101),subjectCodes:['MEPET','ISCTR'],relatedCodes:['MEPET','ISCTR']},snap,null,NOW);assert.deepEqual(mixed.codes,['ISCTR']);assert.deepEqual(mixed.excluded,['MEPET']);
});
test('effective period, stale/unavailable/changed/forged index evidence blocks pay, never market',()=>{
 const snap=circuitSnapshot(indices,NOW);assert.equal(snapshotProblem(snap,null,NOW),null);
 for(const now of [Date.parse('2026-09-30T20:59:59Z'),Date.parse('2026-12-31T21:00:00Z')])assert.throws(()=>circuitSnapshot({...indices,checkedAt:new Date(now).toISOString()},now),/period/);
 assert.throws(()=>circuitSnapshot({...indices,bist30:[...proof.members.slice(1),'MEPET']},NOW),/members_changed/);assert.throws(()=>circuitSnapshot({...indices,sourceSha256:undefined},NOW),/evidence_missing/);
 assert.equal(circuitScope(d(101),snap,null,NOW+37*3600000).kind,'review');assert.equal(circuitScope(d(101),snap,'kap_http_503',NOW).kind,'review');assert.equal(snapshotProblem({...snap,members:['MEPET',...snap.members.slice(1)]},null,NOW),'kap_circuit_index_evidence_invalid');
});
test('exact light listing eliminates outside pay before detail read; fallback metadata also avoids archive/queue/model',async()=>{
 const s=setup();try{const reads:number[]=[];const row=parseListing([{disclosureIndex:101,publishDate:'26.10.2026 10:00:00',subject:d(101,'MEPET').title,title:d(101).company,summary:d(101,'MEPET').summary}],NOW);
 const collector=new KapCollector(s,{listing:async()=>row,indices:async()=>indices,disclosure:async id=>{reads.push(id);return null}},()=>NOW);await collector.run('discovery');await collector.run('live');assert(!reads.includes(101));assert.equal(s.row<{n:number}>('select count(*) n from circuit_light')!.n,1);
 const lease=s.claim('reconcile',NOW)!;s.save(d(102,'MEPET'),lease,NOW,false);s.save(d(102,'MEPET'),lease,NOW,false);
 for(const table of ['disclosures','feed','queue','queue_members','circuit_pending','checks'])assert.equal(s.row<{n:number}>('select count(*) n from '+table)!.n,0,table);
 assert.equal(s.row<{n:number}>('select count(*) n from circuit_light')!.n,2);
 assert.equal(listingCircuit({...row[0].circuit!,summary:'MEPET.E …'},s.get('circuit_snapshot'),null,NOW),null,'truncated hints require metadata fallback');
 }finally{s.close();}
});
test('new stages retain IDs; BIST30 and market queue separately; mixed pay counts only included events/codes',()=>{
 const s=setup();try{const l=s.claim('live',NOW)!;s.save(d(101),l,NOW,true);s.save(d(101),l,NOW+1,true);s.save({...d(102),subjectCodes:['ISCTR','MEPET'],relatedCodes:['ISCTR','MEPET']},l,NOW+2,true);s.save(d(103,'MEPET'),l,NOW+3,true);
 s.save({...real[0],id:104,sourceRef:'kap:104',url:'https://www.kap.org.tr/tr/Bildirim/104',publishedAt:new Date(NOW).toISOString()}as Disclosure,l,NOW+4,true);
 const end=NOW+CIRCUIT_WINDOW_MS;s.freeze(s.claim('groups',end)!,end);const queues=s.rows<{payload:string}>('select payload from queue');assert.equal(queues.length,2);const payloads=queues.map(q=>JSON.parse(q.payload));assert.deepEqual(payloads.find(p=>p.scope==='bist30').disclosureIds,[101,102]);assert.deepEqual(payloads.find(p=>p.scope==='bist30').codes,['ISCTR']);assert.deepEqual(payloads.find(p=>p.scope==='market').codes,[]);
 assert.equal(s.row<{n:number}>('select count(*) n from disclosures')!.n,3);assert.equal(s.row<{n:number}>('select count(*) n from circuit_light')!.n,1);
 }finally{s.close();}
});
test('unknown metadata is visible review, index failure blocks pay without blocking market or other KAP types',async()=>{
 const s=setup();try{const l=s.claim('live',NOW)!;s.save(d(101,'ZZZZZ'),l,NOW,true);assert.equal(s.row<{disposition:string}>('select disposition from circuit_light')!.disposition,'review');
 s.finish(l,NOW,0);const c=new KapCollector(s,{listing:async()=>[],indices:async()=>{throw Error('kap_http_503')},disclosure:async()=>null},()=>NOW);await c.run('indices');assert.equal(s.get('circuit_index_block'),'kap_http_503');
 const next=s.claim('live',NOW)!;s.save(d(102),next,NOW,true);s.save({...real[0],id:103,sourceRef:'kap:103',publishedAt:new Date(NOW).toISOString()}as Disclosure,next,NOW,true);s.save({...d(104),title:'Yeni İş İlişkisi',summary:'Sözleşme imzalandı.',subjectCodes:['MEPET'],relatedCodes:[]},next,NOW,true);
 assert.equal(s.row<{n:number}>("select count(*) n from queue where kind='instant'")!.n,1);assert.equal(s.row<{n:number}>("select count(*) n from queue where kind='circuit'")!.n,1);assert.equal((s.health(NOW).circuitScope as any).review.length,2);
 }finally{s.close();}
});
test('minimum records expire and stay size-bounded, without deleting historical disclosures or refreshing repeats',()=>{
 const s=setup();try{const l=s.claim('live',NOW)!;s.save({...d(101),publishedAt:new Date(NOW-100000).toISOString()},l,NOW,true);const old=s.row('select * from disclosures where id=101');
 s.transaction(()=>{for(let id=0;id<CIRCUIT_LIGHT_MAX+5;id++)s.run('insert into circuit_light values(?,?,?,?,?,?,?)',id+1000,new Date(NOW).toISOString(),NOW+id,NOW+CIRCUIT_LIGHT_TTL,'excluded','bist30_outside',proof.version)});s.pruneCircuitLight(NOW);assert.equal(s.row<{n:number}>('select count(*) n from circuit_light')!.n,CIRCUIT_LIGHT_MAX);assert.deepEqual(s.row('select * from disclosures where id=101'),old);
 s.pruneCircuitLight(NOW+CIRCUIT_LIGHT_TTL);assert.equal(s.row<{n:number}>('select count(*) n from circuit_light')!.n,0);assert.deepEqual(s.row('select * from disclosures where id=101'),old);
 }finally{s.close();}
});
test('consumer never loads excluded members; mixed evidence scopes tweet/card and expiry before send holds',async()=>{
 const s=setup(),DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));try{
 const l=s.claim('live',NOW)!;s.save({...d(101),subjectCodes:['ISCTR','MEPET'],relatedCodes:['ISCTR','MEPET']},l,NOW,true);const end=NOW+CIRCUIT_WINDOW_MS;s.freeze(s.claim('groups',end)!,end);let reads=0;let loaded:any[]=[];
 const c=new KapDelivery(s,{DB,MODE:'telegram_review',AI_DAILY_DRAFT_LIMIT:'240'}as any,async id=>{reads++;const text='ISCTR.E ve MEPET.E paylarında sürekli işleme ara verildi.';return[{source_id:'kap',source_name:'KAP',family:'kap',official:true,url:'https://www.kap.org.tr/tr/Bildirim/'+id,title:'Pay Bazında Devre Kesici Bildirimi',body:text,published_at:new Date(NOW).toISOString(),passages:[{id:'p1',text}],equity_codes:['ISCTR','MEPET']}];},()=>end);
 await c.run();assert.equal(reads,1);const job=await DB.prepare('select documents from model_jobs').first<any>();loaded=JSON.parse(job.documents);assert.deepEqual(loaded[0].equity_codes,['ISCTR']);assert.deepEqual(loaded[0].circuit_scope.excluded_codes,['MEPET']);assert(editorialPolicy(loaded).excluded_equity_codes.includes('MEPET'));assert(editorialPolicy(loaded).instruction.includes('tüm piyasa toplamı değildir'));
 assert.equal(c.deliveryDecision(loaded),'allow');s.set('circuit_index_block','kap_http_503');assert.equal(c.deliveryDecision(loaded),'hold');assert.equal(s.row<{state:string}>('select state from queue')!.state,'needs_review');
 }finally{s.close();}
});

test('legacy outside queued member never triggers full reader, attachments, AI, media or card after activation',async()=>{
 const s=setup(),DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));try{
 s.set('circuit_policy',null);const l=s.claim('live',NOW)!;s.save(d(101,'KTLEV'),l,NOW,true);const end=NOW+CIRCUIT_WINDOW_MS;s.freeze(s.claim('groups',end)!,end);s.set('circuit_policy',{...CIRCUIT_POLICY,activated_at:NOW});let reads=0,media=0;
 const c=new KapDelivery(s,{DB,MODE:'telegram_review',AI_DAILY_DRAFT_LIMIT:'240',MEDIA:{put:async()=>{media++}},RENDER_REPORT:async()=>{throw Error('must_not_render')}}as any,async()=>{reads++;throw Error('must_not_read')},()=>end);
 await c.run();assert.equal(reads,0);assert.equal(media,0);for(const table of ['model_jobs','drafts','news_cards'])assert.equal((await DB.prepare('select count(*) n from '+table).first<any>()).n,0);assert.equal(s.row<{state:string}>('select state from queue')!.state,'suppressed');assert.equal(s.row<{n:number}>('select count(*) n from disclosures')!.n,1,'historic metadata retained');
 }finally{s.close();}
});
test('code-free market event reaches existing evidence/model queue even while share membership is blocked',async()=>{
 const s=setup(),DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));try{
 s.set('circuit_index_block','kap_http_503');const l=s.claim('live',NOW)!;s.save({...real[0],id:101,sourceRef:'kap:101',url:'https://www.kap.org.tr/tr/Bildirim/101',publishedAt:new Date(NOW).toISOString()}as Disclosure,l,NOW,true);let reads=0;
 const c=new KapDelivery(s,{DB,MODE:'telegram_review',AI_DAILY_DRAFT_LIMIT:'240'}as any,async()=>{reads++;return[{source_id:'kap',source_name:'KAP',family:'kap',official:true,url:'https://www.kap.org.tr/tr/Bildirim/101',title:real[0].title,body:real[0].summary!,passages:[{id:'p1',text:real[0].summary!}],published_at:new Date(NOW).toISOString(),equity_codes:[]}]},()=>NOW);assert.equal((await c.run()).state,'model_queued');assert.equal(reads,1);const doc=JSON.parse((await DB.prepare('select documents from model_jobs').first<any>()).documents)[0];assert.equal(doc.circuit_scope.kind,'market');assert.deepEqual(doc.equity_codes,[]);assert.equal(c.deliveryDecision([doc]),'allow');
 }finally{s.close();}
});
