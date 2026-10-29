import {assertCardPng} from './assert-card-dimensions';
import test from 'node:test';
import assert from 'node:assert/strict';
import {cardSvg} from '../src/card';
import {reportCard} from '../src/report-card';
import {png} from '../scripts/render_local';

const negativeHeadline='BIST 100: −0,33%';
const negativeBody='Endeks −0,33% geriledi. Eksik veri — ile gösterildi.';
const asciiHeadline=negativeHeadline.replace(/−/g,'-');
const asciiBody=negativeBody.replace(/−/g,'-');
const layouts=['editorial','frame','rail','masthead','center','brief'] as const;

test('news cards normalize unsupported minus glyphs in every layout and render real PNGs',async()=>{
 for(const layout of layouts){
  const unicode=cardSvg({headline:negativeHeadline,body:negativeBody,template:'market'},[], '', false, 'paper',layout);
  const ascii=cardSvg({headline:asciiHeadline,body:asciiBody,template:'market'},[], '', false, 'paper',layout);
  assert.equal(unicode,ascii,`${layout} output should normalize the numeric minus`);
  assert(unicode.includes('—'),'em dash for missing data should remain intact');assert(!unicode.includes('−'));
  const image=Buffer.from(await png(unicode));assert.equal(image.toString('ascii',1,4),'PNG');assertCardPng(image,unicode);
 }
});

test('report cards normalize numeric minus without changing missing-value em dash',async()=>{
 const make=(headline:string,body:string)=>reportCard({headline,body,card_data:{report:{rows:[{label:'BIST 100',value:'−0,33%'}],footer:'Değişim −0,33%; eksik değer —.'}}} as any);
 const unicode=make(negativeHeadline,negativeBody),ascii=make(asciiHeadline,asciiBody);
 assert.equal(unicode,ascii);assert(unicode.includes('—'));assert(!unicode.includes('−'));
 const image=Buffer.from(await png(unicode));assert.equal(image.toString('ascii',1,4),'PNG');assert.equal(image.readUInt32BE(16),1080);assert.equal(image.readUInt32BE(20),1350);
 const general=reportCard({headline:negativeHeadline,body:negativeBody,card_data:{report:{rows:[],footer:'Günlük rapor —',general:{day:'−0,33%',time:'12:00',companies:1,lots:'−10',amount:'−2',missing:1,rows:[{ticker:'TEST',lots:'−10',price:'−0,2',amount:'−2',urls:''}]}}}} as any);
 assert(!general.includes('−'));assert(general.includes('—'));const generalPng=Buffer.from(await png(general));assert.equal(generalPng.toString('ascii',1,4),'PNG');
});
