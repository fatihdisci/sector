import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CARD_LAYOUTS,nextLayout,chooseLayout,savedLayout} from '../src/card-layout';
import {cardSvg} from '../src/card';
import {localDatabase} from '../src/local-adapters';
import {requestRedesign,redesignOne} from '../src/card-redesign';
import type {Env} from '../src/types';
const id='11111111-1111-4111-8111-111111111111';
const content={headline:'📢 Şirket yeni sözleşme imzaladı',body:'Kaynakla doğrulanmış haber metni.',hashtags:['#Borsa','#BIST','#TEST'],template:'company',card_headline:'Şirket yeni sözleşme imzaladı',card_body:'Yeni sözleşmenin koşulları şirket tarafından açıklandı.'};
async function env(){return {DB:await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8')),MEDIA:{put:async()=>{},delete:async()=>{}}} as unknown as Env;}
async function seed(e:Env){await e.DB.prepare("INSERT INTO drafts(id,event_key,fingerprint,content,documents,verification,state,created_at,expires_at,delivery_state,message_id) VALUES(?,'e','f',?,'[]','official','pending',0,9999999999,'sent',90)").bind(id,JSON.stringify(content)).run();}
test('six layouts preserve dimensions and escape source text in both palettes',()=>{
 for(const theme of ['navy','paper'] as const){const outputs=CARD_LAYOUTS.map(layout=>{
 const svg=cardSvg({headline:'Türkiye ve Japonya enerji alanındaki yatırımlarda iş birliğini genişletmek için yeni adımlar atmayı planlıyor',body:'Şirketin açıklamasına göre yeni dönemde yatırımların kapsamı genişletilecek. Gerekli izinler ve finansman koşulları tamamlandıktan sonra çalışmalar başlayacak.',template:'breaking'},[],'',false,theme,layout);
 assert.match(svg,/width="1600" height="900"/);assert(!/linearGradient|filter=/.test(svg));assert.match(svg,/SON DAKİKA/);return svg;
 });assert.equal(new Set(outputs).size,6);}
 assert.match(cardSvg({headline:'A < B & C',body:'D & E',template:'company'},[],'',false,'navy','frame'),/A &lt; B &amp; C/);
});
test('layout stays stable across retry and another layout is always chosen on request',async()=>{
 const e=await env(),layout=await chooseLayout(e,'article');for(let i=0;i<40;i++){assert.equal(await chooseLayout(e,'article'),layout);assert.notEqual(nextLayout(layout),layout);}
});
test('redesign leaves content intact, excludes old layout and rejects stale/repeated callbacks',async()=>{
 const e=await env();await seed(e);
 assert.match(await requestRedesign(e,`design:${id}:1`,91,1),/güncellenmiş/);
 assert.match(await requestRedesign(e,`design:${id}:1`,90,1),/yenileniyor/);
 assert.match(await requestRedesign(e,`design:${id}:1`,90,2),/zaten/);
 assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM card_redesigns').first<{n:number}>())!.n,1);
 let renders=0;await redesignOne(e,async()=>{renders++;return new Uint8Array([1]);});await redesignOne(e,async()=>{renders++;return new Uint8Array([1]);});
 const row=await e.DB.prepare('SELECT content,revision,delivery_state,message_id FROM drafts WHERE id=?').bind(id).first<any>();
 assert.equal(row.content,JSON.stringify(content));assert.equal(row.revision,2);assert.equal(row.delivery_state,'waiting');assert.equal(row.message_id,90);assert.equal(renders,1);assert.notEqual(await savedLayout(e,'draft:'+id),'editorial');
 assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<{n:number}>())!.n,0);
});
test('render failure preserves previous content, revision and image delivery state',async()=>{
 const e=await env();await seed(e);await requestRedesign(e,`design:${id}:1`,90,1);await redesignOne(e,async()=>{throw Error('card_content_overflow');});
 const row=await e.DB.prepare('SELECT revision,delivery_state FROM drafts WHERE id=?').bind(id).first<any>();assert.equal(row.revision,1);assert.equal(row.delivery_state,'sent');assert.equal(await savedLayout(e,'draft:'+id),null);
});

test('explicit redesign renews the old card delivery window without changing its content',async()=>{
 const e=await env();await seed(e);await e.DB.prepare('UPDATE drafts SET expires_at=1 WHERE id=?').bind(id).run();
 await requestRedesign(e,`design:${id}:1`,90,1);await redesignOne(e,async()=>new Uint8Array([1]));
 const row=await e.DB.prepare('SELECT expires_at,content FROM drafts WHERE id=?').bind(id).first<any>();assert(row.expires_at>Date.now()/1000);assert.equal(row.content,JSON.stringify(content));
});

test('data card redesign preserves every structured figure and generates no model job',async()=>{
 const e=await env();await seed(e);
 const data={...content,template:'akd',card_headline:'ABCD aracı kurum dağılımı',card_body:'Kurumların net işlem miktarları açıklandı.',card_data:{ticker:'ABCD',as_of:'22 Ekim 2026',buy:[{label:'Alfa Yatırım',value:'1.250.000 adet'}],sell:[{label:'Beta Menkul',value:'890.000 adet'}]}};
 await e.DB.prepare('UPDATE drafts SET content=? WHERE id=?').bind(JSON.stringify(data),id).run();
 await requestRedesign(e,`design:${id}:1`,90,88);
 await redesignOne(e,async svg=>{assert.match(svg,/1.250.000/);assert.match(svg,/890.000/);assert.match(svg,/NET ADET/);assert.match(svg,/aracı kurum dağılımı/);return new Uint8Array([1,2,3]);});
 assert.equal((await e.DB.prepare('SELECT content FROM drafts').first<any>()).content,JSON.stringify(data));
 assert.equal((await e.DB.prepare('SELECT revision FROM drafts').first<any>()).revision,2);
 assert.equal((await e.DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<any>()).n,0);
});
