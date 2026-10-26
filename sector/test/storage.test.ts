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
 const env={DB:db,MEDIA:{put:async(k:string,b:Uint8Array)=>objects.set(k,b),delete:async(k:string)=>objects.delete(k)},MODE:'dry_run',TARGET_X_USERNAME:'sectorhaber',AI_MODEL:'gpt-6-luna',AI_EFFORT:'medium',AI_DAILY_DRAFT_LIMIT:'30',ADMIN_TOKEN:'admin',BRIDGE_TOKEN:'bridge'} as unknown as Env;
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
 const payload={id:'job',lease_token:job.lease_token,input_hash:hash,draft,audit:{supported:true,issues:[]},runtime:{model:'gpt-6-luna',effort:'medium',provider:'openai-codex',tool_count:0,fallback_count:0},card_date:date,svg_hash:await sha256(svg),png_base64:Buffer.from(await png(svg)).toString('base64')};
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

test('same-day channel close submits beside legacy overview key and repeated result never publishes twice',async()=>{
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
 let first='';
 for(const id of ['close','same-close']){
  const input=JSON.stringify(docs),hash=await sha256(input);
  sql.prepare("INSERT INTO articles(id,source_id,url,title,summary,published_at,first_seen)VALUES(?,'sermaye-telegram',?,'close','',?,?)").run(id,source.url+'/'+id,source.published_at!,time);
  sql.prepare("INSERT INTO model_jobs(id,article_id,documents,input_hash,created_at,kind,state,lease_token,lease_until)VALUES(?,?,?,?,?,'news','leased','token',?)").run(id,id,input,hash,time,time+600);
  for(const [key,value]of [['card_theme:','paper'],['card_layout:','editorial']])sql.prepare('INSERT INTO system_state(key,value)VALUES(?,?)').run(key+id,value);
  const payload:Record<string,unknown>={id,lease_token:'token',input_hash:hash,draft:out,audit:{supported:true,issues:[]},runtime:{model:'gpt-6-luna',effort:'medium',provider:'openai-codex',tool_count:0,fallback_count:0},cards};
  const r=await submitJob(env,payload);if(!first){first=r.id;assert(!r.duplicate)}else{assert(r.duplicate);assert.equal(r.id,first)};
  assert.equal((await submitJob(env,payload)).id,first);
 }
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM drafts').get()!.n,2);assert.equal(objects.size,1);assert.equal(sql.prepare('SELECT COUNT(*) n FROM x_posts').get()!.n,0);assert.equal(sql.prepare('SELECT COUNT(*) n FROM publication_log').get()!.n,0);
 assert.equal(sql.prepare("SELECT content FROM drafts WHERE id='old'").get()!.content,JSON.stringify(legacy));
});
