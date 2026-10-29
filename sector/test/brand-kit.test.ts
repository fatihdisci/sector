import test from 'node:test';import assert from 'node:assert/strict';
import samples from './fixtures/brand-kit-samples.json';
import manifest from '../assets/news-visuals/manifest.json';
import {REGISTRY} from '../src/brand-kit-registry';
import {TOKENS} from '../src/brand-kit';
import {imagegenPrompt} from '../src/brand-kit-imagegen';
import {draftCards,cardPageDrafts} from '../src/card-pages';
import {postText,EDITOR_PROMPT} from '../src/editorial';
import {proseIssues} from '../src/editorial-prose';
import {newsVisualPlan} from '../src/news-visual-plan';
import {png} from '../scripts/render_local';
import type {Draft} from '../src/types';
test('all twelve registered families use the actual production renderer without separate brand signatures',async()=>{
 assert.equal(REGISTRY.length,12);assert.deepEqual(samples.map(s=>s.key).sort(),REGISTRY.map(r=>r.key).sort());
 for(const sample of samples){const d=sample.draft as Draft,before=JSON.stringify(d),svgs=draftCards(d);assert.equal(svgs.length,cardPageDrafts(d).length);assert.equal(JSON.stringify(d),before);
 for(const svg of svgs){assert(svg.includes('data-brand-kit="bc-typographic-v1"'),sample.key);assert(svg.includes('#080908'));assert(svg.includes('#F4F1E9'));assert.equal((svg.match(/>borsacakali<\/text>/g)??[]).length,1);assert(!/<image\b|>ENDEKS(?: HABER)?<|>HABER<|>H A B E R<|>ÖRNEK</.test(svg));assert(!/#FF[0-9A-F]{4}|#46C7A4/.test(svg));const bytes=await png(svg);assert(bytes.length<5_000_000);}
 }
});
test('live row contracts stay five custody institutions, ten plus ten institution rows and ten plus ten movers',()=>{
 for(const [key,expected,pages]of[['takas',5,1],['kurum',20,1],['piyasayd',20,2]]as const){const d=samples.find(x=>x.key===key)!.draft as Draft,svgs=draftCards(d);assert.equal(svgs.length,pages);assert.equal(svgs.reduce((n,s)=>n+(s.match(/data-kit-row=/g)??[]).length,0),expected);}
 const tavan=draftCards(samples.find(s=>s.key==='tavan')!.draft as Draft)[0];assert.equal([...tavan.matchAll(/data-kit-role="headline"><text[^>]*>([^<]*)<\/text>/g)].map(m=>m[1]).join(' '),samples.find(s=>s.key==='tavan')!.draft.card_headline);
});
test('final ticker view uses ASCII lowercase while source figures, topic tags and validated uppercase data stay intact',()=>{
 const d={...samples[0].draft,headline:'📊 ISCTR kurum dağılımı',body:'İşlemlerin dağılımı açıklandı.',hashtags:['#Borsa','#BIST','#ISCTR'],card_data:{ticker:'ISCTR'}}as Draft,before=JSON.stringify(d),text=postText(d);
 assert(text.includes('#isctr'));assert(!text.includes('#ısctr'));assert(text.includes('#Borsa #BIST'));assert.equal(JSON.stringify(d),before);
 const fund={...d,template:'news',card_data:undefined,hashtags:['#Fon','#PBLK','#Tasfiye']}as Draft;assert(postText(fund).includes('#PBLK'));
});
test('natural data headings can be statements or honest questions and repeated conclusions remain a repair issue',()=>{
 assert(EDITOR_PROMPT.includes('Doğal ve doğrudan Türkçe'));
 for(const headline of ['Şirketin net kârı yükseldi','Hangi kurumlar net alıcı oldu?'])assert.deepEqual(proseIssues({headline,body:'Kaynakta açıklanan dağılım aşağıda yer alıyor.'}),[]);
 assert(proseIssues({headline:'Şirketin net kârı yükseldi',body:'Üretim kapasitesi artacak. Üretim kapasitesi artacak.'}).includes('repeated_body_or_conclusion'));
});
test('imagegen and renderer share identity; unknown content type never silently chooses a template',()=>{
 const p=imagegenPrompt('takas','Doğrulanmış içerik');for(const token of[TOKENS.bg,TOKENS.ink,String(TOKENS.width)+'×'+TOKENS.height,String(TOKENS.watermarkAngle)+'°'])assert(p.includes(token));assert.throws(()=>imagegenPrompt('not-registered',''),/unknown_type/);
});
test('remote breaking assets are unavailable locally and never become normal-news illustrations',()=>{
 assert.equal(manifest.enabled,false);assert.equal(manifest.pools.breaking.assets.length,4);assert(manifest.pools.breaking.assets.every(a=>a.local_path===null&&a.sha256===null&&!a.verified));
 assert.equal(newsVisualPlan({template:'news'},{breakingConfirmed:true}).pool,'general');assert.equal(newsVisualPlan({template:'breaking'}).pool,'general');const plan=newsVisualPlan({template:'breaking'},{breakingConfirmed:true});assert.equal(plan.pool,'breaking');assert.equal(plan.ready,false);assert.equal(plan.reason,'library_assets_not_materialized');assert.equal(plan.references.length,4);
});

test('uppercase Turkish breaking heading does not repeat a separate breaking label',()=>{const svg=draftCards(samples.find(s=>s.key==='son-dakika')!.draft as Draft)[0];assert.equal((svg.match(/>SON DAKİKA<\/text>/g)??[]).length,1);});

test('disabled news pools retain the current approved data-card palette',()=>{assert.deepEqual(manifest.data_card_palette,[TOKENS.bg,TOKENS.ink]);});
