import test from 'node:test';import assert from 'node:assert/strict';
import {postText} from '../src/editorial';import {hashtagTickers} from '../src/tweet-tickers';import type {Draft} from '../src/types';
const d:Draft={headline:'🚨 Devre kesici uygulandı',body:'Sürekli işleme ara verildi.',hashtags:['#Borsa','#BIST','#KARCL','#KTLEV'],category:'bist',importance:80,template:'circuit',card_headline:'Devre kesici',card_body:'Devre kesici uygulandı.',card_data:{tickers:['KARCL','KTLEV']},claims:[],entities:[],event_key:'circuit-test',uncertainties:[]};
test('circuit stock list occurs only once at top, even if model repeated subject in headline and body',()=>{
 for(const body of ["KARCL ve KTLEV paylarında sürekli işleme ara verildi.","#KARCL, #KTLEV'de sürekli işleme ara verildi.","KARCL.E / KTLEV.E paylarında sürekli işleme ara verildi."]){
  const output=postText({...d,headline:"🚨 KARCL ve KTLEV'de devre kesici uygulandı",body});
  assert.equal(output,'🚨 #karcl #ktlev\nDevre kesici uygulandı\n\nSürekli işleme ara verildi.\n\n#Borsa #BIST');
  for(const c of ['KARCL','KTLEV'])assert.equal(output.split(c.toLowerCase()).length-1,1);
 }
 assert.equal(postText({...d,body:'Sürekli işleme ara verildi.\nHisseler: KARCL, KTLEV'}),postText(d));
});
test('single stock suffix is removed from duplicate subject without changing status/negation',()=>{
 const one={...d,hashtags:['#Borsa','#BIST','#KARCL'],card_data:{tickers:['KARCL']}};
 assert.match(postText({...one,body:"KARCL’de sürekli işleme ara verilmedi."}),/\n\nSürekli işleme ara verilmedi\./);
 assert.throws(()=>postText({...d,body:"KARCL'de işlemler durdu. KTLEV'de işlemler yeniden başladı."}),/circuit_ticker_context_requires_edit/);
});
test('tweet ticker tagging applies to single stock news, AKD, institutional and reports without source changes',()=>{
 const news={...d,template:'news' as const,headline:'📢 KARCL yeni sözleşme açıkladı',body:"KARCL'nin açıklaması yayımlandı.",card_data:undefined,hashtags:['#Borsa','#BIST','#KARCL']};
 for(const template of ['news','akd','custody'] as const){const value={...news,template,...(template!=='news'?{card_data:{ticker:'KARCL'}}:{})};const before=JSON.stringify(value),text=postText(value);assert(!/(?<!#)\bKARCL\b/u.test(text));assert.equal(JSON.stringify(value),before);}
 assert.equal(hashtagTickers("OMD, #OMD ve OMD.E; OMDX; https://example.org/OMD.E",['OMD']),"#OMD, #OMD ve #OMD; OMDX; https://example.org/OMD.E");
 assert.equal(hashtagTickers("karcl ve KARCL'nin açıklaması",['KARCL']),"#KARCL ve #KARCL'nin açıklaması");
 const report={...news,template:'info' as const,card_data:{report:{rows:[],footer:''}}};assert.match(postText(report),/#karcl'nin/);
 const institutional={...news,template:'institutional' as const,card_data:{buy:[{label:'KARCL',value:'10 TL'}]}};assert(!/(?<!#)\bKARCL\b/u.test(postText(institutional)));
});

test('October calendar dates are not EKIM ticker mentions; actual equity mentions still get hashtags',()=>{
 assert.equal(hashtagTickers("22 Ekim’de #EKIM ve EKIM hissesi; EKIM’de işlem",['EKIM']),"22 Ekim’de #EKIM ve #EKIM hissesi; #EKIM’de işlem");
 assert.equal(hashtagTickers("1 Ekim'de EKIM.E ve https://example.org/EKIM",['EKIM']),"1 Ekim'de #EKIM ve https://example.org/EKIM");
 assert.equal(hashtagTickers("122 EKIM’de",['EKIM']),"122 #EKIM’de");
});
