import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {parseDisclosure,flightText,jsonValue,kapDate,parseListing,parseIndices,fullText,type Disclosure} from '../src/kap/parser';
import {DEFAULTS,preferences,decide,classify,digestAt,type Preferences} from '../src/kap/rules';
import {KapStore,CIRCUIT_WINDOW_MS,type Lease} from '../src/kap/store';
import {KapCollector,type Source} from '../src/kap/collector';
import {KapClient} from '../src/kap/client';
import {RECENT_IPO_TICKERS,FUND_CRISIS_TICKERS,focusedDisclosureTickers} from '../src/kap/ticker-scope';
const NOW=Date.parse('2026-10-21T13:00:00Z');
const basic=(more:Record<string,unknown>={})=>({disclosureIndex:101,title:'Yeni İş İlişkisi',companyTitle:'TEST SANAYİ A.Ş.',stockCode:'TEST',relatedStocks:null,disclosureClass:'ODA',disclosureType:'ODA',disclosureCategory:'ODA',publishDate:'2026.10.21 16:00:00',disclosureId:'a'.repeat(32),relatedDisclosureOid:null,isChanged:null,summary:'Sözleşme imzalandı.',...more});
function page(b=basic(),body=''){const data='7:'+JSON.stringify({disclosureBasic:b});const split=23;return `<script>self.__next_f.push(${JSON.stringify([1,data.slice(0,split)])})</script><script>self.__next_f.push(${JSON.stringify([1,data.slice(split)])})</script>${body}`;}
const item=(id=101,more:Record<string,unknown>={})=>parseDisclosure(page(basic({disclosureIndex:id,...more})),id);
const setup=()=>{const dir=mkdtempSync(join(tmpdir(),'sector-kap-test-')),path=join(dir,'kap.sqlite'),store=new KapStore(path);const codes=['KPEKS','KTLEV','ASTOR',...Array.from({length:97},(_,i)=>'T'+String(i).padStart(3,'0'))];store.set('indices',{bist30:codes.slice(0,30),bist100:codes,checkedAt:new Date(NOW).toISOString(),source:'https://www.kap.org.tr/tr/Endeksler',sourceSha256:'a'.repeat(64)});const lease=store.claim('discovery',NOW)!;store.discover([{id:100,publishedAt:new Date(NOW-1000).toISOString()}],lease,NOW);store.finish(lease,NOW,60_000);return {store,path,close:()=>{store.close();rmSync(dir,{recursive:true,force:true});}};};
const pref=(p:Partial<Preferences>={})=>preferences({...structuredClone(DEFAULTS),...p});

