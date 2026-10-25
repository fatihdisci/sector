import test from 'node:test';import assert from 'node:assert/strict';
import input from '../src/data/news-catalog-source.json';import catalog from '../src/data/news-companies.json';
import{buildCatalog}from'../scripts/news_catalog_model';
import{evaluateNews,DEFAULT_NEWS_PREFERENCES,foldNews}from'../src/news-routing';
import{matchingCompanies,matchingIssuerMentions}from'../src/news-company-catalog';
const now=Date.parse('2026-10-25T07:00:00Z');
const e=(title:string)=>evaluateNews({title,summary:'Borsa İstanbul şirketinin kaynakta açıklanan sözleşme ayrıntıları ve kararları.',url:'https://example.com',published_at:new Date(now).toISOString()},{id:'test'} as any,DEFAULT_NEWS_PREFERENCES,now);
test('official projections rebuild exact catalog; issuer identity and instrument evidence stay distinct',()=>{
 assert.deepEqual(buildCatalog(input),catalog);assert.equal(catalog.issuers.length,755);
 assert.equal(new Set(catalog.companies.map(c=>c.code)).size,catalog.companies.length);
 for(const c of catalog.companies){assert(c.equity_evidence.length);assert(c.equity_evidence.every(s=>s.field.startsWith('XUTUM.')||s.field.includes('Fiili Dolaşımdaki Paylar')));assert.equal(c.trading_status,'unknown');}
 for(const code of ['GARAN','ISCTR','YKBNK','VAKBN','HALKB','KRDMA','KRDMB','KRDMD','ISMEN','ISATR','ISBTR'])assert(catalog.companies.some(c=>c.code===code),code);
 for(const code of ['TGB','TIB','IYM','YKB','TVB','THL','FIN'])assert(!catalog.companies.some(c=>c.code===code),code);
 const is=catalog.issuers.find(i=>i.source_codes.includes('ISCTR'))!;assert.deepEqual(is.equity_codes,['ISATR','ISBTR','ISCTR']);assert(is.unresolved_codes.includes('ISKUR'));assert(is.unresolved_codes.includes('TIB'));
});
test('no blind code splitting; evidence mismatch or conflicting OID fails',()=>{
 const copy=structuredClone(input);copy.equity_index.push({...copy.equity_index[0],stockCode:'ZZZZZ'});assert.throws(()=>buildCatalog(copy),/source mismatch/);
 const c=structuredClone(input);c.issuers.push({...c.issuers[0]});assert.throws(()=>buildCatalog(c),/duplicate issuer/);
});
test('issuer-only multi-class mentions retain all candidate classes without selecting one',()=>{
 for(const [name,codes] of [['Kardemir',['KRDMA','KRDMB','KRDMD']],['İş Bankası',['ISATR','ISBTR','ISCTR']]] as const){const r=e(name+' sözleşme imzaladı');assert.deepEqual(r.confidence.codes,[]);assert.equal(r.confidence.issuers.length,1);assert.deepEqual(r.confidence.issuers[0].candidate_codes,codes);assert(r.reasons.includes('issuer_verified_share_class_unresolved'));}
 assert.deepEqual(e('Kardemir KRDMB hisse sözleşme açıklaması').confidence.codes,['KRDMB']);
 assert.equal(new Set(catalog.companies.filter(c=>c.code.startsWith('KRD')).map(c=>c.oid)).size,1);
});
test('aliases shared across different issuers remain unresolved',()=>{
 const entities=[{name:'Ortak Ad',code:'AAAA',issuer_oid:'1',verified:true},{name:'Ortak Ad',code:'BBBB',issuer_oid:'2',verified:true}];
 assert.deepEqual(matchingIssuerMentions(foldNews('Ortak Ad'),entities,foldNews),[]);assert.deepEqual(matchingCompanies(foldNews('Ortak Ad'),entities,foldNews),[]);
});
test('foreign parent, broker, spelling and subsidiary protections survive coverage repair',()=>{
 for(const name of ['QNB Yatırım','Borusan','Carrefour','Erdemir Madencilik','ASELSAN NET','CarrefourSA’nın ana şirketi Carrefour'])assert.deepEqual(e(name+' yeni sözleşme açıkladı').confidence.codes,[],name);
 assert.deepEqual(e('Hisse kodları GARAN, ISCTR, YKBNK, VAKBN, HALKB, KRDMD, ISMEN, KOCHL').confidence.codes,['GARAN','HALKB','ISCTR','ISMEN','KRDMD','VAKBN','YKBNK']);
});
