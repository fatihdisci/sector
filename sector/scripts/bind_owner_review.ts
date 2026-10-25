// Explicit local admin operation; never changes preferences, historical reviews or votes.
import {DatabaseSync} from 'node:sqlite';import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {newsReadiness} from '../src/news-readiness';import {DEFAULT_NEWS_PREFERENCES,NEWS_RULE_VERSION} from '../src/news-routing';import {newsReviewArtifact} from './news_review_artifact';
const [database,path,...flags]=process.argv.slice(2),apply=flags.includes('--apply'),owner=process.env.TELEGRAM_USER_ID;
if(!database||!path||!owner||flags.some((f:string)=>f!=='--apply'))throw Error('database_binding_owner_required');
const binding=JSON.parse(await readFile(path,'utf8')),artifact=await newsReviewArtifact(process.cwd());
const sql=new DatabaseSync(resolve(database),{readOnly:!apply});if(apply)sql.exec('BEGIN IMMEDIATE');else sql.exec('PRAGMA query_only=ON');
try{
 const before=sql.prepare("SELECT value FROM system_state WHERE key='news_filter_preferences'").get() as any,prefs=before?JSON.parse(before.value):{};
 if((prefs.mode??'shadow')!=='shadow'||prefs.digest_enabled)throw Error('shadow_digest_off_required');
 const DB={prepare:(q:string)=>{let a:any[]=[];const s={bind:(...v:any[])=>{a=v;return s;},first:async()=>q==='SELECT value FROM system_state WHERE key=?'&&a[0]==='news_owner_review_binding'?{value:JSON.stringify(binding)}:q==='SELECT value FROM system_state WHERE key=?'&&a[0]==='runtime_identity'?{value:JSON.stringify({news_review_artifact:artifact})}:sql.prepare(q).get(...a)??null,all:async()=>({results:sql.prepare(q).all(...a)})};return s;}};
 const report=await newsReadiness({DB,TELEGRAM_USER_ID:owner} as any,{...DEFAULT_NEWS_PREFERENCES,...prefs},NEWS_RULE_VERSION);
 if(!report.owner_context_reviews.valid)throw Error('owner_binding_rejected: '+report.owner_context_reviews.reasons.join('; '));
 if(apply){
  const old=sql.prepare("SELECT value FROM system_state WHERE key='news_owner_review_binding'").get() as any;
  if(old&&old.value!==JSON.stringify(binding))throw Error('existing_binding_must_not_be_overwritten');
  sql.prepare("INSERT OR IGNORE INTO system_state(key,value) VALUES('news_owner_review_binding',?)").run(JSON.stringify(binding));sql.exec('COMMIT');
 }
 console.log(JSON.stringify({valid:true,applied:apply,reviewed:report.metrics.reviewed,distribution:report.owner_context_reviews.distribution,ready:report.ready,missing:report.reasons,hashes:report.owner_context_reviews.hashes}));
}catch(e){if(apply)sql.exec('ROLLBACK');throw e;}finally{sql.close();}
