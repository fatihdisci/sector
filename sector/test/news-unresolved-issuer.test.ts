import test from 'node:test';import assert from 'node:assert/strict';import{evaluateNews,DEFAULT_NEWS_PREFERENCES}from'../src/news-routing';
const now=Date.parse('2026-10-25T07:00:00Z');
function e(title:string,age=0){return evaluateNews({title,summary:'Kaynak açıklamasında sözleşmenin şartları ve şirket kararının ayrıntıları yer alıyor.',url:'https://example.com',published_at:new Date(now-age).toISOString()},{id:'fixture'}as any,{...DEFAULT_NEWS_PREFERENCES,watchlist:['KONTR','KORTS','KENT','ISYAT']},now);}
for(const code of ['KONTR','KORTS','ISYAT','KENT'])test(code+' official issuer remains digest without claiming equity',()=>{
 for(const t of [code+' yeni teknoloji yatırımı için 100 milyon TL sözleşme imzaladı',code+' 100 milyon TL sözleşme imzaladı']){const r=e(t);assert.equal(r.route,'digest');assert.deepEqual(r.confidence.codes,[]);assert.equal(r.confidence.unresolved_issuers.length,1);assert.equal(r.confidence.unresolved_issuers[0].instrument_status,'unresolved');assert.equal(r.confidence.priority,0);assert(r.reasons.includes('official_issuer_instrument_unresolved'));}
});
test('issuer fallback preserves freshness, promotion and unrelated technology controls',()=>{
 assert.equal(e('KONTR teknoloji sözleşme imzaladı',2*86400000).route,'archive');
 assert.equal(e('KONTR indirim kataloğu aktüel ürünleri açıklandı').route,'archive');
 assert.equal(e('KONTR sponsor webinar etkinlik kayıt olun').route,'archive');
 const t=e('Yeni telefon teknoloji lansmanı duyuruldu');assert.equal(t.route,'archive');assert.deepEqual(t.confidence.unresolved_issuers,[]);
 for(const t of ['kent sokaklarında yeni teknoloji uygulaması','KOCHL teknoloji sözleşmesi','QNB Yatırım teknoloji sözleşmesi','Borusan teknoloji sözleşmesi','Carrefour teknoloji sözleşmesi'])assert.deepEqual(e(t).confidence.unresolved_issuers,[]);
});