test('KAP Flight preserves split chunks, quoted names and nested JSON; scripts never execute',()=>{
 const d=item(101,{companyTitle:'ŞİRKET "A {B}" \\ TEST',summary:'Satır\nİkinci [satır]'});assert.equal(d.company,'ŞİRKET "A {B}" \\ TEST');assert.equal(d.publishedAt,'2026-10-21T13:00:00.000Z');
 assert.deepEqual(jsonValue('{"a":[{"x":"}\\\""}]}',0),{a:[{x:'}"'}]});assert.throws(()=>jsonValue('{"a":[}',0));assert.throws(()=>flightText('<script>self.__next_f.push([1,"x"]);evil()</script>'));
 assert.throws(()=>parseDisclosure(page(basic({disclosureIndex:102})),101),/id_mismatch/);assert.throws(()=>item(101,{title:''}));assert.throws(()=>item(101,{summary:{bad:true}}));assert.throws(()=>parseDisclosure('<html>captcha</html>',101),/basic_missing/);
});
test('KAP source dates are Istanbul times; invalid calendar dates fail closed',()=>{
 assert.equal(kapDate('21.10.2026 16:00:00',true),new Date(NOW).toISOString());for(const value of ['2026.02.30 10:00:00','2026.10.21 24:00:00','not a date'])assert.throws(()=>kapDate(value));
 assert.throws(()=>parseListing([{disclosureIndex:101,subject:'a',publishDate:'21.10.2027 16:00:00'}],NOW));
});
test('KAP issuer and related stocks stay separate; portfolio/fund codes cannot become shares',()=>{
 assert.deepEqual(item(101,{stockCode:'SKP',companyTitle:'ÖRNEK PORTFÖY YÖNETİMİ A.Ş.',relatedStocks:'AKBNK,THYAO'}).subjectCodes,[]);
 assert.deepEqual(item(101,{stockCode:'FUND',disclosureType:'FON',companyTitle:'ÖRNEK FON'}).subjectCodes,[]);
 assert.deepEqual(item(101,{stockCode:null,relatedStocks:'THYAO, AKBNK,THYAO, ABC, -BAD'}).relatedCodes,['THYAO','AKBNK']);
 assert.deepEqual(item(101,{stockCode:null,relatedStocks:'THYAO'}).subjectCodes,['THYAO']);
 const d=item(101,{stockCode:null,title:'Piyasa Duyurusu',relatedStocks:'THYAO,AKBNK'});
 const result=decide(d,pref({otherCompanies:'off'}),{bist30:['THYAO'],bist100:['THYAO','AKBNK'],checkedAt:'',source:''});assert.equal(result.action,'off');assert.equal(result.indexTier,null);
});
test('KAP topic matching covers Turkish accents and all selected topics',()=>{
 const examples:Record<string,string>={'Kâr Payı Dağıtımı':'dividend','payların geri alınmasına ilişkin bildirim':'buyback','Geri Satım Bildirimi':'buyback','Finansal Sonuç':'financial','Faaliyet Raporu':'financial','Bedelsiz Sermaye Artırımı':'capital','Yeni İş İlişkisi':'business','Pay Satım Bildirimi':'share_trade','Pay Bazında Devre Kesici Bildirimi':'circuit'};
 for(const [title,topic] of Object.entries(examples))assert.ok(classify(item(101,{title})).includes(topic as never),title);
});
test('KAP user scope narrows circuits, buybacks and share trades to supplied cohorts or verified BIST30/100',()=>{
 assert.deepEqual(RECENT_IPO_TICKERS,['NETGL','BKRGY','INTET','KPEKS','CITAS','VEYAS','TKNKA','KARCL','QUICK','MASFN','ALBTN','METEN','SARAE','ISVEA']);
 assert.deepEqual(FUND_CRISIS_TICKERS,['KTLEV','TRHOL','TEHOL','ODINE','GUNDG','OZATD','DSTKF','KARCL','ASTOR']);
 const noIndices=null,p=pref({otherCompanies:'important',priorityIndices:false,circuitNotifications:true});
 for(const title of ['Payların Geri Alınmasına İlişkin Bildirim','Pay Alım Bildirimi','Pay Bazında Devre Kesici Bildirimi']){
  const allowed=item(101,{title,stockCode:'KPEKS'}),unknown=item(101,{title,stockCode:'TEST'});
  assert.equal(decide(allowed,p,noIndices).action,title.includes('Devre Kesici')?'circuit':'instant',title);
  const denied=decide(unknown,p,noIndices);assert.equal(denied.action,'off',title);assert.equal(denied.reason,'ticker_out_of_scope');assert.equal(denied.store,true);
 }
 const crisis=item(101,{title:'Devre Kesici Uygulaması',stockCode:null,relatedStocks:'KTLEV,TEST'});
 assert.deepEqual(focusedDisclosureTickers(crisis,noIndices),['KTLEV']);assert.equal(decide(crisis,p,noIndices).action,'circuit');
 const indexOnly=item(101,{title:'Pay Satım Bildirimi',stockCode:'THYAO'});
 const indices={bist30:['THYAO'],bist50:[],bist100:['THYAO'],checkedAt:'2026-10-22T00:00:00.000Z',source:'KAP'};
 assert.equal(decide(indexOnly,p,indices).action,'instant');
 const noSubject=item(101,{title:'Pay Satım Bildirimi',stockCode:null,relatedStocks:'TEST,ZZZZ'});
 assert.equal(decide(noSubject,p,indices).action,'off');
 // The new ticker restriction is specific to high-volume transaction alerts.
 assert.equal(decide(item(101,{title:'Finansal Sonuç',stockCode:'TEST'}),pref(),noIndices).action,'instant');
});
test('KAP exact precedence keeps funds and mandatory mutes first while the new transaction scope overrides defaults',()=>{
 const share=item(101,{title:'Pay Alım Bildirimi - Kredi Kullanımı',stockCode:'KPEKS'});assert.equal(decide(share,pref({otherCompanies:'off',priorityIndices:false}),null).action,'instant');
 const outside=item(101,{title:'Pay Alım Bildirimi - Kredi Kullanımı',stockCode:'TEST'});assert.equal(decide(outside,pref({otherCompanies:'off',priorityIndices:false}),null).action,'off');
 assert.equal(decide({...share,isFund:true},pref(),null).action,'off');
 const crisis=item(101,{title:'Tasfiye ve Ödeme',disclosureType:'FON'});assert.equal(decide(crisis,pref(),null).action,'off');assert.equal(decide(crisis,pref({funds:'digest'}),null).action,'instant');
 const muted=item(101,{title:'İç Tüzük Tasfiye',disclosureType:'FON'});assert.equal(decide(muted,pref({funds:'instant'}),null).action,'off');
});
test('KAP storage and notification differ; routine explicit tracking and mandatory mutes',()=>{
 const routine=item(101,{title:'Kredi Derecelendirmesi'});assert.equal(decide(routine,pref(),null).store,false);
 const tracked=pref({watchlist:[{ticker:'TEST',mode:'all',topics:[]}]});assert.equal(decide(routine,tracked,null).action,'off');
 const excluded=item(101,{title:'İhraç Belgesi'});assert.equal(decide(excluded,pref(),null).store,true);assert.equal(decide(excluded,pref(),null).action,'off');
 for(const title of ['İç Tüzük','Fon Gider Bilgileri','Fon Toplam Giderinin Dağılımı','Faizsiz Pay Dışı Sermaye Piyasası Aracı İşlemleri','Kurumsal Yönetim Bilgi Formu (Güncelleme) – Yönetim Kurulu-2'])assert.equal(decide(item(101,{title}),tracked,null).action,'off',title);
 assert.equal(decide(routine,pref({otherCompanies:'topics',otherTopics:['other']}),null).store,true);
});
test('out-of-scope transaction disclosures remain auditable but never enter Telegram queue',()=>{
 const {store,close}=setup();try{
  const lease=store.claim('live',NOW)!;
  store.save(item(101,{title:'Payların Geri Alınmasına İlişkin Bildirim',stockCode:'TEST'}),lease,NOW,true);
  assert.equal(store.rows('SELECT * FROM disclosures').length,1);assert.equal(store.rows('SELECT * FROM feed').length,1);
  assert.equal(store.rows('SELECT * FROM queue').length,0);assert.equal(store.row<{disposition:string}>('SELECT disposition FROM checks WHERE id=101')!.disposition,'stored');
  store.save(item(102,{title:'Payların Geri Alınmasına İlişkin Bildirim',stockCode:'KPEKS'}),lease,NOW+1,true);
  assert.equal(store.rows('SELECT * FROM queue').length,1);assert.equal(store.row<{source_ref:string}>('SELECT source_ref FROM queue')!.source_ref,'kap:102');
 }finally{close();}
});
test('KAP fund digest uses Istanbul 19:00 and preference validation is strict',()=>{
 assert.equal(new Date(digestAt(NOW,'19:00')).toISOString(),'2026-10-21T16:00:00.000Z');assert.equal(new Date(digestAt(NOW+4*3600_000,'19:00')).toISOString(),'2026-10-22T16:00:00.000Z');
 assert.equal(decide(item(101,{disclosureType:'FON',title:'Portföy Dağılım Raporu'}),pref({funds:'digest'}),null).action,'digest');
 assert.throws(()=>pref({fundDigestTime:'25:90'}));assert.throws(()=>pref({watchlist:[{ticker:'ABC',mode:'all',topics:[]}]}));
});
test('KAP full text preserves labeled transaction/board dates and never substitutes summary',()=>{
 const html=page(basic(),'<div class="disclosureScrollableArea"><p>Tam açıklama</p><table><tr><td>Yönetim Kurulu Karar Tarihi</td><td>01.10.2026</td></tr></table><table><tr><th>İşlem Tarihi</th><th>Tutar</th></tr><tr><td>21.10.2026</td><td>500.000</td></tr></table></div>');
 const d=fullText(html,101);assert.equal(d.status,'available');assert.equal(d.boardDecisionDates[0].value,'01.10.2026');assert.equal(d.transactionDates[0].value,'21.10.2026');assert.equal(d.transactionRows[0].Tutar,'500.000');assert.equal(fullText(page(),101).status,'unavailable');assert.equal(fullText(page(),101).text,null);
});
test('KAP indices require exact 30/100 counts and subset, with no bundled fallback',()=>{
 const codes=Array.from({length:100},(_,i)=>'T'+String(i).padStart(3,'0'));
 const html=(a:string[],b:string[])=>`<script>self.__next_f.push(${JSON.stringify([1,JSON.stringify([{code:'XU030',content:a.map(stockCode=>({stockCode}))},{code:'XU050',content:b.slice(0,50).map(stockCode=>({stockCode}))},{code:'XU100',content:b.map(stockCode=>({stockCode}))}])])})</script>`;
 assert.equal(parseIndices(html(codes.slice(0,30),codes)).bist100.length,100);assert.throws(()=>parseIndices(html(codes.slice(0,29),codes)));assert.throws(()=>parseIndices(html([...codes.slice(0,29),'NOPE'],codes)));
});
test('KAP source/feed/queue/cursor transaction rolls back on queue failure; duplicates stay single',()=>{
 const {store,close}=setup();try{const l=store.claim('live',NOW)!;
 store.db.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON queue BEGIN SELECT RAISE(ABORT,'synthetic storage failure'); END;");assert.throws(()=>store.save(item(),l,NOW,true));assert.equal(store.health().sources,0);assert.equal(store.row<{cursor:number}>("SELECT cursor FROM jobs WHERE name='live'")!.cursor,100);
 store.db.exec('DROP TRIGGER fail_queue');store.save(item(),l,NOW,true);store.save(item(),l,NOW,true);assert.equal(store.health().sources,1);assert.equal(store.health().queue,1);assert.equal(store.rows('SELECT * FROM queue_members').length,1);
 }finally{close();}
});
test('KAP startup and backfill are silent; KAP does not inherit RSS 30 minute cutoff',()=>{
 const {store,close}=setup();try{const l=store.claim('live',NOW)!;store.save(item(101,{publishDate:'2026.10.21 15:59:59'}),l,NOW,true);assert.equal(store.health().queue,0);
 store.set('notification_start',NOW-3*3600_000);store.save(item(102,{publishDate:'2026.10.21 14:00:00'}),l,NOW,true);assert.equal(store.health().queue,1);
 const b=store.claim('backfill',NOW)!;store.save(item(99),b,NOW,true);assert.equal(store.health().queue,1);store.save(item(98,{publishDate:'2026.10.19 16:00:00'}),b,NOW,true);assert.equal(store.row('SELECT * FROM disclosures WHERE id=98'),undefined);
 }finally{close();}
});
test('KAP lease fences survive restart and reject stale writers, other application DB rejected',()=>{
 const {store,path,close}=setup();try{const first=store.claim('live',NOW)!;assert.equal(store.claim('live',NOW),null);const second=new KapStore(path);try{assert.equal(second.claim('live',NOW),null);const next=second.claim('live',NOW+121_000)!;assert.ok(next);assert.throws(()=>store.save(item(),first,NOW+121_000,true),/lease_lost/);}finally{second.close();}
 const other=path+'.other',db=new DatabaseSync(other);db.exec('CREATE TABLE private_data(x)');db.close();assert.throws(()=>new KapStore(other),/namespace/);
 }finally{close();}
});
test('KAP circuits freeze one complete three-minute bucket, deduplicate codes and keep late arrivals separate',()=>{
 const {store,close}=setup();try{
  store.configure(pref({circuitNotifications:true}),NOW);const l=store.claim('live',NOW)!;
  for(let id=101;id<=201;id++)store.save(item(id,{title:'Devre Kesici',relatedStocks:'KTLEV,ASTOR',stockCode:null}),l,NOW,true);
  const end=NOW+CIRCUIT_WINDOW_MS,g=store.claim('groups',end-1)!;
  store.freeze(g,end-1);assert.equal(store.health().queue,0);
  store.freeze(g,end);let q=store.rows<{payload:string}>('SELECT payload FROM queue');assert.equal(q.length,1);
  assert.equal(JSON.parse(q[0].payload).disclosureIds.length,101);assert.deepEqual(JSON.parse(q[0].payload).codes,['ASTOR','KTLEV']);
  assert.equal(JSON.parse(q[0].payload).windowStart,NOW);assert.equal(JSON.parse(q[0].payload).windowEnd,end);
  const nextLive=store.claim('live',end)!;store.save(item(202,{title:'Devre Kesici',stockCode:null,relatedStocks:'KTLEV'}),nextLive,end,true);
  store.freeze(g,end+1);assert.equal(store.health().queue,1);store.finish(g,end+1,0);
  const next=store.claim('groups',end+CIRCUIT_WINDOW_MS)!;store.freeze(next,end+CIRCUIT_WINDOW_MS);
  q=store.rows<{payload:string}>('SELECT payload FROM queue ORDER BY created_at');assert.equal(q.length,2);assert.deepEqual(JSON.parse(q[1].payload).codes,['KTLEV']);
  store.freeze(next,end+CIRCUIT_WINDOW_MS);assert.equal(store.health().queue,2);
 }finally{close();}
});
test('legacy mixed circuit windows retain only in-scope members and codes',()=>{
 const {store,close}=setup();try{
  store.configure(pref({circuitNotifications:true}),NOW);const lease=store.claim('live',NOW)!;
  store.save(item(101,{title:'Devre Kesici',stockCode:'KTLEV'}),lease,NOW,true);
  const outside=item(102,{title:'Devre Kesici',stockCode:'MEPET'});store.save(outside,lease,NOW,true);
  // Simulate a pending row written by the previous, unfiltered collector.
  store.run('INSERT INTO circuit_pending VALUES(?,?,?)',102,NOW,JSON.stringify(['MEPET']));
  const end=(Math.floor(NOW/CIRCUIT_WINDOW_MS)+1)*CIRCUIT_WINDOW_MS;store.freeze(store.claim('groups',end)!,end);
  const queue=store.row<{payload:string}>('SELECT payload FROM queue WHERE kind=\'circuit\'')!;
  assert.deepEqual(JSON.parse(queue.payload).disclosureIds,[101]);assert.deepEqual(JSON.parse(queue.payload).codes,['KTLEV']);
  assert.equal(store.rows('SELECT * FROM circuit_pending').length,0);assert.equal(store.rows('SELECT * FROM disclosures').length,2);
 }finally{close();}
});
test('KAP circuit checks align to three-minute boundaries without slowing the live collector',async()=>{
 const {store,close}=setup();let now=NOW+1234;const source:Source={listing:async()=>[],indices:async()=>{throw Error('unused');},disclosure:async()=>null};
 try{const c=new KapCollector(store,source,()=>now);await c.run('groups');assert.equal(store.row<{next_at:number}>("SELECT next_at FROM jobs WHERE name='groups'")!.next_at,NOW+CIRCUIT_WINDOW_MS);
  now+=1000;assert.equal(await c.run('groups'),false);await c.run('live');assert.equal(store.row<{next_at:number}>("SELECT next_at FROM jobs WHERE name='live'")!.next_at,now+30_000);
 }finally{close();}
});
test('KAP a missing ID cannot stall later disclosures; later publication is recovered once',async()=>{
 const {store,close}=setup();let now=NOW,missing=true;const source:Source={listing:async()=>[],indices:async()=>{throw Error('unused');},disclosure:async id=>id===101&&missing?null:item(id)};
 try{store.set('last_listing',{max:103});const c=new KapCollector(store,source,()=>now);await c.run('live');assert.equal(store.row<{cursor:number}>("SELECT cursor FROM jobs WHERE name='live'")!.cursor,103);assert.equal(store.health().queue,2);assert.equal(store.health().unresolvedGaps,1);
 now+=30_000;missing=false;await c.run('reconcile');assert.equal(store.health().queue,3);assert.equal(store.health().unresolvedGaps,0);
 }finally{close();}
});
test('KAP parser/HTTP failures never advance cursor; discovery repair can still ingest later IDs',async()=>{
 const {store,close}=setup();let now=NOW;const source:Source={listing:async()=>[],indices:async()=>{throw Error('kap_index_missing');},disclosure:async id=>{if(id===101)throw Error('kap_id_mismatch');return item(id);}};
 try{store.run('INSERT INTO discovered VALUES(?,?,?)',102,new Date(NOW).toISOString(),NOW);const c=new KapCollector(store,source,()=>now);await c.run('live');assert.equal(store.row<{cursor:number}>("SELECT cursor FROM jobs WHERE name='live'")!.cursor,100);await c.run('reconcile');assert.equal(store.health().queue,1);
 for(let n=0;n<7;n++){now+=300_000;await c.run('live');const r=store.row<{next_at:number}>("SELECT next_at FROM jobs WHERE name='live'")!;assert.ok(r.next_at-now<=300_000);}
 const old={bist30:['TEST'],bist100:['TEST'],checkedAt:new Date(NOW).toISOString(),source:'verified fixture'};store.set('indices',old);await c.run('indices');assert.deepEqual(store.get('indices'),old);
 }finally{close();}
});
test('KAP full batch speeds to 5 seconds; empty edge returns to 30 seconds',async()=>{
 const {store,close}=setup();let now=NOW;const source:Source={listing:async()=>[],indices:async()=>{throw Error('unused');},disclosure:async id=>id<=103?item(id):null};
 try{const c=new KapCollector(store,source,()=>now);await c.run('live');assert.equal(store.row<{next_at:number}>("SELECT next_at FROM jobs WHERE name='live'")!.next_at,NOW+5000);now+=5000;await c.run('live');assert.equal(store.row<{next_at:number}>("SELECT next_at FROM jobs WHERE name='live'")!.next_at,now+30000);}finally{close();}
});
test('KAP network errors, protection HTML, redirect and oversize are not interpreted as no news',async()=>{
 for(const response of [new Response('denied',{status:403}),new Response('redirect',{status:302,headers:{location:'https://evil.test'}}),new Response('<html>protection</html>',{headers:{'content-type':'text/html'}}),new Response('huge',{headers:{'content-type':'text/html','content-length':String(17*1024*1024)}})]){const c=new KapClient(async()=>response);await assert.rejects(()=>c.disclosure(101));}
 assert.equal(await new KapClient(async()=>new Response('',{status:404})).disclosure(101),null);
});
test('KAP bootstrap reconciliation does not accelerate the separate silent backfill job',async()=>{
 const {store,close}=setup();let calls=0;const source:Source={listing:async()=>[],indices:async()=>{throw Error('unused');},disclosure:async id=>{calls++;return item(id);}};
 try{await new KapCollector(store,source,()=>NOW).run('reconcile');assert.equal(calls,0);assert.equal(store.health().queue,0);}finally{close();}
});
test('KAP digest and correction IDs persist independently; no title-based event merge',()=>{
 const {store,close}=setup();try{store.configure(pref({funds:'digest'}));const l=store.claim('live',NOW)!;
 store.save(item(101,{title:'Tera Fon Duyurusu',disclosureType:'FON'}),l,NOW,true);store.save(item(102,{title:'Tera Fon Duyurusu',disclosureType:'FON',isChanged:'DUZENLENEN',relatedDisclosureOid:'a'.repeat(32)}),l,NOW,true);
 const rows=store.rows<{kind:string;available_at:number}>('SELECT kind,available_at FROM queue');assert.equal(rows.length,2);assert.equal(rows[0].kind,'instant');assert.equal(rows[0].available_at,NOW);assert.equal(store.row<{correction:number}>('SELECT correction FROM disclosures WHERE id=102')!.correction,1);
 }finally{close();}
});
test('KAP unread HTTP response body is covered by the 12 second timeout',async()=>{
 const source=new KapClient(async(_url,init)=>new Response(new ReadableStream({start(controller){init!.signal!.addEventListener('abort',()=>controller.error(new DOMException('aborted','AbortError')),{once:true});}}),{headers:{'content-type':'text/html'}}));
 await assert.rejects(()=>source.disclosure(101),{name:'AbortError'});
});
test('KAP captured public metadata contracts remain valid across five actual disclosure types',()=>{
 for(const kind of ['breaker','fund','buyback','company','finance']){const b=JSON.parse(readFileSync(new URL(`fixtures/kap/${kind}.json`,import.meta.url),'utf8'));const d=parseDisclosure(page(b),b.disclosureIndex);assert.equal(d.id,b.disclosureIndex);assert.ok(d.publishedAt.endsWith('Z'));if(kind==='fund')assert.deepEqual(d.subjectCodes,[]);if(kind==='buyback')assert.equal(classify(d)[0],'buyback');if(kind==='breaker')assert.equal(classify(d)[0],'circuit');}
});
test('KAP older retry cannot starve behind an unending stream of newer discoveries',()=>{
 const {store,close}=setup();try{const lease=store.claim('live',NOW)!;store.gap(101,'error','kap_http_503',lease,NOW);store.run('INSERT INTO discovered VALUES(?,?,?)',102,new Date(NOW+60_000).toISOString(),NOW+60_000);assert.equal(store.nextRepair(NOW+60_000),101);}finally{close();}
});

