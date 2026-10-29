import {assertCardPng} from './assert-card-dimensions';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseFeed,sourceDate} from '../src/feed';
import {safeUrl,readPublic} from '../src/network';
import {documentFromHtml} from '../src/article';
import {validateDraft,topicScore,exportPrompt,numericTokens} from '../src/editorial';
import {acceptHermes} from '../src/ai';
import {sameEvent,evidenceFamily} from '../src/dedupe';
import {cardSvg,draftCard} from '../src/card';
import {png} from '../scripts/render_local';
import {pngBytes} from '../src/bridge';
import {transition,callback,parseCallback,publicationGate} from '../src/approval';
import {isOwner,sendDraft} from '../src/telegram';
import {secretEqual} from '../src/worker';
import {parseSpk} from '../src/official';
import type {Source,Document,Draft,Env} from '../src/types';
export const source:Source={id:'sample',name:'Test Kaynağı',url:'https://news.example.org/rss',family:'publisher',language:'tr',official:true,allowed_hosts:['news.example.org'],poll_seconds:120,fresh_hours:72,enabled:true,checked_at:'2026-10-21',terms_url:'https://news.example.org/terms',rights_note:'Fixture only',review_mode:'official_facts'};
export const document:Document={source_id:'sample',source_name:'Test Kaynağı',family:'publisher',official:true,url:'https://news.example.org/a',title:'Örnek Holding yatırım planını açıkladı',body:'Örnek Holding, yeni üretim tesisi için 50 milyon TL yatırım planladığını açıkladı. Proje için izin süreci devam ediyor.',published_at:'2026-10-21T09:00:00Z',passages:[{id:'p1',text:'Örnek Holding, yeni üretim tesisi için 50 milyon TL yatırım planladığını açıkladı.'},{id:'p2',text:'Proje için izin süreci devam ediyor.'}]};
export const draft:Draft={headline:'Örnek Holding yeni üretim tesisi planlıyor',body:'Örnek Holding üretim kapasitesini artırmak amacıyla tesis yatırımı hazırlıyor. İzin başvuruları sonuçlanmış değil.',card_headline:'Örnek Holding üretim tesisi planlıyor',card_body:'Yeni tesis için izin süreci sürüyor.',hashtags:['#Yatırım','#Sanayi'],category:'companies',importance:75,template:'company',claims:[{text:'Örnek Holding yeni üretim tesisi planlıyor.',evidence:[{document:0,passage:'p1',quote:document.passages[0].text}]}],entities:['Örnek Holding'],event_key:'ornek holding yeni tesis 2026',uncertainties:[]};
test('SPK dates stay bound to their own bulletin, never adjacent cards',()=>{
 const html='<a href="/data/abc/2026-72.pdf">Bülten No: 2026/72 Yayımlanma : 21 Ekim 2026 Çarşamba</a><a href="/data/def/2026-71.pdf">Bülten No: 2026/71 Yayımlanma : 19 Ekim 2026 Pazartesi</a>';
 const result=parseSpk(html,'https://spk.gov.tr');assert.equal(result.length,2);assert.equal(result[1].published_at,'2026-10-18T21:00:00.000Z');
});
test('RSS and Atom parse text, date and canonical URL',()=>{
 const xml='<rss><channel><item><title>A &amp; B</title><link>https://news.example.org/a?utm_source=x</link><pubDate>Wed, 21 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>İçerik</p>]]></description></item></channel></rss>';
 assert.deepEqual(parseFeed(xml,source)[0],{title:'A & B',url:'https://news.example.org/a',published_at:'2026-10-21T10:00:00.000Z',summary:'İçerik'});
 const atom='<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Veri</title><link rel="enclosure" href="https://news.example.org/image.jpg"/><link rel="alternate" href="http://news.example.org/a"/><updated>21 Eki 2026 10:00:02</updated></entry></feed>';
 assert.equal(parseFeed(atom,source)[0].url,'https://news.example.org/a');assert.equal(sourceDate('21 Eki 2026 10:00:02'),'2026-10-21T07:00:02.000Z');
});
test('DTD, broken XML and unregistered destinations are rejected',()=>{
 assert.throws(()=>parseFeed('<!DOCTYPE rss><rss/>',source),/unsafe_xml/);assert.throws(()=>parseFeed('<rss><item></rss>',source));
 for(const url of ['http://news.example.org/a','https://127.0.0.1/a','https://news.example.org:8443/a','https://news.example.org.evil.test/a','https://user@news.example.org/a'])assert.throws(()=>safeUrl(url,source.allowed_hosts));
});
test('cross-host redirect stops before a second network request',async()=>{
 let count=0;const f=(async()=>{count++;return new Response(null,{status:302,headers:{location:'https://attacker.example.org/'}});}) as typeof fetch;
 await assert.rejects(()=>readPublic('https://news.example.org/a',source.allowed_hosts,{},f),/unregistered_url/);assert.equal(count,1);
});
test('article extraction removes noise and preserves the actual source',()=>{
 const html='<link rel="canonical" href="https://news.example.org/a"><h1>Örnek Holding</h1><article><p>'+document.body+'</p><aside>Başka şirket 99 milyar dolar kazandı.</aside></article>';
 const doc=documentFromHtml(html,{url:document.url,title:document.title,summary:'RSS snippet',published_at:null},source);
 assert(!doc.body.includes('99 milyar'));assert(doc.body.includes('50 milyon TL'));assert(!doc.body.includes('RSS snippet'));
 assert.throws(()=>documentFromHtml(html,{url:'https://news.example.org/b',title:'B',summary:'',published_at:null},source),/identity/);
 assert.throws(()=>documentFromHtml('<article><h1>Yalnız başlık</h1></article>',{url:document.url,title:'Yalnız başlık',summary:'',published_at:null},source));
});
test('draft and GPT export use identical full evidence',()=>{
 assert(exportPrompt([document]).includes(document.body));assert.equal(validateDraft(draft,[document]).verification,'official_attributed');
});
test('numbers, units, entities and fabricated evidence fail closed',()=>{
 assert.throws(()=>validateDraft({...draft,body:'Örnek Holding 50 milyon USD yatırım yaptı.'},[document]),/unsupported_number/);
 assert.throws(()=>validateDraft({...draft,entities:['Başka Holding']},[document]),/unsupported_entity/);
 assert.throws(()=>validateDraft({...draft,claims:[{text:'Yatırım planı',evidence:[{document:0,passage:'p1',quote:'Kaynakta olmayan uydurulmuş bir alıntı metni'}]}]},[document]),/invented_evidence/);
 assert.throws(()=>validateDraft({...draft,hashtags:['#haber','#gündem']},[document]),/hashtags/);
});
test('semantic audit rejects conditional and subject errors',()=>{
 assert.throws(()=>acceptHermes(draft,{supported:false,issues:['plan gerçekleşmiş gibi yazılmış']},[document]),/semantic_review/);
 assert.throws(()=>acceptHermes({...draft,body:draft.headline},{supported:true,issues:[]},[document]),/repeated_headline/);
 assert.equal(acceptHermes(draft,{supported:true,issues:[]},[document]).draft.headline,'📢 '+draft.headline);
 assert.deepEqual(acceptHermes({...draft,hashtags:['#Yeni Yatırım','#İş-Dünyası']},{supported:true,issues:[]},[document]).draft.hashtags,['#YeniYatırım','#İşDünyası']);
});
test('syndicated wire copies are one family; unrelated entities never merge',()=>{
 assert.equal(evidenceFamily({...document,body:'(Reuters) '+document.body}),'wire-reuters');
 assert(sameEvent(draft,{...draft,headline:'Örnek Holding yeni tesis yatırımına hazırlanıyor'}));
 assert(!sameEvent(draft,{...draft,entities:['Farklı Şirket']}));
});
test('ENDEKS topics include global tech, domestic funds and central banks',()=>{
 for(const title of ['Nvidia yapay zeka yatırımı açıkladı','Fed faiz kararını açıkladı','Fon krizi ve takas kesinliği PBLK kararı'])assert(topicScore(title).score>=60);
 assert.equal(topicScore('Anlık hisse verisi AKD kurum dağılımı').score,0);
});
test('all five brand cards render actual 1080×1350 PNG with licensed fonts',async()=>{
 for(const template of ['breaking','economic_data','company','global','info'] as const){const svg=cardSvg({...draft,template},['Kaynak'],'21.10.2026',true);assert(svg.includes('#080908'));assert(!/linearGradient|radialGradient|filter=/.test(svg));const image=await png(svg);const view=new DataView(image.buffer,image.byteOffset,image.byteLength);const dimensions=assertCardPng(image,svg);assert.equal(pngBytes(Buffer.from(image).toString('base64'),dimensions.width,dimensions.height).length,image.length);}
 assert.throws(()=>cardSvg({...draft,body:'Çok uzun '.repeat(800)},['Kaynak'],'21.10.2026'),/overflow/);
});
test('card content and dimensions are mandatory',()=>{
 assert.throws(()=>pngBytes('bm90IGEgcG5n'),/invalid_png/);
 assert.throws(()=>draftCard({...draft,card_headline:'W'.repeat(500)},['Kaynak'],'21.10.2026'),/overflow/);
});
test('approval callbacks preserve revision and reject repeats, stale and expired cards',()=>{
 const id='00000000-0000-4000-8000-000000000000';assert.deepEqual(parseCallback(callback('approve',id,1)),{action:'approve',id,revision:1});
 assert.equal(transition('pending','approve','official_attributed'),'approved');assert.equal(transition('pending','defer','single_source_attributed'),'deferred');
 assert.throws(()=>transition('approved','approve','official_attributed'));assert.throws(()=>transition('pending','approve','needs_review'));assert.throws(()=>transition('pending','approve','official_attributed',true));
});
test('owner/chat and X publication isolation fail closed',async()=>{
 const env={TELEGRAM_USER_ID:'123',TELEGRAM_CHAT_ID:'123'} as Env;assert(isOwner(env,'123','123','private'));assert(!isOwner(env,'456','123','private'));assert(!isOwner(env,'123','123','group'));
 assert.equal(publicationGate('sectorhaber').allowed,false);assert.equal(publicationGate('heranborsa').allowed,false);assert.equal(publicationGate().reason,'x_publishing_permanently_disabled');
 assert(await secretEqual('a','a'));assert(!await secretEqual('a','b'));assert(!await secretEqual('',''));
});
test('Telegram dry run sends nothing',async()=>{
 await assert.rejects(()=>sendDraft({MODE:'dry_run'} as Env,'id',1,draft,[document],new Uint8Array(),'official_attributed'),/dry_run/);
});
