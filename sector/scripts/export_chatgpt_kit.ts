// Build the self-contained kit in clean staging, verify it, then atomically replace outputs.
import {copyFile,mkdir,mkdtemp,readFile,readdir,rm,writeFile,cp,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join,relative,dirname,extname} from 'node:path';
import {cardSvgs} from '../src/card-pages';
import {png} from './render_local';
import {CARD_LAYOUTS} from '../src/card-layout';
import {report} from '../src/kap/reports';
import {parseMarketOverview} from '../src/market-overview';

const root=process.cwd(),exportsDir=join(root,'exports'),name='ENDEKS-HABER-ChatGPT',target=join(exportsDir,name),zipTarget=join(exportsDir,name+'.zip');
const temp=await mkdtemp(join(tmpdir(),'endeks-kit-')),stage=join(temp,name),zipTemp=join(exportsDir,'.'+name+'.tmp.zip');
await mkdir(exportsDir,{recursive:true});await mkdir(stage,{recursive:true});
try{
 for(const dir of ['assets','src','runtime','examples'])await mkdir(join(stage,dir),{recursive:true});
 const visited=new Set<string>();
 async function source(file:string){
  const abs=join(root,'src',file);if(visited.has(abs))return;visited.add(abs);
  const text=await readFile(abs,'utf8');const out=join(stage,'src',file);await mkdir(dirname(out),{recursive:true});await writeFile(out,text);
  for(const m of [...text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g),...text.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)]){let dep=join(dirname(abs),m[1]);if(!extname(dep))dep+='.ts';await source(relative(join(root,'src'),dep));}
 }
 await source('card-pages.ts');
 await source('market-session.ts');
 await source('channel-programme.ts');
 await source('brand-kit-registry.ts');await source('brand-kit-imagegen.ts');await source('editorial.ts');await source('news-visual-plan.ts');
 await cp(join(root,'assets/news-visuals'),join(stage,'assets/news-visuals'),{recursive:true});
 await cp(join(root,'assets/kap-general'),join(stage,'assets/kap-general'),{recursive:true});
 await cp(join(root,'assets/approved-typography'),join(stage,'assets/approved-typography'),{recursive:true});
 await cp(join(root,'assets/visual-templates'),join(stage,'assets/visual-templates'),{recursive:true});
 await writeFile(join(stage,'BRAND-KIT.md'),'Borsa Çakalı bc-typographic-v1: onaylı yatay/yoğun liste, siyah #080908, kırık beyaz #F4F1E9; Anton/Zilla Slab başlık ve Inter veri fontu; seyrek veri yatay, yoğun veri dikey, yalnız silik çapraz filigran. 12 tür ve mevcut girişler src/brand-kit-registry.ts içindedir. src/brand-kit-imagegen.ts aynı production tokenlarını kullanır. Veri satırları ve mevcut kapasite kapıları korunur. Normal haberler dört onaylı SON DAKİKA PNG’sinden birini bir kez rastgele seçer; assets/news-visuals manifesti ve kaynak PNG’ler pakettedir. Habere özel kart üretimi kullanılmaz.\n');
 for(const file of ['NotoSans-Regular.ttf','NotoSans-Bold.ttf','OFL.txt'])await copyFile(join(root,'assets',file),join(stage,'assets',file));
 for(const file of ['index.mjs','index_bg.wasm','package.json'])await copyFile(join(root,'node_modules/@resvg/resvg-wasm',file),join(stage,'runtime',file));
 execFileSync(join(root,'node_modules/.bin/esbuild'),['src/card-pages.ts','--bundle','--platform=node','--format=esm',`--outfile=${join(stage,'runtime/cards.mjs')}`],{cwd:root});
 execFileSync(join(root,'node_modules/.bin/esbuild'),['src/editorial.ts','--bundle','--platform=node','--format=cjs',`--outfile=${join(stage,'runtime/caption.cjs')}`],{cwd:root});
 execFileSync(join(root,'node_modules/.bin/esbuild'),['src/market-session.ts','--bundle','--platform=node','--format=esm',`--outfile=${join(stage,'runtime/market-session.mjs')}`],{cwd:root});
 await writeFile(join(stage,'render.mjs'),String.raw`import {readFile,writeFile} from 'node:fs/promises';import {cardSvgs} from './runtime/cards.mjs';import {initWasm,Resvg} from './runtime/index.mjs';
const base=new URL('./',import.meta.url),input=process.argv[2],output=process.argv[3]??'kart.png';if(!input)throw Error('Usage: node render.mjs content.json kart.png');const d=JSON.parse(await readFile(input,'utf8'));const svgs=cardSvgs(d,d.theme??'navy',d.layout??'editorial');await initWasm(await readFile(new URL('runtime/index_bg.wasm',base)));const fonts=await Promise.all(['NotoSans-Regular.ttf','NotoSans-Bold.ttf','approved-typography/Anton-Regular.ttf','approved-typography/ZillaSlab-Bold.ttf','approved-typography/Inter.ttf'].map(n=>readFile(new URL('assets/'+n,base))));for(let i=0;i<svgs.length;i++){const svg=svgs[i],name=svgs.length===1?output:output.replace(/\.png$/i,'')+'-'+(i+1)+'.png',r=new Resvg(svg,{font:{fontBuffers:fonts,defaultFontFamily:'Noto Sans'}});try{const image=r.render();try{await writeFile(name,image.asPng());await writeFile(name.replace(/\.png$/i,'')+'.svg',svg);}finally{image.free();}}finally{r.free();}}
`);
 const samples:any[]=[];
 for(const layout of CARD_LAYOUTS)for(const theme of ['navy','paper'])samples.push({name:`haber-${layout}-${theme}`,template:'news',headline:'Şirket yeni yatırım programını açıkladı',body:'Üretim kapasitesini artıracak yatırım için izin ve finansman çalışmaları sürüyor.',theme,layout});
 for(const count of [2,24,120])samples.push({name:`devre-kesici-${count}`,template:'circuit',headline:'Devre kesici uygulandı',body:'Sürekli işleme ara verildi.',card_data:{tickers:Array.from({length:count},(_,i)=>'A'+String(i).padStart(4,'0'))}});
 samples.push({name:'hisse-akd',template:'akd',headline:'ABCD aracı kurum dağılımı',body:'Net alıcı ve satıcı kurumların pay miktarları.',card_data:{ticker:'ABCD',buy:[{label:'Alfa Yatırım',value:'%20 · 123 lot · —'}],sell:[{label:'Beta Menkul',value:'110.000 lot'}]}},{name:'kurum',template:'institutional',headline:'Örnek Kurum üzerinden alınan/satılan hisseler',body:'Alım tarafında öne çıkan hisseler.',card_data:{broker:'Bank of America',buy:Array.from({length:10},(_,i)=>({label:'A'+String(i).padStart(4,'0'),value:`${10-i} milyon TL`}))}},{name:'takas',template:'custody',headline:'ABCD takas dağılımı',body:'Kaynakta yer alan saklama kuruluşları.',card_data:{ticker:'ABCD',metrics:[{label:'Toplam takas',value:'100 milyon lot'}],holdings:[{label:'Alfa',value:'10 milyon lot / %10'}]}},{name:'hacim',template:'volume',headline:'ABCD işlem hacmi',body:'Kaynakta açıklanan işlem hacmi.',card_data:{ticker:'ABCD',metrics:[{label:'İŞLEM HACMİ',value:'125 milyon TL'}]}});
 samples.push({name:'pay-geri-alimlari',template:'info',headline:'PAY GERİ ALIMLARI',body:'22.10.2026',card_data:{report:{rows:[],footer:'',buyback:{day:'2026-10-22',row_count:2,reader:'example',rows:[{ticker:'AAAA',day:'22.10.2026',nominal:'100.000',price:'4,25',amount:'425.000',raw:[]},{ticker:'BBBB',day:'22.10.2026',nominal:'70.000',price:null,amount:null,raw:[]}]}}}});
 samples.push({name:'teorik-eslesme-40',provenance:'Sentetik şablon örneği; canlı piyasa verisi değildir.',template:'theoretical',headline:'Teorik eşleşme',body:'Teorik fiyatlar gerçekleşmiş işlem fiyatı değildir.',card_data:{buy:Array.from({length:20},(_,i)=>({label:'A'+String(i).padStart(4,'0'),value:'94,05 TL|+%10,00|13.383'})),sell:Array.from({length:20},(_,i)=>({label:'B'+String(i).padStart(4,'0'),value:'6,84 TL|%10,00|923.160'}))}},{name:'kurum-akd-ozeti',provenance:'Sentetik şablon örneği; canlı işlem değildir.',template:'institutional',headline:'Kurumlar üzerinden öne çıkan hisseler',body:'Alım ve satım tarafındaki kurumlar ayrı gösterilir.',card_data:{buy_broker:'BofA',sell_broker:'QNB',buy:Array.from({length:5},(_,i)=>({label:'A'+String(i).padStart(4,'0'),value:`${5-i} milyon TL · maliyet 10,25 TL`})),sell:Array.from({length:5},(_,i)=>({label:'B'+String(i).padStart(4,'0'),value:`-${5-i} milyon TL · maliyet 12,50 TL`}))}});
 const overviewFixture=JSON.parse(await readFile(join(root,'test/fixtures/market-overview-26431.json'),'utf8'));
 samples.push({name:'piyasa-ozeti',provenance:overviewFixture.provenance,template:'market',headline:'Gün ortası',body:'BIST 100 piyasa özeti',theme:'paper',card_data:{overview:parseMarketOverview(overviewFixture.document)}});
 for(const [time,view,title]of [['09:55','opening','Borsa açılışı'],['10:01','first_moves','Açılışın ilk anları'],['18:11','close','Gün sonu']]){const d=structuredClone(overviewFixture.document);d.channel_publication.posted_at='2026-10-26T'+time+':00+03:00';samples.push({name:'piyasa-'+view,provenance:'Sentetik yayın saatiyle yerleşim testi; gerçek açılış/kapanış raporu değildir. '+overviewFixture.provenance,template:'market',headline:title,body:'',theme:'paper',card_data:{overview:parseMarketOverview(d)}});}
 const circuitFixture=JSON.parse(await readFile(join(root,'test/fixtures/circuit-report-2026-10-23.json'),'utf8'));
 const demoCodes=new Set<string>();for(const d of circuitFixture.disclosures){const code=d.subjectCodes?.[0];if(d.title==='Pay Bazında Devre Kesici Bildirimi'&&code&&demoCodes.size<59)demoCodes.add(code);}
 const demoDisclosures=circuitFixture.disclosures.filter((d:any)=>d.subjectCodes?.some((code:string)=>demoCodes.has(code)));
 samples.push({name:'devre-kesici-raporu-59',provenance:{...circuitFixture.provenance,note:'DEMO: 23 Ekim 2026 tarihli geçmiş fixture alt kümesi; güncel veri değildir.'},...report('circuit',demoDisclosures.map((disclosure:any)=>({disclosure})),circuitFixture.indices,circuitFixture.at,'').draft});
 for(const s of samples){const {name:n,...d}=s;await writeFile(join(stage,'examples',n+'.json'),JSON.stringify(d,null,2));const svgs=cardSvgs(d,d.theme,d.layout);for(let i=0;i<svgs.length;i++){const svg=svgs[i],page=svgs.length===1?n:n+'-'+(i+1);await writeFile(join(stage,'examples',page+'.svg'),svg);await writeFile(join(stage,'examples',page+'.png'),await png(svg));}}
 await copyFile(join(root,'docs/chatgpt-kit-prompt.txt'),join(stage,'CHATGPT-PROMPT.txt'));await copyFile(join(root,'docs/chatgpt-kit-readme.txt'),join(stage,'ONCE-BUNU-OKU.txt'));
 await writeFile(join(stage,'THIRD-PARTY.txt'),'PNG renderer: @resvg/resvg-wasm 2.6.2, MPL-2.0. Noto Sans: SIL OFL, assets/OFL.txt. Anton, Zilla Slab, Inter: SIL OFL; assets/approved-typography/*OFL* and provenance.json.\n');
 const files:string[]=[];async function walk(dir:string){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else files.push(relative(stage,p).split('\\').join('/'));}}await walk(stage);
 const hashes=Object.fromEntries(await Promise.all(files.sort().map(async f=>[f,createHash('sha256').update(await readFile(join(stage,f))).digest('hex')])));
 await writeFile(join(stage,'SHA256.json'),JSON.stringify(hashes,null,2)+'\n');
 const manifest=JSON.parse(await readFile(join(stage,'SHA256.json'),'utf8')) as Record<string,string>;files.length=0;await walk(stage);const actual=files.filter(f=>f!=='SHA256.json');if(Object.keys(manifest).sort().join('\n')!==[...actual].sort().join('\n'))throw Error('kit_manifest_file_set_mismatch');
 for(const [f,h] of Object.entries(manifest))if(createHash('sha256').update(await readFile(join(stage,f))).digest('hex')!==h)throw Error('kit_hash_mismatch');
 await rm(zipTemp,{force:true});execFileSync('zip',['-X','-r',zipTemp,name],{cwd:temp,stdio:'ignore'});
 await rm(target,{recursive:true,force:true});await cp(stage,target,{recursive:true});await rename(zipTemp,zipTarget);
 console.log(`Offline kit: ${zipTarget}; ${samples.length} examples rendered and ${Object.keys(manifest).length} files hashed.`);
}finally{await rm(temp,{recursive:true,force:true});await rm(zipTemp,{force:true});}
