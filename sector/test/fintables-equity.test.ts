import test from'node:test';import assert from'node:assert/strict';
import rows from'./fixtures/fintables-financial-real.json';
import{evaluateNews,DEFAULT_NEWS_PREFERENCES,foldNews}from'../src/news-routing';
import{explicitEquityCodes}from'../src/news-company-catalog';
const now=Date.parse('2026-10-26T06:30:00Z');
const evaluate=(title:string,summary=title)=>evaluateNews({title,summary,url:'https://example.com/financial',published_at:new Date(now-60000).toISOString()},{id:'fixture'}as any,DEFAULT_NEWS_PREFERENCES,now);
test('actual Fintables financial announcements resolve catalogued codes with fresh deterministic context',()=>{
 for(const row of rows.filter(r=>!r.title.startsWith('$KLNMA'))){const r=evaluateNews(row,{id:row.source_id}as any,DEFAULT_NEWS_PREFERENCES,Date.parse(row.published_at)+60000),code=/\$([A-Z]+)/.exec(row.title)![1];assert(r.eligible);assert(!r.reasons.includes('invalid_or_old_date'));assert.deepEqual(r.confidence.codes,[code]);assert.equal(r.confidence.event,'financial');assert.equal(r.confidence.stage,'decided');assert.equal(r.route,'instant');}
});
test('explicit financial cashtags/hashtags and Turkish Unicode/case variants do not require a BIST tag',()=>{
 for(const title of ['$CVKMD 2026/9 finansal tabloları açıklandı.','#cvkmd 2026/9 BİLANÇO sonuçları açıklandı.','＄cvkmd 2026/9 malî tabloları açıklandı.','#CVKMD finansal raporları açıklandı.','$CVKMD net kârı yüzde 20 arttı.']){const r=evaluate(title);assert.deepEqual(r.confidence.codes,['CVKMD'],title);assert.equal(r.route,'instant',title);}
 for(const context of ['#BIST30','#BIST100','#BİST100','#bist100','BIST 30','BIST 100'])assert.deepEqual(explicitEquityCodes('CVKMD '+context+' finansal tabloları açıklandı.',foldNews),['CVKMD']);
});
test('code identification is separate from realized financial results and index membership',()=>{
 for(const title of ['$CVKMD bilanço beklentileri ve net kâr tahmini açıklandı.','$CVKMD finansal tabloları yarın açıklanacak; beklentiler derlendi.','$CVKMD 2026/9 finansal tablolarını yarın açıklayacak.','$CVKMD 2026/9 finansal tabloları açıklanacak.','$CVKMD bilançosunu henüz açıklamadı.','#CVKMD #BIST100 hedef fiyat ve teknik analiz raporu yayımlandı.','#CVKMD #BIST100 fiyatı yüzde 2 yükseldi.']){const r=evaluate(title);assert.deepEqual(r.confidence.codes,['CVKMD']);assert.notEqual(r.route,'instant',title);}
 assert.equal(evaluate('$CVKMD #BIST30 finansal tabloları açıklandı.').confidence.priority,0,'social tag is not verified index membership');
});
test('fund/broker codes, unknown tokens, consumer catalogues and ambiguous share classes remain guarded',()=>{
 for(const title of ['$TIB finansal tabloları açıklandı. #BIST100','$IYM bilanço sonuçları açıklandı.','$ZZZZZ finansal tabloları açıklandı. #BIST100','CVKMD festival ve etkinlik takvimi yayımlandı.','$CVKMD indirim kataloğu ve satış listesi yayımlandı.','ABCDEF finansal tabloları açıklandı. #BIST100','$CVKMD_TEST finansal tabloları açıklandı. #BIST100','$CVKMDŞ finansal tabloları açıklandı. #BIST100','Borsa fon kodları: #ASTOR, $THYAO finansal raporları açıklandı.'])assert.deepEqual(evaluate(title).confidence.codes,[],title);
 for(const title of ['İş Bankası finansal tabloları açıklandı.','Kardemir bilanço sonuçları açıklandı.','Carrefour bilanço sonuçları açıklandı.','QNB Yatırım finansal tabloları açıklandı.'])assert.deepEqual(evaluate(title).confidence.codes,[],title);
 assert.deepEqual(evaluate('Kardemir #KRDMB finansal tabloları açıklandı.').confidence.codes,['KRDMB']);
 assert.notEqual(evaluate('#CVKMD #BIST100 indirim kataloğu ve market fırsatları açıklandı.').route,'instant');
});

test('a persisted old candidate is immutable while a genuinely new period resolves prospectively without delivery',async()=>{
 const {readFile}=await import('node:fs/promises'),{localDatabase}=await import('../src/local-adapters'),{recordNewsCandidate}=await import('../src/news-routing');
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),env={DB}as any,row=rows[0],source={id:row.source_id}as any;
 const recorded=await recordNewsCandidate(env,row,source,true,now,DEFAULT_NEWS_PREFERENCES);
 await DB.prepare("UPDATE news_candidates SET route='digest',reasons=?,confidence=? WHERE id=?").bind('["relevance_uncertain"]',JSON.stringify({...recorded.decision.confidence,codes:[]}),recorded.id).run();
 const before=await DB.prepare('SELECT * FROM news_candidates WHERE id=?').bind(recorded.id).first<any>();
 const seen=await recordNewsCandidate(env,row,source,true,now+1000,DEFAULT_NEWS_PREFERENCES);assert.equal(seen.decision.route,'digest');assert.deepEqual(seen.decision.confidence.codes,[]);assert.deepEqual(await DB.prepare('SELECT * FROM news_candidates WHERE id=?').bind(recorded.id).first(),before);
 const next={...row,url:'https://example.com/new-period',title:row.title.replaceAll('2026/9','2026/12'),summary:row.summary.replaceAll('2026/9','2026/12'),published_at:new Date(now-1000).toISOString()},fresh=await recordNewsCandidate(env,next,source,true,now,DEFAULT_NEWS_PREFERENCES);assert.equal(fresh.decision.route,'instant');assert.deepEqual(fresh.decision.confidence.codes,['CVKMD']);assert.notEqual(fresh.group,recorded.group);
 for(const table of ['news_cards','model_jobs','drafts'])assert.equal((await DB.prepare('SELECT COUNT(*) n FROM '+table).first<any>()).n,0);
});

test('a real issuer without verified equity instrument evidence stays unresolved despite a financial cashtag',()=>{
 const row=rows.find(r=>r.title.startsWith('$KLNMA'))!,r=evaluateNews(row,{id:row.source_id}as any,DEFAULT_NEWS_PREFERENCES,Date.parse(row.published_at)+60000);assert(r.eligible);assert.deepEqual(r.confidence.codes,[]);assert.equal(r.route,'digest');assert(r.reasons.includes('official_issuer_instrument_unresolved'));
});
