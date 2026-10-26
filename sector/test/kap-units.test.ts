import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withKapUnitEvidence} from '../src/kap-unit-evidence';
import {headlineWithEmoji} from '../src/style';
import type {Document} from '../src/types';
const doc:Document={source_id:'kap',source_name:'KAP',family:'kap',official:true,url:'https://www.kap.org.tr/tr/Bildirim/1685332',title:'Payların Geri Alınmasına İlişkin Bildirim',body:'Borsa İstanbul pay işlemi',published_at:null,equity_codes:['KPEKS'],passages:[{id:'p1',text:'Kendi paylarının nominal tutarı 1.135.381 TL’ye ulaştı. Toplam 750.000.000 TL bütçe, fiyat 48,8533 TL.'}]};
test('BIST nominal quantity converts without converting cash or price and is idempotent',()=>{const [d]=withKapUnitEvidence([doc]);assert.match(d.body,/1.135.381 adet pay/);assert.doesNotMatch(d.body,/750.000.000 adet|48,8533 adet/);assert.deepEqual(withKapUnitEvidence([d]),[d]);assert.deepEqual(d.passages[0],doc.passages[0]);});
test('no unverified fund/private/security conversion',()=>{for(const patch of [{official:false},{source_id:'fund'},{equity_codes:[]},{equity_codes:['ISKUR']},{body:'Özel şirket hisseleri'},{title:'Fon raporu'}]){const d={...doc,...patch};assert.deepEqual(withKapUnitEvidence([d]),[d]);}});
test('building emoji is replaced with the permitted headline emoji',()=>assert.equal(headlineWithEmoji('🏢 KAPEKS pay aldı'),'📢 KAPEKS pay aldı'));

test('table amount preserves its price column',()=>{
 const d={...doc,passages:[{id:'table1row1',text:'İşleme Konu Pay: KPEKS | Payların Nominal Tutarı (TL): 25.000 TL | İşlem Fiyatı (TL/Adet): 48,56 TL'}]};
 const [out]=withKapUnitEvidence([d]);assert.match(out.body,/25.000 adet pay/);assert.doesNotMatch(out.body,/48,56 adet/);
});

import {repairKapShareWording} from '../src/kap-unit-evidence';
import type {Draft} from '../src/types';
import {withKapTableEvidence} from '../src/kap-table-evidence';
import {validateDraft} from '../src/editorial';
import {readFile} from 'node:fs/promises';
import {localDatabase} from '../src/local-adapters';
import {enqueueEvidence} from '../src/ingest';
import {leaseJob} from '../src/bridge';
import type {Env} from '../src/types';
test('quantity before nominal wording and general own-share disclosure receive exact equivalences',()=>{
 const text='Gülermak A.Ş. payları ile ilgili olarak 121,99–122 TL fiyat aralığından 400.000 toplam nominal tutarlı alış işlemi gerçekleştirilmiştir.';
 const general={...doc,title:'GÜLERMAK A.Ş. — Özel Durum Açıklaması (Genel)',equity_codes:['GLRMK'],body:text,passages:[{id:'p1',text}]};
 const [out]=withKapUnitEvidence([general]);assert.match(out.body,/400.000 adet pay/);assert.deepEqual(withKapUnitEvidence([out]),[out]);
 const privateDeal={...general,body:text.replace('Gülermak A.Ş. payları','Başka Özel Şirket A.Ş. payları')};
 assert.deepEqual(withKapUnitEvidence([privateDeal]),[privateDeal]);
});
test('tweet, card and claims use verified share count while cash, price and quotes remain intact',()=>{
 const text='Borsa İstanbul’da toplam 40.000 TL nominal değerli PRKME payları geri alınmıştır. Payların toplam nominal değeri 1.800.000 TL olmuştur. Fiyat 12,45 TL, bütçe 500.000.000 TL.';
 const documents=withKapUnitEvidence([{...doc,body:text,passages:[{id:'p1',text}]}]);
 const draft={headline:'Park Elektrik 40.000 TL nominal PRKME payı geri aldı',body:'Payların toplam nominal değeri 1.800.000 TL oldu. Fiyat 12,45 TL, bütçe 500.000.000 TL.',card_headline:'40.000 TL nominal değerli pay geri alındı',card_body:'Payların toplam nominal değeri 1.800.000 TL oldu.',claims:[{text:'40.000 TL nominal değerli PRKME payı alındı.',evidence:[{document:0,passage:'p1',quote:text}]}]} as Draft;
 const fixed=repairKapShareWording(draft,documents);
 for(const field of ['headline','body','card_headline','card_body'] as const)assert.doesNotMatch(fixed[field],/nominal/iu);
 assert.match(fixed.headline,/40.000 adet PRKME payı/);assert.match(fixed.body,/toplam pay adedi 1.800.000/);
 assert.match(fixed.body,/Fiyat 12,45 TL, bütçe 500.000.000 TL/);assert.equal(fixed.claims[0].evidence[0].quote,text);
 assert(fixed.claims[0].evidence.some(e=>e.passage==='p1_units'));assert.deepEqual(repairKapShareWording(fixed,documents),fixed);
 assert.deepEqual(repairKapShareWording(draft,[doc]),draft);
});

