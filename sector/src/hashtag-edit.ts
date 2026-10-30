import {draftCards} from './card-pages';
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
 if(updated.hashtags.filter(t=>t===tag).length!==1||!postText(updated).replace(/\n\n-[^\n]+$/u,'').endsWith(tag.toLowerCase())||postText(updated).split(tag.toLowerCase()).length!==2)throw Error('editor_hashtag_not_applied');
 if(JSON.stringify(updated)===row.content)return true;
 const media=await readMedia(env,row.media_key,row.content),before=await Promise.all(media.images.map(bytesHash));
 const key=await revisionMediaKey(id,revision+1,'owner-tag:'+revision+':'+code);await storeMedia(env,key,updated,media.images);
 const copied=await readMedia(env,key,JSON.stringify(updated));if(JSON.stringify(before)!==JSON.stringify(await Promise.all(copied.images.map(bytesHash))))throw Error('editor_image_changed');
 const changed=await env.DB.prepare("UPDATE drafts SET content=?,revision=revision+1,media_key=?,message_id=NULL,delivery_state='waiting' WHERE id=? AND revision=? AND media_key=? AND content=? AND state='pending' AND delivery_state='sent' AND expires_at>? AND NOT EXISTS(SELECT 1 FROM x_posts WHERE draft_id=? AND state IN ('queued','uploading','posting','sent','uncertain')) AND NOT EXISTS(SELECT 1 FROM publication_marks WHERE draft_id=? AND state='published') AND NOT EXISTS(SELECT 1 FROM model_jobs WHERE draft_id=? AND expected_revision=? AND state IN ('queued','retry_pending','leased')) AND NOT EXISTS(SELECT 1 FROM card_redesigns WHERE draft_id=? AND state IN ('queued','rendering'))").bind(JSON.stringify(updated),key,id,revision,row.media_key,row.content,Math.floor(Date.now()/1000),id,id,id,revision,id).run();
 if(!changed.meta.changes)throw Error('stale_edit');return true;
}

