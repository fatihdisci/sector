import {assertCardPng} from './assert-card-dimensions';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import twitter from 'twitter-text';
import {report} from '../src/kap/reports';
import {normalize,type Disclosure,type Indices} from '../src/kap/parser';
import {postText} from '../src/editorial';
import {draftCards,cardPageDrafts} from '../src/card-pages';
import {selectCircuitReport} from '../src/circuit-selection';
import {OutputCapacityError,capacityMessage} from '../src/output-capacity';
import {localDatabase} from '../src/local-adapters';
import {queueManual} from '../src/manual';
import {runManual} from '../scripts/manual_reader';
import {deliver} from '../src/pipeline';
import {requestX,publishX} from '../src/x-publish';
import {png} from '../scripts/render_local';
import type {Env} from '../src/types';
const fixture=JSON.parse(await readFile('test/fixtures/circuit-report-2026-10-23.json','utf8')) as {at:number;indices:Indices;disclosures:Disclosure[];provenance:{kind:string}};
const records=fixture.disclosures.map(disclosure=>({disclosure}));
const chosen=new Set<string>();for(const r of records){const c=r.disclosure.subjectCodes[0];if(normalize(r.disclosure.title+' '+r.disclosure.summary).includes('DEVRE KESICI')&&c&&chosen.size<59)chosen.add(c);}
const bounded=records.filter(r=>r.disclosure.subjectCodes.some(c=>chosen.has(c)));
const real=()=>report('circuit',bounded,fixture.indices,fixture.at,'');
test('historical full cache retains 475 events and fails closed above four-card capacity',()=>{
 const matching=records.filter(r=>normalize(r.disclosure.title+' '+r.disclosure.summary).includes('DEVRE KESICI'));
 assert.equal(fixture.provenance.kind,'reconstructed_public_kap_cache');assert.equal(matching.length,475);assert.equal(new Set(matching.map(r=>r.disclosure.id)).size,475);assert.equal(new Set(matching.flatMap(r=>r.disclosure.subjectCodes)).size,400);
 assert.throws(()=>report('circuit',records,fixture.indices,fixture.at,''),(e:unknown)=>{assert(e instanceof OutputCapacityError);assert.equal(e.message,'multi_card_capacity_exceeded');assert.equal(e.diagnostic.tickers,400);assert.equal(e.diagnostic.max_cards,4);return true;});
});
test('bounded historical manual command renders all 59 rows and delivers one fake two-image album exactly once',async()=>{
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));let renders=0;const files=new Map<string,Uint8Array>(),calls:string[]=[];
 const env={DB,MODE:'telegram_review',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'42',TELEGRAM_BOT_TOKEN:'123:fixture',TELEGRAM_VERIFIED_BOT_ID:'123',X_PUBLISH_ENABLED:'true',KAP_REPORT:async(kind:any,at:number,prefs:any)=>{assert.equal(kind,'circuit');assert.equal(at,fixture.at);assert.equal(prefs,undefined);return real();},RENDER_REPORT:async(svg:string)=>{renders++;return png(svg);},MEDIA:{put:async(k:string,b:Uint8Array)=>{files.set(k,b);},get:async(k:string)=>files.has(k)?{arrayBuffer:async()=>files.get(k)!.slice().buffer}:null,delete:async(k:string)=>files.delete(k)}} as unknown as Env;
 const old=globalThis.fetch;globalThis.fetch=async(url,init)=>{assert(String(url).startsWith('https://api.telegram.org/'));const method=String(url).split('/').at(-1)!;assert(['sendMessage','editMessageText','editMessageReplyMarkup','sendMediaGroup','answerCallbackQuery'].includes(method));calls.push(method);if(method==='sendMediaGroup'){const media=JSON.parse((init!.body as FormData).get('media') as string);assert.equal(media.length,2);return Response.json({ok:true,result:media.map((_:unknown,i:number)=>({message_id:100+i}))});}return Response.json({ok:true,result:{message_id:calls.length===1?99:200}});};
 try{
  await queueManual(env,1,{message_id:8,from:{id:7},chat:{id:42,type:'private'},date:fixture.at/1000,text:'/devrekesici'});await runManual(env);
  const row=await DB.prepare('SELECT content FROM drafts').first<any>(),saved=JSON.parse(row.content);assert.equal(saved.card_data.report.events.length,real().draft.card_data!.report!.events!.length);assert.equal(saved.card_data.report.circuit.all_rows.length,59);assert.equal(saved.card_data.report.rows.length,59);assert.equal(renders,2);assert.equal(files.size,2);
  await deliver(env);await runManual(env);await deliver(env);await runManual(env);assert.equal((await DB.prepare('SELECT state FROM manual_requests').first<any>()).state,'complete',JSON.stringify({calls,manual:await DB.prepare('SELECT state,error FROM manual_requests').first(),draft:await DB.prepare('SELECT state,delivery_state FROM drafts').first()}));assert.equal(calls.filter(m=>m==='sendMediaGroup').length,1);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM x_posts').first<any>()).n,0);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM drafts').first<any>()).n,1);
  const published=await DB.prepare('SELECT id,revision,message_id FROM drafts').first<any>();let uploads=0,posts=0;const transport={identity:async()=>({id:'335502216',username:'borsacakali'}),upload:async()=>String(++uploads),post:async(text:string,media:string|string[])=>{posts++;assert.equal(text,postText(saved));assert(twitter.parseTweet(text).valid);assert.deepEqual(media,['1','2']);return '123456';}};
  await publishX(env,transport);assert.equal(posts,0);await requestX(env,`xchoose:0:${published.id}:${published.revision}`,published.message_id,'cb');await publishX(env,transport);await publishX(env,transport);assert.equal(posts,1);assert.equal(uploads,2);assert.equal((await DB.prepare('SELECT state FROM x_posts').first<any>()).state,'sent');

 }finally{globalThis.fetch=old;}
});
test('two real PNGs preserve every ticker and repeat value without an omission note',async()=>{
 const d=real().draft;d.output_preferences={show_footer:false};const svgs=draftCards(d);assert.equal(svgs.length,2);const labels:string[]=[];
 for(const svg of svgs){assert.doesNotMatch(svg,/gösterilmedi/);assert.doesNotMatch(svg,/BIST 50|itibarıyla|\d{2}:\d{2}/);for(const row of svg.matchAll(/data-report-row="\d+"><text[^>]*>(#[A-Z0-9]+)<\/text>/g))labels.push(row[1]);for(const m of svg.matchAll(/<text[^>]*y="(\d+)"/g))assert(Number(m[1])<Number(svg.match(/height="(\d+)"/)![1]));const image=await png(svg);assertCardPng(image,svg);assert(image.length<5_000_000);}
 assert.deepEqual(labels,d.card_data!.report!.rows.map(r=>r.label));assert.equal(new Set(labels).size,59);
});
test('ranking is 30 then 100 then others, repeats descending, ASCII ticker ties; BIST50 never adds a tier',()=>{
 const i={...fixture.indices,bist30:['AAAA',...Array.from({length:29},(_,n)=>'F'+String(n).padStart(4,'0'))],bist100:['AAAA','BBBB','CCCC',...Array.from({length:29},(_,n)=>'F'+String(n).padStart(4,'0')),...Array.from({length:68},(_,n)=>'G'+String(n).padStart(4,'0'))]};
 const codes=['AAAA','BBBB','CCCC','BBBB','CCCC',...Array(10).fill('ZZZZ')];const events=codes.map((c,n)=>({id:n,tickers:[c,c],published_at:'2026-10-23T10:00:00Z'}));const result=selectCircuitReport(events,i,fixture.at);assert.deepEqual(result.rows.map(r=>r.label),['#AAAA','#BBBB','#CCCC','#ZZZZ']);assert.match(result.rows[0].value,/^1 bildirim/);assert.match(result.rows[1].value,/^2 bildirim · BIST 100$/);assert.match(result.rows[3].value,/^10 bildirim$/);assert.deepEqual(selectCircuitReport([...events].reverse(),{...i,bist50:['CCCC']} as any,fixture.at).rows,result.rows);
});
test('missing, stale, future, malformed or untrusted membership blocks nonempty selection; empty and small data do not invent members',()=>{
 for(const i of [null,{...fixture.indices,checkedAt:new Date(fixture.at-37*3600_000).toISOString()},{...fixture.indices,checkedAt:new Date(fixture.at+600_000).toISOString()},{...fixture.indices,bist30:[]},{...fixture.indices,source:'https://example.test/indices'}])assert.throws(()=>report('circuit',records,i,fixture.at,''),/circuit_report_indices_unavailable/);
 const empty=report('circuit',[],null,fixture.at,'');assert.equal(empty.draft.card_data!.report!.rows.length,0);assert.match(postText(empty.draft),/bildirimi yok/);assert.equal(draftCards(empty.draft).length,1);
 const one=report('circuit',records.filter(r=>r.disclosure.subjectCodes.includes('EREGL')),fixture.indices,fixture.at,'');assert.equal(one.draft.card_data!.report!.rows.length,1);assert.match(postText(one.draft),/#eregl/);assert.equal(one.draft.card_data!.report!.circuit!.omitted,0);assert.deepEqual(real().draft.card_data!.report!.rows,report('circuit',bounded,fixture.indices,fixture.at,'',{list:'all'}).draft.card_data!.report!.rows);
 const first=report('circuit',bounded,fixture.indices,fixture.at,'',{list:'first',count:3});assert.throws(()=>draftCards(first.draft),/circuit_report_subset_requires_recalculation/);
});
test('more than four cards yields an explicit capacity diagnostic without truncation',()=>{
 const base=fixture.disclosures.find(d=>d.title==='Pay Bazında Devre Kesici Bildirimi')!;const many=Array.from({length:121},(_,n)=>({disclosure:{...base,id:2000000+n,oid:null,relatedOid:null,subjectCodes:['A'+String(n).padStart(4,'0')]}}));
 assert.throws(()=>report('circuit',many,fixture.indices,fixture.at,''),(e:unknown)=>{assert(e instanceof OutputCapacityError);assert.equal(e.message,'multi_card_capacity_exceeded');assert.equal(e.diagnostic.tickers,121);assert.equal(e.diagnostic.required_cards,5);assert.match(capacityMessage(e.message,e.diagnostic)!,/Hiçbir satır çıkarılmadı/);return true;});
});

test('missing membership becomes an explicit permanent manual review reason without source guessing or model/network calls',async()=>{
 const DB=await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'));const env={DB,MODE:'dry_run',KAP_REPORT:async()=>report('circuit',records,null,fixture.at,'')} as unknown as Env;
 await DB.prepare("INSERT INTO manual_requests(update_id,message_id,kind,input,created_at) VALUES(1,8,'kap_report',?,1)").bind(JSON.stringify({report:'circuit',at:fixture.at})).run();await runManual(env);const row=await DB.prepare('SELECT state,error,attempts FROM manual_requests').first<any>();assert.equal(row.state,'needs_review');assert.equal(row.error,'circuit_report_indices_unavailable');assert.equal(row.attempts,1);assert.equal((await DB.prepare('SELECT count(*) n FROM drafts').first<any>()).n,0);
});
