import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('model repair feedback identifies an empty required entities field',()=>{
 const fact='Örnek Holding yeni tesis yatırımı planlıyor ve izin süreci devam ediyor.';
 const documents=[{source_id:'test',source_name:'Test',family:'test',official:false,url:'https://example.test',title:'Örnek Holding yatırım planını duyurdu',body:fact,passages:[{id:'p1',text:fact}],published_at:null}];
 const draft={headline:'📢 Örnek Holding yeni tesis planlıyor',body:'Yeni tesisin izin süreci henüz tamamlanmadı.',card_headline:'Örnek Holding yatırım planlıyor',card_body:'Yeni tesis için izin süreci sürüyor.',hashtags:['#Yatırım','#Sanayi'],category:'companies',importance:75,template:'company',claims:[{text:fact,evidence:[{document:0,passage:'p1',quote:fact}]}],entities:[],event_key:'ornek-yatirim',uncertainties:[]};
 const result=spawnSync(process.execPath,['--import','tsx','scripts/validate_draft.ts'],{input:JSON.stringify({draft,documents}),encoding:'utf8'});
 assert.equal(result.status,0);const issues=JSON.parse(result.stdout);assert(issues.includes('incomplete_draft'));assert(issues.some((issue:string)=>issue.includes('entities')));
});

import {readFile} from 'node:fs/promises';import {draftCards} from '../src/card-pages';import {CARD_LAYOUTS} from '../src/card-layout';import {postText} from '../src/editorial';import {modelCapacityDetails,capacityMessage} from '../src/output-capacity';import {localDatabase} from '../src/local-adapters';import {recordModelReview} from '../src/model-recovery';import type {Draft,Document,Env} from '../src/types';
const hsbc=JSON.parse(await readFile('test/fixtures/hsbc-capacity-rows.json','utf8'));
const fact='HSBC üzerinden net alım 1,4 milyar TL olarak aktarıldı.',sourceBody=fact+'\n'+hsbc.rows.map((r:any)=>r.side+' '+r.symbol+' '+r.volume).join('\n');
const hsbcDoc:Document={source_id:'manual-input',source_name:'HSBC kurum fixture',family:'fixture',official:false,url:'https://example.org/hsbc-fixture',title:'HSBC kurum analizi',body:sourceBody,passages:[{id:'p1',text:sourceBody}],published_at:null,market_data:{kind:'institutional',broker:'HSBC',rows:hsbc.rows}};
const hsbcDraft:Draft={headline:'📊 HSBC üzerinden öne çıkan hisseler',body:fact,card_headline:'HSBC üzerinden öne çıkan hisseler',card_body:'Kurum üzerinden alım ve satım',template:'institutional',category:'bist',hashtags:['#Borsa','#BIST'],importance:70,entities:['HSBC'],event_key:'hsbc-capacity',uncertainties:[],claims:[{text:fact,evidence:[{document:0,passage:'p1',quote:fact}]}],card_data:{broker:'HSBC',buy:hsbc.rows.filter((r:any)=>r.side==='buy').map((r:any)=>({label:r.symbol,value:r.volume})),sell:hsbc.rows.filter((r:any)=>r.side==='sell').map((r:any)=>({label:r.symbol,value:r.volume}))}};
function preflight(draft:Draft,documents:Document[]=[hsbcDoc]){const r=spawnSync(process.execPath,['--import','tsx','scripts/validate_draft.ts'],{input:JSON.stringify({draft,documents}),encoding:'utf8'});assert.equal(r.status,0);return JSON.parse(r.stdout) as string[];}
test('same HSBC source rows fit all six layouts; caption boundary reports only numeric length and limit',()=>{
 for(const layout of CARD_LAYOUTS)assert.equal(draftCards(hsbcDraft,'navy',layout).length,1);
 assert(!preflight(hsbcDraft).includes('output_capacity_exceeded'));
 const base=postText({...hsbcDraft,body:''}).length;for(const length of [1024,1025]){
  const d={...hsbcDraft,body:'x'.repeat(length-base-2)}; // postText omits an empty body separator.
  const measured=postText(d).length,issues=preflight(d),details=modelCapacityDetails(issues);assert.equal(measured,length);assert.equal(issues.includes('output_capacity_exceeded'),measured>1024);
  if(measured>1024)assert(details.some(v=>v.stage==='caption'&&v.length===measured&&v.limit===1024));
 }
});
test('card overflow records the failed layout, safe error code, text lengths and row counts without content',()=>{
 const bad={...hsbcDraft,card_headline:'Q'.repeat(1200)},details=modelCapacityDetails(preflight(bad));assert(details.length>0);assert(details.every(d=>d.stage==='card'&&CARD_LAYOUTS.includes(d.layout as any)));assert(details.some(d=>(d.lengths as any).card_headline===1200));const encoded=JSON.stringify(details);assert(!encoded.includes('QQQ'));assert(!encoded.includes('ASTOR'));assert(!encoded.includes('HSBC'));
 assert.match(capacityMessage('output_capacity_exceeded',undefined,'bot_query')!,/Bot sorgusu yanıtı alındı/);assert(!/PDF/.test(capacityMessage('output_capacity_exceeded',undefined,'bot_query')!));
});
test('model review persists counts-only capacity details tied to job and never starts a retry',async()=>{
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));
 await DB.prepare("INSERT INTO sources(id,config) VALUES('s','{}')").run();await DB.prepare("INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen) VALUES('a','s','https://example.org/a','fixture','','2026-10-28',1)").run();await DB.prepare("INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,state) VALUES('j','a','[]','hash',1,'needs_review')").run();
 const detail='capacity_detail:'+JSON.stringify({stage:'caption',code:'caption_too_long',length:1050,limit:1024,secret:'do-not-store'});
 await recordModelReview({DB} as Env,'j',{issues:['output_capacity_exceeded',detail]},100);
 const stored=JSON.parse((await DB.prepare("SELECT value FROM system_state WHERE key='model_capacity:j'").first<any>()).value);assert.deepEqual(stored,{version:1,job_id:'j',at:100,details:[{stage:'caption',code:'caption_too_long',length:1050,limit:1024}]});assert.equal((await DB.prepare("SELECT state FROM model_jobs WHERE id='j'").first<any>()).state,'needs_review');
 assert.deepEqual(modelCapacityDetails(['capacity_detail:not-json','capacity_detail:'+JSON.stringify({stage:'card',layout:'secret',code:'api-key'})]),[]);
});

