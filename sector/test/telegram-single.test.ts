import test from 'node:test';
import assert from 'node:assert/strict';
import {sendDraft,sourceKeyboard} from '../src/telegram';
import {cardSvg} from '../src/card';
import type {Env,Draft,Document} from '../src/types';
const env={MODE:'telegram_review',TELEGRAM_BOT_TOKEN:'123:test-fixture',TELEGRAM_VERIFIED_BOT_ID:'123',TELEGRAM_CHAT_ID:'456'} as Env;
const draft={headline:'📢 Örnek Holding yatırım planını açıkladı',body:'Yeni tesisin izin süreci devam ediyor.',hashtags:['#Yatırım','#Sanayi']} as Draft;
const docs=[{url:'https://example.com/article',source_name:'Örnek'}] as Document[];
test('exactly one API operation uploads the photo, complete caption and source button',async()=>{
 const calls:{url:string;form:FormData}[]=[];
 const f=(async(url,init)=>{calls.push({url:String(url),form:init!.body as FormData});return Response.json({ok:true,result:{message_id:10}});}) as typeof fetch;
 const id=await sendDraft(env,'00000000-0000-4000-8000-000000000000',1,draft,docs,new Uint8Array([1,2]),'official_attributed',undefined,f);
 assert.equal(id,10);assert.equal(calls.length,1);assert(calls[0].url.endsWith('/sendPhoto'));assert(calls[0].form.get('photo') instanceof Blob);
 const caption=String(calls[0].form.get('caption'));assert(caption.includes(draft.body));assert(!/DENEME|X kapalı|Önem:|Kaynak:/.test(caption));
 assert.deepEqual(JSON.parse(String(calls[0].form.get('reply_markup'))).inline_keyboard.flat().map((b:any)=>b.text),['Düzenle','Diğer']);
});
test('overlong caption or unsafe source fails before any photo or message can be sent',async()=>{
 let count=0;const f=(async()=>{count++;throw Error('unexpected network');}) as typeof fetch;
 await assert.rejects(()=>sendDraft(env,'id',1,{...draft,body:'A'.repeat(1025)},docs,new Uint8Array(),'official',undefined,f),/caption_too_long/);
 await assert.rejects(()=>sendDraft(env,'id',1,draft,[{...docs[0],url:'javascript:alert(1)'}],new Uint8Array(),'official',undefined,f),/source_url/);assert.equal(count,0);
});
test('revision replaces the same photo message without sending another post',async()=>{
 let method='',body:FormData|undefined;
 const f=(async(url,init)=>{method=String(url);body=init!.body as FormData;return Response.json({ok:true,result:{message_id:10}});}) as typeof fetch;
 assert.equal(await sendDraft(env,'00000000-0000-4000-8000-000000000000',2,draft,docs,new Uint8Array(),'official',10,f),10);
 assert(method.endsWith('/editMessageMedia'));assert.equal(body!.get('message_id'),'10');assert.equal(JSON.parse(String(body!.get('media'))).caption.split('\n\n')[1],draft.body);
});
test('photo caption keeps one canonical hashtag line without a text-copy button',async()=>{
 let form:FormData|undefined;
 const f=(async(_url,init)=>{form=init!.body as FormData;return Response.json({ok:true,result:{message_id:10}});}) as typeof fetch;
 const value={...draft,body:draft.body+'\n\n#Yatırım #Sanayi',hashtags:['#Yatırım','#yatırım','#Sanayi']};
 await sendDraft(env,'00000000-0000-4000-8000-000000000000',1,value,docs,new Uint8Array([1,2]),'official',undefined,f);
 const caption=String(form!.get('caption')),keys=JSON.parse(String(form!.get('reply_markup'))).inline_keyboard.flat();
 assert.equal((caption.match(/#Yatırım/gi)??[]).length,1);
 assert.equal(caption.split('\n\n').at(-1),'#Yatırım #Sanayi');
 assert(!keys.some((k:{text:string;copy_text?:unknown;callback_data?:string})=>k.copy_text||k.text==='📋'||k.callback_data?.startsWith('asset:text:')));
});
test('artwork contains no demo stamp, date, source list, handle, or extra category captions',()=>{
 const svg=cardSvg({headline:'Örnek Holding yeni tesis planlıyor',body:'İzin süreci devam ediyor.',template:'company'},['Gizli kaynak listesi'],'21.10.2026',true);
 assert(!/DENEME|KAYNAK|Gizli kaynak|21.10.2026|@borsacakali|ŞİRKET HABERLERİ/.test(svg));assert(svg.includes('borsacakali'));
 assert.equal(sourceKeyboard([...docs,{...docs[0],url:'https://example.com/secondary'}]).length,1);
});