test('KAP circuit opt-out overrides watchlists, selected topics, index priority and mixed titles',()=>{
 const p=pref({watchlist:[{ticker:'TEST',mode:'all',topics:[]}],otherCompanies:'topics',otherTopics:['circuit','financial','business']});
 for(const d of [item(101,{title:'Devre Kesici'}),item(102,{title:'Pay Alım Bildirimi',summary:'Devre Kesici uygulanmıştır.'})]){
  const r=decide(d,p,{bist30:['TEST'],bist100:['TEST'],checkedAt:'',source:''});assert.equal(r.action,'off');assert.equal(r.reason,'circuit_disabled');assert.equal(r.store,true);
 }
 for(const title of ['Yeni İş İlişkisi','Sözleşme İmzalanması','İhale Sonucu','Sipariş Alınması','Finansal Rapor','Finansal Tablolar','Bilanço Açıklaması','Kar Payı Dağıtımı','Bedelsiz Sermaye Artırımı'])assert.equal(decide(item(101,{title}),pref(),null).action,'instant',title);
 assert.deepEqual(classify(item(101,{title:'Bilanço Açıklaması'})),['financial']);
 const legacy={...DEFAULTS} as Partial<Preferences>;delete legacy.circuitNotifications;assert.equal(preferences(legacy).circuitNotifications,false);
});
test('KAP disabling circuits suppresses queued and not-yet-frozen groups without deleting source history',()=>{
 const {store,close}=setup();try{
  store.configure(pref({circuitNotifications:true}),NOW);const l=store.claim('live',NOW)!;store.save(item(101,{title:'Devre Kesici',stockCode:'KTLEV'}),l,NOW,true);
  const end=NOW+CIRCUIT_WINDOW_MS,g=store.claim('groups',end)!;store.freeze(g,end);store.finish(g,end,0);
  const next=store.claim('live',end)!;store.save(item(102,{title:'Devre Kesici',stockCode:'KTLEV'}),next,end+1,true);store.save(item(103,{title:'Yeni İş İlişkisi'}),next,end+1,true);
  store.configure(pref());const later=store.claim('groups',end+CIRCUIT_WINDOW_MS)!;store.freeze(later,end+CIRCUIT_WINDOW_MS);
  assert.equal(store.row<{n:number}>("SELECT count(*) n FROM queue WHERE kind='circuit' AND state='ready'")!.n,0);
  assert.equal(store.row<{n:number}>("SELECT count(*) n FROM queue WHERE kind='circuit' AND state='suppressed'")!.n,2);
  assert.equal(store.row<{n:number}>("SELECT count(*) n FROM queue WHERE kind='instant' AND state='ready'")!.n,1);
  const last=store.claim('live',end+CIRCUIT_WINDOW_MS)!;store.save(item(104,{title:'Devre Kesici',stockCode:'KTLEV'}),last,end+CIRCUIT_WINDOW_MS,true);assert.equal(store.health().sources,4);assert.equal(store.health().circuitPending,0);
 }finally{close();}
});