import {repairDraftStyle} from '../src/style';import {validateDraft} from '../src/editorial';
test('exact Yapi Kredi 10+10 source survives redundant same-broker fields without entering the five-row dual summary',async()=>{
 const f=JSON.parse(await readFile('test/fixtures/yapi-kredi-capacity-rows.json','utf8')),fact='YAPI KREDI üzerinden net satış 225,0 milyon TL olarak aktarıldı.',body=fact+'\n'+f.rows.map((r:any)=>r.side+' '+r.symbol+' '+r.volume).join('\n');
 const doc:Document={...hsbcDoc,title:'YAPI KREDI kurum analizi',body,passages:[{id:'p1',text:body}],market_data:{kind:'institutional',broker:f.broker,rows:f.rows}};
 const original:Draft={...hsbcDraft,headline:'📊 YAPI KREDI üzerinden öne çıkan hisseler',card_headline:'YAPI KREDI üzerinden öne çıkan hisseler',body:fact,entities:['YAPI KREDI'],claims:[{text:fact,evidence:[{document:0,passage:'p1',quote:fact}]}],card_data:{broker:f.broker,buy_broker:f.broker,sell_broker:f.broker,buy:f.rows.filter((r:any)=>r.side==='buy').map((r:any)=>({label:r.symbol,value:r.volume})),sell:f.rows.filter((r:any)=>r.side==='sell').map((r:any)=>({label:r.symbol,value:r.volume}))}};
 const before=JSON.stringify(doc);assert.equal(original.card_data!.buy!.length,10);assert.equal(original.card_data!.sell!.length,10);
 const failure=modelCapacityDetails(preflight(original,[doc]));assert.equal(failure.length,6);assert(failure.every(x=>x.code==='market_card_capacity_institution_summary'));
 const out=repairDraftStyle(original,[doc]);assert.equal(out.card_data!.buy_broker,undefined);assert.equal(out.card_data!.sell_broker,undefined);assert.equal(out.card_data!.broker,f.broker);assert.deepEqual(out.card_data!.buy,original.card_data!.buy);assert.deepEqual(out.card_data!.sell,original.card_data!.sell);assert.equal(out.body,original.body);assert.deepEqual(out.claims,original.claims);assert.equal(JSON.stringify(doc),before);
 assert(!preflight(out,[doc]).includes('output_capacity_exceeded'));validateDraft(out,[doc]);for(const layout of CARD_LAYOUTS){const cards=draftCards(out,'navy',layout);assert.equal(cards.length,1);for(const row of f.rows)assert(cards[0].includes(row.symbol));}
 const mismatch={...original,card_data:{...original.card_data,buy_broker:'Başka Kurum'}};assert.throws(()=>validateDraft(repairDraftStyle(mismatch,[doc]),[doc]),/unsupported_card_broker/);
 const summaryDoc={...doc,market_data:undefined,source_layout:{kind:'institution_summary' as const,panels:[],minimum_rows:0}};
 const realSummary={...original,card_data:{buy_broker:'Kurum A',sell_broker:'Kurum B',buy:original.card_data!.buy!.slice(0,5),sell:original.card_data!.sell!.slice(0,5)}};
 const preserved=repairDraftStyle(realSummary,[summaryDoc]);assert.equal(preserved.card_data!.buy_broker,'Kurum A');assert.equal(preserved.card_data!.sell_broker,'Kurum B');for(const layout of CARD_LAYOUTS)assert.equal(draftCards(preserved,'navy',layout).length,1);
 assert.throws(()=>draftCards({...realSummary,card_data:{...realSummary.card_data,buy:original.card_data!.buy}},'navy','editorial'),/market_card_capacity_institution_summary/);
});
