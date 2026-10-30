import test from 'node:test';
import assert from 'node:assert/strict';
import {KapStore} from '../src/kap/store';
import {KapReports} from '../scripts/kap_reports';
import type {Disclosure,Listing,Indices} from '../src/kap/parser';

const at=Date.parse('2026-10-23T17:00:00+03:00'),day='2026-10-23',issuer='BORSA İSTANBUL BİSTECH DEVRE KESİCİ UYGULAMASI';
const bist30=['ASTOR',...Array.from({length:29},(_,i)=>'A'+String(i).padStart(4,'0'))].sort();
const bist50=[...bist30,'BRSAN',...Array.from({length:19},(_,i)=>'B'+String(i).padStart(4,'0'))].sort();
const indices:Indices={bist30,bist50,bist100:[...bist50,'EREGL',...Array.from({length:49},(_,i)=>'C'+String(i).padStart(4,'0'))].sort(),checkedAt:new Date(at).toISOString(),source:'https://www.kap.org.tr/tr/Endeksler'};
function disclosure(id:number,ticker:string,hour:number):Disclosure{
 const publishedAt=new Date(Date.parse(day+'T00:00:00+03:00')+hour*3600_000).toISOString();
 return{id,sourceRef:`kap:${id}`,url:`https://www.kap.org.tr/tr/Bildirim/${id}`,title:'Pay Bazında Devre Kesici Bildirimi',summary:`${ticker}.E işlem sırasında Pay Bazında Devre Kesici Uygulaması devreye girmiştir.`,company:issuer,issuerRaw:null,issuerCode:null,relatedCodes:[ticker],subjectCodes:[ticker],disclosureClass:'DUY',disclosureType:'DUY',category:'',fundType:null,isFund:false,oid:null,relatedOid:null,changeStatus:null,isCorrection:false,publishedAt,attachmentCount:0};
}
function listing(d:Disclosure):Listing{return{id:d.id,publishedAt:d.publishedAt,circuit:{title:d.title,summary:d.summary!,company:d.company!}};}
function save(store:KapStore,d:Disclosure,firstSeen:number){store.run('INSERT INTO disclosures VALUES(?,?,?,?,?,?,?,?,?,?)',d.id,d.sourceRef,d.oid,d.relatedOid,Number(d.isCorrection),d.publishedAt,firstSeen,JSON.stringify(d),JSON.stringify({topics:['circuit']}),0);}

test('manual daily report combines stored BIST30 notice, BIST30-excluded IDs and fresh official KAP listing without applying delivery membership filter',async()=>{
 const store=new KapStore(':memory:'),stored=disclosure(1,'ASTOR',9),excluded=disclosure(2,'BRSAN',10),fresh=disclosure(3,'EREGL',11),repeat=disclosure(4,'ASTOR',12),future=disclosure(5,'SASA',18),fetched:number[]=[];
 save(store,stored,at);
 store.run('INSERT INTO circuit_light VALUES(?,?,?,?,?,?,?)',excluded.id,excluded.publishedAt,at,at+7*86400_000,'excluded','bist30_outside','verified');
 const client={listing:async()=>[listing(fresh),listing(repeat),listing(future),{id:99,publishedAt:new Date(at).toISOString()}],disclosure:async(id:number)=>{fetched.push(id);return new Map([[2,excluded],[3,fresh],[4,repeat]]).get(id)??null;}};
 try{
  store.set('indices',indices);
  const result=await new KapReports(store,client as any).build('circuit',at,at);
  const report=result.draft.card_data!.report!,selection=report.circuit!;
  assert.deepEqual(fetched,[2,3,4]);
  assert.equal(selection.total_events,4);assert.equal(selection.total_tickers,3);
  assert.deepEqual(selection.all_rows.map(r=>r.label),['#ASTOR','#BRSAN','#EREGL']);
  assert.match(selection.all_rows.find(r=>r.label==='#ASTOR')!.value,/2 bildirim/);
  assert.match(result.draft.card_body!,/4 bildirim · 3 farklı hisse/);
  assert.match(result.documents[0].body,/4 bildirim; 3 farklı hisse/);
 }finally{store.close();}
});

test('manual report fails closed when any official filtered notice page cannot be retrieved',async()=>{
 const store=new KapStore(':memory:'),excluded=disclosure(20,'BRSAN',10);store.run('INSERT INTO circuit_light VALUES(?,?,?,?,?,?,?)',excluded.id,excluded.publishedAt,at,at+7*86400_000,'excluded','bist30_outside','verified');
 const client={listing:async()=>[],disclosure:async()=>null};
 try{await assert.rejects(()=>new KapReports(store,client as any).build('circuit',at,at),/circuit_report_source_incomplete/);}finally{store.close();}
});

test('automatic batches use only a verified unambiguous official listing summary without detail requests',async()=>{
 const store=new KapStore(':memory:'),notice=disclosure(40,'GIPTA',10);let requests=0;
 const client={listing:async()=>[listing(notice)],disclosure:async()=>{requests++;throw Error('rate limited')}};
 try{const result=await new KapReports(store,client as any).build('circuit',at,at,undefined,'automatic_batch');assert.deepEqual(result.draft.card_data!.report!.events!.map(e=>e.tickers),[['GIPTA']]);assert.equal(requests,0);
 const malformed={...listing(notice),circuit:{...listing(notice).circuit!,summary:'GIPTA.E ve XYZ.E işlem sırasında devre kesici'}};client.listing=async()=>[malformed];await assert.rejects(()=>new KapReports(store,client as any).build('circuit',at,at,undefined,'automatic_batch'),/circuit_report_source_incomplete/);assert.equal(requests,1);
 }finally{store.close();}
});
