import anchor from './data/news-schedule-anchor.json';
import{canonical,type ReviewArtifact}from'./news-owner-review';import{sha256}from'./utils/text';
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