test('focused KAP subjects exclude governance and ratings while retaining deals, financials and trades',()=>{
 const focused=pref({priorityIndices:false,otherCompanies:'topics',otherTopics:['business','financial','buyback','share_trade','dividend','capital']});
 for(const title of ['Yönetim Kurulu Komiteleri','Kurumsal Yönetim Bilgi Formu (Güncelleme) - Yönetim Kurulu-1','Yönetim Bilgi Formu','Kredi Derecelendirilmesi','Kredi Derecelendirmesi','Finansal Takvim','Sorumluluk Beyanı (Konsolide Olmayan)','Genel Kurul Bildirimi']){
  assert.equal(decide(item(101,{title}),focused,null).action,'off',title);
 }
 for(const summary of ['Bağımsız Yönetim Kurulu Üyesinin Görevden Ayrılması','Yönetim Kurulu Üye Değişkliği Hakkında','Kredi Derecelendirilmesi']){
  const d=item(101,{title:'Özel Durum Açıklaması (Genel)',summary});
  assert.equal(decide(d,focused,null).action,'off');
  assert.equal(decide(d,pref({watchlist:[{ticker:'TEST',mode:'all',topics:[]}]}),{bist30:['TEST'],bist100:['TEST'],checkedAt:'',source:''}).action,'off');
 }
 for(const summary of ['SIAL Paris Fuarı Kapsamında Alınan Yeni Siparişler','9A26 Finansalları Hk.','Yeni İş Anlaşması','Yeni Sözleşme İmzalanması'])assert.equal(decide(item(101,{title:'Özel Durum Açıklaması (Genel)',summary}),focused,null).action,'instant',summary);
 assert.equal(decide(item(101,{title:'Özel Durum Açıklaması (Genel)',summary:'Şirket Pay Alım Bildirimi',stockCode:'KPEKS'}),focused,null).action,'instant');
 assert.equal(decide(item(101,{title:'Özel Durum Açıklaması (Genel)',summary:'Şirket Pay Alım Bildirimi',stockCode:'TEST'}),focused,null).action,'off');
 for(const title of ['Payların Geri Alınmasına İlişkin Bildirim','Payların Alınıp Satılmasına İlişkin Bildirim','Pay Alım Satım Bildirimi'])assert.equal(decide(item(101,{title,stockCode:'KPEKS',summary:'Yönetim Kurulu karar tarihi 01.10.2026'}),focused,null).action,'instant',title);
 for(const title of ['Finansal Rapor','Faaliyet Raporu (Konsolide Olmayan)','Yönetim Kurulu Faaliyet Raporu','Bilanço','Yeni İş İlişkisi','Yeni İşler','İhale Sonucu','Sözleşme İmzalanması'])assert.equal(decide(item(101,{title,summary:'Yönetim Kurulu karar tarihi 01.10.2026'}),focused,null).action,'instant',title);
 assert.equal(decide(item(101,{title:'Borsa Dışı Repo Sözleşmesi'}),focused,null).action,'off');
});

