import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import twitter from 'twitter-text';
import {report} from '../src/kap/reports';
import {normalize} from '../src/kap/parser';
import {postText} from '../src/editorial';
import {cardPageDrafts,draftCards} from '../src/card-pages';

test('circuit report retains 59 unique tickers across two cards and uses 20 ranked hashtags',async()=>{
 const f=JSON.parse(await readFile('test/fixtures/circuit-report-2026-10-23.json','utf8'));
 const seen=new Set<string>(),items:any[]=[];
 for(const disclosure of f.disclosures){const c=disclosure.subjectCodes?.[0];if(!normalize(disclosure.title+' '+disclosure.summary).includes('DEVRE KESICI')||!c||seen.has(c))continue;seen.add(c);items.push({disclosure});if(items.length===59)break;}
 assert.equal(items.length,59);
 const out=report('circuit',items,f.indices,f.at,'');const rows=out.draft.card_data!.report!.rows;
 const pages=cardPageDrafts(out.draft);assert.equal(pages.length,2);assert.deepEqual(pages.flatMap(p=>p.card_data!.report!.rows),rows);assert.equal(rows.length,59);
 const text=postText(out.draft),tags=text.match(/#[A-Z][A-Z0-9]{3,4}/g)??[];assert.equal(tags.length,20);assert.equal(new Set(tags).size,20);assert(twitter.parseTweet(text).valid);assert.match(text,/Tüm liste görsellerde/);
 assert.equal(draftCards(out.draft).reduce((n,s)=>n+(s.match(/data-report-row=/g)??[]).length,0),59);
});
