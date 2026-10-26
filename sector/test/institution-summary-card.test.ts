import test from'node:test';import assert from'node:assert/strict';import{draftCards}from'../src/card-pages';import{institutionSummaryCells}from'../src/market-card';import{CARD_LAYOUTS}from'../src/card-layout';import{png}from'../scripts/render_local';import type{Draft}from'../src/types';
const rows=['SAHOL','AKBNK','THYAO','ISCTR','GARAN'].map(label=>({label,value:'+132,17 Mn · maliyet 86,56 ₺'})),draft={headline:'📊 Kurum AKD özeti',body:'Kurumlar üzerinden öne çıkan hisseler',card_headline:'İş ve BofA üzerinden öne çıkan hisseler',card_body:'Kurumlar üzerinden öne çıkan hisseler',template:'institutional',category:'bist',importance:45,card_data:{buy_broker:'İş',sell_broker:'BofA',buy:rows,sell:rows.map(r=>({...r,value:'-253,42 Mn · maliyet 257,72 ₺'}))},claims:[],entities:[],hashtags:['#Borsa'],event_key:'summary',uncertainties:[]}as Draft;
test('institution summary uses two compact full-width tables, explicit roles and separate net-volume/cost columns in every theme/layout',async()=>{
 for(const theme of['paper','navy']as const)for(const layout of CARD_LAYOUTS){const svg=draftCards(draft,theme,layout)[0];assert(svg.includes('KURUM AKD ÖZETİ'));assert(svg.includes('EN ÇOK NET ALIM'));assert(svg.includes('EN ÇOK NET SATIM'));assert.equal((svg.match(/NET HACİM/g)||[]).length,2);assert.equal((svg.match(/MALİYET/g)||[]).length,2);assert.equal((svg.match(/>SAHOL</g)||[]).length,2);assert(!svg.includes('height="650"'));for(const m of svg.matchAll(/<text[^>]* y="([\d.]+)"/g))assert(Number(m[1])<1285);assert((await png(svg)).length>10000);}
});
test('summary retains exact units and missing cells; six rows fail explicitly while standard single-broker ten-row layout remains supported',()=>{
 assert.deepEqual(institutionSummaryCells('+132,17 Mn · maliyet 86,56 ₺'),['+132,17 Mn','86,56 ₺']);assert.deepEqual(institutionSummaryCells('-253,42 milyon TL'),['-253,42 milyon TL','—']);assert.deepEqual(institutionSummaryCells('— · maliyet —'),['—','—']);assert.throws(()=>institutionSummaryCells('100 Mn · 2 TL'),/cells_invalid/);
 assert.throws(()=>draftCards({...draft,card_data:{...draft.card_data,buy:[...rows,rows[0]]}}),/capacity_institution_summary/);
 assert.doesNotThrow(()=>draftCards({...draft,card_data:{broker:'BofA',buy:[...rows,...rows].map(r=>({...r,value:'1 milyon TL'}))}}));
});

test('real regenerated verbose net-volume labels do not overflow any summary layout or lose units',async()=>{
 const d={...draft,card_data:{...draft.card_data,buy:rows.map(r=>({...r,value:'+132,17 milyon net hacim · maliyet 86,56 TL'})),sell:rows.map(r=>({...r,value:'net hacim: -253,42 milyon · maliyet 257,72 TL'}))}};
 assert.deepEqual(institutionSummaryCells('+132,17 milyon net hacim · maliyet 86,56 TL'),['+132,17 milyon','86,56 TL']);assert.deepEqual(institutionSummaryCells('net hacim: -253,42 milyon TL · maliyet 257,72 TL'),['-253,42 milyon TL','257,72 TL']);
 for(const layout of CARD_LAYOUTS)for(const theme of['paper','navy']as const){const svg=draftCards(d,theme,layout)[0];assert(svg.includes('+132,17 milyon'));assert(svg.includes('-253,42 milyon'));assert(svg.includes('257,72 TL'));await png(svg);}
});
