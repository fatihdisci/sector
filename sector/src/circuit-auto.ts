import {indexCircuitSummary} from './kap/reports';
import {withCircuitArtwork,storeCircuitArtwork} from './circuit-artwork';
import {equitySessionLabel}from'./market-session';import {istanbulDay}from'./kap/reports';import {sha256}from'./utils/text';import {renderMedia,revisionMediaKey}from'./media-set';import type{Env,Draft}from'./types';
export const CIRCUIT_POLL_MS=120_000;
/** Existing scheduler port; KAP_REPORT reconstructs ALL market notices, independently of push filters. */
export async function pollCircuitAuto(env:Env,at=Date.now()){
 if(env.CIRCUIT_AUTO_ENABLED!=='true')return{state:'disabled'};
 const session=equitySessionLabel(new Date(at).toISOString());if(!session.label)return{state:'closed',reason:session.reason};
 if(!env.KAP_REPORT||!env.CIRCUIT_GENERAL_IMAGE)return{state:'not_ready'};
 const due=await env.DB.prepare("INSERT INTO system_state(key,value) VALUES('circuit_auto_next',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(system_state.value AS INTEGER)<=?").bind(String(at+CIRCUIT_POLL_MS),at).run();if(!due.meta.changes){const next=await env.DB.prepare("SELECT value FROM system_state WHERE key='circuit_auto_next'").first<{value:string}>();return{state:'waiting',next_at:Number(next?.value)};}
 const day=istanbulDay(at),key='circuit_batch_seen:'+day,raw=await env.KAP_REPORT('circuit',at),all=raw.draft.card_data?.report?.events;
 if(!Array.isArray(all)||all.some(e=>!Number.isSafeInteger(e.id)||e.id<=0||istanbulDay(Date.parse(e.published_at))!==day||Date.parse(e.published_at)>at)||new Set(all.map(e=>e.id)).size!==all.length)throw Error('circuit_auto_event_invalid');
 const summary=indexCircuitSummary(raw,at),eligible=summary.draft.card_data!.report!.events!;
 const previous=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{value:string}>(),saved=previous?JSON.parse(previous.value):null;
 const ids=all.map(e=>e.id).sort((a,b)=>a-b),record=JSON.stringify({ids,at});
 if(!saved){await env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) VALUES(?,?)').bind(key,record).run();return{state:'scope_baseline',day,events:ids.length};}
 if(!Array.isArray(saved.ids)||!Number.isSafeInteger(saved.at)||saved.at>at||saved.ids.some((id:number)=>!ids.includes(id)))throw Error('circuit_auto_source_regressed');
 const fresh=eligible.filter(e=>!saved.ids.includes(e.id)&&Date.parse(e.published_at)>=Math.max(saved.at,at-CIRCUIT_POLL_MS-30000));
 if(!fresh.length){await env.DB.prepare('UPDATE system_state SET value=? WHERE key=? AND value=?').bind(record,key,previous!.value).run();return{state:ids.length?'unchanged':'empty',day,events:0};}
 const members=summary.draft.card_data!.report!.circuit!.indices.snapshot!,codes=[...new Set(fresh.flatMap(e=>e.tickers))].sort((a,b)=>Number(!members.bist30.includes(a))-Number(!members.bist30.includes(b))||(a<b?-1:a>b?1:0));
 const title=codes.map(c=>'#'+c).join(' '),body='Devre kesici uygulandı. '+(codes.length===1?'Sürekli işlemlere ara verildi.':codes.length===2?'İki hissede de sürekli işlemlere ara verildi.':`Bu ${codes.length} hissede de sürekli işlemlere ara verildi.`),text=title+'\n\n'+body+'\n\n#Borsa #BIST #BIST100';
 if(text.length>1024)throw Error('circuit_batch_caption_capacity');
 const {selectCircuitReport}=await import('./circuit-selection'),selection=selectCircuitReport(fresh,members,at,10000,true);
 const eventKey='circuit-batch:'+day+':'+fresh.map(e=>e.id).sort((a,b)=>a-b).join(','),hash=await sha256(eventKey),id=hash.slice(0,8)+'-'+hash.slice(8,12)+'-'+hash.slice(12,16)+'-'+hash.slice(16,20)+'-'+hash.slice(20,32);
 const sourceUrls=fresh.map(e=>'https://www.kap.org.tr/tr/Bildirim/'+e.id),evidence=fresh.map(e=>`${e.id}: ${e.tickers.join(', ')}; ${e.published_at}`).join('\n');
 const documents=[{...summary.documents[0],title:'BIST 30/100 yeni devre kesici bildirimleri',body:evidence,primary_urls:sourceUrls,passages:[{id:'circuit_batch',text:evidence}]}];
 const draft:Draft=await withCircuitArtwork(env,{...summary.draft,automated_daily:'circuit',tweet_style:'circuit_batch',event_key:eventKey,headline:title,body:text,hashtags:[],entities:codes,claims:[{text:body,evidence:[{document:0,passage:'circuit_batch',quote:evidence}]}],card_data:{report:{events:fresh,circuit:selection.selection,rows:selection.rows,footer:''}}});
 const content=JSON.stringify(draft),media=await revisionMediaKey(id,1,await sha256(content));await storeCircuitArtwork(env,media,draft);
 const time=Math.floor(at/1000),changed=await env.DB.batch([
  env.DB.prepare("INSERT OR IGNORE INTO drafts(id,event_key,fingerprint,content,documents,verification,state,created_at,expires_at,media_key) SELECT ?,?,?,?,?,'official_attributed','pending',?,?,? WHERE EXISTS(SELECT 1 FROM system_state WHERE key=? AND value=?)").bind(id,eventKey,hash,content,JSON.stringify(documents),time,Date.parse(day+'T23:59:59+03:00')/1000,media,key,previous!.value),
  env.DB.prepare('UPDATE system_state SET value=? WHERE key=? AND value=? AND EXISTS(SELECT 1 FROM drafts WHERE id=? AND content=?)').bind(record,key,previous!.value,id,content)
 ]);
 if(!changed[0].meta.changes)return{state:'changed_concurrently',day};
 return{state:'updated',day,id,revision:1,events:fresh.length};
}

export function circuitPollDelay(result:{state:string;next_at?:number},started:number,now:number){const next=result.state==='not_ready'?now+2000:Number.isFinite(result.next_at)?result.next_at!:started+CIRCUIT_POLL_MS;return Math.max(250,Math.min(CIRCUIT_POLL_MS,next-now));}
