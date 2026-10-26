import{sha256}from'../src/utils/text';import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{localDatabase}from'../src/local-adapters';import{announceNews}from'../src/news-inbox';import{selectionRows}from'../src/newsroom';import{channelMarketPreviewSQL}from'../src/channel-market-preview';import type{Env}from'../src/types';
async function fixture(){const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));const env={DB,MODE:'telegram_review',TELEGRAM_BOT_TOKEN:'123:test',TELEGRAM_VERIFIED_BOT_ID:'123',TELEGRAM_CHAT_ID:'1',TELEGRAM_USER_ID:'1'}as Env;await DB.prepare('insert into sources(id,config,enabled)values(?,?,1)').bind('sermaye-telegram',JSON.stringify({id:'sermaye-telegram',name:'Sermaye Borsası',official:false,minimum_score:999})).run();return env;}
async function add(env:Env,id:string,caption:string,base=id,at=Date.now(),media='image',peer=2426639373){const articleUrl='https://t.me/SermayeBorsasi/'+base+'?v='+id,articleId=await sha256(articleUrl);const d={version:1,channel:'SermayeBorsasi',peer_id:peer,url:'https://t.me/SermayeBorsasi/'+base,captured_at:at,messages:[{text:caption,media}]};await env.DB.prepare('insert into articles(id,source_id,url,title,summary,published_at,first_seen,document)values(?,?,?,?,?,?,?,?)').bind(articleId,'sermaye-telegram',articleUrl,caption,'Borsa İstanbul piyasa tablosu. Değerler henüz okunmadı.',new Date().toISOString(),Math.floor(Date.now()/1000),JSON.stringify(d)).run();return articleId;}
test('recurring channel images deliver editor previews despite digest route; latest version only, no model/X, no digest duplicate or restart replay',async()=>{const env=await fixture(),old=globalThis.fetch,calls:URLSearchParams[]=[];
 await add(env,'old','📈 BIST 100 — 12:00','26421',Date.now()-1000);const fresh=await add(env,'new','📈 BIST 100 — 12:00','26421'),broker=await add(env,'broker','🏦 Kurum AKD Özeti — 12:01');
 globalThis.fetch=async(url,init)=>{assert.match(String(url),/sendMessage$/);calls.push(init!.body as URLSearchParams);return Response.json({ok:true,result:{message_id:100+calls.length}});};
 try{await announceNews(env);await announceNews(env);assert.equal(calls.length,2);assert.deepEqual((await env.DB.prepare('select article_id from news_cards order by article_id').all<any>()).results.map(r=>r.article_id),[broker,fresh].sort());assert(calls.every(c=>c.get('text')!.includes('değer')||c.get('text')!.includes('Değer')));
 const candidates=(await env.DB.prepare('select route,reasons from news_candidates').all<any>()).results;assert(candidates.every(c=>c.route==='digest'));assert.equal((await selectionRows(env)).length,0);
 for(const t of['model_jobs','drafts','x_posts'])assert.equal((await env.DB.prepare('select count(*)n from '+t).first<any>()).n,0);
 }finally{globalThis.fetch=old;}});
test('text-only, other channel identity, unrelated content, old dates and disabled source cannot use the table lane; malformed evidence is safe',async()=>{const env=await fixture();await add(env,'text','📈 BIST 100 — 12:00','1',Date.now(),'');await add(env,'foreign','📈 BIST 100 — 12:00','2',Date.now(),'image',1);await add(env,'other','Kuş gribi haberi');await add(env,'expired','⏱ Teorik Eşleşme — 09:52');await env.DB.prepare("update articles set published_at='2020-01-01T00:00:00Z' where url like '%?v=expired'").run();await add(env,'invalid','Piyasa Raporu — 12:00');await env.DB.prepare("update articles set document='invalid' where url like '%?v=invalid'").run();
 assert.equal((await env.DB.prepare('select count(*)n from articles a where '+channelMarketPreviewSQL()).first<any>()).n,0);
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('unexpected_send');};try{await announceNews(env);assert.equal((await env.DB.prepare('select count(*)n from news_cards').first<any>()).n,0);await add(env,'disabled','Piyasa Raporu — 12:00');await env.DB.prepare('update sources set enabled=0').run();await announceNews(env);assert.equal((await env.DB.prepare('select count(*)n from news_cards').first<any>()).n,0);}finally{globalThis.fetch=old;}});
test('uncertain preview stays uncertain and is never replayed',async()=>{const env=await fixture();await add(env,'uncertain','⏱ Teorik Eşleşme — 09:52');const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('network_unknown');};try{await announceNews(env);await announceNews(env);assert.equal(calls,1);assert.equal((await env.DB.prepare('select state from news_cards').first<any>()).state,'uncertain');}finally{globalThis.fetch=old;}});

