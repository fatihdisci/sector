import test from 'node:test';import assert from 'node:assert/strict';
import {DEFAULTS,scopedDecision,newBusinessException,matchingFund,type Preferences} from '../src/kap/rules';import type {Disclosure,Indices} from '../src/kap/parser';import {KapStore} from '../src/kap/store';import {KapCollector} from '../src/kap/collector';
const now=Date.parse('2026-10-27T12:00:00Z'),pool=['AKBNK','THYAO',...Array.from({length:98},(_,i)=>'T'+String(i).padStart(3,'0'))];
const idx:Indices={bist30:pool.slice(0,30),bist100:pool,checkedAt:new Date(now).toISOString(),source:'https://www.kap.org.tr/tr/Endeksler',sourceSha256:'a'.repeat(64)};
const d=(p:Partial<Disclosure>={}):Disclosure=>({id:101,sourceRef:'kap:101',url:'https://www.kap.org.tr/tr/Bildirim/101',title:'Finansal Rapor',summary:null,company:'ÖRNEK AŞ',issuerRaw:'TEST',issuerCode:'TEST',relatedCodes:[],subjectCodes:['TEST'],disclosureClass:'ODA',disclosureType:'ODA',category:'ODA',fundType:null,isFund:false,oid:null,relatedOid:null,changeStatus:null,isCorrection:false,publishedAt:new Date(now).toISOString(),attachmentCount:0,...p});
const p:Preferences={...DEFAULTS,otherCompanies:'topics',otherTopics:['business','financial']};
test('company notifications require a current official BIST 30/100 member',()=>{
 assert.equal(scopedDecision(d(),p,idx,now).reason,'index_outside');
 for(const symbol of ['AKBNK','T050'])assert.equal(scopedDecision(d({subjectCodes:[symbol]}),p,idx,now).action,'instant');
 for(const x of [null,{...idx,sourceSha256:undefined},{...idx,source:'unverified'},{...idx,checkedAt:new Date(now-37*3600000).toISOString()},{...idx,bist100:pool.slice(0,99)}])assert.equal(scopedDecision(d(),p,x,now).reason,'index_unavailable');
});
test('only actual new relationship and contract subjects bypass index membership',()=>{
 for(const title of ['Yeni İş İlişkisi','YENİ İŞ İLİŞKİSİ','Yeni Sözleşme','Yeni Bir Sözleşmenin İmzalanması','Yeni Bir İş İlişkisi','Sözleşme İmzalanması']){const item=d({title});assert(newBusinessException(item),title);assert.equal(scopedDecision(item,p,idx,now).action,'instant');assert.equal(scopedDecision(item,p,null,now).action,'instant');}
 const general=d({title:'Özel Durum Açıklaması (Genel)',summary:'Yeni iş ilişkisi kurulması'});assert.equal(scopedDecision(general,p,idx,now).action,'instant');
 for(const title of ['Esas Sözleşme Değişikliği','Kredi Sözleşmesi','İhale Sonucu','Yeni yatırım','Sözleşme süresinin uzatılması'])assert(!newBusinessException(d({title})),title);
});
test('four fund words match separately across official metadata, not inside unrelated words',()=>{
 for(const [field,value] of [['company','TERA PORTFÖY'],['company','Pusula fonu'],['summary','atlas fon bildirim'],['title','TASFİYE süreci'],['title','Tasfiyesinin tamamlanması']] as const){const fund=d({isFund:true,disclosureType:'FON',[field]:value});assert(matchingFund(fund),value);assert.equal(scopedDecision(fund,p,null,now).action,'instant');}
 for(const value of ['DİĞER FON','TERARYUM','PUSULALI','ATLASLAR','TASFİYECİ'])assert.equal(scopedDecision(d({isFund:true,company:value}),p,idx,now).action,'off',value);
 assert.equal(scopedDecision(d({isFund:true,company:'Başka Fon',subjectCodes:['AKBNK']}),p,idx,now).action,'off');
 assert.equal(scopedDecision(d({isFund:false,company:'Tera Şirket',title:'Finansal Rapor'}),p,idx,now).action,'off');
});
test('missing or stale index fails closed and unprocessed item stays retryable',()=>{
 const store=new KapStore(':memory:');try{store.set('notification_start',now-1000);store.set('bootstrap',{latest:100});const l=store.claim('live',now)!;assert.throws(()=>store.save(d(),l,now,true),/kap_index_unavailable/);assert.equal(store.row('select * from checks where id=101'),undefined);assert.equal(store.row('select * from queue'),undefined);}finally{store.close();}
});
test('valid updated indices persist even if the independent circuit proof needs review',async()=>{
 const s=new KapStore(':memory:');try{s.set('circuit_policy',{version:1,authority:'Sentinel_0b3b5acd1e7881918fe77806bb1b0570',scope:'bist30+market',activated_at:now-1000});const collector=new KapCollector(s,{indices:async()=>({...idx,sourceSha256:'a'.repeat(64)}),listing:async()=>[],disclosure:async()=>null},()=>now);await collector.run('indices');assert.deepEqual(s.get<any>('indices')?.bist100,pool);assert(s.get('circuit_index_block'));}finally{s.close();}
});

test('delivery boundary suppresses an old out-of-index queue item and holds stale index data',async()=>{
 const {KapDelivery}=await import('../src/kap-delivery');
 for(const stale of [false,true]){const s=new KapStore(':memory:');try{
  s.set('notification_start',now-1000);s.set('bootstrap',{latest:100});s.set('indices',idx);
  const valid=d({issuerCode:'AKBNK',subjectCodes:['AKBNK']});s.save(valid,s.claim('live',now)!,now,true);
  if(stale)s.set('indices',{...idx,checkedAt:new Date(now-37*3600000).toISOString()});
  else s.run('UPDATE disclosures SET metadata=? WHERE id=101',JSON.stringify(d()));
  const c=new KapDelivery(s,{} as any,async()=>[],()=>now);
  assert.equal(c.deliveryDecision([{source_id:'kap',url:valid.url}] as any),stale?'hold':'suppress');
  assert.equal(s.row<any>('SELECT state FROM queue').state,stale?'needs_review':'suppressed');
 }finally{s.close();}}
});
test('matching fund is enqueued despite prior funds-off setting and passes delivery gate',async()=>{
 const {KapDelivery}=await import('../src/kap-delivery');const s=new KapStore(':memory:');try{
  s.set('notification_start',now-1000);s.set('bootstrap',{latest:100});const fund=d({isFund:true,company:'Pusula Portföy Fonu',disclosureType:'FON'});
  s.save(fund,s.claim('live',now)!,now,true);assert.equal(s.row<any>('SELECT kind FROM queue').kind,'instant');
  const c=new KapDelivery(s,{} as any,async()=>[],()=>now);assert.equal(c.deliveryDecision([{source_id:'kap',url:fund.url}] as any),'allow');
 }finally{s.close();}
});
