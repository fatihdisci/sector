import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import twitter from 'twitter-text';
import {parseMarketOverview,withOverviewEvidence} from '../src/market-overview';
import {repairDraftStyle} from '../src/style';
import {validateDraft,postText,numericIssues} from '../src/editorial';
import {draftCards} from '../src/card-pages';
import {png} from '../scripts/render_local';
import {tableView} from '../src/editor-tools';
import {marketTimeIssues} from '../src/market-time';
import type {Document,Draft} from '../src/types';
const fixture=JSON.parse(await readFile('test/fixtures/market-overview-26431.json','utf8'));
const source:Document=fixture.document;
const raw:Draft={headline:'📊 Gün ortası — BIST 100 görünümü',body:'Kaynak tablosunda endeks seviyesi 11.004,37 puan.',card_headline:'Gün ortası — BIST 100 görünümü',card_body:'Görselde işlem hacmi 49,7 milyar TL.',template:'market',category:'bist',hashtags:['#Borsa','#BIST'],importance:65,entities:['BIST 100'],event_key:'fixture-market-overview',claims:[],uncertainties:[],source_notes:['Kaynak veri tarihi ayrıca teyit edilmedi.']};
const docs=withOverviewEvidence([source]),draft=repairDraftStyle(raw,docs);
test('public cached reader fixture becomes a substantive dashboard and tweet, with no public source filler',()=>{
 assert.equal(fixture.provenance.includes('not independent official data'),true);assert.deepEqual(numericIssues(draft,docs),[]);assert.equal(validateDraft(draft,docs).verification,'single_source_attributed');
 const text=postText(draft);assert(!/kaynak tablos|görselde|belirtiliyor/iu.test(text));assert(text.includes('11.004,37'));assert(text.includes('49,7 milyar TL'));assert(text.includes('163 hisse yükseldi, 449 hisse geriledi'));
 assert.equal(twitter.parseTweet(text).valid,true);assert.equal((text.match(/#[A-Z][A-Z0-9]{3,4}\b/g)??[]).filter(c=>c!=='#BIST').length,10);
 assert(text.includes('Pozitif katkı: #ASTOR #FROTO #CVKMD #TCKRC #RYSAS'));assert(text.includes('Negatif katkı: #ASELS #EREGL #ISCTR #GUBRF #TUPRS'));
 assert.equal(draft.card_headline,'Gün ortası');assert.equal(draft.card_data!.overview!.panels.flatMap(p=>p.rows).length,15);assert.equal(tableView(draft,docs).length,25);
 assert(draft.source_notes!.includes(raw.source_notes![0]));assert.deepEqual(repairDraftStyle(draft,docs),draft);assert.deepEqual(withOverviewEvidence(docs),docs);assert.deepEqual(marketTimeIssues(draft,docs),[]);
});
test('decimal punctuation, negative contribution and missing currency preserve source meaning',()=>{
 const o=parseMarketOverview(source);assert.equal(o.low,'11.004,37');assert.equal(o.points,'-112,62');assert.equal(o.panels[0].rows[4].value,'+0,9 puan');assert.equal(o.panels[1].rows[4].value,'-6,9 puan');
 assert.equal(o.brokers[0].first5,'%67,2');assert.equal(o.brokers[1].first5,'%91,5');assert.equal(o.panels[2].rows[0].value,'6,8 milyar');assert.equal(o.brokers[1].rows[0].net,'2,13 milyar');assert.equal(o.brokers[1].rows[0].total,'19,9 milyar TL');
});
test('incomplete panels, changed ticker ordering and overflow fail rather than hide rows behind a generic three-metric card',()=>{
 const missing=structuredClone(source);missing.passages=missing.passages.filter(p=>!p.text.startsWith('Endeksi yükseltenler'));assert.throws(()=>withOverviewEvidence([missing]),/section_missing/);
 const partial=structuredClone(missing);partial.source_layout!.minimum_rows=24;assert.throws(()=>withOverviewEvidence([partial]),/section_missing/);
 const wrong=structuredClone(source);wrong.source_layout!.panels[0].symbols[0]='XXXXX';assert.throws(()=>parseMarketOverview(wrong),/row_coverage/);
 const extra=structuredClone(source);const p=extra.passages.find(p=>p.id.startsWith('image_normalized_')&&p.text.startsWith('Endeksi yükseltenler'))!;p.text+=' ABCDE +1.0';extra.source_layout!.panels[0].symbols.push('ABCDE');assert.throws(()=>parseMarketOverview(extra),/capacity/);
 const dropped=structuredClone(draft);dropped.card_data!.overview!.panels[0].rows.pop();assert.throws(()=>validateDraft(dropped,docs),/market_overview_source_mismatch/);
 const amount=structuredClone(draft);amount.card_data!.overview!.brokers[0].rows[0].net='9,99 milyar';assert.throws(()=>validateDraft(amount,docs),/market_overview_source_mismatch/);
});
test('real navy and paper PNGs contain every panel and row, remain date/source-free and ignore unsupported random classic layouts',async()=>{
 for(const theme of ['paper','navy'] as const){const svg=draftCards(draft,theme,'editorial')[0],o=draft.card_data!.overview!;
  for(const p of o.panels)for(const r of p.rows)assert(svg.includes(r.label),r.label);
  for(const b of o.brokers)for(const r of b.rows)assert(svg.includes(r.name),r.name);
  assert(svg.includes('ENDEKS'));assert(svg.includes('NET HACİM'));assert(svg.includes('TOPLAM TL'));assert(!/Kaynak tablosunda|Görselde|14:00|26 Ekim|2026-10-26/u.test(svg));assert(!svg.includes('0.9.'));assert(!svg.includes('67.2.'));
  assert.equal(svg,draftCards(draft,theme,'brief')[0]);const bytes=await png(svg);assert(bytes.length>20000);const v=new DataView(bytes.buffer,bytes.byteOffset);assert.equal(v.getUint32(16),1080);assert.equal(v.getUint32(20),1350);
 }
 const long=structuredClone(draft);long.card_data!.overview!.brokers[0].rows[0].name='Çok uzun kurum adı '.repeat(15);assert.throws(()=>draftCards(long),/cell_capacity/);
 const overflow=structuredClone(draft);overflow.card_data!.overview!.panels[0].rows.push({label:'EXTRA',value:'+1 puan'});assert.throws(()=>draftCards(overflow),/capacity/);
});
test('dated uncertainty stays editor-visible and unbound original timestamps never create a fabricated period label',()=>{
 const d=structuredClone(source);delete d.channel_publication;delete d.market_editorial_context;const docs=withOverviewEvidence([d]);const out=repairDraftStyle({...raw,uncertainties:['Veri dönemi ile açıklama çelişiyor.']},docs);assert.equal(out.card_headline,'BIST 100');assert(!postText(out).includes('Gün ortası'));assert.equal(validateDraft(out,docs).verification,'needs_review');assert.deepEqual(out.uncertainties,['Veri dönemi ile açıklama çelişiyor.']);
});
test('all authorized day-part labels remain editorial headers, without claiming a measurement time',async()=>{
 const {withMarketEditorialContext}=await import('../src/market-time');
 for(const [at,label]of [['2026-10-26T06:45:00Z','Güne başlarken'],['2026-10-26T07:30:00Z','Açılışın ilk dakikaları'],['2026-10-26T12:30:00Z','Kapanışa doğru'],['2026-10-26T15:05:00Z','Kapanışta']]as const){const d=structuredClone(source);d.channel_publication!.posted_at=at;const docs=withOverviewEvidence(withMarketEditorialContext([d])),out=repairDraftStyle(raw,docs);assert.equal(out.card_headline,label);assert.deepEqual(marketTimeIssues(out,docs),[]);assert.equal(validateDraft(out,docs).verification,'single_source_attributed');}
});
test('complete dashboard reaches the existing independent audit and unsupported UI actions stay hidden',async()=>{
 const {acceptHermes}=await import('../src/ai'),{draftKeyboard}=await import('../src/telegram-ui');
 assert.equal(acceptHermes(raw,{supported:true,issues:[]},docs).draft.card_data!.overview!.panels.length,3);
 assert.throws(()=>acceptHermes(raw,{supported:false,issues:['Yanlış kurum eşleşmesi']},docs),/semantic_review_failed/);
 const rows=draftKeyboard('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',1,docs,true,draft,{},'more').inline_keyboard.flat();assert(rows.some(b=>b.text==='PNG indir'));assert(rows.some(b=>b.text==='Tablo verileri'));assert(rows.some(b=>b.text==='Kanıtlar'));assert(!rows.some(b=>['Tasarımı değiştir','Hücre düzelt'].includes(b.text)));
});
test('unreadable full overview is isolated into review before any model call; next eligible job can lease',async()=>{
 const {localDatabase}=await import('../src/local-adapters'),{leaseJob}=await import('../src/bridge'),{sha256}=await import('../src/utils/text');
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),at=Math.floor(Date.now()/1000),broken=structuredClone(source);broken.passages=broken.passages.filter(p=>!p.text.startsWith('Endeksi yükseltenler'));
 await DB.prepare("INSERT INTO sources(id,config)VALUES('sermaye-telegram','{}')").run();
 for(const [id,doc]of [['broken',broken],['next',{...source,source_id:'manual-input',source_layout:undefined}]]as const){const input=JSON.stringify([doc]);await DB.prepare("INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen,status)VALUES(?,'sermaye-telegram',?,'table','','2026-10-26',?,'model_queued')").bind(id,doc.url+'/'+id,at).run();await DB.prepare("INSERT INTO news_cards(id,article_id,state,created_at)VALUES(?,?,'model_queued',?)").bind(id,id,at).run();await DB.prepare("INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,kind)VALUES(?,?,?,?,?,'news')").bind(id,id,input,await sha256(input),at+(id==='next'?1:0)).run();}
 assert.equal(await leaseJob({DB}as any),null);assert.equal((await DB.prepare("SELECT state FROM model_jobs WHERE id='broken'").first<any>()).state,'needs_review');assert.equal((await leaseJob({DB}as any))?.id,'next');assert.equal((await DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,0);
});

test('explicit currency in the same net-hacim cell is retained; no currency is inferred for adjacent cells',()=>{
 const d=structuredClone(source);const p=d.passages.find(p=>p.id==='image_normalized_10')!;p.text=p.text.replace('İş: 1,26 milyar;', 'İş: 1,26 milyar TL;');const o=parseMarketOverview(d);assert.equal(o.brokers[0].rows[0].net,'1,26 milyar TL');assert.equal(o.brokers[0].rows[1].net,'504,80 milyon');
});

test('channel programme selects only opening metrics, first moves or close from original publication, never retry time',async()=>{
 const {withMarketEditorialContext}=await import('../src/market-time');
 for(const [time,view]of [['09:55','opening'],['10:01','first_moves'],['18:11','close']]as const){
  const d=structuredClone(source);d.channel_publication!.posted_at='2026-10-26T'+time+':00+03:00';d.channel_publication!.edited_at='2026-10-26T20:00:00+03:00';
  if(view==='opening')d.passages=d.passages.filter(p=>p.id==='channel_context'||/^BIST 100:/.test(p.text));
  if(view==='first_moves')d.passages=d.passages.filter(p=>p.id==='channel_context'||/^(En çok yükselenler|En çok düşenler|Hacim liderleri)/.test(p.text));
  const ds=withOverviewEvidence(withMarketEditorialContext([d])),out=repairDraftStyle(raw,ds),o=out.card_data!.overview!;
  assert.equal(o.view,view);assert.deepEqual(marketTimeIssues(out,ds),[]);assert.deepEqual(numericIssues(out,ds),[]);assert.equal(validateDraft(out,ds).verification,'single_source_attributed');assert(twitter.parseTweet(postText(out)).valid);
  const svg=draftCards(out)[0];assert((await png(svg)).length>15000);assert(!svg.includes('Diğer'));assert(!svg.includes('20:00'));
  if(view==='opening'){assert.equal(o.panels.length,0);assert.equal(o.brokers.length,0);assert(!svg.includes('HACİM'));assert(postText(out).includes('güne %1,01 düşüşle 11.004,37 puandan başladı'));}
  if(view==='first_moves'){assert.deepEqual(o.panels.map(p=>p.key),['gainers','losers','volume']);assert.equal(o.brokers.length,0);for(const p of o.panels)for(const r of p.rows){assert(svg.includes('#'+r.label));assert(postText(out).includes('#'+r.label));}}
  if(view==='close'){assert.equal(out.card_headline,'Gün sonu');assert(!svg.includes('YÜKSELENLER'));assert(!svg.includes('DÜŞENLER'));}
 }
});
test('summary intentionally omits gainers/losers and aggregate institutions; source evidence is retained',()=>{
 const o=parseMarketOverview(source);assert.deepEqual(o.panels.map(p=>p.key),['contribution_up','contribution_down','volume']);assert(o.brokers.every(b=>b.rows.length===5));assert(docs[0].passages.some(p=>p.text.includes('Diğer (34)')));
 const d=structuredClone(source);d.passages=d.passages.filter(p=>!/^En çok (yükselenler|düşenler)/.test(p.text));assert.deepEqual(parseMarketOverview(d),o);
});
