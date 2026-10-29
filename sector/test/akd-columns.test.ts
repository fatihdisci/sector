import {assertCardPng} from './assert-card-dimensions';
import test from 'node:test';
import assert from 'node:assert/strict';
import {akdColumns} from '../src/akd-columns';
import {cardSvg} from '../src/card';
import {CARD_LAYOUTS} from '../src/card-layout';
import {png} from '../scripts/render_local';
import type {Template} from '../src/types';
test('AKD columns preserve explicit ratio, signed lot and currency-free cost',()=>{
 assert.deepEqual(akdColumns({label:'Ünlü',value:'%30,04 · 7.419.604 lot · 4,70'}),{ratio:'%30,04',quantity:'7.419.604',unit:'lot',cost:'4,70'});
 assert.equal(akdColumns({label:'İnfo',value:'%78,89 · -19.488.386 lot · 4,68'})?.quantity,'-19.488.386');
 assert.equal(akdColumns({label:'İnfo',value:'19.488.386 adet'})?.unit,'adet');
 assert.equal(akdColumns({label:'İnfo',value:'19.488.386 TL'}),null);
 assert.deepEqual(akdColumns({label:'İnfo',value:'%20 · 123 lot · —'}),{ratio:'%20',quantity:'123',unit:'lot',cost:null});
 assert.deepEqual(akdColumns({label:'İnfo',value:'— · 123 adet · 4,70'}),{ratio:null,quantity:'123',unit:'adet',cost:'4,70'});
 assert.deepEqual(akdColumns({label:'İnfo',value:'%20 · — · 4,70'}),{ratio:'%20',quantity:null,unit:null,cost:'4,70'});
});
test('AKD keeps structured headers and known cells when one row has missing values',async()=>{
 const rows=[{label:'Tam satır',value:'%20 · 123 lot · 4,70'},{label:'Eksik maliyet',value:'%15 · 90 lot · —'},{label:'Eksik oran',value:'— · 75 lot · 4,65'},{label:'Eksik lot',value:'%5 · — · 4,60'}];
 const svg=cardSvg({template:'akd',headline:'KTLEV aracı kurum dağılımı',body:'Tablo',card_data:{ticker:'KTLEV',buy:rows}},[],'',false,'paper');
 for(const h of ['KURUM','ORAN','NET LOT','MALİYET'])assert(svg.includes('>'+h+'</text>'));
 for(const value of ['Tam satır','%20','123 lot','4,70','%15','90 lot','%5','75 lot','—'])assert(svg.includes(value));
 const image=Buffer.from(await png(svg));assertCardPng(image,svg);
});
test('AKD legacy/unrecognized rows fall back without discarding source text',()=>{
 const svg=cardSvg({template:'akd',headline:'KTLEV dağılımı',body:'Tablo',card_data:{buy:[{label:'Tam',value:'%20 · 123 lot · 4,70'},{label:'Eski biçim',value:'Alıcı ağırlıklı, maliyet açıklanmadı'}]}},[],'',false,'paper');
 assert(svg.includes('>KURUM</text>'));assert(svg.includes('>VERİ</text>'));assert(svg.includes('>Alıcı ağırlıklı, maliyet açıklanmadı</text>'));
});
test('market tables reject row counts beyond safe template capacity without truncating',async()=>{
 const rows=(n:number)=>Array.from({length:n},(_,i)=>({label:`HISSE${i}`,value:'%10 · 100 lot · 1,25'}));
 const render=(template:Template,n:number,field:'buy'|'holdings'='buy')=>cardSvg({template,headline:'Örnek başlık',body:'Örnek içerik',card_data:{[field]:rows(n)}},[],'',false,'navy');
 for(const [template,field,capacity] of [['akd','buy',5],['broker_flow','buy',5],['custody','holdings',5],['institutional','buy',10]] as const){
  const svg=render(template,capacity,field);assert(svg.includes(`HISSE${capacity-1}`),`${template} preserves final boundary row`);
  const image=Buffer.from(await png(svg));assertCardPng(image,svg);
  assert.throws(()=>render(template,capacity+1,field),new RegExp(`market_card_capacity_${template}`));
 }
});
test('market card keeps BofA canonical identity and renders negative signs as ASCII hyphens',async()=>{
 for(const broker of ['Bank of America','BANK OF AMERICA','BofA']){
  const svg=cardSvg({template:'institutional',headline:'Kurum işlem özeti',body:'Tablo',card_data:{broker,buy:[{label:'ABCD',value:'-12 milyon TL'}]}},[],'',false,'paper');
  assert(svg.includes('BofA ÜZERİNDEN ALIM'));assert(svg.includes('>-12 milyon TL</text>'));assert(!svg.includes('−'));
  const image=Buffer.from(await png(svg));assertCardPng(image,svg);
 }
 const akd=cardSvg({template:'akd',headline:'Negatif katkı',body:'Tablo',card_data:{buy:[{label:'Kurum',value:'%−1,25 · −123 lot · −4,50'}]}},[],'',false,'navy');
 assert(akd.includes('%-1,25'));assert(akd.includes('-123 lot'));assert(akd.includes('-4,50'));assert(!akd.includes('−'));
 const image=Buffer.from(await png(akd));assertCardPng(image,akd);
 const points=cardSvg({template:'volume',headline:'Endeks katkısı',body:'Kaynağın açıkladığı puan katkısı.',card_data:{metrics:[{label:'BIST 100 puan katkısı',value:'−0,42 puan'}]}},[],'',false,'paper');
 assert(points.includes('-0,42 puan'));assert(!points.includes('−'));const pointsPng=Buffer.from(await png(points));assertCardPng(pointsPng,points);
});
test('market cards reject labels too long to fit instead of drawing past the canvas',()=>{
 const rows=[{label:'Kurum '.repeat(40),value:'%20 · 123 lot · 4,70'}];
 assert.throws(()=>cardSvg({template:'akd',headline:'Başlık',body:'Tablo',card_data:{buy:rows}},[],'',false,'navy'),/card_content_overflow/);
});
test('AKD tables label each column, omit footer prose and render every theme/layout',async()=>{
 const rows=Array.from({length:5},(_,i)=>({label:['Ünlü','BofA','İş','Yapı Kr.','Ak'][i],value:'%30,04 · 7.419.604 lot · 4,70'}));
 for(const theme of ['navy','paper'] as const)for(const layout of CARD_LAYOUTS){
  const svg=cardSvg({template:'akd',headline:'Gün ortası — KTLEV aracı kurum dağılımı',body:'Sıra: oran · net lot · maliyet. Gereksiz alt açıklama.',card_data:{ticker:'KTLEV',buy:rows,sell:rows}},[],'',false,theme,layout);
  for(const h of ['KURUM','ORAN','NET LOT','MALİYET'])assert(svg.includes('>'+h+'</text>'));
  assert(!svg.includes('Gereksiz'));assert(!svg.includes('Sıra:'));assert(svg.includes('>7.419.604 lot</text>'));assert(svg.includes('>4,70</text>'));
  const bytes=Buffer.from(await png(svg));assertCardPng(bytes,svg);
 }
});
