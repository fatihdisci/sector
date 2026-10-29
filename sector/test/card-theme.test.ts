import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chooseTheme,legacyTheme} from '../src/card-theme';
import {localDatabase} from '../src/local-adapters';
import {cardSvg,COLORS} from '../src/card';
import type {Env} from '../src/types';
test('theme is saved once and survives repeat requests and a changed content template',async()=>{
 const env={DB:await localDatabase(':memory:',await readFile('migrations/0001_sector.sql','utf8'))} as Env;
 const themes=await Promise.all(Array.from({length:5},()=>chooseTheme(env,'article')));
 assert(themes.every(t=>t===themes[0]));assert.equal(await chooseTheme(env,'article','economic_data'),themes[0]);
 assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM system_state WHERE key='card_theme:article'").first<{n:number}>())!.n,1);
 assert.equal(await chooseTheme(env,'old-light','info'),'paper');
 assert.equal(await chooseTheme(env,'old-dark','company'),'navy');
});
test('saved palette keys retain compatibility while approved monochrome identity preserves text and dimensions',()=>{
 const card={headline:'Örnek Holding yeni yatırımını duyurdu',body:'Yeni tesis için izin süreci devam ediyor.',template:'company' as const};
 for(const theme of ['navy','paper'] as const){
  const svg=cardSvg(card,[],'',false,theme);
  assert(svg.includes(`<rect width="1600" height="900" fill="#080908"/>`));
  assert(svg.includes('Örnek Holding'));assert(svg.includes('izin süreci'));
  assert(svg.includes('viewBox="0 0 1600 900"'));
 }
 assert.equal(legacyTheme('info'),'paper');assert.equal(legacyTheme('breaking'),'navy');
});
