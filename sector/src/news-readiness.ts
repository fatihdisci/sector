import {validateMaintenanceReview} from './news-maintenance-review';
import {validateScheduleReview} from './news-schedule-review';
import type {Env} from './types';
import {evaluateNews,type NewsPreferences} from './news-routing';
import {COMPANY_CATALOG_VERSION} from './news-company-catalog';
import {validateOwnerReview,type OwnerReviewRow} from './news-owner-review';
import {sha256} from './utils/text';
export const NEWS_READINESS_VERSION=2;
// These are release acceptance floors, not assertions about unreviewed production data.
export const MIN_SHADOW_REVIEWS=12;
type Review={reviewer:string;reviewed_at:number;hash:string};
export type NewsReadinessRecord={version:number;rule_version:string;entity_review:Review&{sources:{code:string;url:string;checked_at:number}[]};scope_review:Review;evaluation_review:Review&{accepted:boolean}};
export async function newsReadiness(env:Env,p:NewsPreferences,ruleVersion:string,now=Date.now()){
 const entities=[...p.entities].sort((a,b)=>a.code.localeCompare(b.code)||a.name.localeCompare(b.name));
 const entityHash=await sha256(JSON.stringify(entities));
 const scopeHash=await sha256(JSON.stringify({watchlist:[...p.watchlist].sort(),entities:entityHash,digest_enabled:p.digest_enabled,digest_times:p.digest_times}));
 const rows=(await env.DB.prepare(`SELECT n.id,n.title,n.published_at,n.route,n.legacy_eligible,n.confidence,n.rule_version,f.kind,f.created_at,f.update_id FROM news_candidates n JOIN news_feedback f ON f.candidate_id=n.id WHERE n.rule_version=? AND f.kind IN ('review:instant','review:digest','review:archive') AND f.update_id=(SELECT f2.update_id FROM news_feedback f2 WHERE f2.candidate_id=n.id AND f2.kind IN ('review:instant','review:digest','review:archive') ORDER BY f2.created_at DESC,f2.update_id DESC LIMIT 1) ORDER BY n.id`).bind(ruleVersion).all<{id:string;title:string;published_at:string|null;route:string;legacy_eligible:number;confidence:string;rule_version:string;kind:string;created_at:number;update_id:number}>()).results;
 const historical_metrics={reviewed:rows.length,critical_misses:rows.filter(r=>r.kind==='review:instant'&&r.route!=='instant').length,important_archived:rows.filter(r=>r.kind!=='review:archive'&&r.route==='archive').length,false_critical:rows.filter(r=>r.kind!=='review:instant'&&r.route==='instant').length};
 const contextReviews=(await env.DB.prepare('SELECT * FROM news_owner_route_reviews ORDER BY candidate_id').all<OwnerReviewRow>()).results;
 const state=async(key:string)=>{const r=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{value:string}>();try{return JSON.parse(r?.value??'null');}catch{return null;}};
 const runtime=await state('runtime_identity'),binding=await state('news_owner_review_binding');
 // Delivery enablement is separately reviewed below; it does not change this fresh-context sample.
 const reviewScopeHash=await sha256(JSON.stringify({watchlist:[...p.watchlist].sort(),entities:entityHash,digest_enabled:false,digest_times:p.digest_times}));
 const scheduleRecord=await state('news_schedule_transition');
 const maintenanceRecord=await state('news_maintenance_transition');
 const candidateRow=await env.DB.prepare("SELECT value FROM system_state WHERE key='news_maintenance_candidate'").first<{value:string}>();let successor:null|{candidate_raw:string;request:any;event:any}=null;
 if(candidateRow){const digest=await sha256(candidateRow.value);const eventRow=await env.DB.prepare("SELECT value FROM system_state WHERE key LIKE 'news_maintenance_approval:%' AND json_valid(value) AND json_extract(value,'$.candidate_digest')=? LIMIT 1").bind(digest).first<{value:string}>();try{const event=JSON.parse(eventRow?.value??'null');if(event?.nonce){const request=await state('news_maintenance_request:'+event.nonce);successor={candidate_raw:candidateRow.value,request,event};}}catch{/* malformed approval remains invalid */}}
 const maintenance=await validateMaintenanceReview({record:maintenanceRecord,artifact:runtime?.news_review_artifact??null,binding,schedule:scheduleRecord,owner:env.TELEGRAM_USER_ID??'',ownerChat:env.TELEGRAM_CHAT_ID??'',rule:ruleVersion,catalog:COMPANY_CATALOG_VERSION,scope:scopeHash,activated_at:p.activated_at,schedule_since:p.schedule_since,now,successor});
 const schedule=await validateScheduleReview({record:scheduleRecord,artifact:maintenance.valid?maintenance.parent_artifact:runtime?.news_review_artifact??null,binding,owner:env.TELEGRAM_USER_ID??'',rule:ruleVersion,catalog:COMPANY_CATALOG_VERSION,entities:entityHash,scope:scopeHash,review_scope:reviewScopeHash,times:p.digest_times,watchlist:p.watchlist,activated_at:p.activated_at,schedule_since:p.schedule_since,enabled:p.digest_enabled,now});
 const context=await validateOwnerReview({rows:contextReviews,binding,artifact:schedule.valid?schedule.parent_artifact:runtime?.news_review_artifact??null,owner:env.TELEGRAM_USER_ID??'',rule:ruleVersion,catalog:COMPANY_CATALOG_VERSION,scope:schedule.valid?schedule.parent_review_scope:reviewScopeHash,now,evaluate:r=>evaluateNews({title:r.title,summary:r.summary,url:r.url,published_at:r.published_at},{id:r.source_id} as any,p,Date.parse(r.published_at)+60000)});
 const metrics=context.valid?context.metrics:historical_metrics;
 const historicalSampleHash=await sha256(JSON.stringify(rows));
 const sampleHash=context.valid?await sha256(JSON.stringify({adapter:1,hashes:context.hashes,rows:context.rows})):historicalSampleHash;
 const saved=await env.DB.prepare("SELECT value FROM system_state WHERE key='news_filter_readiness'").first<{value:string}>();
 let record:Partial<NewsReadinessRecord>={};try{record=JSON.parse(saved?.value??'{}')??{};}catch{/* Invalid review records never activate the filter. */}
 const reasons:string[]=contextReviews.length&&!context.valid?context.reasons.map(r=>'Taze yayın paketi: '+r):[];
 if(maintenanceRecord&&!maintenance.valid)reasons.push(...maintenance.reasons);
 if(scheduleRecord&&!schedule.valid)reasons.push(...schedule.reasons);
 const validReview=(r:Review|undefined,hash:string)=>!!r&&r.hash===hash&&!!env.TELEGRAM_USER_ID&&r.reviewer===env.TELEGRAM_USER_ID&&Number.isSafeInteger(r.reviewed_at)&&r.reviewed_at>0&&r.reviewed_at<=now;
 if(record.version!==NEWS_READINESS_VERSION||record.rule_version!==ruleVersion)reasons.push('Hazırlık kaydı yok veya kural/hazırlık sürümü güncel değil.');
 const official=(url:string)=>{try{const u=new URL(url);return u.protocol==='https:'&&['kap.org.tr','borsaistanbul.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false;}};
 if(!entities.length||!validReview(record.entity_review,entityHash)||!Array.isArray(record.entity_review?.sources)||!entities.every(e=>record.entity_review?.sources?.some(s=>s.code===e.code&&official(s.url)&&Number.isSafeInteger(s.checked_at)&&s.checked_at>0&&s.checked_at<=record.entity_review!.reviewed_at)))reasons.push('Şirket eşleştirmeleri resmî kaynaklarla gözden geçirilmemiş veya eşleştirme listesi değişmiş.');
 const scopeReviewHash=schedule.valid?schedule.parent_scope:scopeHash;
 if(!validReview(record.scope_review,scopeReviewHash))reasons.push('Takip kapsamı ve seçki ayarları bu sürüm için gözden geçirilmemiş.');
 if(!context.valid&&(metrics.reviewed<MIN_SHADOW_REVIEWS||!['instant','digest','archive'].every(route=>rows.some(r=>r.kind==='review:'+route))||!rows.some(r=>r.legacy_eligible===0)||!rows.some(r=>r.legacy_eligible===1)))reasons.push(`İnsan etiketli gölge örneklemi yetersiz: en az ${MIN_SHADOW_REVIEWS} kayıt, üç rota ve eski filtrenin iki tarafı gerekli.`);
 if(metrics.critical_misses||metrics.important_archived||metrics.false_critical)reasons.push('Etiketli örneklemde kritik kaçırma, önemli haberi arşivleme veya yanlış kritik kararı var.');
 if(!context.valid&&(!validReview(record.evaluation_review,sampleHash)||record.evaluation_review?.accepted!==true||rows.some(r=>r.created_at>(record.evaluation_review?.reviewed_at??0))))reasons.push('Bu etiketli örneklem ve gerçek hata ölçümleri insan tarafından onaylanmamış.');
 // Unresolved but important company news must not disappear into an undelivered digest.
 if(!p.digest_enabled||!p.digest_times.length)reasons.push('Seçki gönderimi kapalı: belirsiz fakat önemli şirket haberlerinin görünmez kalma riski var; aktif filtreye geçilemez.');
 if(!Number.isSafeInteger(p.activated_at)||p.activated_at<=0||p.activated_at>now)reasons.push('Kontrollü geçiş zamanı geçerli değil; seçki gönderimi henüz başlayamaz.');
 const latency=await env.DB.prepare('SELECT AVG(MAX(0,c.created_at*1000-n.first_seen)) preview_latency_ms FROM news_candidates n JOIN news_cards c ON c.article_id=n.article_id WHERE n.rule_version=?').bind(ruleVersion).first();
 const candidates=(await env.DB.prepare('SELECT id,title,route,legacy_eligible,reasons,confidence,rule_version FROM news_candidates WHERE rule_version=? ORDER BY evaluated_at DESC,id LIMIT 100').bind(ruleVersion).all()).results;
 return {maintenance_transition:{applied:!!maintenanceRecord,valid:maintenance.valid,source:maintenanceRecord?.approval_source,runtime_artifact:runtime?.news_review_artifact?.hash,parent_artifact:maintenance.valid?maintenance.parent_artifact.hash:null},schedule_transition:{applied:!!scheduleRecord,valid:schedule.valid,source:scheduleRecord?.approval_source,from_scope:schedule.valid?schedule.parent_scope:null,to_scope:scopeHash,reasons:scheduleRecord?schedule.reasons:[],runtime_artifact:runtime?.news_review_artifact?.hash,editorial_approved_artifact:schedule.valid?schedule.parent_artifact.hash:null},owner_context_reviews:context,ready:reasons.length===0,reasons,version:NEWS_READINESS_VERSION,rule_version:ruleVersion,hashes:{entities:entityHash,scope:scopeHash,sample:sampleHash},metrics,missing_evidence:{company_codes:entities.filter(e=>!validReview(record.entity_review,entityHash)||!record.entity_review?.sources?.some(s=>s.code===e.code&&official(s.url))).map(e=>e.code).filter((v,i,a)=>a.indexOf(v)===i),scope_review:!validReview(record.scope_review,scopeReviewHash)},metric_basis:context.valid?'fresh_publication_owner_review':'historical_feedback',historical_metrics,historical_sample_hash:historicalSampleHash,latency,labels:context.valid?context.rows:rows,candidates,note:'Bu salt okunur rapor hazırlık/onay kaydı oluşturmaz. Etiketlenmemiş verinin doğruluğu ölçülmüş sayılmaz. İnceleme: /aday <kimlik> instant|digest|archive. Beklenti/karar, iddia/yalanlama, dönem ve endeks dışı şirket örneklerini ayrıca inceleyin.'};
}
export function digestDeliveryStatus(p:NewsPreferences){return p.mode==='active'&&p.digest_enabled&&p.digest_times.length>0&&p.activated_at>0&&p.activated_at<=Date.now();}
