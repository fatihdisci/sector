import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {localDatabase} from '../src/local-adapters';
import {enqueueEvidence} from '../src/ingest';
import type {Env,Document} from '../src/types';
const doc={source_id:'kap',source_name:'KAP',url:'https://www.kap.org.tr/tr/Bildirim/101',title:'Bildirim',body:'metin',passages:[{id:'p',text:'metin'}],published_at:null} as Document;
test('stable queue id survives repeated enqueue without replaying existing job',async()=>{
 const DB=await localDatabase(':memory:',(await readFile('migrations/0001_sector.sql','utf8'))+'\n'+(await readFile('migrations/0008_kap_previews.sql','utf8')));const env={DB} as Env;
 const id=await enqueueEvidence(env,[doc],'kap','','queue-101');
 await DB.prepare("UPDATE model_jobs SET state='needs_review' WHERE id=?").bind(id).run();
 assert.equal(await enqueueEvidence(env,[doc],'kap','','queue-101'),id);
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM model_jobs').first<{n:number}>())!.n,1);
 assert.equal((await DB.prepare('SELECT state FROM model_jobs WHERE id=?').bind(id).first<{state:string}>())!.state,'needs_review');
});
test('existing article is not altered by a new selection',async()=>{
 const DB=await localDatabase(':memory:',(await readFile('migrations/0001_sector.sql','utf8'))+'\n'+(await readFile('migrations/0008_kap_previews.sql','utf8')));const env={DB} as Env;
 const id=await enqueueEvidence(env,[doc],'kap');await DB.prepare("UPDATE model_jobs SET state='paused' WHERE id=?").bind(id).run();
 await assert.rejects(enqueueEvidence(env,[doc],'kap','','new-queue'),/kap_existing_article/);
 assert.equal((await DB.prepare('SELECT state FROM model_jobs WHERE id=?').bind(id).first<{state:string}>())!.state,'paused');
});
