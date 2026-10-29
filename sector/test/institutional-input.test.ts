import {assertCardPng} from './assert-card-dimensions';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {withMarketText,marketSelection,selectMarketDocument} from '../src/market-input';
import {queueManual} from '../src/manual';
import {manualDocuments} from '../scripts/manual_reader';
import {localDatabase} from '../src/local-adapters';
import {repairDraftStyle} from '../src/style';
import {validateDraft,numericIssues,postText} from '../src/editorial';
import {draftCard} from '../src/card';
import {CARD_LAYOUTS} from '../src/card-layout';
import {png} from '../scripts/render_local';
import {sameEvent,eventIdentity} from '../src/dedupe';
import type {Document,Draft,Env} from '../src/types';
const text=await readFile('test/fixtures/bopt.txt','utf8');
const raw:Document={source_id:'manual-input',source_name:'İlettiğin metin',family:'owner-submitted',official:false,url:'https://t.me/habernewssbot?start=source_10',title:'BANK OF AMERICA kurum analizi',body:text,passages:[{id:'provided_text',text}],published_at:null,language:'tr'};
const doc=withMarketText(raw);
const rows=(side:'buy'|'sell')=>doc.market_data!.rows!.filter(r=>r.side===side).map(r=>({label:r.symbol,value:r.volume}));
function draft(focus:'buy'|'sell'|'both'='both'):Draft{return {headline:'📊 Bank of America üzerinden işlemde öne çıkan hisseler',body:'Alım ve satım listelerinde farklı hisseler yer aldı.',card_headline:'Bank of America üzerinden öne çıkan hisseler',card_body:'İletilen kurum analizi.',template:'institutional',category:'bist',importance:86,hashtags:['#Borsa','#BIST'],entities:['BANK OF AMERICA'],claims:[{text:'CITAS alım listesinde yer aldı.',evidence:[{document:0,passage:'market_units',quote:doc.body}]}],event_key:'owner-bopt-analysis-'+focus,uncertainties:[],card_data:{...(focus!=='sell'?{buy:rows('buy')}:{}),...(focus!=='buy'?{sell:rows('sell')}:{})}};}
test('BoPT text preserves all 20 ranks, direction, explicit TL and decimal scales without recalculating rounded totals',()=>{
 assert.equal(doc.market_data?.kind,'institutional');assert.equal(doc.market_data?.broker,'BANK OF AMERICA');assert.equal(doc.market_data?.rows?.length,20);
 assert.deepEqual(doc.market_data?.rows?.[0],{side:'buy',symbol:'CITAS',volume:'43,9 milyon TL',rank:1});
 assert.deepEqual(doc.market_data?.rows?.at(-1),{side:'sell',symbol:'TOASO',volume:'34,6 milyon TL',rank:10});
 assert(doc.body.includes('769,4 milyon TL'));assert(doc.body.includes('-0,31%'));assert(doc.body.includes('1,5 milyar TL'));
 assert.equal(doc.passages[0].text,text);assert.deepEqual(withMarketText(doc),doc);assert.equal(marketSelection(text),undefined);
});
test('single-side instructions apply to source data while swapped rows, wrong amounts and made-up units fail',()=>{
 assert.equal(marketSelection('Sadece alınan hisseler'),'buy');assert.equal(marketSelection('yalnız satılanları hazırla'),'sell');assert.equal(marketSelection('İkisini de göster'),'both');
 for(const focus of ['buy','sell','both'] as const){const d=draft(focus),selected=selectMarketDocument(doc,focus);assert.doesNotThrow(()=>validateDraft(d,[selected]));assert.deepEqual(numericIssues(d,[selected]),[]);assert.equal(repairDraftStyle(d,[selected]).template,'institutional');}
 assert.throws(()=>validateDraft(draft(),[selectMarketDocument(doc,'buy')]),/market_focus_mismatch/);
 assert.throws(()=>validateDraft({...draft('buy'),card_data:{buy:[{label:'THYAO',value:'121,1 milyon TL'}]}},[selectMarketDocument(doc,'buy')]),/market_side_mismatch/);
 assert.throws(()=>validateDraft({...draft('buy'),card_data:{buy:[{label:'CITAS',value:'25,4 milyon TL'}]}},[selectMarketDocument(doc,'buy')]),/market_row_value_mismatch/);
 assert.throws(()=>validateDraft({...draft('buy'),card_data:{buy:[{label:'CITAS',value:'43,9 milyon USD'}]}},[selectMarketDocument(doc,'buy')]),/market_row_value_mismatch/);
 assert.throws(()=>selectMarketDocument({...raw,market_data:{kind:'custody',ticker:'THYAO'}},'buy'),/focus_unsupported/);
});
test('owner can reply to full bot text or its generated card for a new selection without scraping the rendered card',async()=>{
 const env={DB:await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),MODE:'dry_run',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'42'} as Env;
 const message={message_id:11,text:'Sadece alınanlar',from:{id:7},chat:{id:42,type:'private'},reply_to_message:{message_id:10,text}};
 assert.equal(await queueManual(env,100,message),true);
 const first=await env.DB.prepare('SELECT kind,input FROM manual_requests WHERE update_id=100').first<{kind:string;input:string}>();assert.equal(first!.kind,'text');assert.equal(JSON.parse(first!.input).focus,'buy');
 const original=await manualDocuments(env,first!.kind,first!.input,11);assert.equal(original[0].market_data?.focus,'buy');
 await env.DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,state,created_at,expires_at,message_id) VALUES('d','e','f',?,?,'single_source_attributed','pending',0,9999999999,20)").bind(JSON.stringify(draft()),JSON.stringify([raw])).run();
 await queueManual(env,101,{...message,message_id:12,text:'Sadece satılanlar',reply_to_message:{message_id:20,caption:'Yalnızca beş satırlık hazırlanmış kart',photo:[{file_id:'not-original',width:1080,height:1350}]}});
 const reuse=await env.DB.prepare('SELECT kind,input FROM manual_requests WHERE update_id=101').first<{kind:string;input:string}>();assert.equal(reuse!.kind,'market_reuse');
 const selected=await manualDocuments(env,reuse!.kind,reuse!.input,12);assert.equal(selected[0].market_data?.rows?.length,20);assert.equal(selected[0].market_data?.focus,'sell');assert.notEqual(selected[0].url,doc.url);assert.equal(JSON.parse(reuse!.input).source_message_id,10);
});
test('ten ranked stocks on one or both sides render full PNGs in every layout and palette',async()=>{
 for(const focus of ['buy','sell','both'] as const)for(const theme of ['navy','paper'] as const)for(const layout of CARD_LAYOUTS){
  const d=draft(focus),svg=draftCard(d,[],'',false,theme,layout);
  assert.equal(svg.includes('THYAO'),focus!=='buy');assert.equal(svg.includes('CITAS'),focus!=='sell');
  if(focus!=='sell')assert(svg.includes('ALARK'));if(focus!=='buy')assert(svg.includes('TOASO'));
  const bytes=Buffer.from(await png(svg));assertCardPng(bytes,svg);
 }
});
test('separately requested buy/sell views and updated snapshots are not swallowed by headline deduplication',async()=>{
 const both=draft(),buy={...draft('buy'),event_key:both.event_key},sell={...draft('sell'),event_key:both.event_key};
 assert.equal(sameEvent(both,buy),false);assert.equal(sameEvent(buy,sell),false);assert.equal(sameEvent(buy,{...buy}),true);
 assert.notEqual(await eventIdentity(buy,[doc]),await eventIdentity(sell,[doc]));
 assert.equal(sameEvent(buy,{...buy,card_data:{...buy.card_data,as_of:'22 Ekim 2026'}}),false);
 assert.equal(sameEvent(buy,{...buy,card_data:{...buy.card_data,broker:'Başka Kurum'}}),false);
});
test('market cards retain the broker subject and single-stock AKD/takas captions lead with one hashtag',()=>{
 const fixed=repairDraftStyle({...draft('buy'),card_headline:'Alım tarafında öne çıkan hisseler'},[selectMarketDocument(doc,'buy')]);
 assert.equal(fixed.card_data?.broker,'BANK OF AMERICA');assert(fixed.card_headline.includes('BANK OF AMERICA'));
 const d={...draft(),template:'custody' as const,headline:'📊 THYAO takas dağılımı',card_data:{ticker:'THYAO'},hashtags:['#Borsa','#BIST','#THYAO']};
 assert(postText(d).startsWith('📊 #thyao\nTakas dağılımı'));assert.equal(postText(d).split('#thyao').length-1,1);
});
test('a currency-free screenshot uses source ranks instead of ambiguous monetary amounts',()=>{
 const body=doc.body.replace(/ TL\b/g,''),image={...doc,body,passages:[{id:'market_units',text:body}],market_data:{...doc.market_data!,focus:'buy' as const,rows:doc.market_data!.rows!.map(r=>({...r,volume:r.volume.replace(/ TL$/,'')}))}};
 assert.throws(()=>validateDraft({...draft('buy'),card_data:{buy:[{label:'CITAS',value:'43,9 milyon'}]}},[image]),/market_currency_missing_use_rank/);
 const d={...draft('buy'),claims:[{text:'CITAS alım listesinde yer aldı.',evidence:[{document:0,passage:'market_units',quote:body}]}],card_data:{buy:rows('buy').map((r,i)=>({label:r.label,value:(i+1)+'. sıra'}))}};
 assert.doesNotThrow(()=>validateDraft(d,[image]));
});

