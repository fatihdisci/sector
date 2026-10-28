import anchor from './data/news-maintenance-anchor.json';import{canonical,type ReviewArtifact}from'./news-owner-review';import{sha256}from'./utils/text';
export async function validateMaintenanceReview(i:{record:any;artifact:ReviewArtifact|null;binding:any;schedule:any;owner:string;ownerChat?:string;rule:string;catalog:string;scope:string;activated_at:number;schedule_since?:number;now:number;successor?:{candidate_raw:string;request:any;event:any}|null},trusted=anchor){
 const r=i.record,reasons:string[]=[];const fail=(s:string)=>reasons.push(s);
 if(!r)return{valid:false,reasons:['Bakım geçiş kaydı yok.'],parent_artifact:trusted.parent_artifact};
 for(const[k,v]of Object.entries({version:1,approval_source:trusted.approval_source,recorded_at:trusted.recorded_at,rule:i.rule,catalog:i.catalog,scope:i.scope,activated_at:i.activated_at,schedule_since:i.schedule_since}))if(r[k]!==v||r[k]!==trusted[k as keyof typeof trusted])fail('Bakım kapsam/onay uyuşmazlığı: '+k);
 if(!i.owner||r.actor!==i.owner||r.recorded_at>i.now||r.recorded_at<=0)fail('Bakım sahibi/zamanı geçersiz.');
 if(r.parent_state_hash!==trusted.parent_state_hash||await sha256(canonical({binding:i.binding,schedule:i.schedule}))!==trusted.parent_state_hash)fail('Bakım üst onay zinciri değişmiş.');
 const a=i.artifact;if(!a||a.hash!==r.artifact_hash||await sha256(canonical({files:a.files,catalog_hash:a.catalog_hash}))!==a.hash||canonical(a.files)!==canonical(trusted.runtime_files)||a.catalog_hash!==trusted.parent_artifact.catalog_hash)fail('Bakım çalışan kaynak parmak izi uyuşmuyor.');
 if(!reasons.length)return{valid:true,reasons,parent_artifact:trusted.parent_artifact};
 const s=i.successor;
 if(s&&r&&a){
  let candidate:any;try{candidate=JSON.parse(s.candidate_raw);}catch{candidate=null;}
  const oldFiles=trusted.runtime_files,oldCatalog=trusted.parent_artifact.catalog_hash;
  const oldArtifact={files:oldFiles,catalog_hash:oldCatalog,hash:await sha256(canonical({files:oldFiles,catalog_hash:oldCatalog}))};
  const parent=await validateMaintenanceReview({...i,artifact:oldArtifact,successor:null},trusted);
  const digest=await sha256(s.candidate_raw),q=s.request,e=s.event;
  const fields={rule:i.rule,catalog:i.catalog,scope:i.scope,activated_at:i.activated_at,schedule_since:i.schedule_since,parent_state_hash:trusted.parent_state_hash,previous_artifact_hash:oldArtifact.hash};
  const candidateBound=candidate?.state==='pending'&&candidate.hash===a.hash&&Object.entries(fields).every(([k,v])=>candidate[k]===v)&&Number.isSafeInteger(candidate.created_at)&&candidate.created_at>0&&Number.isSafeInteger(candidate.expires_at)&&candidate.created_at<=e?.approved_at&&e?.approved_at<candidate.expires_at;
  const requestBound=q?.state==='approved'&&!!i.ownerChat&&q.chat===i.ownerChat&&q.owner===i.owner&&q.owner===e?.owner&&q.chat===e?.chat&&q.message===e?.message&&q.nonce===e?.nonce&&q.artifact===a.hash&&e?.artifact===a.hash&&q.candidate_digest===digest&&e?.candidate_digest===digest&&Number.isSafeInteger(q.message)&&q.message>0&&Number.isSafeInteger(q.expires_at)&&Number.isSafeInteger(e.approved_at)&&e.approved_at>0&&e.approved_at<q.expires_at&&e.approved_at<=i.now;
  const artifactBound=a.catalog_hash===oldCatalog&&await sha256(canonical({files:a.files,catalog_hash:a.catalog_hash}))===a.hash;
  if(parent.valid&&candidateBound&&requestBound&&artifactBound)return{valid:true,reasons:[],parent_artifact:trusted.parent_artifact};
 }
 return{valid:false,reasons,parent_artifact:trusted.parent_artifact};
}
