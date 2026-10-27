import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {acceptHermes,AUDIT_PROMPT} from '../src/ai';
import {draftCards} from '../src/card-pages';

test('real 12:01 AKD image retains ten rows, broker roles, original scales, and fund code',async()=>{
 const {documents,draft,audit}=JSON.parse(await readFile('test/fixtures/institution-summary-26499-draft.json','utf8'));
 const checked=acceptHermes(draft,audit,documents).draft;
 const data=checked.card_data;assert(data?.buy&&data.sell);
 assert.equal(data.buy_broker,'Garanti');assert.equal(data.sell_broker,'BofA');
 assert.equal(data.buy.length,5);assert.equal(data.sell.length,5);
 assert.deepEqual(data.buy[1],{label:'Z30KP.F',value:'+95,04 Mn · maliyet 206,62 ₺'});
 assert.deepEqual(data.sell[0],{label:'AKBNK',value:'-289,09 Mn · maliyet 63,70 ₺'});
 assert(!data.buy.some((r:{value:string})=>/1\. sıra|Mn\s*TL/.test(r.value)));
 assert.equal(draftCards(checked,'navy','editorial').length,1);
});

test('final audit treats scale-only AKD cells as source values while rejecting invented currency',()=>{
 assert.match(AUDIT_PROMPT,/source_layout\.kind=institution_summary[^\n]*para birimi eklenmeden aynen aktarılabilir/u);
 assert.match(AUDIT_PROMPT,/para birimi belirtilmemiş parasal hacimlere TL veya başka bir birim eklenmesini reddet/u);
});
