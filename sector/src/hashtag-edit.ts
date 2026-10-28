import type {Env,Draft,Document} from './types';
import {validateDraft,postText} from './editorial';import {catalogEntities,matchingCompanies} from './news-company-catalog';import {verifiedEquityCodes} from './equity-codes';
import {publicationState} from './telegram-ui';import {readMedia,storeMedia,revisionMediaKey,bytesHash} from './media-set';
const fold=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/[^a-z0-9]+/g,' ').trim();
export function hashtagOnlyRequest(request:string):string|null {
 const match=/^tweet(?:in)? sonuna\s+#([a-z][a-z0-9]{3,4})\s+ekle\s*[,;.]?\s+görseli değiştirme[.!]?$/iu.exec(request.trim());return match?match[1].toUpperCase():null;
}
/** A single explicit source-backed tag edit; automatic generation limits stay intact. */
export async function tryHashtagOnlyEdit(env:Env,id:string,revision:number,request:string):Promise<boolean>{
 const code=hashtagOnlyRequest(request);if(!code)return false;
 const row=await env.DB.prepare("SELECT content,documents,verification,media_key FROM drafts WHERE id=? AND revision=? AND state='pending' AND delivery_state='sent' AND expires_at>?").bind(id,revision,Math.floor(Date.now()/1000)).first<{content:string;documents:string;verification:string;media_key:string}>();
 if(!row||row.verification==='needs_review')throw Error('stale_edit');
 const publication=await publicationState(env,id);if(publication.published||publication.api)throw Error('publication_locked');
 if(await env.DB.prepare("SELECT 1 FROM model_jobs WHERE draft_id=? AND expected_revision=? AND state IN ('queued','retry_pending','leased') UNION ALL SELECT 1 FROM card_redesigns WHERE draft_id=? AND state IN ('queued','rendering') LIMIT 1").bind(id,revision,id).first())throw Error('edit_in_progress');
 const draft=JSON.parse(row.content) as Draft,docs=JSON.parse(row.documents) as Document[];
 const text=docs.map(d=>d.title+'\n'+d.body).join('\n');const known=new Set([...verifiedEquityCodes(docs),...matchingCompanies(fold(text),catalogEntities,fold).map(c=>c.code)]);
 // This source uses the distinctive legal-title prefix, not the full corporate suffix.
 // Keep this explicit alias local to the owner edit; do not infer unrelated tickers.
 const selecName='selcuk ecza deposu';
 if(code==='SELEC'&&(' '+fold(text)+' ').includes(' '+selecName+' ')&&catalogEntities.some(c=>c.code==='SELEC'&&fold(c.name).startsWith(selecName+' ')))known.add('SELEC');
 if(!known.has(code))throw Error('unsupported_editor_hashtag');
 const tag='#'+code;
 const without=draft.hashtags.filter(t=>t.toUpperCase()!==tag);
 validateDraft(draft.hashtags.length===4&&without.length===3?{...draft,hashtags:without}:draft,docs);
 const updated={...draft,hashtags:[...without,tag]};
 if(postText(updated).length>1024)throw Error('telegram_caption_too_long');
 // The only exception to the automatic tag count is this exact authenticated edit.
 // All source/numeric/claim checks run on the unchanged factual draft.
 if(updated.hashtags.filter(t=>t===tag).length!==1||!postText(updated).endsWith(tag)||postText(updated).split(tag).length!==2)throw Error('editor_hashtag_not_applied');
 if(JSON.stringify(updated)===row.content)return true;
 const media=await readMedia(env,row.media_key,row.content),before=await Promise.all(media.images.map(bytesHash));
 const key=await revisionMediaKey(id,revision+1,'owner-tag:'+revision+':'+code);await storeMedia(env,key,updated,media.images);
 const copied=await readMedia(env,key,JSON.stringify(updated));if(JSON.stringify(before)!==JSON.stringify(await Promise.all(copied.images.map(bytesHash))))throw Error('editor_image_changed');
 const changed=await env.DB.prepare("UPDATE drafts SET content=?,revision=revision+1,media_key=?,message_id=NULL,delivery_state='waiting' WHERE id=? AND revision=? AND media_key=? AND content=? AND state='pending' AND delivery_state='sent' AND expires_at>? AND NOT EXISTS(SELECT 1 FROM x_posts WHERE draft_id=? AND state IN ('queued','uploading','posting','sent','uncertain')) AND NOT EXISTS(SELECT 1 FROM publication_marks WHERE draft_id=? AND state='published') AND NOT EXISTS(SELECT 1 FROM model_jobs WHERE draft_id=? AND expected_revision=? AND state IN ('queued','retry_pending','leased')) AND NOT EXISTS(SELECT 1 FROM card_redesigns WHERE draft_id=? AND state IN ('queued','rendering'))").bind(JSON.stringify(updated),key,id,revision,row.media_key,row.content,Math.floor(Date.now()/1000),id,id,id,revision,id).run();
 if(!changed.meta.changes)throw Error('stale_edit');return true;
}
