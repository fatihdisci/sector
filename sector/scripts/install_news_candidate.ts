/** Stage a tested candidate only. This command cannot approve or activate it. */
import {DatabaseSync} from 'node:sqlite';import {readFile,stat,open,unlink} from 'node:fs/promises';import {resolve,dirname,join} from 'node:path';
import {newsReviewArtifact} from './news_review_artifact';import {stageMaintenanceCandidate} from '../src/news-maintenance-request';import type {Env} from '../src/types';
const [database,file,ownerChat]=process.argv.slice(2);if(!database||!file||process.argv.length>5)throw Error('database_and_candidate_required');
const dbPath=resolve(database);if(!(await stat(dbPath)).isFile())throw Error('database_not_regular_file');
const raw=await readFile(resolve(file),'utf8'),artifact=await newsReviewArtifact(process.cwd()),lockPath=join(dirname(dbPath),'.install.lock');
const lock=await open(lockPath,'wx',0o600);let db:DatabaseSync;
try{db=new DatabaseSync(dbPath);}catch(e){await lock.close();await unlink(lockPath);throw e;}
try{
 db.exec('BEGIN IMMEDIATE');
 const prior=db.prepare("SELECT value FROM system_state WHERE key='news_maintenance_transition'").get() as {value:string}|undefined;
 const actor=prior?JSON.parse(prior.value)?.actor:null;if(typeof actor!=='string'||!actor)throw Error('prior_owner_binding_required');
 // The outer IMMEDIATE transaction also makes history+pending-pointer batches atomic.
 const DB={prepare:(sql:string)=>{let args:any[]=[];const statement={bind:(...v:any[])=>{args=v;return statement;},first:async()=>db.prepare(sql).get(...args)??null,run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}})};return statement;},batch:async(statements:{run:()=>Promise<unknown>}[])=>Promise.all(statements.map(s=>s.run()))};
 const result=await stageMaintenanceCandidate({DB,TELEGRAM_USER_ID:actor,TELEGRAM_CHAT_ID:ownerChat??process.env.TELEGRAM_CHAT_ID} as unknown as Env,raw,artifact);db.exec('COMMIT');
 console.log(JSON.stringify({result,hash:artifact.hash,approval:false,activation:false}));
}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.close();await lock.close();await unlink(lockPath);}
