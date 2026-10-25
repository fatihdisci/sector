import test from 'node:test';import assert from 'node:assert/strict';
import {evaluateNews,DEFAULT_NEWS_PREFERENCES} from '../src/news-routing';import type {Source} from '../src/types';
const now=Date.parse('2026-10-25T05:00:00Z');
const e=(title:string,summary='Borsa İstanbul şirketlerinin kaynakta açıklanan işlemlerinin ayrıntıları.')=>evaluateNews({title,summary,url:'https://example.com/news',published_at:new Date(now-60000).toISOString()},{id:'test'} as Source,DEFAULT_NEWS_PREFERENCES,now);
test('verified multiple equity codes; misspellings and ordinary words remain unresolved',()=>{
 assert.deepEqual(e('QNB Yatırım net satış; ASTOR, THYAO, KCHOL dahil 10 hisse').confidence.codes,['ASTOR','KCHOL','THYAO']);
 assert.deepEqual(e('BofA satış: ASELS, EREGL, TUPRS, KOCHL').confidence.codes,['ASELS','EREGL','TUPRS']);
 assert.deepEqual(e('Borsa fon kodları: ASTOR, THYAO').confidence.codes,[]);
 assert.deepEqual(e('BIST: ZZZZZ hisse kodu').confidence.codes,[]);
 assert.deepEqual(e('ASTOR festival sponsorluğu','Kültür sanat etkinlikleri için yeni program ve takvim duyuruldu.').confidence.codes,[]);
});
test('short names are distinct from ambiguous groups and foreign parents',()=>{
 assert.deepEqual(e('Aselsan, Netaş, Baydöner, Borusan sözleşme açıkladı').confidence.codes.sort(),['ASELS','BYDNR','NETAS']);
 for(const name of ['QNB Yatırım','Borusan','Carrefour'])assert.deepEqual(e(name+' yeni açıklama yaptı').confidence.codes,[]);
 assert.deepEqual(e("Arçelik'ten fabrika yatırımı").confidence.codes,['ARCLK']);
 assert.deepEqual(e('Arçelik'.normalize('NFD')+' yatırım').confidence.codes,['ARCLK']);
});
test('opening is distinct from expectation, allegation and negation',()=>{
 const r=e("Arçelik'ten Manisa'ya 200 milyon euroluk yatırım: Yeni fabrika açıldı");assert.equal(r.confidence.event,'investment');assert.equal(r.route,'instant');
 for(const t of ['Arçelik yeni fabrika açmayı planlıyor','Arçelik fabrikası açılmadı'])assert.notEqual(e(t).route,'instant');
 assert.equal(e('Arçelik fabrikası açıldı iddiası').route,'digest');
});
