import anchor from './data/news-schedule-anchor.json';
import{canonical,type ReviewArtifact}from'./news-owner-review';import{sha256}from'./utils/text';
import{HOURLY_SELECTION_SCHEDULE}from'./news-selection-schedule';
import type{MaintenanceSuccessor,MaintenanceLink}from'./news-maintenance-chain';
type Input={record:any;artifact:ReviewArtifact|null;binding:any;owner:string;rule:string;catalog:string;entities:string;scope:string;review_scope:string;times:string[];watchlist:string[];activated_at:number;schedule_since?:number;enabled:boolean;now:number};
export async function validateScheduleReview(i:Input,trusted=anchor){
 const r=i.record,reasons:string[]=[];const reject=(s:string)=>reasons.push(s);
 if(!r)return {valid:false,reasons:['Saat geçiş kaydı yok.'],parent_artifact:trusted.parent_artifact,parent_scope:trusted.parent_scope,parent_review_scope:trusted.parent_review_scope};
 for(const [k,v]of Object.entries({version:1,approval_source:trusted.approval_source,accepted_recorded_at:trusted.accepted_recorded_at,rule_version:i.rule,catalog_version:i.catalog,entity_hash:i.entities,scope_hash:i.scope,review_scope_hash:i.review_scope,activated_at:i.activated_at,timezone:'Europe/Istanbul'}))if(r[k]!==v||r[k]!==trusted[k as keyof typeof trusted])reject('Saat geçiş kapsam/onay uyuşmazlığı: '+k);
 if(!i.owner||r.actor!==i.owner||!Number.isSafeInteger(r.applied_at)||r.applied_at<trusted.accepted_recorded_at||r.applied_at>i.now||r.applied_at!==i.schedule_since)reject('Saat geçiş sahibi/zamanı geçersiz.');
 if(!i.enabled||canonical(i.times)!==canonical(trusted.times)||canonical(i.watchlist)!==canonical(trusted.watchlist)||canonical(r.times)!==canonical(trusted.times))reject('Onaysız saat veya takip değişikliği.');
 if(await sha256(canonical(i.binding))!==trusted.parent_binding_hash)reject('Saat geçiş üst onay zinciri uyuşmuyor.');
 const a=i.artifact;
 if(!a||a.hash!==r.artifact_hash||await sha256(canonical({files:a.files,catalog_hash:a.catalog_hash}))!==a.hash||canonical(a.files)!==canonical(trusted.runtime_files)||a.catalog_hash!==trusted.parent_artifact.catalog_hash)reject('Saat geçiş çalışan kaynak hash uyuşmazlığı.');
 return {valid:!reasons.length,reasons,parent_artifact:trusted.parent_artifact,parent_scope:trusted.parent_scope,parent_review_scope:trusted.parent_review_scope};
}

/** A schedule successor is usable only when its exact artifact is in the already validated owner-approved maintenance chain. */
export async function validateSelectionScheduleSuccessor(input:{record:any;parent:any;chain:MaintenanceSuccessor|null;runtimeArtifact:ReviewArtifact|null;owner:string;chat:string;now:number}){
 const empty={valid:false,applied:false,reasons:['Saatlik seçki için onaylı geçiş yok.'],times:null as string[]|null,selection_since:null as number|null};
 const r=input.record;if(!r)return empty;
 const links:MaintenanceLink[]=[...(input.chain?.parents??[]),...(input.chain?[{artifact:input.runtimeArtifact!,candidate_raw:input.chain.candidate_raw,request:input.chain.request,event:input.chain.event}]:[])];
 const link=links.find(v=>v.artifact?.hash===r.artifact_hash);if(!link)return {...empty,reasons:['Saatlik seçki adayı onay zincirinde bulunamadı.']};
 let c:any;try{c=JSON.parse(link.candidate_raw);}catch{return {...empty,reasons:['Saatlik seçki adayı okunamadı.']};}
 const q=link.request,e=link.event,reasons:string[]=[];
 const reject=(reason:string)=>reasons.push(reason);
 if(JSON.stringify(c.selection_schedule)!==JSON.stringify(HOURLY_SELECTION_SCHEDULE)||JSON.stringify(r.times)!==JSON.stringify(HOURLY_SELECTION_SCHEDULE.times)||r.timezone!==HOURLY_SELECTION_SCHEDULE.timezone||JSON.stringify(r.quiet_hours)!==JSON.stringify(HOURLY_SELECTION_SCHEDULE.quiet_hours))reject('Saatlik seçki kuralı adayla uyuşmuyor.');
 if(!input.parent||r.parent_schedule_hash!==await sha256(canonical(input.parent)))reject('Saatlik seçki önceki sahip onayına bağlı değil.');
 if(r.approval_source!=='maintenance_owner_callback'||!input.owner||r.actor!==input.owner||r.chat!==input.chat||!Number.isSafeInteger(r.message)||r.message<=0||!r.nonce)reject('Saatlik seçki sahibi veya mesaj bağı geçersiz.');
 const digest=await sha256(link.candidate_raw);
 if(q?.state!=='approved'||e?.nonce!==q?.nonce||r.nonce!==q?.nonce||e?.owner!==q?.owner||e?.chat!==q?.chat||e?.message!==q?.message||r.actor!==q?.owner||r.chat!==q?.chat||r.message!==q?.message||q?.owner!==input.owner||q?.chat!==input.chat||q?.artifact!==r.artifact_hash||e?.artifact!==r.artifact_hash||q?.candidate_digest!==digest||e?.candidate_digest!==digest||c?.hash!==r.artifact_hash)reject('Saatlik seçki için gerçek, aynı-hash sahip callback kaydı yok.');
 if(!Number.isSafeInteger(e?.approved_at)||e.approved_at<=0||e.approved_at>input.now||r.applied_at!==e.approved_at)reject('Saatlik seçki onay zamanı geçersiz.');
 return {valid:reasons.length===0,applied:reasons.length===0,reasons,times:reasons.length?null:[...HOURLY_SELECTION_SCHEDULE.times],selection_since:reasons.length?null:r.applied_at};
}