test('older conversion passages are augmented once with newly supported wording',()=>{
 const text='Borsa İstanbul’da 40.000 TL nominal değerli KPEKS payı geri alındı. Payların toplam nominal değeri 1.800.000 TL oldu.';
 const old={...doc,body:text,passages:[{id:'p1',text},{id:'bist_units',text:'BIST işlem birimi'},{id:'p1_units',text:text+'\nBIST işlem birimi karşılıkları: 1.800.000 TL nominal pay miktarı = 1.800.000 adet pay'}]};
 const [out]=withKapUnitEvidence([old]);assert.match(out.passages.find(p=>p.id==='p1_units')!.text,/40.000 adet pay/);
 assert.equal(out.passages.filter(p=>p.id==='p1_units').length,1);assert.deepEqual(withKapUnitEvidence([out]),[out]);
});

const mkk:Document={...doc,title:'KAMUYU AYDINLATMA PLATFORMU — Pay Alım Satım Bildirimi',url:'https://www.kap.org.tr/tr/Bildirim/1685556',body:'Pay alım satım açıklaması ekte yer almaktadır.',passages:[],published_at:'2026-10-22T06:04:34.000Z',equity_codes:['SSAAT']};
const pdfText='Bildirime Konu Borsa Şirketi : SAAT VE SAAT SANAYİ VE TİCARET A.Ş.\n21/10/2026 tarihinde payları ile ilgili olarak 21,90–23,66 TL fiyat aralığından toplam 265.798 TL nominal tutarlı pay alım işlemi gerçekleştirilmiştir. İşlemin toplam bedeli 6.103.361,26 TL’dir.';
const pdf:Document={...mkk,url:'https://www.kap.org.tr/tr/api/file/download/4028328ca0b8418601a161dba8d22ecc',title:'KAMUYU AYDINLATMA PLATFORMU — SSAAT_56578.pdf',body:pdfText,passages:[{id:'page1',text:pdfText},{id:'page1_table5',text:JSON.stringify([['Alım İşlemine Konu Payların\nToplam Nominal Tutarı (TL)','Sahip Olunan Payların Gün Sonu Nominal Tutarı (TL)','İşlem Fiyatı (TL/Adet)'],['265.798','184.310.732,\n19','22,96']])}],coverage:{complete:true,page_count:1,pages:[{page:1}]}};
test('MKK share-deal PDFs supply conversion proof, preserving the original PDF and cash amount',()=>{
 const documents=withKapUnitEvidence([mkk,pdf]),out=documents[1];
 assert(out.passages.some(p=>p.id==='bist_units'));
 assert.match(out.body,/265.798 adet pay/);assert.match(out.body,/184.310.732,19 adet pay/);
 assert.doesNotMatch(out.body,/6.103.361,26 adet|22,96 adet|23,66 adet/);
 assert.deepEqual(out.passages[0],pdf.passages[0]);assert.deepEqual(withKapUnitEvidence(documents),documents);
 const draft={headline:'📊 Ramazan Kaya 265.798 TL nominal tutarlı pay alımı yaptı',body:'265.798 TL nominal tutarlı alım yaptı. İşlemin toplam bedeli 6.103.361,26 TL oldu.',card_headline:'Ramazan Kaya pay aldı',card_body:'265.798 TL nominal tutarlı alım yaptı.',hashtags:['#Borsa','#BIST','#SSAAT'],category:'kap',importance:90,template:'kap',entities:['Ramazan Kaya'],event_key:'ssaat-2026-10-21',uncertainties:[],claims:[{text:'265.798 TL nominal tutarlı alım yaptı. İşlemin toplam bedeli 6.103.361,26 TL oldu.',evidence:[{document:1,passage:'page1',quote:pdfText}]}]} as Draft;
 // The real disclosure names the person in another table; this fixture adds it explicitly.
 documents[1]={...out,body:'Ramazan Kaya\n'+out.body};
 const fixed=repairKapShareWording(draft,documents);
 assert.equal(fixed.headline,'📊 Ramazan Kaya 265.798 adet pay aldı');
 assert.match(fixed.body,/265.798 adet pay aldı/);assert.match(fixed.body,/6.103.361,26 TL/);
 assert(fixed.claims[0].evidence.some(e=>e.document===1&&e.passage==='page1_units'));
 assert.equal(validateDraft(fixed,documents).verification,'official_attributed');
});
test('linked PDF without an exchange-name header uses its exact verified security, not an unrelated attachment',()=>{
 const text='HAREKET A.Ş. payları ile ilgili olarak 8,24 - 8,82 TL fiyat aralığından 9.018.641 toplam nominal tutarlı alış işlemi ve 11.300.933 toplam nominal tutarlı satış işlemi yapılmıştır.';
 const parent={...mkk,equity_codes:['HRKET']},attachment={...pdf,title:'KAMUYU AYDINLATMA PLATFORMU — HRKET.pdf',equity_codes:['HRKET'],body:text,passages:[{id:'page1',text}]};
 const docs=withKapUnitEvidence([parent,attachment]);
 assert.match(docs[1].body,/9.018.641 adet pay/);assert.match(docs[1].body,/11.300.933 adet pay/);
 for(const patch of [{equity_codes:['SSAAT']},{published_at:'2026-10-21T06:04:34.000Z'},{official:false},{url:attachment.url.replace('www.kap.org.tr','other.test')},{coverage:{complete:false,page_count:1,pages:[]}}]){
  const wrong={...attachment,...patch};assert.deepEqual(withKapUnitEvidence([parent,wrong])[1],wrong);
 }
 assert.deepEqual(withKapUnitEvidence([attachment]),[attachment]);
});
test('PDF table annotations keep split decimal digits and units in their own cells',()=>{
 const out=withKapTableEvidence([pdf])[0],row=out.passages.find(p=>p.id==='page1_table5row1');
 assert(row);assert.match(row.text,/184.310.732,19 TL/);assert.match(row.text,/İşlem Fiyatı \(TL\/Adet\): 22,96 TL/);
 assert.deepEqual(withKapTableEvidence([out]),[out]);assert.equal(out.passages[1].text,pdf.passages[1].text);
});
test('TL-before-total and nominal table labels are repaired consistently in structured card rows',()=>{
 const text='Borsa İstanbul’da KPEKS paylarında 9.565.500 TL toplam nominal tutarlı alış işlemi ve 0 TL toplam nominal tutarlı satış işlemi yapılmıştır. Fiyat 3,94 TL, işlem bedeli 37.688.070 TL.';
 const docs=withKapUnitEvidence([{...doc,body:text,passages:[{id:'p1',text}]}]);
 const draft={headline:'KPEKS 9.565.500 TL nominal tutarlı alım yaptı',body:'9.565.500 TL toplam nominal tutarlı alış işlemi yapıldı. Fiyat 3,94 TL, işlem bedeli 37.688.070 TL.',card_headline:'KPEKS pay aldı',card_body:'Alımın nominal tutarı 9.565.500 TL oldu.',card_data:{ticker:'KPEKS',buy:[{label:'KPEKS',value:'9.565.500 TL nominal tutarlı pay'}],metrics:[{label:'Alımın nominal tutarı (TL)',value:'9.565.500 TL'},{label:'İşlem bedeli',value:'37.688.070 TL'},{label:'Fiyat',value:'3,94 TL'}]},claims:[{text:'9.565.500 TL nominal tutarlı alım yaptı.',evidence:[{document:0,passage:'p1',quote:text}]}]} as Draft;
 const fixed=repairKapShareWording(draft,docs);
 for(const field of ['headline','body','card_headline','card_body'] as const)assert.doesNotMatch(fixed[field],/nominal/iu);
 assert.equal(fixed.card_data?.buy?.[0].value,'9.565.500 adet pay');
 assert.deepEqual(fixed.card_data?.metrics?.[0],{label:'Alımın pay adedi',value:'9.565.500 adet pay'});
 assert.deepEqual(fixed.card_data?.metrics?.slice(1),draft.card_data?.metrics?.slice(1));
 assert.deepEqual(repairKapShareWording(fixed,docs),fixed);
});
test('nominal labels for cash, debt, a different private company and exceptional security are not share quantities',()=>{
 const text='Borsa İstanbul’da 400.000 TL nominal değerli pay alındı. Tahvilin nominal tutarı: 500.000 TL, nakit bütçe 750.000.000 TL.';
 const docs=withKapUnitEvidence([{...doc,body:text,passages:[{id:'p1',text}]}]);
 assert.match(docs[0].body,/400.000 adet pay/);assert.doesNotMatch(docs[0].body,/500.000 adet|750.000.000 adet/);
 const privatePdf={...pdf,body:pdfText.replace('Bildirime Konu Borsa Şirketi','Borsada işlem görmeyen şirket'),title:'KAP — Başka Özel Şirket.pdf'};
 assert(!withKapUnitEvidence([mkk,privatePdf])[1].passages.some(p=>p.id==='bist_units'));
 const exceptional={...pdf,equity_codes:['ISKUR']};assert(!withKapUnitEvidence([{...mkk,equity_codes:['ISKUR']},exceptional])[1].passages.some(p=>p.id==='bist_units'));
});
test('PDF price wording and line wraps do not disable verified share conversions',()=>{
 for(const price of ['3,17 TL fiyat ile','6,25 - 6,31 TL fiyat\n aralığından']){
  const text=pdfText.replace('21,90–23,66 TL fiyat aralığından',price);
  const docs=withKapUnitEvidence([mkk,{...pdf,body:text,passages:[{id:'page1',text}]}]);
  assert.match(docs[1].body,/265.798 adet pay/);
 }
});
test('a KAP trade table identifies its security even when old document metadata omitted the ticker',()=>{
 const d={...doc,equity_codes:undefined,body:'Pay geri alımı',passages:[{id:'table5',text:JSON.stringify([['İşleme Konu Pay','İşlem Fiyatı (TL/Adet)','İşleme Konu Payların Nominal Tutarı (TL)'],['B Grubu, MAVI, TREMAVI00037','35,22','350.000']])}]};
 const out=withKapUnitEvidence([d])[0];assert.match(out.body,/350.000 adet pay/);
 const exceptional={...d,passages:d.passages.map(p=>({...p,text:p.text.replaceAll('MAVI','ISKUR')}))};
 assert(!withKapUnitEvidence([exceptional])[0].passages.some(p=>p.id==='bist_units'));
});
test('another listed company in the official related-company field stays distinct from the issuer',()=>{
 const text='İlgili Şirketler Related Companies | [DMSAS]\nİştirakimiz Demisaş A.Ş. Payları (DMSAS) ile ilgili olarak 5,64 - 5,68 fiyat aralığından 180.000 TL toplam nominal tutarlı alış işlemi yapılmıştır.';
 const d={...doc,title:'SARKUYSAN A.Ş. — Pay Alım Satım Bildirimi',equity_codes:['SARKY'],body:text,passages:[{id:'p1',text}]};
 assert.match(withKapUnitEvidence([d])[0].body,/180.000 adet pay/);
 assert.deepEqual(withKapUnitEvidence([{...d,body:text.replace('[DMSAS]','[]')}]),[{...d,body:text.replace('[DMSAS]','[]')}]);
});
test('compact nominal wording and inverted sale labels use verified quantities without converting cash',()=>{
 const docs=withKapUnitEvidence([mkk,pdf]);
 const d={headline:'265.798 TL nominal alım yaptı',body:'265.798 TL nominal tutarla yapıldı.',card_headline:'Pay alımı',card_body:'Toplam nominal tutarlı alış işlemi 265.798 TL olarak yer aldı.',claims:[]} as unknown as Draft;
 const out=repairKapShareWording(d,docs);
 assert.equal(out.headline,'265.798 adet pay aldı');assert.match(out.body,/265.798 adet pay üzerinden/);
 assert.equal(out.card_body,'Alış miktarı 265.798 adet pay olarak yer aldı.');
 assert.equal(repairKapShareWording({...d,card_body:'265.798 TL nominal tutarlı alış bildirildi.'},docs).card_body,'265.798 adet pay alımı bildirildi.');
});
test('exact thousands spelling and secondary nominal wording normalize without rounding',()=>{
 const text='Borsa İstanbul’da 300.000 TL nominal değerli KPEKS payı geri alındı. 1.135.381 TL nominal değerli pay toplamına ulaşıldı.';
 const docs=withKapUnitEvidence([{...doc,body:text,passages:[{id:'p1',text}]}]);
 const draft={headline:'KPEKS 300 bin TL nominal tutarlı payını geri aldı',body:'Son işlem 300.000 TL nominal tutarlıydı.',card_headline:'300.000 TL nominal tutarlı geri alım yaptı',card_body:'300 bin nominal tutarlı işlem sonrasında payı arttı.',claims:[]} as unknown as Draft;
 const out=repairKapShareWording(draft,docs);
 assert.equal(out.headline,'KPEKS 300.000 adet payını geri aldı');assert.equal(out.body,'Son işlem 300.000 adet payı kapsadı.');
 assert.equal(out.card_body,'300.000 adet paylık işlem sonrasında payı arttı.');
 assert.equal(repairKapShareWording({...draft,headline:'KPEKS 1,1 milyon TL nominal tutarlı payını geri aldı'},docs).headline,'KPEKS 1,1 milyon TL nominal tutarlı payını geri aldı');
});
test('issuer names and nominal-bedelli cash descriptions preserve distinct quantity and consideration proof',()=>{
 for(const [title,text] of [
  ['TÜRK ALTIN İŞLETMELERİ A.Ş. — Payların Geri Alınmasına İlişkin Bildirim','Borsa İstanbul’da 2.487.148 TL nominal tutarlı Türk Altın İşletmeleri A.Ş. payları geri alınmıştır.'],
  ['NET HOLDİNG A.Ş. — Payların Geri Alınmasına İlişkin Bildirim','Borsa İstanbul’da NET HOLDİNG A.Ş. payları ile ilgili olarak 300.000 TL toplam nominal bedelli 10.601.000,00 TL tutarında alış işlemi gerçekleştirilmiştir.']
 ]){
  const docs=withKapUnitEvidence([{...doc,title,body:text,passages:[{id:'p1',text}]}]);
  assert(docs[0].passages.some(p=>p.id==='p1_units'));
  assert.doesNotMatch(docs[0].body,/10.601.000,00 adet/);
 }
});
test('new unit evidence removes an obsolete broad conversion from both passages and model body',()=>{
 const text='Borsa İstanbul pay işlemleri tamamlandı. Tahvilin nominal tutarı 500.000 TL.';
 const oldText=text+'\nBIST işlem birimi karşılıkları: 500.000 TL nominal pay miktarı = 500.000 adet pay';
 const d={...doc,body:text+'\n\n'+oldText,passages:[{id:'p1',text},{id:'p1_units',text:oldText}]};
 const out=withKapUnitEvidence([d])[0];assert.doesNotMatch(out.body,/500.000 adet/);assert(!out.passages.some(p=>p.id==='p1_units'));
 assert.deepEqual(out.passages[0],d.passages[0]);assert.deepEqual(withKapUnitEvidence([out]),[out]);
});
test('PDF normalization never concatenates separate numbers or alters punctuation in names',()=>{
 const d={...pdf,passages:[{id:'page1_table9',text:JSON.stringify([['İşleme Konu Pay','Nominal Tutar (TL)'],['Kurum A. 101','40.000\n24,12']])}]};
 const row=withKapTableEvidence([d])[0].passages.find(p=>p.id==='page1_table9row1')!;
 assert.match(row.text,/Kurum A\. 101/);assert.match(row.text,/40.000 24,12$/);assert.doesNotMatch(row.text,/40.00024,12/);
});
test('nominal-share PDF support does not expand unrelated financial-report tables',()=>{
 const d={...pdf,passages:[{id:'page1_table1',text:JSON.stringify([['Dönem','Hasılat (TL)','Faaliyet Kârı (TL)'],['2026','100.000','10.000']])}]};
 assert.deepEqual(withKapTableEvidence([d]),[d]);
});
test('the real job lease persists PDF conversion evidence before the model receives the payload',async()=>{
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));
 const env={DB,AI_MODEL:'gpt-6.1-terra',AI_EFFORT:'low'} as Env;
 const parent={...mkk,body:mkk.body.repeat(4),passages:[{id:'metadata',text:mkk.title+'\n'+mkk.body.repeat(4)}]};
 const id=await enqueueEvidence(env,[parent,pdf],'kap');
 const before=await DB.prepare('SELECT input_hash FROM model_jobs WHERE id=?').bind(id).first<{input_hash:string}>();
 const job=await leaseJob(env);assert(job);assert.equal(job.id,id);
 assert(job.documents[1].passages.some((p:{id:string})=>p.id==='page1_units'));
 assert.match(job.documents[1].body,/265.798 adet pay/);assert.notEqual(job.input_hash,before!.input_hash);
 const saved=await DB.prepare('SELECT documents,input_hash FROM model_jobs WHERE id=?').bind(id).first<{documents:string;input_hash:string}>();
 assert.deepEqual(JSON.parse(saved!.documents),job.documents);assert.equal(saved!.input_hash,job.input_hash);
 assert.equal(await leaseJob(env),null);
});
