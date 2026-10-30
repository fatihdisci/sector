import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/worker';
import {leaseJob,submitJob} from '../src/bridge';
import {validateDraft} from '../src/editorial';
import {draftCard} from '../src/card';
import {png} from '../scripts/render_local';
import {sha256} from '../src/utils/text';
import type {Document,Draft,Env} from '../src/types';
async function environment(){
 const sql=new DatabaseSync(':memory:');sql.exec(await readFile('migrations/0001_sector.sql','utf8'));
 class Statement {
  args:unknown[]=[];constructor(public text:string){}
  bind(...args:unknown[]){const s=new Statement(this.text);s.args=args;return s;}
  run(){const r=sql.prepare(this.text).run(...this.args as never[]);return Promise.resolve({success:true,meta:{changes:Number(r.changes)}});}
  first(){return Promise.resolve(sql.prepare(this.text).get(...this.args as never[])??null);}
  all(){return Promise.resolve({results:sql.prepare(this.text).all(...this.args as never[])});}
 }
 const db={prepare:(text:string)=>new Statement(text),batch:async(statements:Statement[])=>{sql.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('COMMIT');return result;}catch(e){sql.exec('ROLLBACK');throw e;}}};
 const objects=new Map<string,Uint8Array>();
 const env={DB:db,MEDIA:{put:async(k:string,b:Uint8Array)=>objects.set(k,b),delete:async(k:string)=>objects.delete(k)},MODE:'dry_run',TARGET_X_USERNAME:'sectorhaber',AI_MODEL:'gpt-6.1-terra',AI_EFFORT:'low',AI_DAILY_DRAFT_LIMIT:'30',ADMIN_TOKEN:'admin',BRIDGE_TOKEN:'bridge'} as unknown as Env;
 return {env,sql,objects};
}
const document:Document={source_id:'test',source_name:'Resmî Test',family:'official-test',official:true,title:'Test Teknoloji yeni tesis planını açıkladı',url:'https://test.example.org/a',published_at:'2026-10-21T12:00:00Z',body:'Test Teknoloji, yeni üretim tesisi yatırımını planladığını açıkladı. Proje için izin başvuruları sürüyor.',passages:[{id:'p1',text:'Test Teknoloji, yeni üretim tesisi yatırımını planladığını açıkladı.'}]};
const draft:Draft={headline:'Test Teknoloji üretim tesisi yatırımı planlıyor',body:'Şirketin yeni tesisi için izin başvuruları sürüyor.',card_headline:'Test Teknoloji yeni tesis planlıyor',card_body:'Üretim yatırımı için izin süreci devam ediyor.',entities:['Test Teknoloji'],event_key:'test-yeni-tesis-2026',category:'companies',importance:55,template:'company',claims:[{text:'Test Teknoloji üretim tesisi planlıyor.',evidence:[{document:0,passage:'p1',quote:document.passages[0].text}]}],hashtags:['#Teknoloji','#Yatırım'],uncertainties:[]};
test('private routes require distinct admin and bridge secrets',async()=>{
 const {env}=await environment(),ctx={waitUntil:()=>{}} as unknown as ExecutionContext;
 assert.equal((await worker.fetch(new Request('https://sector.test/api/status'),env,ctx)).status,401);
 assert.equal((await worker.fetch(new Request('https://sector.test/api/bridge/lease',{method:'POST',headers:{authorization:'Bearer admin'}}),env,ctx)).status,401);
 assert.equal((await worker.fetch(new Request('https://sector.test/health'),env,ctx)).status,200);
 assert.equal((await worker.fetch(new Request('https://sector.test/telegram/webhook',{method:'POST',body:'{}'}),env,ctx)).status,401);
});
test('job lease is exclusive, result is idempotent, publication remains absent',async()=>{
 const {env,sql,objects}=await environment();
 sql.prepare('INSERT INTO sources(id,config) VALUES(?,?)').run('test','{}');
 sql.prepare('INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen) VALUES(?,?,?,?,?,?,?)').run('a','test',document.url,document.title,'',document.published_at!,Date.now()/1000);
 const input=JSON.stringify([document]),hash=await sha256(input);
 sql.prepare('INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at) VALUES(?,?,?,?,?)').run('job','a',input,hash,Date.now()/1000);
 sql.prepare("INSERT INTO news_cards(id,article_id,state,created_at) VALUES('card','a','model_queued',?)").run(Date.now()/1000);
 const job=await leaseJob(env);assert(job);assert.equal(await leaseJob(env),null);
 const date='21.10.2026',svg=draftCard(draft,[document.source_name],date,true,job.card_theme,job.card_layout);
 const payload={id:'job',lease_token:job.lease_token,input_hash:hash,draft,audit:{supported:true,issues:[]},runtime:{model:'gpt-6.1-terra',effort:'low',provider:'openai-codex',tool_count:0,fallback_count:0},card_date:date,svg_hash:await sha256(svg),png_base64:Buffer.from(await png(svg)).toString('base64')};
 await assert.rejects(()=>submitJob(env,{...payload,input_hash:'changed'}),/invalid_job_lease/);
 await assert.rejects(()=>submitJob(env,{...payload,svg_hash:'wrong'}),/card_content_mismatch/);
 sql.prepare("UPDATE model_jobs SET error='previous_validation_failure' WHERE id='job'").run();
 const result=await submitJob(env,payload);assert.equal(sql.prepare("SELECT error FROM model_jobs WHERE id='job'").get()!.error,null);assert(!result.duplicate);assert.equal(objects.size,1);
 assert.equal(sql.prepare('SELECT value FROM system_state WHERE key=?').get('card_theme:draft:'+result.id)!.value,job.card_theme);
 assert.equal(sql.prepare('SELECT value FROM system_state WHERE key=?').get('card_layout:draft:'+result.id)!.value,job.card_layout);
 assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM drafts').get()!.count,1);
 assert.equal(sql.prepare('SELECT state FROM drafts').get()!.state,'pending'); // Verified 50–59-point stories are deliverable.
 const repeat=await submitJob(env,payload);assert.equal(repeat.id,result.id);assert(repeat.duplicate);
 assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM publication_log').get()!.count,0);
 assert.equal(sql.prepare('SELECT documents FROM model_jobs').get()!.documents,'[]');
});
test('SQLite transactions roll back partially completed jobs',async()=>{
 const {env,sql}=await environment();
 await assert.rejects(()=>env.DB.batch([env.DB.prepare("INSERT INTO system_state VALUES('test','1')"),env.DB.prepare('INSERT INTO nonexistent VALUES(1)')]));
 assert.equal(sql.prepare("SELECT * FROM system_state WHERE key='test'").get(),undefined);
});

