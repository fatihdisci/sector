import {circuitDraft,withCircuitArtwork,storeCircuitArtwork} from './circuit-artwork';
import {renderMedia} from './media-set';
import {sha256} from './utils/text';
import {postText} from './editorial';
import twitter from 'twitter-text';
import {OutputCapacityError} from './output-capacity';
import type {Env,Document,Draft} from './types';
// Deterministic reports use the existing delivery/retry ledger, without a model
// lease or an additional Telegram sender.
export async function saveReport(env:Env,row:{update_id:number;message_id:number},result:{draft:Draft;documents:Document[]}){
 const buyback=/^(?:buyback|general_buyback)-(\d+)$/.exec(result.draft.event_key),day=result.draft.card_data?.report?.general?.day??(buyback?new Date(Number(buyback[1])+10800000).toISOString().slice(0,10):null);
 if(day&&await env.DB.prepare('SELECT 1 FROM buyback_days WHERE day=?').bind(day).first()){await env.DB.prepare("UPDATE manual_requests SET state='needs_review',error='daily_buyback_exists',lease_until=0 WHERE update_id=?").bind(row.update_id).run();return;}
 const circuit=circuitDraft(result.draft);if(circuit)result={...result,draft:await withCircuitArtwork(env,result.draft)};
 if(!circuit&&!env.RENDER_REPORT)throw Error('kap_report_renderer_unavailable');
 if(postText(result.draft).length>1024)throw Error('kap_report_caption_limit');
 const hash=await sha256('kap-report:'+row.update_id),id=[hash.slice(0,8),hash.slice(8,12),'4'+hash.slice(13,16),'8'+hash.slice(17,20),hash.slice(20,32)].join('-'),media=`drafts/${id}/1.png`,time=Math.floor(Date.now()/1000),doc=result.documents[0];
 if(!await env.DB.prepare('SELECT id FROM drafts WHERE id=?').bind(id).first()){
  try{if(circuit)await storeCircuitArtwork(env,media,result.draft);else await renderMedia(env,media,result.draft,env.RENDER_REPORT!);}catch(e){
   if(e instanceof OutputCapacityError){const events=result.draft.card_data?.report?.events,tweet=twitter.parseTweet(postText(result.draft));e.diagnostic={...e.diagnostic,...(events?{events:events.length,tickers:new Set(events.flatMap(e=>e.tickers)).size}:{}),tweet_length:tweet.weightedLength,tweet_limit:280,preference:result.draft.output_preferences?.list??'default_summary'};}
   throw e;
  }
  await env.DB.batch([
   ...(day?[env.DB.prepare("INSERT INTO buyback_days VALUES(?,'kap',?,'legacy')").bind(day,id)]:[]),
   env.DB.prepare('INSERT OR IGNORE INTO sources(id,config,enabled) VALUES(?,?,0)').bind(doc.source_id,JSON.stringify({id:doc.source_id,name:doc.source_name,method:'reference'})),
   env.DB.prepare("INSERT OR IGNORE INTO articles(id,source_id,url,title,summary,published_at,first_seen,status) VALUES(?,?,?,?,?,?,?,'prepared')").bind(id,doc.source_id,doc.url+'-'+row.update_id,doc.title,'',doc.published_at??new Date(time*1000).toISOString(),time),
   env.DB.prepare("INSERT OR IGNORE INTO drafts(id,event_key,fingerprint,content,documents,verification,state,created_at,expires_at,media_key) VALUES(?,?,?,?,?,?,'pending',?,?,?)").bind(id,id,id,JSON.stringify(result.draft),JSON.stringify(result.documents),'verified',time,time+86400,media),
   env.DB.prepare("INSERT OR IGNORE INTO model_jobs(id,article_id,documents,input_hash,created_at,kind,state,result_draft) VALUES(?,?,?,?,?,'manual','complete',?)").bind(id,id,JSON.stringify(result.documents),id,time,id),
   env.DB.prepare("UPDATE manual_requests SET state='model_queued',job_id=?,lease_until=0,error=NULL WHERE update_id=?").bind(id,row.update_id)
  ]);
 }else await env.DB.prepare("UPDATE manual_requests SET state='model_queued',job_id=?,lease_until=0,error=NULL WHERE update_id=?").bind(id,row.update_id).run();
}
