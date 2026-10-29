import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';
import {reportImage,validateTable,selectBuyback,buybackDraft,buybackTweet,buybackCsv,trDecimal} from '../src/is-buyback';
import {buybackCard,buybackLayout} from '../src/buyback-card';import {draftCard} from '../src/card';import {postText} from '../src/editorial';
import {png} from '../scripts/render_local';import {pollBuybacks} from '../src/buyback-pipeline';import {localDatabase,localMedia} from '../src/local-adapters';
import {saveReport} from '../src/kap-report-save';import {evidenceView,tableView} from '../src/editor-tools';import type {Env} from '../src/types';
const root='test/fixtures/is-buyback/',raw=JSON.parse(await readFile(root+'2026-10-23.json','utf8')),indices=JSON.parse(await readFile(root+'indices-2026-10-23.json','utf8'));
const at=Date.parse(indices.checkedAt),published='2026-10-23T06:08:50Z',url='https://arastirma.isyatirim.com.tr/2026/10/23/pay-geri-alimlari-23-10-2026/';
const html=await readFile(root+'article.html','utf8'),table=validateTable(raw,published);
const evidence={report_url:url,image_url:reportImage(html,url),image_hash:'a'.repeat(64),published_at:published,version:'v1',index_checked_at:indices.checkedAt,index_source:indices.source,reader:table.reader,raw_rows:table.rows};
test('real article discovery chooses content image, never guessed cover/date URLs',()=>{
 assert.match(evidence.image_url,/Geri_Alim-18-scaled.jpg$/);assert.throws(()=>reportImage('<article><img src="bad"></article>',url),/body_missing/);
 assert.throws(()=>reportImage(html.replace('</div>','<img src="https://arastirma.isyatirim.com.tr/wp-content/uploads/second.jpg"></div>'),url),/ambiguous/);
 assert.throws(()=>reportImage(html.replace(evidence.image_url,'https://127.0.0.1/x.jpg'),url),/unregistered/);
});
test('54 physical source rows, transaction date, nullable MASFN cells and exact totals preserved',()=>{
 assert.equal(table.rows.length,54);assert.equal(table.day,'2026-10-22');const m=table.rows.find(r=>r.ticker==='MASFN')!;assert.equal(m.price,null);assert.equal(m.amount,null);
 assert.equal(table.rows[0].amount,'2.799.860');assert.notEqual(table.rows[0].amount,'2.800.000');assert.equal(table.rows.find(r=>r.ticker==='OMD')?.ticker,'OMD');
 assert.equal(trDecimal('5.750.000'),'5750000');assert.equal(trDecimal('34,45'),'34.45');assert.equal(trDecimal(null),null);assert.throws(()=>trDecimal('34.45'),/invalid_number/);
 for(const input of [{...raw,row_count:55},{...raw,complete:false},{...raw,rows:raw.rows.map((r:any,i:number)=>i? r:{...r,day:'31.02.2026'})},{...raw,rows:raw.rows.map((r:any,i:number)=>i? r:{...r,price:'?',day:'22.10.2026'})}])assert.throws(()=>validateTable(input,published));
 assert.throws(()=>validateTable(raw,'2026-10-21T06:00:00Z'),/date_mismatch/);
});
test('index tier then exact nominal magnitude selects 10; absent/stale membership never invented',()=>{
 const s=selectBuyback(table,indices,at);assert(s.known);assert.equal(s.rows.length,10);assert.equal(new Set(s.rows.map(r=>r.ticker)).size,10);
 const tier=(c:string)=>indices.bist30.includes(c)?0:indices.bist100.includes(c)?1:2;
 assert(s.rows.every((r,i)=>!i||tier(s.rows[i-1].ticker)<=tier(r.ticker)));
 const unknown=selectBuyback(table,null,at);assert(!unknown.known);assert.deepEqual(unknown.rows.slice(0,3).map(r=>r.ticker),['AKFGY','GEDIK','TRALT']);
 assert(!selectBuyback(table,indices,at+40*3600000).known);
 assert(!selectBuyback(table,{...indices,bist30:[]},at).known);
 assert(!selectBuyback(table,{...indices,bist100:[]},at).known);
 const nonIndex={...table,rows:table.rows.filter(r=>!indices.bist100.includes(r.ticker))};assert.equal(selectBuyback(nonIndex,indices,at).rows.length,10);
 assert.equal(selectBuyback({...table,rows:table.rows.slice(0,3)},indices,at).rows.length,3);
 const equal={...table,rows:[{...table.rows[0],ticker:'ZZZZ',nominal:'10'},{...table.rows[0],ticker:'AAAA',nominal:'10'}]};assert.equal(selectBuyback(equal,null,at).rows[0].ticker,'AAAA');
});
test('tweet is X-weighted, exactly 10 hashtag codes; image has all 54, evidence stays editor-only',()=>{
 const {draft,documents}=buybackDraft(table,evidence,indices,at),tweet=buybackTweet(table,indices,at);assert.equal(postText(draft),tweet.text);assert(tweet.weightedLength<=280);assert.equal((tweet.text.match(/#[a-z0-9]+/g)??[]).length,10);
 assert(!/İş Yatırım|https|09:00|lot|adet/.test(postText(draft)));const svg=draftCard(draft);assert.equal((svg.match(/data-row=/g)??[]).length,54);assert(!/İş Yatırım|Kaynak|09:00|dipnot|TOPLAM LOT/.test(svg));
 assert.equal(tableView(draft,documents).length,54);assert.equal(evidenceView(draft,documents,'single_source_attributed').sources[0].report_evidence?.raw_rows.length,54);
 assert.match(buybackCsv(table),/"MASFN";"70.000";"";""/);
 draft.output_preferences={list:'first',count:5};assert.equal((draftCard(draft).match(/data-row=/g)??[]).length,54);
});
test('real PNG renders at low/medium/high capacity; every row is present and bounds remain readable',async()=>{
 for(const n of [3,54,150,200]){const rows=Array.from({length:n},(_,i)=>({...table.rows[i%table.rows.length],ticker:'A'+String(i).padStart(4,'0')})),t={...table,rows,row_count:n},svg=buybackCard(t),layout=buybackLayout(n),bytes=await png(svg);
  assert.equal((svg.match(/data-row=/g)??[]).length,n);assert(layout.font>=28);assert(layout.width<=4096&&layout.height<=4096);assert(bytes.length<5_000_000);assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);
  for(const m of svg.matchAll(/<text[^>]*\by="(\d+)"/g))assert(Number(m[1])<layout.height);
 }
 assert.throws(()=>buybackLayout(201),/capacity/);assert.throws(()=>buybackCard({...table,rows:[{...table.rows[0],amount:'123.456.789.012.345.678.901.234'}]}),/capacity/);
});
async function setup(){const dir=await mkdtemp(tmpdir()+'/is-buyback-');return {dir,env:{DB:await localDatabase(dir+'/news.sqlite',await readFile('migrations/0001_sector.sql','utf8')),MEDIA:await localMedia(dir+'/media'),MODE:'dry_run',RENDER_REPORT:png} as Env};}
function fakeFeed(){return `<rss version="2.0"><channel><item><title>Pay Geri Alımları 23/10/2026</title><link>${url}</link><pubDate>${published}</pubDate></item></channel></rss>`;}
const imageBytes=await readFile(root+'2026-10-23.jpg');
function transport(changed=false){const calls:string[]=[];return {calls,fetcher:(async(input:RequestInfo|URL)=>{const u=String(input);calls.push(u);assert(u.startsWith('https://arastirma.isyatirim.com.tr/'));return new Response(u.endsWith('/feed/')?fakeFeed():u.replace(/\/$/,'')===url.replace(/\/$/,'')?html:new Uint8Array(changed?[...imageBytes,1]:imageBytes),{headers:{'content-type':u===url?'text/html':'image/jpeg'}});}) as typeof fetch};}
test('isolated end-to-end: one ordinary draft; replay, restart and changed report version do not republish',async()=>{
 const {dir,env}=await setup();try{const t=transport(),io={fetcher:t.fetcher,readImage:async()=>structuredClone(raw),indices:async()=>indices,now:()=>at};
  await env.DB.prepare("INSERT OR IGNORE INTO system_state VALUES('buyback_discovery_since','0')").run();
  const first=await pollBuybacks(env,io);assert.equal(first.state,'ready');assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,1);
  assert.equal((await pollBuybacks(env,io)).draft_id,undefined);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,1);
  const same=await pollBuybacks(env,{...io,fetcher:transport(true).fetcher});assert.equal(same.state,'duplicate');
  // A new image + changed source value is a labelled correction, never X send.
  const corrected=structuredClone(raw);corrected.rows[0].amount='2.799.861';corrected.rows[0].raw[4]='2.799.861';
  const newTransport=transport();const base=newTransport.fetcher;newTransport.fetcher=async(u,o)=>String(u).endsWith('.jpg')?new Response(new Uint8Array([...imageBytes,2])):base(u,o);
  const correction=await pollBuybacks(env,{...io,fetcher:newTransport.fetcher,readImage:async()=>corrected});assert.equal(correction.state,'correction');
  const d=await env.DB.prepare('SELECT content FROM drafts WHERE id=?').bind(correction.draft_id).first<any>();assert.match(postText(JSON.parse(d.content)),/Düzeltme/);
  assert.equal((await env.DB.prepare('SELECT state FROM drafts WHERE id=?').bind(first.draft_id).first<any>()).state,'rejected');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM telegram_effects').first<any>()).n,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('unread values held for review; no stale feed relabelling and no legacy duplicate',async()=>{
 const {dir,env}=await setup();try{
  await env.DB.prepare("INSERT INTO system_state VALUES('buyback_discovery_since','0')").run();
  const io={fetcher:transport().fetcher,readImage:async()=>({...raw,row_count:55}),indices:async()=>null,now:()=>at};assert.equal((await pollBuybacks(env,io)).state,'needs_review');assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,0);
  assert.equal((await pollBuybacks(env,{...io,now:()=>at+4*86400000})).state,'no_new_report');
  await env.DB.prepare("INSERT INTO buyback_days VALUES('2026-10-22','kap','legacy','legacy')").run();
  assert.equal((await pollBuybacks(env,{...io,fetcher:transport(true).fetcher,readImage:async()=>raw})).state,'blocked_existing');
  const result=buybackDraft(table,evidence,indices,at);result.draft.event_key='buyback-'+Date.parse('2026-10-22T17:00:00+03:00');
  await env.DB.prepare("INSERT INTO manual_requests(update_id,message_id,kind,input,created_at) VALUES(1,1,'kap_report','{}',0)").run();await saveReport(env,{update_id:1,message_id:1},result);
  assert.equal((await env.DB.prepare('SELECT error FROM manual_requests').first<any>()).error,'daily_buyback_exists');
  result.draft.event_key='general_buyback-'+Date.parse('2026-10-22T17:00:00+03:00');await env.DB.prepare("UPDATE manual_requests SET error=NULL WHERE update_id=1").run();await saveReport(env,{update_id:1,message_id:1},result);assert.equal((await env.DB.prepare('SELECT error FROM manual_requests').first<any>()).error,'daily_buyback_exists');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('expired reader lease recovers; uncertain predecessor blocks correction without replay',async()=>{
 const {dir,env}=await setup();try{
  const io={fetcher:transport().fetcher,readImage:async()=>raw,indices:async()=>indices,now:()=>at};
  await env.DB.prepare("INSERT OR IGNORE INTO system_state VALUES('buyback_discovery_since','0')").run();
  const first=await pollBuybacks(env,io);assert.equal(first.state,'ready');
  await env.DB.prepare("UPDATE drafts SET delivery_state='uncertain' WHERE id=?").bind(first.draft_id).run();
  const changed=structuredClone(raw);changed.rows[0].amount='2.799.861';changed.rows[0].raw[4]='2.799.861';
  const held=await pollBuybacks(env,{...io,fetcher:transport(true).fetcher,readImage:async()=>changed});
  assert.equal(held.state,'needs_review');assert.equal(held.error,'existing_delivery_unresolved');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,1);
  // An interrupted read (before draft creation) can be claimed after its lease.
  await env.DB.prepare("UPDATE buyback_reports SET state='reading',lease_until=0 WHERE id=?").bind(held.id).run();
  await env.DB.prepare("UPDATE drafts SET delivery_state='sent' WHERE id=?").bind(first.draft_id).run();
  const recovered=await pollBuybacks(env,{...io,fetcher:transport(true).fetcher,readImage:async()=>changed});assert.equal(recovered.state,'correction');
  assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('new report evidence binds full real membership snapshot, dates, selected ten and source hash; legacy missing evidence is not fabricated',async()=>{
 const {buybackSelectionEvidence}=await import('../src/is-buyback'),{sha256}=await import('../src/utils/text');
 const selection=await buybackSelectionEvidence(table,indices,at),snapshot=selection.index_snapshot!;
 assert.equal(snapshot.members.bist30.length,30);assert.equal(snapshot.members.bist100.length,100);
 const {sha256:hash,...payload}=snapshot;assert.equal(hash,await sha256(JSON.stringify(payload)));assert.equal(selection.transaction_date,'2026-10-22');
 assert.deepEqual(selection.selected.map(s=>s.ticker),selectBuyback(table,indices,at).rows.map(r=>r.ticker));assert.equal(selection.selected.length,10);assert.equal(selection.selected[0].reason,'BIST30');
 const result=buybackDraft(table,{...evidence,selection},indices,at);assert.equal(result.documents[0].buyback_evidence?.selection?.index_snapshot?.sha256,hash);assert(!postText(result.draft).includes(snapshot.source_url));
 assert.equal(buybackDraft(table,evidence,indices,at).documents[0].buyback_evidence?.selection,undefined);
 assert.equal((await buybackSelectionEvidence(table,null,at)).index_snapshot,null);assert.equal((await buybackSelectionEvidence(table,indices,at+48*3600000)).selected[0].reason,'membership_unknown');
 const changed=structuredClone(selection);changed.selected.reverse();assert.throws(()=>buybackDraft(table,{...evidence,selection:changed},indices,at),/evidence_mismatch/);
});

test('first activation and restart do not backfill historical reports; only a subsequent new report may enter the ordinary queue',async()=>{
 const {dir,env}=await setup();try{let reads=0;const io={fetcher:transport().fetcher,readImage:async()=>{reads++;return raw;},indices:async()=>indices,now:()=>at};
 assert.equal((await pollBuybacks(env,io)).state,'before_activation');assert.equal((await pollBuybacks(env,io)).state,'before_activation');assert.equal(reads,0);
 assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,0);
 const t=transport();const base=t.fetcher;const fetcher:typeof fetch=async(u,o)=>String(u).endsWith('/feed/')?new Response(fakeFeed().replace(published,new Date(at+1000).toISOString())):base(u,o);
 assert.equal((await pollBuybacks(env,{...io,fetcher,now:()=>at+2000})).state,'ready');assert.equal(reads,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('natural buyback copy uses transaction day, Turkish month suffixes, singular/plural and unchanged selection',()=>{
 const expected=['1 Ocak’ta','1 Şubat’ta','1 Mart’ta','1 Nisan’da','1 Mayıs’ta','1 Haziran’da','1 Temmuz’da','1 Ağustos’ta','1 Eylül’de','1 Ekim’de','1 Kasım’da','1 Aralık’ta'];
 for(let m=1;m<=12;m++){const t={...table,day:`2026-${String(m).padStart(2,'0')}-01`},a=buybackTweet(t,indices,at);assert(a.text.startsWith(expected[m-1]));assert(a.text.includes('hangi şirketler kendi paylarını geri aldı?'));assert(a.text.endsWith('Geri alım yapan şirketlerin tamamı ve işlem detayları görsellerde.'));assert(a.weightedLength<=280);}
 for(const n of [1,3,10,54,200]){const rows=Array.from({length:n},(_,i)=>({...table.rows[i%table.rows.length],ticker:'A'+String(i).padStart(4,'0')})),t={...table,rows,row_count:n};
 for(const correction of[false,true]){const actual=buybackTweet(t,null,at,correction),selected=selectBuyback(t,null,at);assert.deepEqual(actual.rows,selected.rows);assert.equal((actual.text.match(/#[a-z0-9]+/g)??[]).length,Math.min(n,10));assert(actual.weightedLength<=280);assert.equal(actual.text.includes('Düzeltme:'),correction);assert(actual.text.includes(n===1?'şirket hangisi?':'hangi şirketler'));}}
 const t=buybackTweet(table,indices,at);assert(t.text.startsWith('22 Ekim’de'));assert(!t.text.includes('23 Ekim'));assert(!/📢|en çok|fiyat etkisi|lot|adet/.test(t.text));
 assert.throws(()=>buybackTweet({...table,day:'2026-02-30'},indices,at),/invalid_date/);assert.throws(()=>buybackTweet({...table,rows:[]},indices,at),/row_coverage/);
 const created=buybackDraft(table,evidence,indices,at);assert.equal(postText(created.draft),t.text,'closing paragraph must survive draft assembly');assert.deepEqual(created.draft.card_data?.report?.buyback,table);assert.equal(created.documents[0].buyback_evidence,evidence);
});