test('malformed unrelated numeric source text cannot crash claim validation',()=>{
 const doc={...document,body:document.body+' 0,00452.309.2026.271.253.902.511.65,3760 1 tesis'};
 assert.equal(validateDraft({...draft,headline:'Test Teknoloji 1 tesis planlıyor'},[doc]).verification,'official_attributed');
});
test('fresh model jobs precede old KAP retries; retry leases remain exclusive',async()=>{
 const {env,sql}=await environment();sql.prepare('INSERT INTO sources(id,config) VALUES(?,?)').run('test','{}');
 for(const [id,state,age] of [['old','retry_pending',100],['fresh','queued',0]] as const){
  sql.prepare('INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen) VALUES(?,?,?,?,?,?,?)').run(id,'test',document.url+id,document.title,'',document.published_at!,Date.now()/1000);
  sql.prepare('INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,kind,state) VALUES(?,?,?,?,?,?,?)').run(id,id,JSON.stringify([document]),'hash',Date.now()/1000-age,'kap',state);
 }
 assert.equal((await leaseJob(env))!.id,'fresh');assert.equal((await leaseJob(env))!.id,'old');assert.equal(await leaseJob(env),null);
 assert.equal(sql.prepare("SELECT state FROM model_jobs WHERE id='old'").get()!.state,'leased');
});
test('explicit news request precedes older automatic KAP work',async()=>{
 const {env,sql}=await environment();sql.prepare('INSERT INTO sources(id,config) VALUES(?,?)').run('test','{}');
 for(const [id,kind,age] of [['auto','kap',100],['clicked','news',0]] as const){
  sql.prepare('INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen) VALUES(?,?,?,?,?,?,?)').run(id,'test',document.url+id,document.title,'',document.published_at!,Date.now()/1000);
  sql.prepare('INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,kind,state) VALUES(?,?,?,?,?,?,?)').run(id,id,JSON.stringify([document]),'hash',Date.now()/1000-age,kind,'queued');
 }
 sql.prepare("INSERT INTO news_cards(id,article_id,state,created_at) VALUES('card','clicked','model_queued',?)").run(Date.now()/1000);
 assert.equal((await leaseJob(env))!.id,'clicked');assert.equal((await leaseJob(env))!.id,'auto');
});

