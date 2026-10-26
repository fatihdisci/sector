import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,dirname,extname} from 'node:path';
import {execFileSync} from 'node:child_process';

test('ChatGPT kit ZIP has exact SHA manifest, complete source closure, and 31 valid PNG examples',async(t)=>{
 const root=process.cwd(),zip=join(root,'exports/ENDEKS-HABER-ChatGPT.zip'),tmp=await mkdtemp(join(tmpdir(),'kit-verify-'));
 try{
  try{await access(zip);}catch{t.skip('release staging omits the offline kit; CI exports it before running this integrity test');return;}
  execFileSync('unzip',['-q',zip,'-d',tmp]);const base=join(tmp,'ENDEKS-HABER-ChatGPT');
  const manifest=JSON.parse(await readFile(join(base,'SHA256.json'),'utf8')) as Record<string,string>,actual:string[]=[];
  async function walk(path:string){for(const entry of await readdir(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())await walk(file);else actual.push(relative(base,file).split('\\').join('/'));}}
  await walk(base);assert(actual.includes('SHA256.json'));assert.deepEqual(Object.keys(manifest).sort(),actual.filter(f=>f!=='SHA256.json').sort());
  for(const [file,expected] of Object.entries(manifest))assert.equal(createHash('sha256').update(await readFile(join(base,file))).digest('hex'),expected,file);
  const sourceRoot=join(base,'src');
  for(const file of actual.filter(f=>f.startsWith('src/')&&f.endsWith('.ts'))){const text=await readFile(join(base,file),'utf8');for(const match of text.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)){let dep=join(dirname(join(base,file)),match[1]);if(!extname(dep))dep+='.ts';await readFile(dep);}}
  const examples=actual.filter(f=>f.startsWith('examples/')&&f.endsWith('.png'));assert.equal(examples.length,31);
  for(const file of examples){const data=await readFile(join(base,file));assert.equal(data.toString('hex',0,8),'89504e470d0a1a0a');const svg=await readFile(join(base,file.replace(/\.png$/,'.svg')),'utf8');const dimensions=svg.match(/<svg[^>]*width="(\d+)"[^>]*height="(\d+)"/);assert(dimensions,file);assert.equal(data.readUInt32BE(16),Number(dimensions[1]));assert.equal(data.readUInt32BE(20),Number(dimensions[2]));if(!file.includes('pay-geri-alimlari')){assert.equal(data.readUInt32BE(16),1080);assert.equal(data.readUInt32BE(20),1350);}else{assert(data.readUInt32BE(16)<=4096);assert(data.readUInt32BE(20)<=4096);}}
  const built=join(tmp,'cards.mjs');execFileSync(join(root,'node_modules/.bin/esbuild'),['src/card-pages.ts','--bundle','--platform=node','--format=esm',`--outfile=${built}`],{cwd:root});
  assert.deepEqual(await readFile(built),await readFile(join(base,'runtime/cards.mjs')),'runtime bundle must match current source');
  const sessionBuilt=join(tmp,'market-session.mjs');execFileSync(join(root,'node_modules/.bin/esbuild'),['src/market-session.ts','--bundle','--platform=node','--format=esm',`--outfile=${sessionBuilt}`],{cwd:root});assert.deepEqual(await readFile(sessionBuilt),await readFile(join(base,'runtime/market-session.mjs')));
  const session=await import('node:url').then(async({pathToFileURL})=>import(pathToFileURL(join(base,'runtime/market-session.mjs')).href));assert.equal(session.equitySessionLabel('2026-10-26T11:00:03Z').label,'Gün ortası');assert.equal(session.equitySessionLabel('2026-10-28T11:00:00Z').label,null);
  execFileSync(process.execPath,[join(base,'render.mjs'),join(base,'examples/devre-kesici-120.json'),join(tmp,'card.png')],{cwd:tmp});
  for(let i=1;i<=4;i++)assert.deepEqual(await readFile(join(tmp,`card-${i}.png`)),await readFile(join(base,`examples/devre-kesici-120-${i}.png`)),'standalone runtime must reproduce every page');
  execFileSync(process.execPath,[join(base,'render.mjs'),join(base,'examples/devre-kesici-raporu-40.json'),join(tmp,'daily.png')],{cwd:tmp});
  for(let i=1;i<=3;i++)assert.deepEqual(await readFile(join(tmp,`daily-${i}.png`)),await readFile(join(base,`examples/devre-kesici-raporu-40-${i}.png`)),'standalone runtime must reproduce the selected daily report');
  execFileSync(process.execPath,[join(base,'render.mjs'),join(base,'examples/teorik-eslesme-40.json'),join(tmp,'theory.png')],{cwd:tmp});
  for(let i=1;i<=4;i++)assert.deepEqual(await readFile(join(tmp,`theory-${i}.png`)),await readFile(join(base,`examples/teorik-eslesme-40-${i}.png`)),'theoretical runtime must preserve all four pages');
  assert(sourceRoot);
 }finally{await rm(tmp,{recursive:true,force:true});}
});
