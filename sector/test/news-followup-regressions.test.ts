import test from'node:test';import assert from'node:assert/strict';import rows from'./fixtures/news-followup-real.json';import{sameNewsEvent}from'../src/news-event-matching';import{evaluateNews,DEFAULT_NEWS_PREFERENCES}from'../src/news-routing';
const find=(id:string)=>rows.find(r=>r.id===id)!,fresh=(r:any)=>evaluateNews(r,{id:r.source_id}as any,DEFAULT_NEWS_PREFERENCES,Date.parse(r.published_at)+60000);
test('same canonical Fed article survives a rewritten headline; real decisions/amounts/periods remain separate',()=>{
 const a=find('9f80f2beb977cba38af2737f4f91bf94'),b=find('9542c853217f395546f5dc8802c8703f');assert(sameNewsEvent(a,b));assert(!sameNewsEvent(a,{...b,title:'Fed politika faizini indirdi'}));assert(!sameNewsEvent(a,{...b,summary:b.summary.replace('100','101')}));assert(!sameNewsEvent({...a,title:'Fed ilk yarı beklentileri'},{...a,title:'Fed ikinci yarı beklentileri'}));
});
test('concrete Chinese FDI figures outrank a technology keyword without opening generic technology',()=>{
 assert.equal(fresh(find('1d0b25950c112f661812c2f8190c9787')).route,'digest');assert(fresh(find('1d0b25950c112f661812c2f8190c9787')).reasons.includes('concrete_economic_data'));
 const r={...rows[0],title:'Yeni telefon teknoloji lansmanı',summary:'Yapay zeka özellikli yeni telefon tanıtıldı, oyun ve kamera özellikleri anlatıldı.'};assert.equal(fresh(r).route,'archive');
});
test('Netflix matching uses company/per-user metric/direction after full-source comparison; other metrics do not merge',()=>{
 const a=find('bca974750a5e8fee0ff5c25ba20b653e'),b=find('e61693baa6cf745f5bc1cd3eb89f76b3');assert(sameNewsEvent(a,b));assert(!sameNewsEvent(a,{...b,title:b.title.replace('Netflix','Spotify')}));assert(!sameNewsEvent(a,{...b,title:"Netflix'te abone sayısı düşüyor",summary:'Abone sayısı düşüyor, kullanıcı başına izleme süresi artıyor.'}));
});
test('Putin LNG share and sanctions rhetoric are not a new instant decision; concrete sanctions remain material',()=>{
 assert.notEqual(fresh(find('2c69d6fe5b30b5a72b9ff3f83497abb4')).route,'instant');const r={...rows[0],title:'AB yeni LNG yaptırım kararını onayladı',summary:'Avrupa Birliği yeni doğal gaz yaptırımını onayladı; karar yürürlüğe girdi.'};assert.equal(fresh(r).route,'instant');
});
