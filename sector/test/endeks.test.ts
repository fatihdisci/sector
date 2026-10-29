import {assertCardPng} from './assert-card-dimensions';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {BRAND_NAME,BRAND_HANDLE,COLORS} from '../src/brand';
import {cardSvg,templateLabel} from '../src/card';
import {CARD_LAYOUTS} from '../src/card-layout';
import {png} from '../scripts/render_local';
import {documentScore,topicScore,EDITOR_PROMPT} from '../src/editorial';
import {repairDraftStyle} from '../src/style';
import type {Document,Draft,Template} from '../src/types';
const doc={source_id:'kap',source_name:'KAP',family:'kap',official:true,url:'https://www.kap.org.tr/tr/Bildirim/123',title:'Yeni İş İlişkisi',body:'Şirket yeni üretim sözleşmesini duyurdu.',passages:[],published_at:null,equity_codes:['TEST']} as Document;
test('ENDEKS identity, all layouts and all new templates render actual 1080 by 1350 PNG',async()=>{
 assert.equal(BRAND_NAME,'Borsa Çakalı');assert.equal(BRAND_HANDLE,'@borsacakali');assert.equal(COLORS.navy,'#112333');
 const templates:Template[]=['breaking','circuit','kap','company','market','finance','info'];
 for(const template of templates)for(const theme of ['navy','paper'] as const)for(const layout of CARD_LAYOUTS){
  const svg=cardSvg({template,headline:'TEST paylarında yeni gelişme',body:'Şirketin resmî açıklaması yatırımcılarla paylaşıldı.'},[],'',false,theme,layout);
  assert.match(svg,/borsacakali/);assert(!svg.includes('SECTOR'));assert(!/linearGradient|radialGradient|filter=/.test(svg));
  if(template==='circuit')assert.match(svg,/DEVRE KESİCİ/);
  const data=Buffer.from(await png(svg));assertCardPng(data,svg);
 }
 assert.equal(templateLabel('market'),'BIST / PİYASA');
 for(const [file,w,h] of [['profile',800,800],['banner',1500,500]] as const){const b=await readFile('assets/'+file+'.png');assert.equal(b.readUInt32BE(16),w);assert.equal(b.readUInt32BE(20),h);}
});
test('BIST and official disclosures outrank broad tech without excluding other companies or macro',()=>{
 assert(topicScore('Yeni İş İlişkisi','',true).score>topicScore('Apple yeni telefon teknolojisini tanıttı','',true).score);
 assert(topicScore('Devre Kesici Uygulaması').score>=90);
 assert(topicScore('Fed faiz kararını açıkladı').score>=80);
 assert(topicScore('Türkiye enflasyonu açıklandı').score>=70);
 assert(topicScore('Şirket yeni sözleşme imzaladı').score>=60);
 assert(documentScore({...doc,index_tier:30}).score>documentScore({...doc,index_tier:100}).score);
 assert(documentScore({...doc,index_tier:100}).score>documentScore(doc).score);
 assert(EDITOR_PROMPT.includes('Borsa Çakalı'));assert(EDITOR_PROMPT.includes('Alım-satım')||EDITOR_PROMPT.includes('yatırım tavsiyesi'));
});
test('official breakers choose the circuit template and verified ticker hashtags automatically',()=>{
 const source={...doc,title:'Devre Kesici Uygulaması'};
 const draft={headline:'İşlem başladı',hashtags:['#Piyasa','#Haber'],template:'company',category:'companies'} as Draft;
 const fixed=repairDraftStyle(draft,[source]);assert.equal(fixed.template,'circuit');assert.equal(fixed.category,'bist');assert.deepEqual(fixed.hashtags,['#Borsa','#BIST','#TEST']);
});
