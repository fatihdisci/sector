import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import{parseListing,syndicationTitle,type Disclosure}from'../src/kap/parser';import{decide,DEFAULTS}from'../src/kap/rules';import{KapStore}from'../src/kap/store';import{KapCollector}from'../src/kap/collector';import{KapDelivery}from'../src/kap-delivery';import{localDatabase}from'../src/local-adapters';
const NOW=Date.parse('2026-10-26T09:00:00Z'),title='Sendikasyon Kredisi Hakkında';
const d=(heading=title)=>({issuerRaw:'AKBNK',issuerCode:'AKBNK',disclosureClass:'ODA',disclosureType:'ODA',category:'ODA',fundType:null,changeStatus:null,oid:null,relatedOid:null,isCorrection:false,id:101,sourceRef:'kap:101',url:'https://www.kap.org.tr/tr/Bildirim/101',title:heading,summary:'Sendikasyon Kredisi Hakkında bilgi',company:'BANKA',subjectCodes:['AKBNK'],relatedCodes:[],isFund:false,publishedAt:new Date(NOW).toISOString(),attachmentCount:1})as Disclosure;
test('only exact Turkish-normalized topic is muted, never related credit headings or body mentions',()=>{
 const prefs={...DEFAULTS,watchlist:[{ticker:'AKBNK',mode:'all' as const,topics:[]}]};const indices={bist30:['AKBNK'],bist100:['AKBNK'],checkedAt:new Date(NOW).toISOString(),source:'KAP'};
 for(const t of [title,'  SENDİKASYON\tKREDİSİ  HAKKINDA\n','sendikasyon kredisi hakkında','Sendikasyon Kredısi Hakkında']){assert(syndicationTitle(t));const a=decide(d(t),prefs,indices);assert.equal(a.action,'off');assert.equal(a.reason,'syndication_title');assert.equal(a.store,false);}
 for(const t of ['Sendikasyon Kredisi Hakkında Açıklama','Sendikasyon Kredisi','Kredi Sözleşmesi','Finansman Anlaşması','Özel Durum Açıklaması (Genel)','Sendikasyon Kredisi Hakkında (Güncelleme)']){assert(!syndicationTitle(t));assert.notEqual(decide(d(t),prefs,indices).reason,'syndication_title');}
});
test('official light title skips detail/attachments/archive/AI without resetting discovery cursors',async()=>{
 const s=new KapStore(':memory:');try{s.set('notification_start',NOW-60000);s.set('bootstrap',{latest:100});s.run("UPDATE jobs SET cursor=100 WHERE name='live'");let reads=0;
 const rows=parseListing([{disclosureIndex:101,subject:title,publishDate:'26.10.2026 12:00:00'}],NOW);assert.equal(rows[0].excludedTopic,'syndication_title');
 const c=new KapCollector(s,{listing:async()=>rows,indices:async()=>{throw Error('unused')},disclosure:async id=>{if(id===101)reads++;return null}},()=>NOW);await c.run('discovery');await c.run('live');assert.equal(reads,0);assert.equal(s.row<{disposition:string}>('select disposition from checks where id=101')!.disposition,'syndication_title');
 assert.equal(s.row<{n:number}>('select count(*) n from disclosures')!.n,0);assert.equal(s.row<{n:number}>('select count(*) n from queue')!.n,0);assert(s.row<{cursor:number}>("select cursor from jobs where name='live'")!.cursor>=101);
 const l=s.claim('reconcile',NOW)!;s.save({...d(),id:103,sourceRef:'kap:103'},l,NOW,false);assert.equal(s.row<{n:number}>('select count(*) n from disclosures')!.n,0);
 }finally{s.close();}
});
test('already pending exact topic is suppressed before full reader and final send; sent/uncertain ledger stays intact',async()=>{
 const s=new KapStore(':memory:'),DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));try{
 const codes=['AKBNK',...Array.from({length:99},(_,i)=>'T'+String(i).padStart(3,'0'))];s.set('indices',{bist30:codes.slice(0,30),bist100:codes,checkedAt:new Date(NOW).toISOString(),source:'https://www.kap.org.tr/tr/Endeksler',sourceSha256:'a'.repeat(64)});s.configure({...DEFAULTS,otherCompanies:'important'},NOW);s.set('notification_start',NOW-60000);s.set('bootstrap',{latest:100});const l=s.claim('live',NOW)!;s.save(d('Kredi Sözleşmesi'),l,NOW,true);
 // Simulate a previously queued exact heading from the preceding release.
 s.run('update disclosures set metadata=? where id=101',JSON.stringify(d()));let reads=0;
 for(const [id,state]of[['old-sent','sent'],['old-uncertain','uncertain']])s.run('insert into queue(id,source_ref,kind,state,created_at,available_at,payload)values(?,?,?,?,?,?,?)',id,id,'instant',state,NOW,NOW,'{}');
 const before=s.rows("select * from queue where state in ('sent','uncertain')");const c=new KapDelivery(s,{DB,MODE:'telegram_review'}as any,async()=>{reads++;throw Error('must_not_read')},()=>NOW);
 assert.equal(c.deliveryDecision([{source_id:'kap',url:d().url}]as any),'suppress');await c.run();assert.equal(reads,0);assert.deepEqual(s.rows("select * from queue where state in ('sent','uncertain')"),before);assert.equal(s.row<{n:number}>('select count(*) n from disclosures')!.n,1);
 }finally{s.close();}
});
