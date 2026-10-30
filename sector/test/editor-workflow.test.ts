import {beforeEach,afterEach,mock as fixedClock} from 'node:test';
beforeEach(()=>fixedClock.timers.enable({apis:['Date'],now:Date.parse('2026-10-23T09:30:00Z')}));
afterEach(()=>fixedClock.timers.reset());
import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdtemp,copyFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {DatabaseSync} from 'node:sqlite';import {createHash} from 'node:crypto';
import {localDatabase} from '../src/local-adapters';import type {Env,Draft,Document,Source} from '../src/types';
import {outputPreferences,outputView,selectedRows,assertSelectedRows} from '../src/output-preferences';
import {draftCard} from '../src/card';import {postText} from '../src/editorial';import {png} from '../scripts/render_local';
import {keyboard} from '../src/telegram';import {draftKeyboard} from '../src/telegram-ui';import {editorMessage,tableView,evidenceView} from '../src/editor-tools';
import {capturePublication} from '../src/publication-snapshot';import {publicationCsv} from '../src/publication-report';
import {recordNewsCandidate,DEFAULT_NEWS_PREFERENCES} from '../src/news-routing';import {announceNews} from '../src/news-inbox';import {poll} from '../src/pipeline';
import {buildAccountReport} from '../src/nitter-account';import {requestRedesign} from '../src/card-redesign';
const id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const doc:Document={source_id:'manual-input',source_name:'Editör girdisi',family:'manual',official:false,url:'https://example.org/input',title:'AKD tablo',body:'Alfa: 123 lot',passages:[{id:'p1',text:'Alfa: 123 lot'}],published_at:null};
const draft:Draft={headline:'📢 Aracı kurum dağılımı',body:'Kaynakta açıklanan işlemler.',card_headline:'Kurum dağılımı',card_body:'Kaynakta açıklanan işlemler.',hashtags:['#Borsa','#BIST'],category:'bist',importance:80,template:'institutional',claims:[{text:'Alfa: 123 lot',evidence:[{document:0,passage:'p1',quote:'Alfa: 123 lot'}]}],entities:['Alfa'],event_key:'event',uncertainties:[],card_data:{broker:'Örnek Kurum',buy:Array.from({length:10},(_,i)=>({label:'A'+String(i).padStart(4,'0'),value:(100+i)+' milyon TL'})),sell:[{label:'SELL',value:'50 milyon TL'}]}};
async function setup(){const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));const bytes=new Uint8Array([137,80,1,2,3]);return {DB,MEDIA:{get:async()=>({arrayBuffer:async()=>bytes.buffer})},MODE:'telegram_review',TELEGRAM_CHAT_ID:'7',TELEGRAM_USER_ID:'7',TELEGRAM_BOT_TOKEN:'123:fixture',TELEGRAM_VERIFIED_BOT_ID:'123'} as unknown as Env;}
async function seed(e:Env,d=draft){await e.DB.prepare("INSERT INTO sources(id,config) VALUES('manual-input','{}')").run();await e.DB.prepare("INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen,draft_id) VALUES('a','manual-input','https://example.org/input','title','','2026-10-23',1,?)").bind(id).run();await e.DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,created_at,expires_at,media_key,message_id,delivery_state) VALUES(?,?,?,?,?,'verified',1,9999999999,'drafts/aaa/1.png',90,'sent')").bind(id,id,id,JSON.stringify(d),JSON.stringify([doc])).run();}
const mock=()=>{const old=globalThis.fetch,sent:string[]=[];globalThis.fetch=async(_u,init)=>{const b=init?.body as URLSearchParams;sent.push(String(b?.get?.('text')??''));return Response.json({ok:true,result:{message_id:99}});};return {sent,restore:()=>globalThis.fetch=old};};
test('explicit all and side selection preserve the same rows in tweet, SVG and actual PNG',async()=>{
 const preference=outputPreferences('Tümünü yaz, sadece alınanlar; saat yazma, alt not olmasın')!;assert.equal(preference.list,'all');assert.equal(preference.side,'buy');
 const d=outputView({...draft,output_preferences:preference});assertSelectedRows(draft.card_data!.buy!,selectedRows(d));const text=postText(d),svg=draftCard(d);
 for(const r of draft.card_data!.buy!){assert(text.includes('#'+r.label.toLowerCase()));assert(svg.includes(r.label));assert(svg.includes(r.value));}assert(!svg.includes('SELL'));assert(!text.includes('#sell'));
 const bytes=await png(svg);assert.deepEqual([...bytes.slice(0,4)],[137,80,78,71]);
 const first=outputView({...draft,output_preferences:outputPreferences('ilk 3 alınanı göster')});assert.equal(first.card_data!.buy!.length,3);
 assert.throws(()=>draftCard({...d,card_data:{...d.card_data,buy:[...d.card_data!.buy!,{label:'OVER',value:'1 milyon TL'}]}}),/capacity/);
 assert.throws(()=>assertSelectedRows(draft.card_data!.buy!,selectedRows(first)),/coverage/);
});
test('PNG button is available on every card; fixed templates never offer unsupported random layouts',async()=>{
 for(const d of [draft,{...draft,template:'circuit' as const},{...draft,template:'info' as const,card_data:{report:{rows:[],footer:''}}}]){
  const b=draftKeyboard(id,1,[doc],false,d,{},'more');assert(b.inline_keyboard.flat().some(x=>'callback_data'in x&&x.callback_data?.startsWith('asset:image:')));
  assert.equal(b.inline_keyboard.flat().some(x=>'callback_data'in x&&x.callback_data?.startsWith('dm:layouts:')),d.template==='institutional');
 }
 const env=await setup();await seed(env,{...draft,template:'circuit'});assert.match(await requestRedesign(env,`design:${id}:1:frame`,90,1),/sabit/);
 assert.notEqual(draftCard(draft,[],'',false,'navy','editorial'),draftCard(draft,[],'',false,'navy','frame'));
});
test('targeted cell correction retains source and before/after, queues audit, and does not mutate delivered data',async()=>{
 const env=await setup(),m=mock();try{await seed(env);await env.DB.prepare('INSERT INTO editor_prompts VALUES(?,?,?,?,?,?)').bind('7',id,1,88,'cell',9999999999).run();
  assert(await editorMessage(env,{text:'buy.0.value = 125 milyon TL',reply_to_message:{message_id:88}},55));
  const diff=await env.DB.prepare('SELECT * FROM editor_corrections').first<any>();assert.equal(diff.before_value,'100 milyon TL');assert.equal(diff.after_value,'125 milyon TL');assert.equal(diff.state,'proposed');
  const job=await env.DB.prepare('SELECT documents,edit_request FROM model_jobs').first<any>();const docs=JSON.parse(job.documents);assert.equal(docs[0].body,doc.body);assert.equal(docs.at(-1).official,false);assert.equal(docs.at(-1).source_id,'editor-correction');
  assert.equal(JSON.parse((await env.DB.prepare('SELECT content FROM drafts').first<any>()).content).card_data.buy[0].value,'100 milyon TL');
  assert.equal(tableView(draft,[doc])[0].direction,'buy');assert.equal(evidenceView(draft,[doc],'verified').claims[0].excerpts[0].quote,'Alfa: 123 lot');
 }finally{m.restore();}
});
test('publication snapshots preserve original revision and raw PNG hash after draft changes',async()=>{
 const env=await setup();await seed(env);const at=Date.now();await env.DB.prepare("INSERT INTO publication_marks VALUES(?,'published',?,?)").bind(id,at,at).run();await capturePublication(env,id,'manual',at);
 await env.DB.prepare('UPDATE drafts SET revision=2,content=?').bind(JSON.stringify({...draft,headline:'SONRADAN DEĞİŞTİ'})).run();await capturePublication(env,id,'manual',at);
 const snap=await env.DB.prepare('SELECT * FROM publication_snapshots').first<any>();assert.equal(snap.revision,1);assert.equal(snap.media_hash,createHash('sha256').update(new Uint8Array([137,80,1,2,3])).digest('hex'));assert(!snap.text.includes('SONRADAN'));
 await env.DB.prepare('UPDATE publication_marks SET published_at=?').bind(at+1).run();await env.DB.prepare('UPDATE publication_snapshots SET published_at=?').bind(at+1).run();await capturePublication(env,id,'manual',at+1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM publication_snapshots').first<any>()).n,1);
 const csv=await publicationCsv(env,at+1);assert(!csv.includes('SONRADAN'));assert(csv.includes('Aracı kurum dağılımı'));
});
test('old populated schema upgrades additively and an offline file restore preserves queues and receipts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'endeks-migrate-')),schema=await readFile('migrations/0001_sector.sql','utf8'),path=join(dir,'old.sqlite'),old=schema.split('-- Additive editor migration')[0],oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('network_disabled');};
 try{assert.equal(schema.slice(schema.indexOf('-- Additive editor migration'),schema.indexOf('-- Telegram UI:')),await readFile('migrations/0002_editorial.sql','utf8'));const db=new DatabaseSync(path);db.exec(old);db.exec('PRAGMA application_id=1397048148;');db.prepare('INSERT INTO system_state VALUES(?,?)').run('telegram_offset','100');db.exec("INSERT INTO sources(id,config) VALUES('old','{}'); INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen) VALUES('old-a','old','https://example.org/old','Eski kayıt','','2026-10-23',1); INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,revision,created_at,expires_at) VALUES('old-d','old-event','hash','{}','[]','verified',7,1,9999999999); INSERT INTO model_jobs(id,article_id,documents,input_hash,state,created_at) VALUES('old-j','old-a','[]','hash','leased',1); INSERT INTO x_posts(id,draft_id,revision,day,state,content,media_key,created_at) VALUES('old-x','old-d',7,'2026-10-23','uncertain','metin','media',1);");db.prepare('INSERT INTO telegram_updates(update_id,payload,state,created_at) VALUES(1,?, ?,1)').run('{}','uncertain');db.close();await copyFile(path,join(dir,'backup.sqlite'));
  const upgraded=await localDatabase(path,schema);assert.equal((await upgraded.prepare("SELECT value FROM system_state WHERE key='telegram_offset'").first<any>()).value,'100');assert.equal((await upgraded.prepare('SELECT state FROM telegram_updates').first<any>()).state,'uncertain');assert.equal((await upgraded.prepare('SELECT COUNT(*) n FROM news_candidates').first<any>()).n,0);assert.equal((await upgraded.prepare('SELECT revision FROM drafts').first<any>()).revision,7);assert.equal((await upgraded.prepare('SELECT state FROM model_jobs').first<any>()).state,'leased');assert.equal((await upgraded.prepare('SELECT state FROM x_posts').first<any>()).state,'uncertain');
  const recovered=await localDatabase(join(dir,'backup.sqlite'),schema);assert.equal((await recovered.prepare('SELECT state FROM telegram_updates').first<any>()).state,'uncertain');assert.equal((await recovered.prepare('PRAGMA integrity_check').first<any>()).integrity_check,'ok');assert.equal((await recovered.prepare('SELECT state FROM x_posts').first<any>()).state,'uncertain');
 }finally{globalThis.fetch=oldFetch;await rm(dir,{recursive:true,force:true});}
});
test('a valid old RSS feed archives metadata without flagging a source outage or using a model',async()=>{
 const env=await setup(),old=globalThis.fetch;const source:Source={id:'rss',name:'Kaynak',url:'https://example.org/rss',allowed_hosts:['example.org'],family:'publisher',official:false,poll_seconds:60,fresh_hours:24,enabled:true,language:'tr',checked_at:'',terms_url:'',rights_note:'metadata',review_mode:'facts'};
 await env.DB.prepare('INSERT INTO sources(id,config,enabled) VALUES(?,?,1)').bind(source.id,JSON.stringify(source)).run();globalThis.fetch=async()=>new Response('<rss><channel><item><title>Eski teknoloji tanıtımı</title><link>https://example.org/old</link><pubDate>Wed, 01 Jan 2020 10:00:00 GMT</pubDate><description>Tanıtım ve ürün lansmanı hakkında eski haber.</description></item></channel></rss>');
 try{await poll(env);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM news_candidates').first<any>()).n,1);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM articles').first<any>()).n,0);assert.equal((await env.DB.prepare('SELECT failures FROM sources').first<any>()).failures,0);}finally{globalThis.fetch=old;}
});
test('shadow evaluation excludes rejected candidates before SQL LIMIT and never blocks explicit work',async()=>{
 const env=await setup(),m=mock(),now=Date.now(),source={id:'rss',family:'publisher',name:'Kaynak',official:false,minimum_score:0} as Source;
 try{await env.DB.prepare('INSERT INTO sources(id,config,enabled) VALUES(?,?,1)').bind(source.id,JSON.stringify(source)).run();for(let i=0;i<5;i++){
  const item={title:i<4?'Rutin tanıtım '+i:'TCMB politika faizini sabit tuttu',summary:'Yeterli uzunlukta başlık ve kaynak açıklaması yer alıyor.',url:'https://example.org/'+i,published_at:new Date(now-i*60000).toISOString()};const saved=await recordNewsCandidate(env,item,source,i===4,now);
  await env.DB.prepare('INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen) VALUES(?,?,?,?,?,?,?)').bind(saved.article,source.id,item.url,item.title,item.summary,item.published_at,now/1000).run();
 }await announceNews(env);assert(m.sent.some(t=>t.includes('TCMB')));assert.equal(m.sent.length,1);
 }finally{m.restore();}
});
test('Nitter even-sized gap median and the 23:00 cutoff are correctly labelled',()=>{
 const at=Date.parse('2026-10-23T10:00:00Z'),posts=[0,10,40].map((m,i)=>({id:String(i),at:new Date(at+m*60000).toISOString(),url:'https://x.com/borsacakali/status/'+i,retweet:false}));const text=buildAccountReport('2026-10-23',posts,{ok:true});assert(text.includes('medyan 20 dk'));assert(text.includes('23.00 itibarıyla'));
});
test('explicit all removes the generic tweet ticker cap as well as the institutional cap',()=>{
 const d={...draft,template:'company' as const,card_data:undefined,hashtags:Array.from({length:12},(_,i)=>'#A'+String(i).padStart(4,'0')),output_preferences:outputPreferences('Tüm hisseleri yaz')};const text=postText(d);for(const tag of d.hashtags)assert(text.includes(tag.toLowerCase()));
});
test('copy/mark intent is owner-only and a correction never bypasses the existing revision or source guards',async()=>{
 const worker=(await import('../src/worker')).default,env=await setup();env.TELEGRAM_WEBHOOK_SECRET='fixture';await seed(env);const m=mock();try{
  const update={update_id:100,callback_query:{id:'callback',data:`ed:data:${id}:1`,from:{id:8},message:{message_id:90,chat:{id:7,type:'private'}}}};
  const response=await worker.fetch(new Request('https://local.sector/telegram/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-telegram-bot-api-secret-token':'fixture'},body:JSON.stringify(update)}),env,{waitUntil:()=>{}} as any);assert.equal(response.status,200);assert.equal(m.sent.length,0);
 }finally{m.restore();}
});
test('source-backed hashtags do not leak unselected sell tickers into a buy-only tweet',async()=>{
 const {repairDraftStyle}=await import('../src/style');const prefs=outputPreferences('Tümünü yaz sadece alınanlar')!,data=draft.card_data!;
 const source:Document={...doc,equity_codes:[...data.buy!,...data.sell!].map(r=>r.label),output_preferences:prefs,market_data:{kind:'institutional',broker:'Örnek Kurum',rows:(['buy','sell'] as const).flatMap(side=>data[side]!.map(r=>({side,symbol:r.label,volume:r.value})))}};
 const fixed=repairDraftStyle({...draft,hashtags:['#SELL','#Borsa','#BIST']},[source]);assert.equal(fixed.card_data!.sell!.length,0);assert(!postText(fixed).includes('#sell'));for(const r of data.buy!)assert(postText(fixed).includes('#'+r.label.toLowerCase()));
});
test('selection opens undated details once without starting generation or inventing a date',async()=>{
 const {newsroomCallback}=await import('../src/newsroom'),env=await setup(),m=mock(),source={id:'rss',name:'Kaynak',family:'publisher',official:false} as Source;
 try{await env.DB.prepare('INSERT INTO sources(id,config,enabled) VALUES(?,?,1)').bind(source.id,JSON.stringify(source)).run();const c=await recordNewsCandidate(env,{title:'TCMB karar açıklaması',summary:'Karar hakkında doğrulanması gereken kaynak ayrıntıları.',url:'https://example.org/undated',published_at:null},source,false);
  await env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?)').bind('selection_message:88',JSON.stringify([c.id])).run();assert.match((await newsroomCallback(env,'pick:'+c.id,88,999))??'',/ayrıntısı/);await newsroomCallback(env,'pick:'+c.id,88,1000);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM manual_requests').first<any>()).n,0);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<any>()).n,0);assert.equal((await env.DB.prepare('SELECT COUNT(*) n FROM news_cards').first<any>()).n,1);
 }finally{m.restore();}
});
test('general buyback subset is rejected before calculation instead of ignoring the requested scope',async()=>{
 const {KapReports}=await import('../scripts/kap_reports'),{KapStore}=await import('../src/kap/store'),store=new KapStore(':memory:');try{const reports=new KapReports(store),at=Date.now();await assert.rejects(()=>reports.build('general_buyback',at,at,outputPreferences('ilk 3 hisse')),/subset_requires_recalculation/);}finally{store.close();}
});