test('enabling circuits never replays late-discovered old disclosures or suppressed groups',()=>{
 const {store,close}=setup();try{
  store.configure(pref({circuitNotifications:true}),NOW+1000);const l=store.claim('live',NOW)!;
  store.save(item(101,{title:'Devre Kesici',publishDate:'2026.10.21 12:00:00'}),l,NOW+2000,true);
  assert.equal(store.health().circuitPending,0);
  store.configure(pref(),NOW+3000);store.configure(pref({circuitNotifications:true}),NOW+4000);
  assert.equal(store.rows("SELECT * FROM queue WHERE kind='circuit' AND state='ready'").length,0);
 }finally{close();}
});

test('index priority does not elevate routine forms over selected material topics',()=>{
 const p=pref({priorityIndices:true,otherCompanies:'topics',otherTopics:['business','financial','buyback','share_trade','dividend','capital','circuit']});
 const indices={bist30:['TEST'],bist100:['TEST'],checkedAt:new Date(NOW).toISOString(),source:'verified fixture'};
 for(const title of ['Finansal Takvim','Sorumluluk Beyanı (Konsolide Olmayan)','Genel Kurul Bildirimi'])assert.equal(decide(item(101,{title}),p,indices).action,'off');
 for(const title of ['Yeni İş İlişkisi','Kar Payı Dağıtımı','Sermaye Artırımı','Finansal Rapor'])assert.equal(decide(item(101,{title}),p,indices).action,'instant');
});

 test('interest-bearing non-equity disclosures are muted even for explicit tracking and funds',()=>{
 for(const title of ['Pay Dışında Sermaye Piyasası Aracı İşlemlerine İlişkin Bildirim (Faiz İçeren)','pay disi sermaye piyasasi araci islemleri (faiz iceren)']){
  for(const p of [pref(),pref({watchlist:[{ticker:'TEST',mode:'all',topics:[]}]}),pref({otherCompanies:'topics',otherTopics:['other'],funds:'instant'})]){
   assert.equal(decide(item(101,{title}),p,null).action,'off');
   assert.equal(decide(item(101,{title,disclosureType:'FON'}),p,null).action,'off');
  }
 }
 for(const title of ['Payların Geri Alınmasına İlişkin Bildirim','Pay Alım Satım Bildirimi'])assert.equal(decide(item(101,{title,stockCode:'KPEKS'}),pref(),null).action,'instant');
 for(const title of ['Yeni İş İlişkisi','Finansal Rapor'])assert.equal(decide(item(101,{title}),pref(),null).action,'instant');
 });

