import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {botQuery} from '../src/bot-query';
import {queueManual} from '../src/manual';
import {localDatabase} from '../src/local-adapters';
import {botDocuments,type BotReply} from '../scripts/bot_query_reader';
import type {Env} from '../src/types';
test('named institutions route to BoPT; bare summary, AKD and custody route to derinlik',()=>{
 for(const broker of ['bank of america','ak yatırım','İş','QNB Finans'])assert.deepEqual(botQuery('/kurum '+broker),{bot:'b0pt_bot',command:'/kurum '+broker,kind:'institutional',broker});
 assert.equal(botQuery('/kurum')!.bot,'ucretsizderinlikbot');assert.equal(botQuery('/kurum')!.kind,'broker_flow');
 assert.deepEqual(botQuery('/akd ktlev.e'),{bot:'ucretsizderinlikbot',command:'/akd KTLEV',kind:'akd',ticker:'KTLEV'});
 assert.equal(botQuery('/takas thyao')!.kind,'custody');
 for(const command of ['/akd','/takas ABC','/kurum abc/def'])assert.throws(()=>botQuery(command),/invalid/);
 assert.equal(botQuery('/kurum bank\n/akd ASELS'),null);assert.equal(botQuery('haber /kurum'),null);
});
test('only owner commands queue once, with stable query key and original time; forwarded commands cannot trigger sends',async()=>{
 const env={DB:await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),MODE:'dry_run',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'42'} as Env;
 const m={message_id:100,date:1792659600,text:'/kurum ak yatırım',from:{id:7},chat:{id:42,type:'private'}};
 assert.equal(await queueManual(env,101,{...m,from:{id:8}}),false);
 assert.equal(await queueManual(env,101,{...m,forward_origin:{type:'user',sender_user:{is_bot:true,username:'b0pt_bot'}}}),false);
 assert.equal(await queueManual(env,101,m),true);assert.equal(await queueManual(env,101,m),true);
 const rows=await env.DB.prepare('SELECT kind,input FROM manual_requests').all<{kind:string;input:string}>();assert.equal(rows.results.length,1);assert.equal(rows.results[0].kind,'bot_query');assert.deepEqual(JSON.parse(rows.results[0].input),{text:m.text,query_key:'101',submitted_at:m.date});
});
const text=await readFile('test/fixtures/bopt.txt','utf8');
const reply=(text:string,images:string[]=[])=>(async(q:{bot:string;command:string}):Promise<BotReply>=>({bot:q.bot,command:q.command,text,images,message_ids:[2]}));
test('institutional replies retain all 20 source rows and reject a different institution',async()=>{
 const docs=await botDocuments('/kurum bank of america','1',undefined,reply(text));assert.equal(docs[0].market_data?.rows?.length,20);assert.equal(docs[0].url,'https://t.me/b0pt_bot#endeks-query-1');
 const next=await botDocuments('/kurum bank of america','9',undefined,reply(text));assert.notEqual(next[0].url,docs[0].url);
 await assert.rejects(()=>botDocuments('/kurum QNB','2',undefined,reply(text)),/broker_mismatch/);
 await assert.rejects(()=>botDocuments('/takas THYAO','3',undefined,reply(text)),/reply_invalid/);
 await assert.rejects(()=>botDocuments('/kurum','4',undefined,reply('Üye olmanız gerekiyor')),/reply_invalid/);
});
test('image-only AKD uses the existing extraction and rejects a different ticker',async()=>{
 const extract=async()=>({body:'KTLEV aracı kurum dağılımı',passages:[{id:'image_table',text:'Ünlü: 100 lot'}],images:['/tmp/image'],market_data:{kind:'akd' as const,ticker:'KTLEV'},coverage:{complete:true,page_count:1,pages:[]}});
 const docs=await botDocuments('/akd ktlev','5',undefined,reply('', ['responses/fixture.image']),extract,async()=>new Uint8Array([1]));assert.equal(docs[0].market_data?.ticker,'KTLEV');
 await assert.rejects(()=>botDocuments('/akd ASELS','6',undefined,reply('', ['responses/fixture.image']),extract,async()=>new Uint8Array([1])),/ticker_mismatch/);
});
test('complete institutional text does not fail or spend vision work on a redundant image',async()=>{
 let reads=0;const extract=async():Promise<never>=>{reads++;throw Error('image_market_number_ambiguous');};
 const docs=await botDocuments('/kurum bank of america','101',undefined,reply(text,['responses/redundant.image']),extract,async()=>new Uint8Array([1]));
 assert.equal(reads,0);assert.equal(docs.length,1);assert.equal(docs[0].market_data?.rows?.length,20);
 await assert.rejects(()=>botDocuments('/kurum QNB','102',undefined,reply(text,['responses/redundant.image']),extract,async()=>new Uint8Array([1])),/broker_mismatch/);
});
test('truncated institutional text is rejected without falling back to images',async()=>{
 const partial=text.replace(/^10\..*$/gm,'');let reads=0;
 await assert.rejects(()=>botDocuments('/kurum bank of america','103',undefined,reply(partial,['responses/table.image']),async()=>{reads++;throw Error('image_market_number_ambiguous');},async()=>new Uint8Array([1])),/bot_query_text_incomplete/);
 assert.equal(reads,0);
});

test('image-only named institution replies never invoke OCR',async()=>{
 let reads=0;await assert.rejects(()=>botDocuments('/kurum bank of america','104',undefined,reply('', ['responses/table.image']),async()=>{reads++;throw Error('unexpected_ocr');},async()=>new Uint8Array([1])),/bot_query_text_incomplete/);assert.equal(reads,0);
});

test('incomplete movers text has its own failure code and does not inspect images',async()=>{
 let reads=0;await assert.rejects(()=>botDocuments('/piyasayd','105',undefined,reply('En Çok Yükselenler\nEn Çok Düşenler',['responses/table.image']),async()=>{reads++;throw Error('unexpected_ocr');},async()=>new Uint8Array([1])),/bot_query_text_incomplete_movers/);assert.equal(reads,0);
});
