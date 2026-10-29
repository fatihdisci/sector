import {withCircuitArtwork,storeCircuitArtwork} from './circuit-artwork';
import {equitySessionLabel}from'./market-session';import {istanbulDay}from'./kap/reports';import {sha256}from'./utils/text';import {renderMedia,revisionMediaKey}from'./media-set';import {publicationState}from'./telegram-ui';import type{Env,Draft}from'./types';
export const CIRCUIT_POLL_MS=120_000;
/** Existing scheduler port; KAP_REPORT reconstructs ALL market notices, independently of push filters. */
export async function pollCircuitAuto(env:Env,at=Date.now()){
 if(env.CIRCUIT_AUTO_ENABLED!=='true')return{state:'disabled'};
 const session=equitySessionLabel(new Date(at).toISOString());if(!session.label)return{state:'closed',reason:session.reason};
 if(!env.KAP_REPORT||!env.CIRCUIT_GENERAL_IMAGE)return{state:'not_ready'};
 const due=await env.DB.prepare("INSERT INTO system_state(key,value) VALUES('circuit_auto_next',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(system_state.value AS INTEGER)<=?").bind(String(at+CIRCUIT_POLL_MS),at).run();if(!due.meta.changes){const next=await env.DB.prepare("SELECT value FROM system_state WHERE key='circuit_auto_next'").first<{value:string}>();return{state:'waiting',next_at:Number(next?.value)};}
 const day=istanbulDay(at),key='circuit_auto:'+day;
 const summary=await env.KAP_REPORT('circuit',at),events=summary.draft.card_data?.report?.events;
 if(!Array.isArray(events))throw Error('circuit_auto_evidence_missing');
 if(events.some(e=>!Number.isSafeInteger(e.id)||e.id<=0||istanbulDay(Date.parse(e.published_at))!==day||Date.parse(e.published_at)>at)||new Set(events.map(e=>e.id)).size!==events.length)throw Error('circuit_auto_event_invalid');
 await env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('circuit_auto_observed:'+day,JSON.stringify(events)).run();
 const ids=events.map(e=>e.id).sort((a,b)=>a-b);if(!ids.length)return{state:'empty',day};
 const previous=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{value:string}>();const saved=previous?JSON.parse(previous.value):null;
 if(saved&&ids.every(id=>saved.ids.includes(id)))return{state:'unchanged',day,events:ids.length};
 if(saved&&saved.ids.some((id:number)=>!ids.includes(id)))throw Error('circuit_auto_source_regressed');
 const hash=await sha256('circuit-auto:'+day),id=hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20,32);
 const old=await env.DB.prepare('SELECT * FROM drafts WHERE id=?').bind(id).first<any>();
 if(old&&old.event_key!=='circuit-auto:'+day)return{state:'id_conflict',day};
 if(old){const p=await publicationState(env,id);if(p.published||p.api)return{state:'publication_locked',day,events:ids.length};if(old.state!=='pending'||!['sent','waiting'].includes(old.delivery_state))return{state:'delivery_locked',day,events:ids.length};const busy=await env.DB.prepare("SELECT 1 FROM model_jobs WHERE draft_id=? AND state IN ('queued','leased','retry_pending') UNION ALL SELECT 1 FROM card_redesigns WHERE draft_id=? AND state IN ('queued','rendering') LIMIT 1").bind(id,id).first();if(busy)return{state:'editing',day};}
 const revision=(old?.revision??0)+1,draft:Draft=await withCircuitArtwork(env,{...summary.draft,automated_daily:'circuit',event_key:'circuit-auto:'+day}),content=JSON.stringify(draft),media=await revisionMediaKey(id,revision,await sha256(content));
 await storeCircuitArtwork(env,media,draft);
 const time=Math.floor(at/1000),record=JSON.stringify({id,ids,revision,updated_at:at});
 const update=old?env.DB.prepare("UPDATE drafts SET content=?,documents=?,media_key=?,revision=?,delivery_state='waiting',next_delivery=0,lease_until=0 WHERE id=? AND revision=? AND state='pending' AND delivery_state IN ('waiting','sent') AND NOT EXISTS(SELECT 1 FROM x_posts WHERE draft_id=? AND state IN ('queued','uploading','posting','sent','uncertain'))").bind(content,JSON.stringify(summary.documents),media,revision,id,old.revision,id):env.DB.prepare("INSERT OR IGNORE INTO drafts(id,event_key,fingerprint,content,documents,verification,state,created_at,expires_at,media_key) VALUES(?,?,?,?,?,'official_attributed','pending',?,?,?)").bind(id,draft.event_key,hash,content,JSON.stringify(summary.documents),time,Date.parse(day+'T23:59:59+03:00')/1000,media);
 const changed=await env.DB.batch([update,env.DB.prepare('INSERT INTO system_state(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM drafts WHERE id=? AND revision=? AND content=?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,record,id,revision,content),env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM drafts WHERE id=? AND revision=? AND content=?)').bind('draft_text_control:'+id,'1',id,revision,content)]);
 if(!changed[0].meta.changes)return{state:'changed_concurrently',day};
 return{state:'updated',day,id,revision,events:ids.length};
}

export function circuitPollDelay(result:{state:string;next_at?:number},started:number,now:number){const next=result.state==='not_ready'?now+2000:Number.isFinite(result.next_at)?result.next_at!:started+CIRCUIT_POLL_MS;return Math.max(250,Math.min(CIRCUIT_POLL_MS,next-now));}