test('internal source notes do not enter a tweet and cannot override blocking uncertainty',()=>{
 const note={...draft,source_notes:['Kaynakta aktarılmayan ikincil bir alan açıklanmadı.']};
 assert.equal(validateDraft(note,[document]).verification,'official_attributed');
 assert.equal(validateDraft({...note,uncertainties:['Şirketin yatırım yapıp yapmayacağı kaynaklardan doğrulanamıyor.']},[document]).verification,'needs_review');
});

test('explicitly requested distinct channel posts each produce a deliverable and each submission stays idempotent',async()=>{
 const {repairDraftStyle}=await import('../src/style'),{withOverviewEvidence}=await import('../src/market-overview'),{draftCards}=await import('../src/card-pages'),{eventIdentity,sameEvent}=await import('../src/dedupe');
 const {env,sql,objects}=await environment();
 const source=(JSON.parse(await readFile('test/fixtures/market-overview-26453.json','utf8'))).document as Document;
 const docs=withOverviewEvidence([source]),out=repairDraftStyle({...draft,template:'market',category:'bist',entities:['BIST 100'],event_key:'BIST100-kaynak-gorseli-piyasa-gorunumu',uncertainties:[]},docs);
 const legacy={...out,headline:'📊 Gün ortası — BIST 100 görünümü',body:'Endeks 11.004,37 puanda.',card_data:undefined};
 const normalize=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const oldKey=await sha256([out.category,out.entities.map(normalize).sort().join('|'),normalize(out.event_key),'2026-10-26'].join('|'));
 assert.notEqual(await eventIdentity(out,docs),oldKey);assert(!sameEvent(out,legacy));
 const corrected=structuredClone(out);corrected.card_data!.overview!.brokers[0].rows[0].net='900 milyon';assert(!sameEvent(out,corrected));assert.notEqual(await eventIdentity(out,docs),await eventIdentity(corrected,docs));
 const time=Math.floor(Date.now()/1000);
 sql.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,state,created_at,expires_at) VALUES('old',?,'old',?,'[]','single_source_attributed','pending',?,?)").run(oldKey,JSON.stringify(legacy),time,time+86400);
 sql.prepare("INSERT INTO sources(id,config)VALUES('sermaye-telegram','{}')").run();
 const cards=[];for(const svg of draftCards(out,'paper','editorial'))cards.push({svg_hash:await sha256(svg),png_base64:Buffer.from(await png(svg)).toString('base64')});
 const created:string[]=[];
 for(const id of ['close','same-close']){
  const input=JSON.stringify(docs),hash=await sha256(input);
  sql.prepare("INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen)VALUES(?,'sermaye-telegram',?,'close','',?,?)").run(id,source.url+'/'+id,source.published_at!,time);
  sql.prepare("INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,kind,state,lease_token,lease_until)VALUES(?,?,?,?,?,'news','leased','token',?)").run(id,id,input,hash,time,time+600);
  for(const [key,value]of [['card_theme:','paper'],['card_layout:','editorial']])sql.prepare('INSERT INTO system_state(key,value)VALUES(?,?)').run(key+id,value);
  const payload:Record<string,unknown>={id,lease_token:'token',input_hash:hash,draft:out,audit:{supported:true,issues:[]},runtime:{model:'gpt-6.1-terra',effort:'low',provider:'openai-codex',tool_count:0,fallback_count:0},cards};
  const r=await submitJob(env,payload);assert(!r.duplicate);created.push(r.id);const saved=JSON.parse(String(sql.prepare('SELECT content FROM drafts WHERE id=?').get(r.id)!.content));assert.equal(saved.news_source_name,'Sermaye Borsası (@SermayeBorsasi)');assert((await import('../src/editorial')).postText(saved).endsWith('\n\n-Sermaye Borsası (@SermayeBorsasi)'));
  assert.equal((await submitJob(env,payload)).id,r.id);
 }
 assert.notEqual(created[0],created[1]);assert.equal(sql.prepare('SELECT COUNT(*) n FROM drafts').get()!.n,3);assert.equal(objects.size,2);assert.equal(sql.prepare('SELECT COUNT(*) n FROM x_posts').get()!.n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM publication_log').get()!.n,0);
 assert.equal(sql.prepare("SELECT content FROM drafts WHERE id='old'").get()!.content,JSON.stringify(legacy));
});