import {renderMedia} from './media-set';import {savedTheme,legacyTheme} from './card-theme';import {savedLayout} from './card-layout';
import {telegram} from './telegram';import {newsFailureNote} from './news-progress';
export function periodOnlyRequest(request:string):boolean {
 const r=request.trim().toLocaleLowerCase('tr-TR');
 return /^başlığı (?:gün sonu|gün ortası|kapanışa doğru) yap[.!]?$/u.test(r)||/^(?:görselin ve tweetin başlığını|görseli ve tweeti|tweet(?:in)? başlığını|görsel(?:in)? başlığını) (?:gün sonu|gün ortası|kapanışa doğru|açılışın ilk dakikaları) olarak değiştir(?:[,;.]? kapanışa doğru olmasın| bir seferlik bir istek bu)?[.!]?$/u.test(r)||/^(?:gün sonu|gün ortası|kapanışa doğru) yaz tweette ve görsele[.!]?$/u.test(r);
}
export async function tryPeriodOnlyEdit(env:Env,id:string,revision:number,request:string):Promise<boolean>{
 if(!periodOnlyRequest(request))return false;
 const row=await env.DB.prepare("SELECT content,documents,verification,media_key FROM drafts WHERE id=? AND revision=? AND state='pending' AND delivery_state='sent' AND expires_at>?").bind(id,revision,Math.floor(Date.now()/1000)).first<{content:string;documents:string;verification:string;media_key:string}>();
 if(!row||row.verification==='needs_review')throw Error('stale_edit');
 const state=await publicationState(env,id);if(state.published||state.api)throw Error('publication_locked');
 const old=JSON.parse(row.content) as Draft,docs=JSON.parse(row.documents) as Document[];
 if(!docs.some(d=>d.market_data)&&!old.card_data?.overview)return false;
 const label=(['Gün sonu','Gün ortası','Kapanışa doğru','Açılışın ilk dakikaları'] as const).find(p=>request.toLocaleLowerCase('tr-TR').includes(p.toLocaleLowerCase('tr-TR')))!;
 const folded=request.toLocaleLowerCase('tr-TR'),textTarget=/tweet|metin/u.test(folded),cardTarget=/görsel|kart/u.test(folded),changeText=!cardTarget||textTarget,changeCard=!textTarget||cardTarget;
 const heading=(s:string)=>{const emoji=/^(?:\p{Extended_Pictographic}\uFE0F?\s*)+/u.exec(s)?.[0]??'';const rest=s.slice(emoji.length).replace(/^(?:Gün sonu|Gün ortası|Kapanışa doğru|Açılışın ilk dakikaları|Piyasa özeti)\s*(?:[—–:-]\s*|$)/iu,'').trim();return emoji+label+(rest?' — '+rest:'');};
 const updated={...old,headline:changeText?heading(old.headline):old.headline,card_headline:changeCard?(old.card_data?.overview?label:heading(old.card_headline)):old.card_headline};
 // Validate unchanged factual content; the strict owner parser authorizes only an editorial label, never a measurement timestamp.
 validateDraft(old,docs);if(postText(updated).length>1024)throw Error('telegram_caption_too_long');
 if(updated.headline===old.headline&&updated.card_headline===old.card_headline)return true;
 const busy=await env.DB.prepare("SELECT 1 FROM model_jobs WHERE draft_id=? AND expected_revision=? AND state IN ('queued','retry_pending','leased') UNION ALL SELECT 1 FROM card_redesigns WHERE draft_id=? AND state IN ('queued','rendering') LIMIT 1").bind(id,revision,id).first();if(busy)throw Error('edit_in_progress');
 const key=await revisionMediaKey(id,revision+1,'owner-period:'+revision+':'+request);
 if(updated.card_headline!==old.card_headline){
  if(!env.RENDER_REPORT)throw Error('renderer_unavailable');
  const theme=await savedTheme(env,'draft:'+id)??legacyTheme(old.template),layout=await savedLayout(env,'draft:'+id)??'editorial';
  if(updated.card_data?.overview){const images=[];for(const svg of draftCards({...updated,headline:updated.card_headline},theme,layout))images.push(await env.RENDER_REPORT(svg));await storeMedia(env,key,updated,images);}
  else await renderMedia(env,key,updated,env.RENDER_REPORT,theme,layout);
 }else await storeMedia(env,key,updated,(await readMedia(env,row.media_key,row.content)).images);
 const changed=await env.DB.prepare("UPDATE drafts SET content=?,revision=revision+1,media_key=?,message_id=NULL,delivery_state='waiting',next_delivery=0 WHERE id=? AND revision=? AND media_key=? AND content=? AND state='pending' AND delivery_state='sent' AND expires_at>? AND NOT EXISTS(SELECT 1 FROM x_posts WHERE draft_id=? AND state IN ('queued','uploading','posting','sent','uncertain')) AND NOT EXISTS(SELECT 1 FROM publication_marks WHERE draft_id=? AND state='published') AND NOT EXISTS(SELECT 1 FROM model_jobs WHERE draft_id=? AND expected_revision=? AND state IN ('queued','retry_pending','leased')) AND NOT EXISTS(SELECT 1 FROM card_redesigns WHERE draft_id=? AND state IN ('queued','rendering'))").bind(JSON.stringify(updated),key,id,revision,row.media_key,row.content,Math.floor(Date.now()/1000),id,id,id,revision,id).run();
 if(!changed.meta.changes)throw Error('stale_edit');return true;
}
/** Only jobs enrolled at request creation are notified: historical failures are untouched. */
export async function notifyEditFailures(env:Env):Promise<void>{
 if(!env.TELEGRAM_USER_ID||!env.TELEGRAM_CHAT_ID)return;
 const rows=await env.DB.prepare("SELECT s.key,s.value,j.error,j.draft_id,j.expected_revision FROM system_state s JOIN model_jobs j ON s.key='edit_notice:'||j.id WHERE j.kind='edit' AND j.state IN ('needs_review','expired','failed') AND json_extract(s.value,'$.state')='pending' ORDER BY j.created_at LIMIT 10").all<{key:string;value:string;error:string;draft_id:string;expected_revision:number}>();
 for(const row of rows.results??[]){
  const n=JSON.parse(row.value);if(n.owner!==env.TELEGRAM_USER_ID||n.chat!==env.TELEGRAM_CHAT_ID)continue;
  const sending=JSON.stringify({...n,state:'sending'});const claim=await env.DB.prepare('UPDATE system_state SET value=? WHERE key=? AND value=?').bind(sending,row.key,row.value).run();if(!claim.meta.changes)continue;
  try{await telegram(env,'sendMessage',new URLSearchParams({chat_id:n.chat,text:'Düzenleme tamamlanamadı. '+newsFailureNote({job_error:row.error} as any)+' Mevcut taslak korunuyor.'}));await env.DB.prepare('UPDATE system_state SET value=? WHERE key=? AND value=?').bind(JSON.stringify({...n,state:'sent'}),row.key,sending).run();}
  catch{await env.DB.prepare('UPDATE system_state SET value=? WHERE key=? AND value=?').bind(JSON.stringify({...n,state:'uncertain'}),row.key,sending).run();}
 }
}