test('late edit does not send a second preview; explicit unprepared request binds latest source, repeated callback is inert',async()=>{
 const {requestNews}=await import('../src/news-inbox');const env=await fixture(),old=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url)=>{assert.match(String(url),/sendMessage$/);calls++;return Response.json({ok:true,result:{message_id:101}});};
 try{const first=await add(env,'v1','Teorik Eşleşme — 09:52','900',Date.now()-2000);await announceNews(env);const c=await env.DB.prepare('select * from news_cards').first<any>();const latest=await add(env,'v2','Teorik Eşleşme — 09:52','900',Date.now());await announceNews(env);assert.equal(calls,1);
 assert.match(await requestNews(env,c.id,101),/hazırlanacak/);assert.equal((await env.DB.prepare('select article_id from news_cards').first<any>()).article_id,latest);assert.match(await requestNews(env,c.id,101),/zaten sırada/);assert.equal((await env.DB.prepare('select count(*)n from articles where id=?').bind(first).first<any>()).n,1);assert.equal((await env.DB.prepare('select count(*)n from x_posts').first<any>()).n,0);
 }finally{globalThis.fetch=old;}
});
test('late edit cannot bypass uncertain preview delivery',async()=>{const env=await fixture(),old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('network_unknown');};try{await add(env,'u1','Teorik Eşleşme — 09:52','901',Date.now()-1000);await announceNews(env);await add(env,'u2','Teorik Eşleşme — 09:52','901');await announceNews(env);assert.equal(calls,1);assert.equal((await env.DB.prepare('select state from news_cards').first<any>()).state,'uncertain');}finally{globalThis.fetch=old;}});

test('fast channel lane excludes RSS and serializes simultaneous discovery/RSS callers across edited versions',async()=>{
 const env=await fixture(),old=globalThis.fetch;let calls=0,release!:()=>void,entered!:()=>void;
 const started=new Promise<void>(r=>entered=r),held=new Promise<void>(r=>release=r);
 await add(env,'fast1','Teorik Eşleşme — 09:40','990',Date.now()-1000);
 await env.DB.prepare('insert into sources(id,config,enabled)values(?,?,1)').bind('rss',JSON.stringify({id:'rss',name:'RSS',official:true,minimum_score:0})).run();
 await env.DB.prepare('insert into articles(id,source_id,url,title,summary,published_at,first_seen)values(?,?,?,?,?,?,?)').bind('rss-1','rss','https://example.com/news','TCMB faiz kararını açıkladı','TCMB faiz kararını açıkladı',new Date().toISOString(),Math.floor(Date.now()/1000)).run();
 globalThis.fetch=async(url)=>{assert.match(String(url),/sendMessage$/);calls++;if(calls===1){entered();await held;}return Response.json({ok:true,result:{message_id:200+calls}});};
 try{
  const first=announceNews(env,true);await started;
  assert.equal((await env.DB.prepare("select count(*) n from news_cards where article_id='rss-1'").first<any>()).n,0);
  await add(env,'fast2','Teorik Eşleşme — 09:40','990');
  const concurrent=announceNews(env);release();await Promise.all([first,concurrent]);
  assert.equal((await env.DB.prepare("select count(*) n from news_cards c join articles a on a.id=c.article_id where a.source_id='sermaye-telegram' and c.state='sent'").first<any>()).n,1);
  assert.equal((await env.DB.prepare("select state from news_cards where article_id='rss-1'").first<any>()).state,'sent');
  assert.equal(calls,2);await announceNews(env,true);assert.equal(calls,2);
  for(const t of ['model_jobs','x_posts'])assert.equal((await env.DB.prepare('select count(*) n from '+t).first<any>()).n,0);
 }finally{release();globalThis.fetch=old;}
});
