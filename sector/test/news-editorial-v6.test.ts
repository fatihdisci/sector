import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';import examples from './fixtures/editorial-v6-real.json';import{evaluateNews,DEFAULT_NEWS_PREFERENCES,recordNewsCandidate}from'../src/news-routing';import{sameNewsEvent}from'../src/news-event-matching';import{localDatabase}from'../src/local-adapters';
const now=Date.parse('2026-10-25T15:00:00Z');const source={id:'fixture'}as any;
function fresh(id:string){const r=examples.find(x=>x.id===id)!;return {...r,published_at:new Date(now-60000).toISOString()};}
const evalFresh=(r:any)=>evaluateNews(r,source,DEFAULT_NEWS_PREFERENCES,now);
test('real fresh-context failures: rhetoric archive, quantitative BIST analysis and concrete fund stages instant',()=>{
 assert.equal(evalFresh(fresh('f3fcf7c8e367ee66937d6b6f318319c8')).route,'archive');
 for(const id of ['dbc6de84d1e1db2c24222d67e80b0eaa','921f7126e761ce5ad9a3d9239ed144a2','094978f17d2a70784b44685e829ae70b','fc54798992a2272ddcde122175569b4d'])assert.equal(evalFresh(fresh(id)).route,'instant',id);
 const a=evalFresh(fresh('094978f17d2a70784b44685e829ae70b')),b=evalFresh(fresh('fc54798992a2272ddcde122175569b4d'));assert.equal(a.confidence.stage,'wanted');assert.equal(b.confidence.stage,'redetained');
});
test('different source detention reports group, genuine new stages and unrelated broad signatures do not',()=>{
 const ids=['feca5fed14f50b2bfce74d5d296fd993','a7c1350397c26cc741e7163c5e16b35f','c43632b5671d6a1f32e7aef1d83e7554','e4a91b325e7a6c3d3c3f444acd3d49f2'];
 for(const id of ids)assert(sameNewsEvent(fresh(ids[0]),fresh(id)),id);
 assert(!sameNewsEvent(fresh('094978f17d2a70784b44685e829ae70b'),fresh('fc54798992a2272ddcde122175569b4d')));
 assert(!sameNewsEvent(fresh(ids[0]),fresh('921f7126e761ce5ad9a3d9239ed144a2')));
});
test('exact article timestamp/fragment/format repeat retains immutable record and no extra event',async()=>{
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),env={DB}as any,item=fresh('f3fcf7c8e367ee66937d6b6f318319c8');
 const a=await recordNewsCandidate(env,item,source,true,now,DEFAULT_NEWS_PREFERENCES);
 const b=await recordNewsCandidate(env,{...item,title:item.title+' ',url:item.url+'#endeks-event=a7a18e4e96ea379c',published_at:new Date(now-30000).toISOString()},source,true,now+1,DEFAULT_NEWS_PREFERENCES);
 assert.equal(a.id,b.id);assert.equal(a.group,b.group);assert.equal((await DB.prepare('select count(*) n from news_candidates').first<any>()).n,1);
});
test('routine analysis and generic fund/BIST words do not imply instant; off-topic stays out',()=>{
 const e=(title:string,summary='Kaynakta bu gelişmeyle ilgili ayrıntılar ve açıklamalar yer alıyor.')=>evalFresh({title,summary,url:'https://example.org',published_at:new Date(now-60000).toISOString()});
 for(const t of ['BIST günü nasıl kapatabilir? Analistlerin beklentileri','Yatırım fonları hakkında haftalık yorum'])assert.notEqual(e(t).route,'instant');
 for(const t of ['Doğu Ekspresi gezi rehberi','Meteoroloji hava durumu tahminleri','KPSS sınavında yeni gelişmeler','Ünlü oyuncunun aşk hayatı','Kent merkezinde yeni telefon lansmanı'])assert.equal(e(t).route,'archive',t);
 assert.equal(e('TCMB faiz indirdi: politika faizi kararı açıklandı').route,'instant');
 assert.equal(e('Aselsan üretimin durduğu iddiasını yalanladı').route,'instant');
 const r=fresh('921f7126e761ce5ad9a3d9239ed144a2');r.published_at=new Date(now-2*86400000).toISOString();assert.equal(evalFresh(r).route,'archive');
});

test('changed signed figures cannot disappear through punctuation normalization',()=>{const a={title:'Şirket net kârı -10 milyon TL',summary:'',published_at:new Date(now).toISOString()},b={...a,title:'Şirket net kârı 10 milyon TL'};assert(!sameNewsEvent(a,b));});
test('real cross-source detention copies use one persisted group without merging new stages',async()=>{
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),env={DB}as any,ids=['feca5fed14f50b2bfce74d5d296fd993','a7c1350397c26cc741e7163c5e16b35f','c43632b5671d6a1f32e7aef1d83e7554','e4a91b325e7a6c3d3c3f444acd3d49f2'],groups=[];
 for(const id of ids){const r=fresh(id);groups.push((await recordNewsCandidate(env,{...r,url:'https://fixture.example/'+id},source,true,now,DEFAULT_NEWS_PREFERENCES)).group);}
 assert.equal(new Set(groups).size,1);
 const a=await recordNewsCandidate(env,fresh('094978f17d2a70784b44685e829ae70b'),source,true,now,DEFAULT_NEWS_PREFERENCES),b=await recordNewsCandidate(env,fresh('fc54798992a2272ddcde122175569b4d'),source,true,now,DEFAULT_NEWS_PREFERENCES);assert.notEqual(a.group,b.group);
});
test('an existing version decision and timestamp are never rewritten by a repeated scan',async()=>{
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),env={DB}as any,a=fresh('921f7126e761ce5ad9a3d9239ed144a2'),b={...a,title:a.title.replace('500','600')};
 await recordNewsCandidate(env,a,source,true,now,DEFAULT_NEWS_PREFERENCES);const v=await recordNewsCandidate(env,b,source,true,now,DEFAULT_NEWS_PREFERENCES);
 await DB.prepare("update news_candidates set route='digest',rule_version='historical',evaluated_at=123 where id=?").bind(v.id).run();
 const repeated=await recordNewsCandidate(env,b,source,true,now+1,DEFAULT_NEWS_PREFERENCES);assert.equal(repeated.decision.route,'digest');const row=await DB.prepare('select rule_version,evaluated_at from news_candidates where id=?').bind(v.id).first<any>();assert.equal(row.rule_version,'historical');assert.equal(row.evaluated_at,123);
});