test('articles of association are muted even with share override; ordinary contracts stay enabled',()=>{
 const tracked=pref({watchlist:[{ticker:'TEST',mode:'all',topics:[]}]});
 for(const title of ['Esas Sözleşme Değişikliği','ESAS SOZLESME Tadil Metni','Pay Alım Bildirimi - Esas Sözleşme'])assert.equal(decide(item(101,{title}),tracked,null).action,'off');
 assert.equal(decide(item(101,{title:'Yeni İş İlişkisi',summary:'Esas sözleşme hükümlerine uygun yeni sözleşme imzalandı.'}),tracked,null).action,'instant');
});

test('MKK settlement issuer/title pair is muted across suffixes and tracking overrides',()=>{
 const title='Borçlanma Araçları, Yatırım Fonları ve Varant İtfa/Kupon/Getiri/Nakdi Uzlaşı Ödeme İşlemleri / AKMEN, ATAVK';
 const p=pref({funds:'instant',watchlist:[{ticker:'TEST',mode:'all',topics:[]}]});
 for(const t of [title,title.toLocaleUpperCase('tr'),title+' / Pay Alım Bildirimi']){
  const d=item(101,{title:t,companyTitle:'MERKEZİ KAYIT KURULUŞU A.Ş.'});assert.equal(decide(d,p,null).action,'off');
 }
 assert.equal(decide(item(101,{title:'Yeni İş İlişkisi',companyTitle:'MERKEZİ KAYIT KURULUŞU A.Ş.'}),p,null).action,'instant');
 assert.equal(decide(item(101,{title,companyTitle:'TEST SANAYİ A.Ş.'}),p,null).action,'instant');
 assert.equal(decide(item(101,{title:'Payların Geri Alınmasına İlişkin Bildirim',stockCode:'KPEKS'}),p,null).action,'instant');
});

