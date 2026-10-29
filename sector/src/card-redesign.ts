import {savedLayout,nextLayout,isCardLayout,type CardLayout} from './card-layout';
import {savedTheme,legacyTheme} from './card-theme';
import {renderMedia,revisionMediaKey} from './media-set';
import type {Draft,Env} from './types';
const now=()=>Math.floor(Date.now()/1000);
export async function requestRedesign(env:Env,data:string,messageId:number,updateId:number):Promise<string>{
 const match=/^design:([a-f0-9-]{36}):(\d+)(?::([a-z]+))?$/.exec(data);if(!match)return 'Bu kart kullanılamıyor.';
 const row=await env.DB.prepare("SELECT id,revision,delivery_state,content,expires_at FROM drafts WHERE id=? AND revision=? AND message_id=? AND state='pending'").bind(match[1],Number(match[2]),messageId).first<{id:string;revision:number;delivery_state:string;content:string;expires_at:number}>();
 if(!row||row.delivery_state!=='sent')return 'Kart güncellenmiş veya hazırlanıyor. Güncel karttan tekrar deneyebilirsin.';
 const draft=JSON.parse(row.content) as Draft;if(draft.automated_daily||draft.tweet_style==='owner_ready')return 'Hazır paket sabittir. Değişiklik için yeni paket gönder.';if(draft.template==='circuit'||draft.card_data?.report||draft.card_data?.overview)return 'Bu şablon sabit düzen kullanır.';
 if(match[3]&&!isCardLayout(match[3]))return 'Geçersiz düzen.';
 const busy=await env.DB.prepare("SELECT id FROM model_jobs WHERE draft_id=? AND state IN ('queued','leased','retry_pending') UNION ALL SELECT CAST(update_id AS TEXT) id FROM card_redesigns WHERE draft_id=? AND state IN ('queued','rendering') LIMIT 1").bind(row.id,row.id).first();
 if(busy)return 'Kartın düzenlemesi zaten sırada.';
 const current=await savedLayout(env,'draft:'+row.id)??'editorial',layout=match[3] as CardLayout??nextLayout(current);
 if(layout===current)return 'Bu düzen zaten seçili.';
 await env.DB.prepare('INSERT OR IGNORE INTO card_redesigns(update_id,draft_id,revision,message_id,layout,created_at) VALUES(?,?,?,?,?,?)').bind(updateId,row.id,row.revision,messageId,layout,now()).run();
 return 'Kart başka bir tasarımla yenileniyor. Tweet metni aynı kalacak.';
}
export async function redesignOne(env:Env,render:(svg:string)=>Promise<Uint8Array>):Promise<void>{
 const time=now();
 await env.DB.prepare("UPDATE card_redesigns SET state='queued' WHERE state='rendering' AND lease_until<?").bind(time).run();
 const job=await env.DB.prepare("SELECT * FROM card_redesigns WHERE state='queued' ORDER BY created_at LIMIT 1").first<{update_id:number;draft_id:string;revision:number;message_id:number;layout:CardLayout}>();if(!job)return;
 const lock=await env.DB.prepare("UPDATE card_redesigns SET state='rendering',lease_until=? WHERE update_id=? AND state='queued'").bind(time+120,job.update_id).run();if(!lock.meta.changes)return;
 try{
  const row=await env.DB.prepare("SELECT content,documents,revision FROM drafts WHERE id=? AND revision=? AND message_id=? AND delivery_state='sent' AND state='pending'").bind(job.draft_id,job.revision,job.message_id).first<{content:string;documents:string;revision:number}>();if(!row)throw Error('stale_card');
  const d=JSON.parse(row.content) as Draft;if(d.card_data?.overview)throw Error('fixed_layout');const theme=await savedTheme(env,'draft:'+job.draft_id)??legacyTheme(d.template);
  const revision=row.revision+1,media=await revisionMediaKey(job.draft_id,revision,String(job.update_id));
  await renderMedia(env,media,d,render,theme,job.layout);
  // Keep old media for recovery. Content/evidence never change in a redesign.
  const result=await env.DB.batch([
   env.DB.prepare("UPDATE drafts SET revision=?,media_key=?,delivery_state='waiting',next_delivery=0,expires_at=MAX(expires_at,?) WHERE id=? AND revision=? AND delivery_state='sent' AND state='pending'").bind(revision,media,time+86400,job.draft_id,row.revision),
   env.DB.prepare("INSERT INTO system_state(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM drafts WHERE id=? AND media_key=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind('card_layout:draft:'+job.draft_id,job.layout,job.draft_id,media),
   env.DB.prepare("UPDATE card_redesigns SET state='complete',lease_until=0 WHERE update_id=?").bind(job.update_id)
  ]);
  if(!result[0].meta.changes){await env.MEDIA.delete(media);throw Error('stale_card');}
 }catch(e){await env.DB.prepare("UPDATE card_redesigns SET state='failed',lease_until=0,error=? WHERE update_id=?").bind(e instanceof Error&&/^[a-z_]+$/.test(e.message)?e.message:'render_failed',job.update_id).run();}
}
