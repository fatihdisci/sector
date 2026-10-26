import test from'node:test';import assert from'node:assert/strict';import{writeFile,mkdir}from'node:fs/promises';import{cardPageDrafts,draftCards}from'../src/card-pages';import{png}from'../scripts/render_local';import{validateCardData}from'../src/card-data';import type{Draft}from'../src/types';
const rows=Array.from({length:20},(_,i)=>({label:'A'+String(i).padStart(4,'0'),value:'94,05 TL|+%10,00|13.383'}));
const draft:Draft={headline:'📊 Teorik eşleşmede öne çıkanlar',body:'Teorik fiyatlar gerçekleşmiş işlem fiyatı değildir.',card_headline:'Teorik eşleşme',card_body:'Teorik eşleşmede öne çıkanlar',template:'theoretical',category:'bist',importance:80,hashtags:['#Borsa','#BIST'],card_data:{buy:rows,sell:rows.map(r=>({...r,value:'6,84 TL|-%10,00|923.160'}))},entities:[],claims:[],uncertainties:[],event_key:'fixture-theory'};
test('forty theoretical rows use four readable source-preserving cards with explicit columns and no real buy/sell labels',async()=>{
 const pages=cardPageDrafts(draft);assert.equal(pages.length,4);assert.deepEqual(pages.flatMap(p=>p.card_data!.buy!),rows);const svgs=draftCards(draft);
 for(const svg of svgs){assert(svg.includes('TEORİK FİYAT'));assert(svg.includes('DEĞİŞİM'));assert(svg.includes('KALAN'));assert(!svg.includes('ALICI KURUMLAR'));assert(!svg.includes('NET LOT'));const bytes=await png(svg);assert(bytes.length<5000000);assert.deepEqual([...bytes.slice(0,8)],[137,80,78,71,13,10,26,10]);}
 assert.throws(()=>draftCards({...draft,card_data:{buy:[{label:'KAPLM',value:'94,05 TL|%10'}]}}),/theoretical_cell_missing/);
 assert.throws(()=>draftCards({...draft,card_data:{buy:[...rows,rows[0]]}}),/multi_card_capacity/);
});
test('two distinct brokers have distinct panel labels; unknown names fail evidence check',async()=>{
 const d={...draft,template:'institutional' as const,card_headline:'Kurumlar üzerinden öne çıkan hisseler',card_data:{buy_broker:'BofA',sell_broker:'QNB',buy:[{label:'YKBNK',value:'1,16 milyar TL'}],sell:[{label:'ASTOR',value:'732,80 milyon TL'}]}};
 validateCardData(d.card_data,[{title:'BofA ve QNB kurum özeti',body:'YKBNK ASTOR'}as any]);const svg=draftCards(d)[0];assert(svg.includes('EN ÇOK NET ALIM'));assert(svg.includes('BofA üzerinden öne çıkan hisseler'));assert(svg.includes('EN ÇOK NET SATIM'));assert(svg.includes('QNB üzerinden öne çıkan hisseler'));await png(svg);
 assert.throws(()=>validateCardData({...d.card_data,sell_broker:'Uydurma'},[{title:'BofA QNB',body:'YKBNK ASTOR'}as any]),/unsupported_card_broker/);
});

test('trailing currency symbols retain exact currency and value; absent/different currency does not pass',async()=>{
 const{numericTokens,numericIssues}=await import('../src/editorial');assert.deepEqual(numericTokens('94,05₺'),['94,05₺']);
 for(const [source,value]of[['94,05₺','94,05 TL'],['3.000₺','3.000 TL'],['-1,16₺','-1,16 TL']]){const d={...draft,headline:'Fiyat bilgisi',body:'',card_headline:'Fiyat bilgisi',card_body:'',card_data:{metrics:[{label:'Fiyat',value}]}};assert.deepEqual(numericIssues(d,[{title:'Fiyat',body:source,language:'tr'}as any]),[]);assert(numericIssues({...d,card_data:{metrics:[{label:'Fiyat',value:value.replace('TL','USD')}]}},[{title:'Fiyat',body:source,language:'tr'}as any]).length>0);}
});

test('a following EUREN ticker cannot turn the preceding remaining quantity into EUR',async()=>{
 const{numericTokens}=await import('../src/editorial');assert.deepEqual(numericTokens('720.534 EUREN'),['720.534']);assert.deepEqual(numericTokens('720.534 EUR'),['720.534 eur']);assert.deepEqual(numericTokens('94,05 TL'),['94,05 tl']);
});
