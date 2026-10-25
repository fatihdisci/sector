import {sha256} from './utils/text';
import anchor from './data/news-owner-review-anchor.json';
import policyAnchor from './data/news-policy-v6-anchor.json';
import successorAnchor from './data/news-review-successor-anchor.json';
export const OWNER_REVIEW_ADAPTER_VERSION=1;
export const ownerReviewAnchor=anchor;
export function canonical(value:any):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
// Original importer used Python's sorted JSON with spaces, ensure_ascii=False.
export function approvalCanonical(value:any):string{
 if(Array.isArray(value))return '['+value.map(approvalCanonical).join(', ')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+': '+approvalCanonical(value[k])).join(', ')+'}';
 return JSON.stringify(value);
}
export type OwnerReviewRow={candidate_id:string;actor:string;label:string;context:string;approval_source:string;rule_version:string;catalog_version:string;code_hash:string;catalog_hash:string;scope_hash:string;sample_hash:string;evidence:string;recorded_at:number};
export type ReviewSnapshot={id:string;title:string;summary:string;url:string;published_at:string;source_id:string;legacy_eligible:number};
export type ReviewArtifact={files:Record<string,string>;catalog_hash:string;hash:string};
export async function validateOwnerReview(input:{rows:OwnerReviewRow[];binding:any;artifact:ReviewArtifact|null;owner:string;rule:string;catalog:string;scope:string;now:number;evaluate:(r:ReviewSnapshot)=>{route:string;reasons:string[];confidence?:{codes:string[];event:string;stage:string}}},trusted=anchor,successorTrusted=successorAnchor,policyTrusted=policyAnchor){
 const reasons:string[]=[],reject=(s:string)=>reasons.push(s),b=input.binding,p=b?.package,snapshot=b?.snapshot as ReviewSnapshot[]|undefined;
 const empty={reviewed:0,critical_misses:0,important_archived:0,false_critical:0};
 if(!input.rows.length)return {valid:false,reviewed:0,distribution:{instant:0,digest:0,archive:0},metrics:empty,reasons:['Taze yayın onay paketi yok.'],rows:[],hashes:{}};
 if(b?.version!==OWNER_REVIEW_ADAPTER_VERSION||!p||!Array.isArray(snapshot))return {valid:false,reviewed:0,distribution:{instant:0,digest:0,archive:0},metrics:empty,reasons:['Sürümlü değişmez örnek paketi eksik.'],rows:[],hashes:{}};
 for(const key of ['context','approval_source','rule_version','catalog_version','code_hash','catalog_hash','scope_hash','sample_hash'] as const)if(p[key]!==trusted[key])reject('Onay kaynağı/sürüm/hash uyuşmazlığı: '+key);
 const policy=b.policy;
 const effectiveTrusted=policy?policyTrusted:successorTrusted;
 if(policy&&await sha256(canonical(b.successor))!==(policyTrusted as any).parent_binding_hash)reject('Politika successor üst zinciri uyuşmuyor.');
 const transition=policy??b.successor;
 const successor=!!transition;
 if(successor){
  if(transition.version!==1||transition.previous_sample_hash!==trusted.sample_hash||effectiveTrusted.previous_sample_hash!==trusted.sample_hash||transition.approval_source!==effectiveTrusted.approval_source||transition.actor!==input.owner||!input.owner||transition.recorded_at!==effectiveTrusted.accepted_recorded_at||transition.recorded_at>input.now||transition.recorded_at<=0)reject('Geçersiz successor onay zinciri.');
  for(const [key,value] of Object.entries({rule_version:input.rule,catalog_version:input.catalog,scope_hash:input.scope,catalog_hash:input.artifact?.catalog_hash}))if(transition[key]!==value||transition[key]!==effectiveTrusted[key as keyof typeof effectiveTrusted])reject('Successor sürüm/katalog/kapsam uyuşmazlığı: '+key);
  if(transition.artifact_hash!==input.artifact?.hash)reject('Successor çalışan kod hash uyuşmazlığı.');
 }else if(p.rule_version!==input.rule||p.catalog_version!==input.catalog||p.scope_hash!==input.scope)reject('Güncel kural/katalog/inceleme kapsamı değişmiş.');
 if(await sha256(approvalCanonical(p.code_files))!==trusted.code_hash||canonical(p.code_files)!==canonical(trusted.code_files))reject('Onaylı kod paketi değişmiş.');
 const artifact=input.artifact;
 if(!artifact||artifact.catalog_hash!==(successor?effectiveTrusted.catalog_hash:trusted.catalog_hash)||await sha256(canonical({files:artifact.files,catalog_hash:artifact.catalog_hash}))!==artifact.hash)reject('Çalışan sürüm kod/katalog parmak izi eksik veya geçersiz.');
 // The adapter is new, but all approved classifier and delivery code must be byte-identical.
 // The old readiness implementation is never claimed to be the new implementation.
 for(const file of Object.keys(successor?effectiveTrusted.code_files:trusted.code_files).filter(f=>f!=='src/news-readiness.ts'))if(artifact?.files[file]!== (successor?(effectiveTrusted.code_files as Record<string,string>)[file]:(trusted.code_files as Record<string,string>)[file]))reject('İncelenmiş sınıflandırma/teslim kodu değişmiş: '+file);
 for(const file of ['src/news-readiness.ts','src/news-owner-review.ts'])if(!/^[a-f0-9]{64}$/.test(artifact?.files[file]??''))reject('Hazırlık adaptörü sürüm kanıtı eksik: '+file);
 if(!Array.isArray(p.rows)||await sha256(approvalCanonical(p.rows))!==trusted.sample_hash)reject('Onaylı tam örnek kümesi değişmiş.');
 const snap=[...snapshot].sort((a,b)=>a.id.localeCompare(b.id));
 if(await sha256(canonical(snap))!==trusted.snapshot_hash)reject('Değişmez kaynak örnek görüntüsü uyuşmuyor.');
 const ids=new Set(input.rows.map(r=>r.candidate_id)),sampleIds=new Set((p.rows??[]).map((r:any)=>r.candidate_id));
 if(ids.size!==input.rows.length||sampleIds.size!==(p.rows??[]).length||ids.size!==sampleIds.size||ids.size<12||snap.length!==ids.size||new Set(snap.map(r=>r.id)).size!==ids.size||[...ids].some(id=>!sampleIds.has(id)))reject('Eksik veya yinelenen örnek kümesi.');
 const labels=input.rows.map(r=>r.label);if(!['instant','digest','archive'].every(x=>labels.includes(x))||!snap.some(r=>r.legacy_eligible===0)||!snap.some(r=>r.legacy_eligible===1))reject('Üç rota ve eski filtrenin iki tarafı gerekli.');
 for(const r of input.rows){
  const expected=(p.rows??[]).find((x:any)=>x.candidate_id===r.candidate_id),s=snap.find(x=>x.id===r.candidate_id);
  if(!expected||!s||r.actor!==input.owner||!input.owner||r.label!==expected.label||!Number.isSafeInteger(r.recorded_at)||r.recorded_at<=0||r.recorded_at>input.now){reject('Geçersiz sahip/etiket/kayıt zamanı.');continue;}
  for(const key of ['context','approval_source','rule_version','catalog_version','code_hash','catalog_hash','scope_hash','sample_hash'] as const)if(r[key]!==p[key])reject('Satır onay bağı uyuşmuyor: '+key);
  let evidence:any={};try{evidence=JSON.parse(r.evidence);}catch{}
  if(s.title!==expected.title||s.url!==expected.url||s.published_at!==expected.published_at||evidence.current_observation?.title!==s.title||evidence.current_observation?.url!==s.url||evidence.approved_context!==expected.basis||!Number.isFinite(Date.parse(s.published_at)))reject('Kaynak veya taze bağlam kanıtı uyuşmuyor.');
 }
 if(successor&&!reasons.length){
  const semantics=snap.map(s=>{const d=input.evaluate(s);return {id:s.id,route:d.route,reasons:d.reasons,codes:d.confidence?.codes,event:d.confidence?.event,stage:d.confidence?.stage};});
  if(await sha256(canonical(semantics))!==effectiveTrusted.semantic_hash)reject('Successor örneklerinde semantik eşdeğerlik sağlanmadı.');
 }
 const rows=reasons.length?[]:snap.map(s=>{const r=input.rows.find(r=>r.candidate_id===s.id)!,d=input.evaluate(s);const override=policy?(policyTrusted as any).policy_changes?.find((x:any)=>x.id===s.id):null;return {id:s.id,label:override?.route??r.label,original_label:r.label,policy_override_source:override?policyTrusted.approval_source:null,route:d.route,reasons:d.reasons,legacy_eligible:s.legacy_eligible,evaluation_time:Date.parse(s.published_at)+60000,context:'fresh_publication_owner_review'};});
 const metrics={reviewed:rows.length,critical_misses:rows.filter(r=>r.label==='instant'&&r.route!=='instant').length,important_archived:rows.filter(r=>r.label!=='archive'&&r.route==='archive').length,false_critical:rows.filter(r=>r.label!=='instant'&&r.route==='instant').length};
 const distribution={instant:rows.filter(r=>r.label==='instant').length,digest:rows.filter(r=>r.label==='digest').length,archive:rows.filter(r=>r.label==='archive').length};
 return {valid:!reasons.length,reviewed:rows.length,distribution,metrics,reasons:[...new Set(reasons)],rows,hashes:{approved_code:trusted.code_hash,approved_sample:trusted.sample_hash,source_snapshot:trusted.snapshot_hash,runtime_artifact:artifact?.hash,scope:input.scope,successor_approval:successor?transition.approval_source:null,successor_semantics:successor?effectiveTrusted.semantic_hash:null},note:policy?'Yayın + 1 dakika bağlamı; original_label geçmiş onaydır, label yalnız yeni açık politika kaydının ileriye dönük kapsamıdır; tarihsel karar yeniden yazılmaz.':'Yayın zamanı + 1 dakika taze bağlam simülasyonu; tarihsel karar veya gözlenen performans değildir.'};
}