test('institutional captions list five hashtagged stocks on each selected side while keeping all card rows',()=>{
 for(const focus of ['buy','sell','both'] as const){
  const d=draft(focus),text=postText(d);
  for(const side of ['buy','sell'] as const){
   const selected=focus!==(side==='buy'?'sell':'buy');
   const line=text.split('\n').find(l=>l.startsWith(side==='buy'?'Alınanlar:':'Satılanlar:'));
   assert.equal(!!line,selected);
   if(selected){assert.equal((line!.match(/#[a-z][a-z0-9]{3,4}/g)??[]).length,5);assert.equal(d.card_data![side]!.length,10);}
  }
  assert(!text.includes('#alark'));assert(!text.includes('#toaso'));
 }
});
test('general multi-stock captions hashtag mentioned codes once and circuit captions limit only the visible list',()=>{
 const d={...draft(),template:'news' as const,headline:'📢 CITAS için açıklama',body:'BIMAS ve SELEC gelişmeleri.',hashtags:['#Borsa','#BIST','#CITAS','#BIMAS','#SELEC']};
 const text=postText(d);for(const code of ['CITAS','BIMAS','SELEC'])assert.equal(text.split('#'+code.toLowerCase()).length-1,1);
 const codes=['CITAS','BIMAS','SELEC','GARAN','AKBNK','ENKAI'];
 const circuit={...draft(),template:'circuit' as const,card_data:{tickers:codes},hashtags:['#Borsa','#BIST',...codes.map(c=>'#'+c)]};
 assert(!postText(circuit).includes('#enkai'));assert.equal(circuit.card_data.tickers.length,6);
});

test('source rank determines the five displayed stocks even if model card rows arrive reversed',()=>{
 const input=draft();input.card_data!.buy!.reverse();input.card_data!.sell!.reverse();
 const fixed=repairDraftStyle(input,[doc]),text=postText(fixed);
 assert.equal(fixed.card_data!.buy![0].label,'CITAS');assert.equal(fixed.card_data!.sell![0].label,'THYAO');
 assert(text.includes('Alınanlar: #citas #selec #ktlev #sasa #enkai'));
 assert.equal(input.card_data!.buy![0].label,'ALARK');
});