import {loadNewsArtwork} from '../scripts/news_artwork';
import {assertNewsArtwork,newsArtworkEligible,selectNewsArtwork} from '../src/news-artwork';
import {renderModelJob} from '../scripts/owner_visual_runtime';
import {draftKeyboard} from '../src/telegram-ui';
test('news uses one reviewed PNG, persists choice across failed storage, retry and text edit; no rendering or X queue',async()=>{
 const {env,sql,objects}=await environment();env.NEWS_GENERAL_IMAGES=await loadNewsArtwork('.');
 sql.prepare('INSERT INTO sources(id,config) VALUES(?,?)').run('test','{}');
 sql.prepare('INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen) VALUES(?,?,?,?,?,?,?)').run('a','test',document.url,document.title,'',document.published_at!,Date.now()/1000);
 const input=JSON.stringify([document]),hash=await sha256(input),time=Math.floor(Date.now()/1000);
 sql.prepare("INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,state,lease_token,lease_until) VALUES('news-art','a',?,?,?,'leased','lease',?)").run(input,hash,time,time+600);
 const payload={id:'news-art',lease_token:'lease',input_hash:hash,draft,audit:{supported:true,issues:[]},runtime:{model:'gpt-6.1-terra',effort:'low',provider:'openai-codex',tool_count:0,fallback_count:0},cards:[]};
 const rendered=await renderModelJob(env,{...payload,documents:[document],deadline:time+600} as any,draft,async()=>{throw Error('must_not_render')});assert.deepEqual(rendered,{cards:[]});
 const put=env.MEDIA.put;env.MEDIA.put=async()=>{throw Error('storage_failure')};
 await assert.rejects(submitJob(env,payload),/storage_failure/);
 const reserved=JSON.parse(String(sql.prepare("SELECT value FROM system_state WHERE key='news_artwork_choice:news-art'").get()!.value));
 env.MEDIA.put=put;env.NEWS_GENERAL_IMAGES.reverse();
 const result=await submitJob(env,payload),row=sql.prepare('SELECT * FROM drafts WHERE id=?').get(result.id)!;const saved=JSON.parse(String(row.content));
 assert.deepEqual(saved.news_artwork,reserved);const image=objects.get(String(row.media_key))!;assert.deepEqual(image,env.NEWS_GENERAL_IMAGES.find(a=>a.id===reserved.id)!.bytes);assert.equal(objects.size,1);
 await assertNewsArtwork(String(row.content),[image]);await assert.rejects(assertNewsArtwork(String(row.content),[image,image]),/news_artwork_binding/);
 const changed=image.slice();changed[100]^=1;await assert.rejects(assertNewsArtwork(String(row.content),[changed]),/news_artwork_binding/);
 assert.equal((await submitJob(env,payload)).id,result.id);assert.equal(objects.size,1);
 const edited={...draft,body:draft.body+' Şirket izin sürecini sürdürüyor.'};
 sql.prepare("INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,state,lease_token,lease_until,kind,draft_id,expected_revision,edit_request) VALUES('news-edit','a',?,?,?,'leased','lease',?,'edit',?,1,'Metni düzenle')").run(input,hash,time,time+600,result.id);
 await assert.rejects(submitJob(env,{...payload,id:'news-edit',draft:{...draft,news_artwork:reserved}}),/owner_ready_model_forbidden/);
 await submitJob(env,{...payload,id:'news-edit',draft:edited});
 const after=sql.prepare('SELECT * FROM drafts WHERE id=?').get(result.id)!;assert.equal(after.revision,2);assert.deepEqual(JSON.parse(String(after.content)).news_artwork,reserved);assert.deepEqual(objects.get(String(after.media_key)),image);
 const menu=JSON.stringify(draftKeyboard(result.id,2,[document],true,saved,{},'more'));assert(!menu.includes('layouts'));assert(!menu.includes('design:'));
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM x_posts').get()!.n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM x_schedules').get()!.n,0);
});
test('general news pool excludes DKB, owner packages and data; rejects missing or altered real assets',async()=>{
 const {env}=await environment(),pool=await loadNewsArtwork('.');env.NEWS_GENERAL_IMAGES=pool;
 assert(newsArtworkEligible(draft,[document]));assert(newsArtworkEligible({...draft,template:'kap'},[{...document,source_id:'kap'}]));
 for(const d of [{...draft,tweet_style:'owner_ready' as const},{...draft,automated_daily:'circuit' as const},{...draft,template:'circuit' as const},{...draft,card_data:{report:{rows:[],footer:''}}}])assert(!newsArtworkEligible(d,[document]));
 assert(!newsArtworkEligible(draft,[{...document,market_data:{kind:'akd'}}]));assert(!newsArtworkEligible(draft,[{...document,owner_visual:{} as any}]));
 env.NEWS_GENERAL_IMAGES=pool.slice(0,3);await assert.rejects(selectNewsArtwork(env,'missing'),/unavailable/);
 env.NEWS_GENERAL_IMAGES=pool;const chosen=await selectNewsArtwork(env,'stable');assert.equal((await selectNewsArtwork(env,'stable')).sha256,chosen.sha256);
 chosen.bytes=chosen.bytes.slice();chosen.bytes[100]^=1;await assert.rejects(selectNewsArtwork(env,'stable'),/news_artwork_invalid/);
});

