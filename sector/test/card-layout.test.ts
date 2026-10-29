import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {cardSvg,wrap} from '../src/card';

test('balanced headline wrapping preserves every word, number and qualifier',()=>{
 for(const value of ['Abbott, beslenme işini yaklaşık 8,5 milyar dolarlık satış beklentisiyle ayırmayı planlıyor','GÜÇ’te hedef üç yılda 3 milyondan fazla genç','İhracat & üretim: şirketin <yeni> hedefi','TCMB faiz kararını açıkladı']){
  const lines=wrap(value,96,920);assert.equal(lines.join(' '),value);assert(lines.every(Boolean));
 }
});
test('long Turkish headlines and six-line summaries stay inside separate artwork regions',()=>{
 const headline='Şirket, yeni yatırımının izin süreci tamamlandıktan sonra üretim kapasitesini artırmayı planlıyor';
 const body='Yeni yatırımın tamamlanması için izin sürecinin sonuçlanması bekleniyor. Şirket, kapasite artışına ilişkin çalışmaların sürdüğünü ve projenin koşullara bağlı olarak ilerleyeceğini belirtti.';
 for(const template of ['company','economic_data','global','info','breaking'] as const){
  const svg=cardSvg({headline,body,template});const {document}=parseHTML(svg);
  const texts=[...document.querySelectorAll('text')];
  const heading=[...document.querySelectorAll('[data-kit-role="headline"] text')];
  const summary=[...document.querySelectorAll('[data-kit-role="body"] text')];
  assert.equal(heading.map(n=>n.textContent).join(' '),headline);
  assert.equal(summary.map(n=>n.textContent).join(' '),body);
  const lastHeading=Math.max(...heading.map(n=>Number(n.getAttribute('y'))+Number(n.getAttribute('font-size'))*.25));
  const firstBody=Math.min(...summary.map(n=>Number(n.getAttribute('y'))-36));
  assert(lastHeading<firstBody);
  for(const n of summary)assert(Number(n.getAttribute('y'))+12<1310);
 }
});
test('artwork escapes publisher text and never silently clips impossible content',()=>{
 const {document}=parseHTML(cardSvg({headline:'A & B <yatırım> planlıyor',body:'İzin süreci "henüz" bitmedi.',template:'company'}));
 assert.equal(document.querySelectorAll('yatırım').length,0);
 assert([...document.querySelectorAll('text')].map(n=>n.textContent).join(' ').includes('A & B <yatırım> planlıyor'));
 assert.throws(()=>cardSvg({headline:'',body:'Özet',template:'info'}),/empty/);
 assert.throws(()=>cardSvg({headline:'Başlık',body:'Uzun içerik '.repeat(800),template:'info'}),/overflow/);
});
