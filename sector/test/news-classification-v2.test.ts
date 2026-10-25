import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import catalog from '../src/data/news-companies.json';import examples from './fixtures/news-rule-public-examples.json';
import {evaluateNews,DEFAULT_NEWS_PREFERENCES as prefs,newsPreferences,NEWS_RULE_VERSION} from '../src/news-routing';
import {localDatabase} from '../src/local-adapters';import {readFile} from 'node:fs/promises';import type {Source,Env} from '../src/types';
const source={id:'fixture',family:'fixture'} as Source,now=Date.parse('2026-10-23T12:00:00Z');
const evaluate=(title:string,summary='Kaynak açıklaması: gelişmenin ayrıntıları bugün yayımlandı.')=>evaluateNews({title,summary,url:'https://example.org/item',published_at:new Date(now).toISOString()},source,prefs,now);
test('official catalog is immutable, sourced, separated from index membership and conservative about identities',()=>{
 assert(catalog.companies.length>500);assert.equal(createHash('sha256').update(JSON.stringify(catalog.companies)).digest('hex'),catalog.companies_sha256);
 assert(catalog.companies.every(c=>!('index' in c)));for(const title of ['Carrefour Fransa sonuçlarını açıkladı','Erdemir Madencilik yatırım yaptı','ASELSAN NET sözleşme imzaladı','Volvo yeni model tanıttı','CarrefourSA’nın ana şirketi Carrefour sonuçlarını açıkladı'])assert.deepEqual(evaluate(title).confidence.codes,[]);
 assert.deepEqual(evaluate('CarrefourSA yeni mağaza açtı').confidence.codes,['CRFSA']);assert.deepEqual(evaluate('Akfen GYO net kâr açıkladı').confidence.codes,['AKFGY']);
});
test('real published examples: market outlook, retail catalog, contract and three earnings reports',()=>{
 const result=examples.map(x=>evaluateNews(x,source,prefs,x.evaluated_at));assert.equal(examples.length,6);
 assert.equal(result[0].confidence.event,'market_outlook');assert.equal(result[0].confidence.stage,'expected');assert.equal(result[0].route,'digest');assert(!result[0].reasons.includes('general_technology'));
 assert.deepEqual(result[1].confidence.codes,['ASELS']);assert.equal(result[1].confidence.event,'contract');assert.equal(result[1].confidence.stage,'signed');
 for(const [i,code] of [[2,'EREGL'],[3,'AKFGY'],[4,'EBEBK']] as const){assert(result[i].confidence.codes.includes(code));assert.equal(result[i].confidence.event,'financial');}
 assert.equal(result[5].confidence.event,'retail_promotion');assert.equal(result[5].route,'archive');
});
test('event stages generalize: default/bid/award/signed/forecast/decision and denials',()=>{
 const cases=[['Aselsan ihaleye teklif verdi','tender','bid'],['Aselsan ihaleyi kazandı','tender','awarded'],['Aselsan ihale için sözleşme imzaladı','contract','signed'],['Aselsan borcunu ödeyemedi temerrüde düştü','payment_default','occurred'],['Aselsan temerrüt iddiasını yalanladı','payment_default','denied'],['TCMB politika faizi beklentisi açıklandı','rate','expected'],['TCMB politika faizini indirdi','rate','decided']];
 for(const [title,event,stage] of cases){const r=evaluate(title);assert.equal(r.confidence.event,event,title);assert.equal(r.confidence.stage,stage,title);}
 assert.equal(evaluate('Aselsan ödemeleri aksadı').confidence.event,'payment_default');assert.equal(evaluate('Aselsan sözleşme imzalayacak').confidence.stage,'expected');
 assert.equal(evaluate('Aselsan ihaleye teklif verdi').route,'digest');assert.equal(evaluate('BofA piyasa stratejisti dolar beklentisini açıkladı').route,'digest');
 assert.equal(evaluate('Erdemir üçüncü çeyrek net kârı beklentilerin üzerinde gerçekleşti').confidence.stage,'decided');
 assert.equal(evaluate('Erdemir net kâr beklentisi açıklandı').confidence.stage,'expected');
 assert.equal(evaluate('Erdemir üçüncü çeyrek net kârının artması bekleniyor').confidence.stage,'expected');
 assert.notEqual(evaluate('BİM raflarda indirim fırsatı: ev ekonomisi ve teknoloji').confidence.event,'macro_data');
 assert.notEqual(evaluate('BİM finansal tablo açıkladı').confidence.event,'retail_promotion');
 assert.equal(evaluateNews({...examples[1],published_at:null},source,prefs,now).route,'digest');
});
test('catalog provision is not active-mode readiness or owner approval; no feedback learning',async()=>{
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),env={DB,TELEGRAM_USER_ID:'owner'} as Env;
 const p=await newsPreferences(env);assert(p.entities.length>500);assert.equal(p.mode,'shadow');assert.equal(p.digest_enabled,false);
 await DB.prepare("INSERT INTO system_state VALUES('news_filter_preferences',?)").bind(JSON.stringify({mode:'active',approved_by_owner:true,entities:[]})).run();assert.equal((await newsPreferences(env)).mode,'shadow');assert.equal((await DB.prepare('SELECT COUNT(*) n FROM news_feedback').first<any>()).n,0);assert.equal(NEWS_RULE_VERSION,'investor-v3');
});
