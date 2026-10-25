import twitter from'twitter-text';
import{galleryDraft}from'./gallery-range';import{renderMedia}from'./media-set';import{postText}from'./editorial';import{sha256}from'./utils/text';import type{Env,Document}from'./types';
// Deterministic source-table job; uses the ordinary draft delivery ledger, never a separate sender/model claim.
export async function saveGallery(env:Env,article:{id:string},doc:Document,time:number){
 const existing=await env.DB.prepare('SELECT id,state,result_draft FROM model_jobs WHERE article_id=? AND expected_revision=0').bind(article.id).first<any>();if(existing){if(existing.state==='complete'&&!existing.result_draft)throw Error('gallery_existing_job_conflict');await env.DB.batch([env.DB.prepare("UPDATE articles SET status=?,draft_id=?,lease_until=0 WHERE id=?").bind(existing.state==='complete'?'prepared':'model_queued',existing.result_draft??null,article.id),env.DB.prepare("UPDATE news_cards SET state='model_queued' WHERE article_id=? AND state='requested'").bind(article.id)]);return existing;}
 if(!env.RENDER_REPORT)throw Error('gallery_renderer_unavailable');const draft=galleryDraft(doc);if(twitter.parseTweet(postText(draft)).weightedLength>280)throw Error('gallery_tweet_capacity');
 const h=await sha256('gallery:'+article.id),id=[h.slice(0,8),h.slice(8,12),'4'+h.slice(13,16),'8'+h.slice(17,20),h.slice(20,32)].join('-'),media=`drafts/${id}/1.png`,input=JSON.stringify([doc]);
 await renderMedia(env,media,draft,env.RENDER_REPORT);
 await env.DB.batch([
  env.DB.prepare("INSERT OR IGNORE INTO drafts(id,event_key,fingerprint,content,documents,verification,state,created_at,expires_at,media_key) VALUES(?,?,?,?,?,'single_source','pending',?,?,?)").bind(id,await sha256(draft.event_key),await sha256(draft.headline+'\n'+draft.body),JSON.stringify(draft),input,time,time+86400,media),
  env.DB.prepare("INSERT OR IGNORE INTO model_jobs(id,article_id,documents,input_hash,created_at,kind,state,result_draft) VALUES(?,?,?,?,?,'news','complete',?)").bind('gallery-'+article.id,article.id,'[]',await sha256(input),time,id),
  env.DB.prepare("UPDATE articles SET status='prepared',draft_id=?,document=NULL,document_expires=?,lease_until=0,error=NULL WHERE id=?").bind(id,time,article.id),
  env.DB.prepare("UPDATE news_cards SET state='model_queued' WHERE article_id=? AND state='requested'").bind(article.id)
 ]);return{id,state:'complete',result_draft:id};
}
