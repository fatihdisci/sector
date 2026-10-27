import test,{beforeEach,afterEach,mock} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {localDatabase} from '../src/local-adapters';import type {Env,Draft,Document} from '../src/types';import {draftKeyboard,newsKeyboard} from '../src/telegram-ui';import {draftMenu,refreshDraftMenu} from '../src/card-menu';import {previewMarkup,refreshNewsMenu,interestSummary} from '../src/news-menu';import {recordNewsCandidate,DEFAULT_NEWS_PREFERENCES} from '../src/news-routing';import {newsReadiness} from '../src/news-readiness';import {newsroomMessage} from '../src/newsroom';import worker from '../src/worker';
const now=Date.parse('2026-10-23T09:30:00Z'),id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',news='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
beforeEach(()=>mock.timers.enable({apis:['Date'],now}));afterEach(()=>mock.timers.reset());
const docs=[{url:'https://example.org/source',source_id:'rss',source_name:'Kaynak',family:'fixture',official:false,title:'Örnek haber',body:'Kaynak verisi',passages:[],published_at:new Date(now).toISOString()}] as Document[];
const draft={headline:'📢 Örnek haber',body:'Kaynağa dayalı haber.',hashtags:['BIST'],template:'akd',card_data:{ticker:'ABCD',buy:[{label:'Alfa',value:'123 lot'}]},claims:[],uncertainties:[]} as unknown as Draft;
async function setup(){const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));const env={DB,MODE:'telegram_review',X_PUBLISH_ENABLED:'true',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'7',TELEGRAM_BOT_TOKEN:'123:fixture',TELEGRAM_VERIFIED_BOT_ID:'123',TELEGRAM_WEBHOOK_SECRET:'fixture',MEDIA:{get:async()=>({arrayBuffer:async()=>new Uint8Array([137,80,78,71]).buffer})}} as unknown as Env;
 await DB.prepare("INSERT INTO sources(id,config) VALUES('rss','{}')").run();await DB.prepare("INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen) VALUES('a','rss','https://example.org/source','Örnek haber','Kaynağa dayalı açıklama',?,?)").bind(new Date(now).toISOString(),now/1000).run();
 await DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,created_at,expires_at,media_key,message_id,delivery_state) VALUES(?,?,?,?,?,'verified',?,?, 'drafts/aaa/1.png',90,'sent')").bind(id,id,id,JSON.stringify(draft),JSON.stringify(docs),now/1000,now/1000+3600).run();await DB.prepare("INSERT INTO news_cards(id,article_id,state,message_id,created_at) VALUES(?,'a','sent',80,?)").bind(news,now/1000).run();return env;}
