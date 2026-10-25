import anchor from './data/news-maintenance-anchor.json';import{canonical,type ReviewArtifact}from'./news-owner-review';import{sha256}from'./utils/text';
export async function validateMaintenanceReview(i:{record:any;artifact:ReviewArtifact|null;binding:any;schedule:any;owner:string;rule:string;catalog:string;scope:string;activated_at:number;schedule_since?:number;now:number},trusted=anchor){
 const r=i.record,reasons:string[]=[];const fail=(s:string)=>reasons.push(s);
 if(!r)return{valid:false,reasons:['Bakım geçiş kaydı yok.'],parent_artifact:trusted.parent_artifact};
 for(const[k,v]of Object.entries({version:1,approval_source:trusted.approval_source,recorded_at:trusted.recorded_at,rule:i.rule,catalog:i.catalog,scope:i.scope,activated_at:i.activated_at,schedule_since:i.schedule_since}))if(r[k]!==v||r[k]!==trusted[k as keyof typeof trusted])fail('Bakım kapsam/onay uyuşmazlığı: '+k);
 if(!i.owner||r.actor!==i.owner||r.recorded_at>i.now||r.recorded_at<=0)fail('Bakım sahibi/zamanı geçersiz.');
 if(r.parent_state_hash!==trusted.parent_state_hash||await sha256(canonical({binding:i.binding,schedule:i.schedule}))!==trusted.parent_state_hash)fail('Bakım üst onay zinciri değişmiş.');
 const a=i.artifact;if(!a||a.hash!==r.artifact_hash||await sha256(canonical({files:a.files,catalog_hash:a.catalog_hash}))!==a.hash||canonical(a.files)!==canonical(trusted.runtime_files)||a.catalog_hash!==trusted.parent_artifact.catalog_hash)fail('Bakım çalışan kaynak parmak izi uyuşmuyor.');
 return{valid:!reasons.length,reasons,parent_artifact:trusted.parent_artifact};
}
