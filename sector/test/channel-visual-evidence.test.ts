import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseMarketOverview,withOverviewEvidence} from '../src/market-overview';
import {documentProgramme} from '../src/channel-programme';
import type {Document} from '../src/types';
const fixtures=JSON.parse(await readFile('test/fixtures/channel-visual-20261027.json','utf8')) as {image:number;source_image_sha256:string;documents:Document[]}[];

test('real 10:01 image includes the volume row omitted by OCR and preserves unknown currency',()=>{
 const d=fixtures[0].documents[0],o=parseMarketOverview(d);
 assert.equal(d.channel_publication?.message_id,26489);assert.equal(d.source_layout?.minimum_rows,25);
 assert.equal(o.view,'first_moves');assert.equal(o.panels.length,3);
 assert.deepEqual(o.panels.find(p=>p.key==='volume')!.rows.at(-1),{label:'PETKM',value:'84,8 milyon'});
 assert(o.panels.find(p=>p.key==='volume')!.rows.every(r=>!r.value.includes('TL')));
 assert(d.passages.some(p=>p.id.startsWith('image_source_note_')));assert.doesNotThrow(()=>withOverviewEvidence([d]));
});
test('09:55 report and 09:52 theory retain separate identities and all extracted source rows',()=>{
 const opening=fixtures[1].documents[0],theory=fixtures[2].documents[0],o=parseMarketOverview(opening);
 assert.equal(opening.channel_publication?.message_id,26488);assert.equal(o.view,'opening');assert.equal(o.level,'11.138,10');assert.equal(o.points,'-13,86');assert.equal(o.percent,'%0,12');assert.equal(o.direction,'down');
 assert.equal(theory.channel_publication?.message_id,26487);assert.equal(documentProgramme(theory)?.kind,'theoretical_open');
 assert.equal(theory.source_layout?.minimum_rows,40);assert(theory.source_layout?.panels.every(p=>p.symbols.length===20));
 assert.equal(theory.source_layout?.panels[0].symbols[0],'GOODY');assert.equal(theory.source_layout?.panels[1].symbols.at(-1),'INFO');
 assert(theory.passages.some(p=>p.text.includes('KALAN 214.171')));assert(theory.passages.some(p=>p.text.includes('KALAN 211.948')));
});