function fake(){const original=globalThis.fetch,calls:{method:string;body:any}[]=[];globalThis.fetch=async(u,init)=>{assert(String(u).startsWith('https://api.telegram.org/'),'No X/model/other external calls permitted');calls.push({method:String(u).split('/').at(-1)!,body:init?.body});return Response.json({ok:true,result:{message_id:99}});};return {calls,restore:()=>globalThis.fetch=original};}
async function press(env:Env,data:string,update=1,message=90,user=7){return worker.fetch(new Request('https://local/telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-telegram-bot-api-secret-token':'fixture'},body:JSON.stringify({update_id:update,callback_query:{id:'cb'+update,data,from:{id:user},message:{message_id:message,chat:{id:7,type:'private'}}}})}),env,{waitUntil:()=>{}} as any);}
const buttons=(m:any)=>m.inline_keyboard.flat();const labels=(m:any)=>buttons(m).map((b:any)=>b.text);
test('preview and ready main menus contain only the requested actions; contextual More keeps supported actions',()=>{
 assert.deepEqual(labels(newsKeyboard(news,docs[0].url)),['İçerik oluştur','❤️','👎','Diğer']);assert.deepEqual(labels(draftKeyboard(id,1,docs,true,draft)),['X’te paylaş','Düzenle','Diğer']);
 const more=draftKeyboard(id,1,docs,true,draft,{},'more');for(const label of ['Kaynağı aç','Tasarımı değiştir','PNG indir','Elle paylaştım','Ertele','Kanıtlar','Tablo verileri','Hücre düzelt','Geri'])assert(labels(more).includes(label));
 assert(!labels(more).includes('CSV indir'));assert(!JSON.stringify(more).includes('copy_text'));assert(!JSON.stringify(more).includes('pub:stats'));
 for(const template of ['circuit','info'] as const){const d={...draft,template,card_data:template==='info'?{report:{rows:[],footer:'',general:{day:'2026-10-23',time:'12:30',companies:0,lots:'0',amount:'0',missing:0,rows:[]}}}:{tickers:['ABCD']}};const m=draftKeyboard(id,1,docs,true,d,{},'more');assert(!labels(m).includes('Tasarımı değiştir'));assert(!labels(m).includes('Hücre düzelt'));assert.equal(labels(m).includes('CSV indir'),template==='info');}
});
test('published, API in-flight, manual and deferred menus never expose an inappropriate publish or manual correction',()=>{
 for(const state of [{published:true,api:'sent'},{api:'uncertain'},{api:'queued'},{published:true,manual:true}]){assert.deepEqual(labels(draftKeyboard(id,1,docs,true,draft,state)),['Yayın özeti','Diğer']);assert(!labels(draftKeyboard(id,1,docs,true,draft,state, 'more')).includes('Elle paylaştım'));}
 assert(labels(draftKeyboard(id,1,docs,true,draft,{published:true,manual:true},'more')).includes('Manuel saati düzelt'));assert(!labels(draftKeyboard(id,1,docs,true,draft,{published:true,api:'sent'},'more')).includes('İşareti geri al'));
 assert.deepEqual(labels(draftKeyboard(id,1,docs,true,draft,{deferred:true})),['Hazıra al','Diğer']);
});
test('More, Back and layout selection replace markup on the same message without sending a new message or publishing',async()=>{
 const e=await setup(),f=fake();try{for(const [i,view] of ['more','layouts','main'].entries())assert.equal((await press(e,`dm:${view}:${id}:1`,i+1)).status,200);await press(e,`nm:more:${news}`,4,80);await press(e,`nm:main:${news}`,5,80);
 assert.equal(f.calls.filter(c=>c.method==='editMessageReplyMarkup').length,5);assert(f.calls.every(c=>['editMessageReplyMarkup','answerCallbackQuery'].includes(c.method)));const last=f.calls.filter(c=>c.method==='editMessageReplyMarkup').at(-1)!;assert.equal(last.body.get('message_id'),'80');assert.deepEqual(labels(JSON.parse(last.body.get('reply_markup'))),['İçerik oluştur','❤️','👎','Diğer']);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);
 }finally{f.restore();}
});
test('like, change and remove are owner/article-scoped; duplicate and out-of-order callbacks cannot retoggle or inflate counts',async()=>{
 const e=await setup(),f=fake();try{
 await press(e,`ni:l:${news}`,10,80);await press(e,`ni:l:${news}`,10,80);assert.equal((await interestSummary(e)).likes,1);assert(labels(await previewMarkup(e,news,docs[0].url)).includes('❤️ ✓'));
 await press(e,`ni:d:${news}`,11,80);assert.equal((await interestSummary(e)).likes,0);assert.equal((await interestSummary(e)).dislikes,1);assert(labels(await previewMarkup(e,news,docs[0].url)).includes('👎 ✓'));
 await press(e,`ni:l:${news}`,9,80);assert.equal((await interestSummary(e)).dislikes,1);
 await press(e,`ni:d:${news}`,12,80);assert.equal((await interestSummary(e)).dislikes,0);assert.deepEqual(labels(await previewMarkup(e,news,docs[0].url)),['İçerik oluştur','❤️','👎','Diğer']);
 await press(e,`ni:l:${news}`,13,80);assert.equal((await interestSummary(e)).likes,1);await press(e,`ni:l:${news}`,14,80);assert.equal((await interestSummary(e)).likes,0);
 const row=await e.DB.prepare('SELECT * FROM news_interests').first<any>();assert.equal(row.actor,'7');assert.equal(row.article_id,'a');assert.equal(row.source_id,'rss');assert.equal(row.choice,null);
 assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM news_feedback').first<any>()).n,0);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM publication_marks').first<any>()).n,0);assert(f.calls.every(c=>['editMessageReplyMarkup','answerCallbackQuery'].includes(c.method)));
 }finally{f.restore();}
});
test('unauthorized, mismatched-message and stale-revision callbacks cannot change interest, menu, manual publication or X state',async()=>{
 const e=await setup(),f=fake();try{await press(e,`ni:l:${news}`,1,80,8);await press(e,`ni:l:${news}`,2,81);await press(e,`dm:more:${id}:2`,3);await press(e,`dp:mark:${id}:2`,4);await press(e,`dm:more:${id}:1`,5,91);await press(e,`dp:mark:${id}:1`,6,90,8);
 assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM news_interests').first<any>()).n,0);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM publication_marks').first<any>()).n,0);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);assert(!f.calls.some(c=>c.method==='editMessageReplyMarkup'));
 }finally{f.restore();}
});
test('manual mark/undo and defer/ready affect only the manual ledger; API publication cannot be undone',async()=>{
 const e=await setup(),f=fake();try{await press(e,`dp:mark:${id}:1`,1);assert.deepEqual(labels(await draftMenu(e,await e.DB.prepare('SELECT * FROM drafts').first())),['Yayın özeti','Diğer']);await press(e,`dp:mark:${id}:1`,1);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM publication_marks').first<any>()).n,1);
 await press(e,`dp:undo:${id}:1`,2);await press(e,`dp:defer:${id}:1`,3);assert.deepEqual(labels(await draftMenu(e,await e.DB.prepare('SELECT * FROM drafts').first())),['Hazıra al','Diğer']);await press(e,`dp:undo:${id}:1`,4);assert.equal((await e.DB.prepare('SELECT state FROM publication_marks').first<any>()).state,'ready');assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);
 await e.DB.prepare("INSERT INTO x_posts(id,draft_id,revision,day,state,content,media_key,created_at,finished_at) VALUES('x',?,1,'2026-10-23','sent','text','drafts/aaa/1.png',?,?)").bind(id,now,now).run();await press(e,`dp:undo:${id}:1`,5);assert.equal((await e.DB.prepare("SELECT state FROM x_posts WHERE id='x'").first<any>()).state,'sent');assert(!f.calls.some(c=>/delete|postTweet|upload/.test(c.method)));
 }finally{f.restore();}
});
test('legacy revisionless publication and copy controls redirect safely; expired controls cannot revive a publication or redesign',async()=>{
 const e=await setup(),f=fake();try{await press(e,`pub:mark:${id}`,1);await press(e,`asset:text:${id}:1`,2);for(const [i,action] of ['approve','reject','defer'].entries())await press(e,`s:${action}:${id}:1`,10+i);assert.equal((await e.DB.prepare('SELECT state FROM drafts').first<any>()).state,'pending');assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM publication_marks').first<any>()).n,0);assert(f.calls.every(c=>['editMessageReplyMarkup','answerCallbackQuery'].includes(c.method)));
 await e.DB.prepare('UPDATE drafts SET expires_at=1').run();await press(e,`dp:mark:${id}:1`,3);await press(e,`design:${id}:1`,4);await press(e,`xpost:${id}:1`,5);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM card_redesigns').first<any>()).n,0);assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);
 }finally{f.restore();}
});
test('shadow report separates owner interests from human route evaluation and preserves old detailed feedback',async()=>{
 const e=await setup(),f=fake();try{await e.DB.prepare("INSERT INTO news_feedback VALUES(1,'old','repeat',?)").bind(now).run();await press(e,`ni:l:${news}`,2,80);await newsroomMessage(e,{text:'/golgerapor'});const sent=f.calls.find(c=>c.method==='sendMessage'||c.method==='sendDocument')!;const report=JSON.parse(sent.method==='sendDocument'?await sent.body.get('document').text():sent.body.get('text'));assert.equal(report.historical_metrics.reviewed,0);assert.equal(report.owner_context_reviews.reviewed,0);assert.equal(report.interest_feedback.likes,1);assert.equal(report.metrics.reviewed,0);assert.equal(report.ready,false);assert.equal((await e.DB.prepare("SELECT COUNT(*) n FROM news_feedback WHERE kind='repeat'").first<any>()).n,1);
 }finally{f.restore();}
});
test('UI schema upgrades a populated previous schema without altering source, publication or detailed-feedback rows',async()=>{
 const schema=await readFile('migrations/0001_sector.sql','utf8'),ui=await readFile('migrations/0003_telegram_ui.sql','utf8');assert.equal(schema.slice(schema.indexOf('-- Telegram UI:'),schema.indexOf('-- Independent report receipts')),ui);
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{DatabaseSync}=await import('node:sqlite');const dir=await mkdtemp(join(tmpdir(),'endeks-ui-schema-'));try{const path=join(dir,'old.sqlite'),old=new DatabaseSync(path);old.exec(schema.slice(0,schema.indexOf('-- Telegram UI:')));old.exec('PRAGMA application_id=1397048148;');old.exec("INSERT INTO news_feedback VALUES(1,'old','digest',1);");old.close();const db=await localDatabase(path,schema);assert.equal((await db.prepare('SELECT kind FROM news_feedback').first<any>()).kind,'digest');assert.equal((await db.prepare('SELECT COUNT(*) n FROM news_interests').first<any>()).n,0);assert.equal((await db.prepare('PRAGMA integrity_check').first<any>()).integrity_check,'ok');}finally{await rm(dir,{recursive:true,force:true});}
});