import {loadKapArtwork} from '../scripts/kap_artwork';
import {kapNews,withKapArtwork,assertKapArtwork} from '../src/kap-artwork';
test('official KAP news selects its fixed reviewed image ahead of general news and capitalizes codes only in KAP view',async()=>{
 const real=await loadKapArtwork('.');assert.equal(real.sha256,'8aff59b0b326a0c6d45bebba1af40354523bdb4781f9aead2b9801713662f56e');assert.equal(real.width,1672);assert.equal(real.height,941);
 const {env,sql,objects}=await environment();const fixture=new Uint8Array(await readFile('assets/visual-templates/bc-v1/01-yatay-takas.png'));const v=new DataView(fixture.buffer,fixture.byteOffset,fixture.byteLength);env.KAP_GENERAL_IMAGE={bytes:fixture,sha256:await(await import('../src/media-set')).bytesHash(fixture),width:v.getUint32(16),height:v.getUint32(20)};env.NEWS_GENERAL_IMAGES=await loadNewsArtwork('.');
 const doc={...document,source_id:'kap',official:true,url:'https://www.kap.org.tr/tr/Bildirim/12345',equity_codes:['ASELS']};assert(kapNews(draft,[doc]));assert(!newsArtworkEligible(draft,[doc]));assert(!kapNews({...draft,tweet_style:'owner_ready'},[doc]));assert(!kapNews({...draft,card_data:{report:{rows:[],footer:''}}},[doc]));assert(!kapNews(draft,[{...doc,url:'https://evil.example/tr/Bildirim/12345'}]));
 assert.deepEqual(await renderModelJob(env,{documents:[doc]}as any,draft,async()=>{throw Error('must not render KAP')}),{cards:[]});
 sql.prepare('INSERT INTO sources(id,config) VALUES(?,?)').run('kap','{}');sql.prepare('INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen) VALUES(?,?,?,?,?,?,?)').run('kap-a','kap',doc.url,doc.title,'',doc.published_at!,Date.now()/1000);const input=JSON.stringify([doc]),hash=await sha256(input),time=Math.floor(Date.now()/1000);
 sql.prepare("INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,state,lease_token,lease_until) VALUES('kap-art','kap-a',?,?,?,'leased','lease',?)").run(input,hash,time,time+600);
 const result=await submitJob(env,{id:'kap-art',lease_token:'lease',input_hash:hash,draft,audit:{supported:true,issues:[]},runtime:{model:'gpt-6.1-terra',effort:'low',provider:'openai-codex',tool_count:0,fallback_count:0},cards:[]});const row=sql.prepare('SELECT * FROM drafts WHERE id=?').get(result.id)!;const bound=JSON.parse(String(row.content));assert.equal(bound.kap_artwork.sha256,env.KAP_GENERAL_IMAGE.sha256);assert(!bound.news_artwork);assert.deepEqual(objects.get(String(row.media_key)),fixture);await assertKapArtwork(String(row.content),[fixture]);assert.equal(sql.prepare("SELECT COUNT(*) n FROM system_state WHERE key LIKE 'news_artwork_choice:%'").get()!.n,0);
 const {postText}=await import('../src/editorial');const display={...bound,headline:'asels açıklama yaptı',body:'isctr payları için bildirim yapıldı. https://example.org/isctr/#asels',hashtags:['#asels','#isctr','#Borsa'],kap_artwork:{...bound.kap_artwork,equity_codes:['ASELS','ISCTR']}};const kapText=postText(display);assert(kapText.includes('#ASELS'));assert(kapText.includes('#ISCTR'));assert(!kapText.replace('https://example.org/isctr/#asels','').includes('#asels'));assert(!kapText.includes('#isctr'));assert(kapText.includes('https://example.org/isctr/#asels'));
 const normal=postText({...draft,hashtags:['#ASELS']});assert(normal.includes('#asels'));assert(!normal.includes('#ASELS'));const ready={...display,tweet_style:'owner_ready' as const,body:'Birebir #asels'};assert.equal(postText(ready),'Birebir #asels');
 const changed=fixture.slice();changed[100]^=1;await assert.rejects(assertKapArtwork(String(row.content),[changed]),/kap_artwork_binding/);await assert.rejects(withKapArtwork({...env,KAP_GENERAL_IMAGE:undefined},draft,[doc]),/unavailable/);
});

test('new business uses its own approved watermark-free asset; ordinary KAP retains general asset',async()=>{
 const general=await loadKapArtwork('.'),business=await loadKapArtwork('.','business');assert.equal(business.sha256,'9a99447c71d988f5d02b204b03a216725dbc88607954eb1708ee3a390c575581');
 const {env}=await environment();env.KAP_GENERAL_IMAGE=general;env.KAP_BUSINESS_IMAGE=business;
 const doc={...document,source_id:'kap',official:true,url:'https://www.kap.org.tr/tr/Bildirim/12345',title:'Yeni İş İlişkisi',equity_codes:['ASELS']};
 assert.equal((await withKapArtwork(env,draft,[doc])).kap_artwork!.sha256,business.sha256);
 assert.equal((await withKapArtwork(env,draft,[{...doc,title:'Finansal Rapor'}])).kap_artwork!.sha256,general.sha256);
 assert.equal((await withKapArtwork(env,draft,[{...doc,source_id:'rss'}])).kap_artwork!.sha256,general.sha256);
 await assert.rejects(withKapArtwork({...env,KAP_BUSINESS_IMAGE:undefined},draft,[doc]),/unavailable/);
});
