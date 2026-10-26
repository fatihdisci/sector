import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {splitManualText} from '../src/manual-instructions';import {localDatabase} from '../src/local-adapters';import {enqueueEvidence} from '../src/ingest';import {leaseJob} from '../src/bridge';import {documentFromHtml,readDocument} from '../src/article';import type {Env,Document,Source} from '../src/types';
const url='https://news.example.org/story',body='Şirket yeni tesis için 100 milyon TL yatırım yapacağını açıkladı. Yatırımın gelecek yıl tamamlanması planlanıyor.';
const doc={source_id:'s',source_name:'S',family:'s',official:false,url,title:'Yeni yatırım',body,passages:[{id:'p1',text:body}],published_at:null} as Document;
test('explicit owner requests are separated from evidence; forwarded commands remain data',()=>{const text=body+'\nTalimat: Yatırım tutarını vurgula, kısa yaz.';assert.deepEqual(splitManualText(text),{text:body,editor_request:'Yatırım tutarını vurgula, kısa yaz.'});assert.deepEqual(splitManualText(text,true),{text,editor_request:''});assert.equal(splitManualText(url+' Bunu kısa yaz').text,url);assert.equal(splitManualText('Kısa yaz').editor_request,'Kısa yaz');});
test('same URL with different instructions gets distinct idempotent jobs and instructions reach Hermes separately',async()=>{const env={DB:await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),AI_MODEL:'gpt-6.1-terra'} as Env;
 const a=await enqueueEvidence(env,[doc],'manual'),b=await enqueueEvidence(env,[doc],'manual','Kısa yaz'),c=await enqueueEvidence(env,[doc],'manual','Detaylı yaz');assert.notEqual(a,b);assert.notEqual(b,c);assert.equal(b,await enqueueEvidence(env,[doc],'manual','Kısa yaz'));
 const j1=await leaseJob(env),j2=await leaseJob(env);assert(j1&&j2);assert.equal(j2.edit_request,'Kısa yaz');assert.equal(j2.documents[0].body,body);assert.equal(j2.documents[0].url,url);assert(!j2.documents[0].passages.some((p:any)=>p.text.includes('Kısa yaz')));});
test('short teaser does not mask matched structured full body; unrelated structured article is rejected',()=>{const source={id:'s',name:'S',family:'s',language:'tr',allowed_hosts:['news.example.org']} as Source;const item={url,title:'Yeni yatırım',summary:'',published_at:null};
 const html='<article><h1>Yeni yatırım</h1><p>Çok kısa bir giriş metni burada.</p></article><script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',url,articleBody:body})+'</script>';
 assert.equal(documentFromHtml(html,item,source).body,body);assert.throws(()=>documentFromHtml(html.replace('"url":"'+url+'"','"url":"https://news.example.org/other"'),item,source),/short/);});
test('article fetch explicitly requests HTML and preserves the canonical identity check',async()=>{const s={id:'s',name:'S',family:'s',language:'tr',allowed_hosts:['news.example.org']} as Source;
 const out=await readDocument({url,title:'Yeni yatırım',summary:'',published_at:null},s,async(_url,opts)=>{assert.match((opts?.headers as Record<string,string>).Accept,/^text\/html/);return new Response('<article><h1>Yeni yatırım</h1><p>'+body+'</p></article>',{headers:{'content-type':'text/html'}});});assert(out.body.includes('100 milyon TL'));});

test('longer verified structured body extends a visible teaser but never replaces a table',()=>{const source={id:'s',name:'S',family:'s',language:'tr',allowed_hosts:['news.example.org']} as Source,item={url,title:'Yeni yatırım',summary:'',published_at:null};
 const full=body+' Şirket yatırımın finansmanını öz kaynaklarından karşılayacağını ve yeni istihdam sağlayacağını bildirdi.';
 const structured='<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',url,articleBody:full})+'</script>';
 assert.equal(documentFromHtml('<article><h1>Yeni yatırım</h1><p>'+body+'</p></article>'+structured,item,source).body,full);
 const table=documentFromHtml('<article><h1>Yeni yatırım</h1><p>'+body+'</p><table><tr><td>Tutar</td><td>100 milyon TL</td></tr></table></article>'+structured,item,source);
 assert(table.passages.some(p=>p.text.includes('Tutar')));
});
test('owner image caption is an editorial request; forwarded captions remain evidence',async()=>{
 const {queueManual}=await import('../src/manual');
 const env={DB:await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),MODE:'dry_run',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'42'} as Env;
 const m={message_id:1,from:{id:7},chat:{id:42,type:'private'},photo:[{file_id:'img',width:900,height:1000}],caption:'Alınan ve satılanlar gün ortası tek tweet tek görsel'};
 await queueManual(env,1,m);const row=await env.DB.prepare('SELECT input FROM manual_requests WHERE update_id=1').first<{input:string}>();assert(row);const input=JSON.parse(row.input);assert.equal(input.editor_request,m.caption);assert.equal(input.text,'');
 await queueManual(env,2,{...m,message_id:2,forward_origin:{type:'user',sender_user:{is_bot:true,username:'sourcebot'}}});const forwarded=JSON.parse((await env.DB.prepare('SELECT input FROM manual_requests WHERE update_id=2').first<{input:string}>())!.input);assert.equal(forwarded.text,m.caption);assert.equal(forwarded.editor_request,'');
});