test('existing-card migration edits markup only, respects current revision/status and deduplicates message IDs',async()=>{
 const {menuPlan,refreshMenuItem}=await import('../src/menu-refresh'),e=await setup(),f=fake();try{const plan=await menuPlan(e);assert.equal(plan.length,2);for(const item of plan)assert(await refreshMenuItem(e,item));assert(f.calls.every(c=>c.method==='editMessageReplyMarkup'));assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);const item=plan.find(i=>i.kind==='draft')!;await e.DB.prepare('UPDATE drafts SET revision=2').run();const before=f.calls.length;assert.equal(await refreshMenuItem(e,item),false);assert.equal(f.calls.length,before);assert.equal(JSON.parse((await e.DB.prepare('SELECT content FROM drafts').first<any>()).content).body,draft.body);
 }finally{f.restore();}
});

test('published state also rejects old edit, cell and design controls even if the revision still matches',async()=>{
 const e=await setup(),f=fake();try{await e.DB.prepare("INSERT INTO publication_marks VALUES(?,'published',?,?)").bind(id,now,now).run();for(const [i,data] of [`s:edit:${id}:1`,`ed:correct:${id}:1`,`design:${id}:1`].entries())await press(e,data,100+i);assert(!f.calls.some(c=>c.method==='sendMessage'));for(const table of ['edits','editor_prompts','card_redesigns','model_jobs','x_posts'])assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM '+table).first<any>()).n,0,table);
 }finally{f.restore();}
});
