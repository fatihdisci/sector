import {assertCardPng} from './assert-card-dimensions';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {localDatabase} from '../src/local-adapters';
import {queueManual} from '../src/manual';
import {manualDocuments} from '../scripts/manual_reader';
import {marketInput,withMarketText} from '../src/market-input';
import {editorialPolicy,repairDraftStyle,styleIssues} from '../src/style';
import {numericIssues,validateDraft} from '../src/editorial';
import {cardSvg} from '../src/card';
import {CARD_LAYOUTS} from '../src/card-layout';
import {png} from '../scripts/render_local';
import {cardDataFields} from '../src/card-data';
import type {Document,Draft,Env} from '../src/types';
const broker='Borsa İstanbul Aracı Kurum Verileri 20 Ekim 2026 20:00:32\nAracı Kurum İşlem Özeti\nEn Çok Net Alış Yapanlar\n1. Ak → +1,40 Mr ₺\n2. Gedik → +559,09 Mn ₺\nEn Çok Net Satış Yapanlar\n1. İş → -1,53 Mr ₺\n2. Ziraat → -567,97 Mn ₺\nhttps://t.me/ucretsizderinlikbot';
const custody='📊 THYAO Takas\nSon Takas: 2026-10-21\nToplam Takas Lotu: 738,85 Milyon Lot\nBireysel: %51,66\nKurumsal: %48,34\nYatırımcı Sayısı: 799.104\nSaklama Kuruluşları:\n1. Citi 108,10 Milyon %14,62\n2. İş 105,48 Milyon %14,27\n3. Yat. Fon. 55,63 Milyon %7,53';
const doc=(text:string):Document=>({source_id:'manual-input',source_name:'İlettiğin metin',family:'owner-submitted',official:false,url:'https://example.test/source',title:text.split('\n')[0],body:text,passages:[{id:'provided_text',text}],published_at:null,language:'tr'});
async function env(){return {DB:await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),MODE:'dry_run',TELEGRAM_USER_ID:'7',TELEGRAM_CHAT_ID:'42',TELEGRAM_BOT_TOKEN:'123:test',TELEGRAM_VERIFIED_BOT_ID:'123'} as Env;}
test('forwarded market texts retain period, exact scale and signed sale equivalences; custody is not a fund crisis',()=>{
 const d=withMarketText(doc(broker));assert.equal(d.market_data?.kind,'broker_flow');assert.match(d.body,/1,40 milyar TL/);assert.match(d.body,/559,09 milyon TL/);assert.match(d.body,/İş: net satım miktarı 1,53 milyar TL/);assert.match(d.body,/20 Ekim 2026 20:00:32/);assert.deepEqual(d.passages[0],doc(broker).passages[0]);
 assert.deepEqual(withMarketText(d),d);
 const c=withMarketText(doc(custody));assert.equal(c.market_data?.kind,'custody');assert.deepEqual(c.equity_codes,['THYAO']);assert.deepEqual(editorialPolicy([c]).required_hashtags,['#Borsa','#BIST','#THYAO']);
 assert.equal(marketInput('Kurumlar fon krizi hakkında konuştu.'),undefined);
});
test('owner forwards one full-resolution photo or image document; a watermark link cannot turn it into a URL request',async()=>{
 const e=await env(),base={message_id:1,from:{id:7},chat:{id:42,type:'private'}};
 const m={...base,caption:'https://t.me/ucretsizderinlikbot',photo:[{file_id:'small',width:200,height:300},{file_id:'large',width:900,height:1080}],forward_origin:{type:'user',sender_user:{is_bot:true,username:'ucretsizderinlikbot'}}};
 assert.equal(await queueManual(e,1,{...m,from:{id:8}}),false);assert.equal(await queueManual(e,1,{...m,chat:{id:42,type:'group'}}),false);
 assert.equal(await queueManual(e,1,m),true);assert.equal(await queueManual(e,1,m),true);
 const row=await e.DB.prepare('SELECT kind,input FROM manual_requests').first<{kind:string;input:string}>();assert.equal(row?.kind,'image');assert.equal(JSON.parse(row!.input).image.file_id,'large');assert.equal(JSON.parse(row!.input).origin_bot,'ucretsizderinlikbot');
 await queueManual(e,2,{...base,message_id:2,document:{file_id:'as-file',file_name:'akd.png',mime_type:'image/png'}});
 await queueManual(e,3,{...base,message_id:3,text:broker});
 assert.equal((await e.DB.prepare('SELECT kind FROM manual_requests WHERE update_id=2').first<{kind:string}>())!.kind,'image');assert.equal((await e.DB.prepare('SELECT kind FROM manual_requests WHERE update_id=3').first<{kind:string}>())!.kind,'text');
 assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM manual_requests').first<{n:number}>())!.n,3);
});
test('image intake downloads a bounded Telegram file once, preserves source image evidence and invents no date or official status',async()=>{
 const e=await env(),original=globalThis.fetch,bytes=new Uint8Array([137,80,78,71,13,10,26,10]);let reads=0;
 globalThis.fetch=async(input)=>String(input).endsWith('/getFile')?Response.json({ok:true,result:{file_path:'photos/file.jpg'}}):new Response(bytes);
 try{
  const documents=await manualDocuments(e,'image',JSON.stringify({text:'',image:{file_id:'large'},origin_bot:'ucretsizderinlikbot'}),55,async data=>{reads++;assert.deepEqual(data,bytes);return {body:'Hisse kodu: ASELS. Ak net 766.204 lot alım yaptı. Tarih belirtilmemiş.',passages:[{id:'image_table1row1',text:'Ak net 766.204 lot alım yaptı.'}],images:['/tmp/source.png'],market_data:{kind:'akd',ticker:'ASELS'},coverage:{complete:true,page_count:1,pages:[{page:1,mode:'image_ocr_visual',tables:2,characters:100}]}};});
  assert.equal(reads,1);assert.equal(documents[0].published_at,null);assert.equal(documents[0].official,false);assert.equal(documents[0].market_data?.kind,'akd');assert.deepEqual(documents[0].images,['/tmp/source.png']);assert.match(documents[0].url,/source_55$/);
  await assert.rejects(()=>manualDocuments(e,'image',JSON.stringify({text:'',image:{file_id:'x',file_size:20_000_001}}),55),/size_limit/);
 }finally{globalThis.fetch=original;}
});
test('market kinds select distinct templates and reject relative periods while keeping verified tags and holdings validation',()=>{
 const d=withMarketText(doc(custody));
 const draft={headline:'📊 THYAO takas dağılımı',body:'Citi saklamasında 108,10 milyon lot bulunuyor.',card_headline:'THYAO saklama dağılımı',card_body:'Bireysel pay %51,66, kurumsal pay %48,34.',hashtags:['#Borsa','#BIST','#THYAO'],entities:['THYAO'],category:'bist',importance:86,template:'akd',claims:[{text:'Citi saklamasında 108,10 milyon lot bulunuyor.',evidence:[{document:0,passage:'market_units',quote:d.body}]}],event_key:'thyao-custody-21-ekim',uncertainties:[],card_data:{ticker:'THYAO',as_of:'2026-10-21',holdings:[{label:'Citi',value:'108,10 milyon lot · %14,62'}],metrics:[{label:'Toplam takas lotu',value:'738,85 milyon lot'}]}} as Draft;
 const fixed=repairDraftStyle(draft,[d]);assert.equal(fixed.template,'custody');assert.deepEqual(numericIssues(fixed,[d]),[]);assert.equal(validateDraft(fixed,[d]).verification,'single_source_attributed');
 assert.throws(()=>validateDraft({...fixed,card_data:{holdings:[{label:'Uydurma',value:'108,10 milyon lot'}]}},[d]),/unsupported_card_entity/);
 assert(styleIssues({...fixed,headline:'📊 THYAO bugün takas dağılımı'},[d]).includes('unsupported_market_relative_period'));
 assert(cardDataFields(fixed.card_data).some(([k])=>k.includes('holdings')));
});
test('broker-flow and custody cards render in all saved layouts and palettes without turning holdings into buying',async()=>{
 for(const layout of CARD_LAYOUTS)for(const theme of ['navy','paper'] as const)for(const template of ['broker_flow','custody'] as const){
  const svg=cardSvg({template,headline:template==='custody'?'THYAO saklama dağılımı':'Kurumların net işlemleri',body:'Veri dönemi kaynakta belirtilen tarihtir.',card_data:{ticker:template==='custody'?'THYAO':undefined,as_of:'21 Ekim 2026',buy:[{label:'Ak',value:'+1,40 milyar TL'}],sell:[{label:'İş',value:'-1,53 milyar TL'}],holdings:[{label:'Citi',value:'108,10 milyon lot · %14,62'}],metrics:[{label:'Toplam takas lotu',value:'738,85 milyon lot'}]}},[],'',false,theme,layout);
  if(template==='custody'){assert.match(svg,/TAKASIN İLK BEŞİ/);assert(!svg.includes('ALICI KURUMLAR'));}else assert.match(svg,/NET ALICI KURUMLAR/);
  const image=Buffer.from(await png(svg));assertCardPng(image,svg);
 }
});