test('empty official listing is valid but malformed data stays rejected',async()=>{
 assert.deepEqual(parseListing([],NOW),[]);
 for(const value of [null,{},'',{data:[]},[{}],Array(10001).fill({})])assert.throws(()=>parseListing(value,NOW));
 const client=new KapClient(async()=>new Response('[]',{headers:{'Content-Type':'application/json'}}));
 assert.deepEqual(await client.listing(),[]);
});
test('empty discovery preserves cursors, preferences and pending records and recovers health',async()=>{
 const {store,close}=setup();try{
  const live=store.claim('live',NOW)!;store.save(item(),live,NOW,true);store.finish(live,NOW,30000);
  const before=JSON.stringify({jobs:store.rows("SELECT name,cursor,ceiling FROM jobs WHERE name!='discovery'"),queue:store.rows('SELECT * FROM queue'),preferences:store.get('preferences'),start:store.get('notification_start')});
  store.run("UPDATE jobs SET failures=5,last_error='kap_listing_shape' WHERE name='discovery'");
  const collector=new KapCollector(store,{listing:async()=>[],disclosure:async()=>null,indices:async()=>{throw Error('unused');}},()=>NOW+60001);
  await collector.run('discovery');
  assert.equal(JSON.stringify({jobs:store.rows("SELECT name,cursor,ceiling FROM jobs WHERE name!='discovery'"),queue:store.rows('SELECT * FROM queue'),preferences:store.get('preferences'),start:store.get('notification_start')}),before);
  assert.equal(store.latest(),100);assert.equal(store.get<{count:number}>('last_listing')!.count,0);
  assert.deepEqual({...store.row<Record<string,unknown>>('SELECT failures,last_error,last_ok FROM jobs WHERE name=\'discovery\'')},{failures:0,last_error:null,last_ok:NOW+60001});
 }finally{close();}
});
test('first empty discovery waits for a real high-water mark without replaying history',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sector-kap-empty-')),store=new KapStore(join(dir,'kap.sqlite'));
 try{const lease=store.claim('discovery',NOW)!;store.discover([],lease,NOW);
  assert.equal(store.get('notification_start'),null);assert.equal(store.latest(),0);
  store.discover([{id:100,publishedAt:new Date(NOW-1000).toISOString()}],lease,NOW);
  assert.equal(store.row<{cursor:number}>("SELECT cursor FROM jobs WHERE name='live'")!.cursor,100);
  assert.equal(store.rows('SELECT * FROM queue').length,0);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
