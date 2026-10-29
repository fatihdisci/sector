import {refreshDraftMenu} from './card-menu';
import {preparePublication,snapshotStatement} from './publication-snapshot';
import {publicationAdvice,dailyAdvice,cadence,publicationPlan} from './publication-policy';
export {cadence} from './publication-policy';
import type {Env} from './types';
import {telegram} from './telegram';
import {postText} from './editorial';
export const publicationSQL=`SELECT draft_id,MIN(finished_at) published_at,'api' method FROM x_posts WHERE state='sent' GROUP BY draft_id UNION ALL SELECT draft_id,published_at,'manual' method FROM publication_marks m WHERE state='published' AND NOT EXISTS(SELECT 1 FROM x_posts x WHERE x.draft_id=m.draft_id AND x.state='sent')`;
export async function publicationSummary(env:Env,now=Date.now()){
 const day=new Date(now+10800000).toISOString().slice(0,10),start=Date.parse(day+'T00:00:00+03:00');
 const all=(await env.DB.prepare(publicationSQL).all<{draft_id:string;published_at:number;method:string}>()).results;
 const today=all.filter(r=>r.published_at>=start&&r.published_at<start+86400000);const last=all.length?Math.max(...all.map(r=>r.published_at)):null;
 const reserved=(await env.DB.prepare("SELECT COUNT(*) n FROM x_posts WHERE day=? AND state IN ('queued','uploading','posting','sent','uncertain')").bind(day).first<{n:number}>())?.n??0;
 const api=today.filter(r=>r.method==='api').length;return {day,reserved,total:today.length,manual:today.length-api,api,last,note:publicationAdvice(last,today.length,now)};
}
export async function refreshPublicationCard(env:Env,id:string){await refreshDraftMenu(env,id);}
export async function publicationAction(env:Env,action:string,id:string,update:number,messageId?:number,now=Date.now()){
 const row=await env.DB.prepare("SELECT message_id,delivery_state FROM drafts WHERE id=?").bind(id).first<{message_id:number;delivery_state:string}>();
 if(!row||row.delivery_state!=='sent'||messageId!==undefined&&row.message_id!==messageId)return 'Güncel içerik kartını kullan.';
 if(!['mark','undo','defer','time','stats'].includes(action))return 'Geçersiz işlem.';
 if(action==='time'){
  const p=await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:'Manuel yayın zamanını bu mesaja yanıtla: YYYY-MM-DD HH:MM veya yalnız HH:MM (bugün). İstanbul saati.',reply_markup:JSON.stringify({force_reply:true,selective:true})}));
  await env.DB.prepare('INSERT OR REPLACE INTO publication_time_edits VALUES(?,?,?,?)').bind(env.TELEGRAM_USER_ID!,id,Number(p.message_id),now+900000).run();return 'Yayın saatini yanıt olarak yaz.';
 }
 const before=await publicationSummary(env,now);
 if(action!=='stats'){
  if(action==='defer'&&await env.DB.prepare("SELECT 1 FROM publication_marks WHERE draft_id=? AND state='published'").bind(id).first())return 'Yayımlanmış içerik ertelenemez. Hatalı işaret için geri al düğmesini kullan.';
  const existing=await env.DB.prepare("SELECT 1 FROM x_posts WHERE draft_id=? AND state IN ('queued','uploading','posting','sent','uncertain')").bind(id).first();
  if(existing)return 'API yayını mevcut veya sonucu bekleniyor. Manuel işaret değişmedi.';
  const prior=await env.DB.prepare("SELECT published_at FROM publication_marks WHERE draft_id=? AND state='published'").bind(id).first<{published_at:number}>();
  const snapshot=action==='mark'?await preparePublication(env,id):null;
  await env.DB.batch([
   env.DB.prepare(`INSERT INTO publication_marks(draft_id,state,published_at,updated_at) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM publication_actions WHERE update_id=?) AND NOT EXISTS(SELECT 1 FROM x_posts WHERE draft_id=? AND state IN ('queued','uploading','posting','sent','uncertain')) ON CONFLICT(draft_id) DO UPDATE SET state=excluded.state,published_at=CASE WHEN publication_marks.state='published' AND excluded.state='published' THEN publication_marks.published_at ELSE excluded.published_at END,updated_at=excluded.updated_at WHERE NOT (publication_marks.state='published' AND excluded.state='deferred')`).bind(id,action==='mark'?'published':action==='defer'?'deferred':'ready',action==='mark'?now:null,now,update,id),
   env.DB.prepare('INSERT OR IGNORE INTO publication_actions VALUES(?,?)').bind(update,now),
   ...(snapshot?[snapshotStatement(env,id,'manual',prior?.published_at??now,snapshot)]:[])
  ]);
 }
 await refreshPublicationCard(env,id);
 const s=await publicationSummary(env,now);return `${action==='mark'?'✅ ':action==='undo'?'↩️ ':action==='defer'?'⏸ ':''}${s.total} yayın (${s.manual} elle/${s.api} API), ${s.reserved} X işlemi. Son ${s.last?new Date(s.last).toLocaleTimeString('tr-TR',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit'}):'—'}. ${cadence(action==='mark'?before.last:s.last,now)} ${dailyAdvice(s.total,now)}`;
}
export async function publicationMessage(env:Env,m:any,update:number){
 const link=/^\/yayinurl ([a-f0-9-]{36}) (https:\/\/x\.com\/endeks_haber\/status\/\d+)$/i.exec(m.text??'');
 if(link){const row=await env.DB.prepare("SELECT id FROM publication_snapshots WHERE draft_id=? AND method='manual' ORDER BY published_at DESC LIMIT 1").bind(link[1]).first<{id:string}>();if(row)await env.DB.prepare('UPDATE publication_snapshots SET remote_url=? WHERE id=?').bind(link[2],row.id).run();await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:row?'X bağlantısı kullanıcı beyanı olarak kaydedildi. API teyidi değildir.':'Önce içeriği paylaşıldı işaretle.'}));return true;}

 if(m.text==='/yayinplani'||m.text==='/yayınplanı'){await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:publicationPlan}));return true;}
 if(m.text==='/yayinraporu'||m.text==='/yayınraporu'){
  const {publicationCsv}=await import('./publication-report');const form=new FormData();form.set('chat_id',env.TELEGRAM_CHAT_ID!);
  form.set('document',new Blob([await publicationCsv(env)],{type:'text/csv;charset=utf-8'}),'endeks-yayin-raporu.csv');
  form.set('caption','Son 28 günün kayıtlı yayınları. Manuel X bağlantısı ve performans alanları bilinmiyorsa boş; sıfır değildir. Başlık/kategori/şablon yayın anındaki kaydı yansıtır; eski kaydın anlık görüntüsü yoksa alan boş bırakılır. Gerçek yayın verisiyle eşleştir; acil/rutin ve deney grubunu elle belirt.');
  await telegram(env,'sendDocument',form);return true;
 }

 if(m.text==='/yayinlar'||m.text==='/yayınlar'){const s=await publicationSummary(env);await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:`Bugün ${s.total} paylaşım: ${s.manual} manuel / ${s.api} API. ${s.reserved} X işlemi; uygulamada günlük sınır yok. Son yayın: ${s.last?new Date(s.last).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}):'—'}. ${s.note}`}));return true;}
 const start=m.text?.match(/^\/start pub_(mark|undo|defer|time|stats)_([a-f0-9-]{36})$/);
 if(start){const text=await publicationAction(env,start[1],start[2],update);await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text}));return true;}
 const edit=await env.DB.prepare('SELECT * FROM publication_time_edits WHERE user_id=? AND expires_at>? AND prompt_message_id=?').bind(env.TELEGRAM_USER_ID!,Date.now(),m.reply_to_message?.message_id??0).first<any>();if(!edit)return false;
 const v=m.text?.trim().match(/^(?:(\d{4}-\d{2}-\d{2}) )?(\d{2}):(\d{2})$/);const date=v?.[1]??new Date(Date.now()+10800000).toISOString().slice(0,10);const at=v?Date.parse(`${date}T${v[2]}:${v[3]}:00+03:00`):NaN;
 let text='Geçerli, gelecekte olmayan bir İstanbul tarihi ve saati yaz.';
 if(Number.isFinite(at)&&at<=Date.now()&&new Date(at+10800000).toISOString().slice(0,10)===date){
  const previous=await env.DB.prepare("SELECT published_at FROM publication_marks WHERE draft_id=? AND state='published'").bind(edit.draft_id).first<{published_at:number}>();
  const result=await env.DB.batch([env.DB.prepare("UPDATE publication_marks SET published_at=?,updated_at=? WHERE draft_id=? AND state='published' AND NOT EXISTS(SELECT 1 FROM x_posts WHERE draft_id=? AND state='sent')").bind(at,Date.now(),edit.draft_id,edit.draft_id),env.DB.prepare("UPDATE publication_snapshots SET published_at=? WHERE draft_id=? AND method='manual' AND published_at=? AND EXISTS(SELECT 1 FROM publication_marks WHERE draft_id=? AND published_at=?)").bind(at,edit.draft_id,previous?.published_at??-1,edit.draft_id,at)]);const r=result[0];text=r.meta.changes?'Manuel yayın saati güncellendi.':'Önce manuel paylaşıldı işaretle. API yayın saati değiştirilemez.';

 }
 await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text}));if(Number.isFinite(at)&&at<=Date.now()&&new Date(at+10800000).toISOString().slice(0,10)===date)await env.DB.prepare('DELETE FROM publication_time_edits WHERE user_id=?').bind(env.TELEGRAM_USER_ID!).run();return true;
}
