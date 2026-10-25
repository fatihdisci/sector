import {catalogEntities,matchingCompanies,explicitEquityCodes,COMPANY_CATALOG_VERSION} from './news-company-catalog';
import {newsReadiness} from './news-readiness';
import type {Env,Item,Source} from './types';
import {sha256} from './utils/text';
import {titleSimilarity} from './dedupe';
export const NEWS_RULE_VERSION='investor-v3';
export type NewsRoute='instant'|'digest'|'archive';
export type NewsPreferences={mode:'shadow'|'active';approved_by_owner:boolean;digest_enabled:boolean;digest_times:string[];activated_at:number;watchlist:string[];entities:{name:string;code:string;verified:boolean;index?:30|100;excluded_contexts?:string[]}[];requested_mode?:'shadow'|'active';readiness_reasons?:string[]};
export const DEFAULT_NEWS_PREFERENCES:NewsPreferences={mode:'shadow',approved_by_owner:false,digest_enabled:false,digest_times:['12:30','18:30'],activated_at:0,watchlist:[],entities:catalogEntities};
export const foldNews=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/[^a-z0-9%]+/g,' ').trim();
export async function newsPreferences(env:Env):Promise<NewsPreferences>{
 const r=await env.DB.prepare("SELECT value FROM system_state WHERE key='news_filter_preferences'").first<{value:string}>();
 if(!r)return {...DEFAULT_NEWS_PREFERENCES,readiness_reasons:['Aktif filtre için tercihler ve sürümlü hazırlık incelemesi gerekli.']};
 try{const v=JSON.parse(r.value);const prefs:NewsPreferences={...DEFAULT_NEWS_PREFERENCES,...v,mode:v.mode==='active'&&v.approved_by_owner===true?'active':'shadow',digest_enabled:v.digest_enabled===true,activated_at:Number.isSafeInteger(v.activated_at)?v.activated_at:0,entities:Array.isArray(v.entities)&&v.entities.length?v.entities.filter((e:any)=>e?.verified===true&&typeof e.name==='string'&&/^[A-Z][A-Z0-9]{3,4}$/.test(e.code)):catalogEntities,watchlist:Array.isArray(v.watchlist)?v.watchlist.filter((c:unknown)=>typeof c==='string'&&/^[A-Z][A-Z0-9]{3,4}$/.test(c)):[],digest_times:(Array.isArray(v.digest_times)?v.digest_times:DEFAULT_NEWS_PREFERENCES.digest_times).filter((s:unknown)=>typeof s==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(s))};const readiness=await newsReadiness(env,prefs,NEWS_RULE_VERSION);return {...prefs,requested_mode:v.mode==='active'?'active':'shadow',mode:prefs.mode==='active'&&readiness.ready?'active':'shadow',readiness_reasons:[...(v.approved_by_owner!==true?['Sahibin açık aktif filtre onayı yok.']:[]),...readiness.reasons]};}catch{return {...DEFAULT_NEWS_PREFERENCES,readiness_reasons:['Haber tercihleri veya hazırlık kaydı okunamadı; gölge mod korundu.']};}
}
export function evaluateNews(item:Item,source:Source,p=DEFAULT_NEWS_PREFERENCES,now=Date.now()){
 const text=foldNews(item.title+' '+item.summary),title=foldNews(item.title),reasons:string[]=[];
 const date=item.published_at?Date.parse(item.published_at):NaN;
 const eligible=Number.isFinite(date)&&date<=now+300000&&now-date<=24*3600000;
 const entities=matchingCompanies(text,p.entities,foldNews);
 const codes=[...new Set(entities.map(e=>e.code).concat(explicitEquityCodes(item.title+' '+item.summary,foldNews)))];
 const macro=/\b(tcmb|tuik|enflasyon|politika faizi|merkez bankasi|fed|spk|borsa istanbul|gsyh|issizlik|cari denge)\b/.test(text);
 const sector=/\b(petrol|dogal gaz|enerji|bankacilik|otomotiv|celik|havacilik|yari iletken|tarife|yaptirim)\b/.test(text);
 // Event semantics precede routing. Technology words in a market opinion do not define its topic.
 const denied=/\b(yalanla\w*|reddet\w*|gercegi yansitmiyor|durmadi|durdurulmadi)\b/.test(text);
 const outlook=/\b(bekleniyor|bekliyor|beklenti\w*|imzalayacak|tahmin\w*|ongoru\w*|surebilir|olabilir|ihtimal\w*|planliyor|iddia\w*|soylenti\w*)\b/.test(text);
 const results=/\b(bilanco\w*|finansal (?:tablo|sonuc)\w*|net kar\w*|net zarar\w*)\b/.test(text);
 const forecastTitle=/\b(beklenti\w*|tahmin\w*|ongoru\w*|hedef fiyat|teknik analiz)\b/.test(title)&&!/\bbeklenti\w* (?:uzerinde|altinda|asti|asarak)\b/.test(title);
 const realizedResults=!forecastTitle&&results&&/\b(acikla\w*|gerceklesti|oldu|artti|geriledi|azaldi|yukseldi|asti)\b/.test(text)&&!/\b(bekleniyor|tahmin\w*|ongoru\w*|olabilir)\b/.test(title);
 const market=/\b(piyasa\w*|hisse senet\w*|dolar|borsa\w*|tahvil\w*|riskten kacis)\b/.test(text);
 const opinion=/\b(stratejist\w*|analist\w*|piyasa gorusu|teknik analiz|hedef fiyat|beklenti\w*)\b/.test(text)&&!realizedResults;
 const expected=!denied&&!realizedResults&&(outlook||opinion);
 const retail=/\b(indirim katalog\w*|aktuel urun\w*|aktuel katalog\w*|indirim firsat\w*|raflarda|market brosur\w*)\b/.test(text);
 const investment=/\b(yatirim\w*|fabrika\w*|tesis\w*)\b/.test(text);
 const opened=investment&&/\b(acildi|acilis\w* (?:yapildi|gerceklestirildi)|devreye aldi|hizmete acti|fabrikasini acti)\b/.test(text);
 const decided=opened||realizedResults||/\b(karar verdi|kararini acikladi|acikladi|imzaladi\w*|kazandi\w*|onayladi|yururluge girdi|durdurdu|durduruldu|iptal etti|tamamlandi|artirdi|indirdi|sabit tuttu|aciklandi)\b/.test(text);
 const signed=/\b(sozlesme|anlasma)\w*\b.*\b(imzaladi\w*|imzalandi\w*|imzalamis\w*)\b/.test(text);
 const bid=/\b(ihale\w*)\b/.test(text)&&/\b(teklif (?:ver\w*|sun\w*)|teklifini (?:ver\w*|sun\w*)|katildi|basvurdu)\b/.test(text);
 const awarded=/\b(ihale\w*)\b/.test(text)&&/\b(kazandi\w*|uhdesinde kal\w*)\b/.test(text);
 const defaultEvent=/\b(temerrut\w*|odeme\w* (?:aksa|gecik)\w*|borc\w* odeyem\w*|odeme\w* yapama\w*)\b/.test(text);
 const event=retail?'retail_promotion':investment&&opened?'investment':defaultEvent?'payment_default':signed?'contract':/\b(ihale\w*)\b/.test(text)?'tender':results?'financial':/\b(sozlesme\w*|anlasma\w*)\b/.test(text)?'contract':/\b(iptal\w*)\b/.test(text)?'cancel':/politika faizi|faiz karar|(?:fed|tcmb).*faiz|faiz.*(?:indirdi|artirdi|sabit)/.test(text)?'rate':/\b(enflasyon\w*|gsyh|cari denge|issizlik\w*)\b/.test(text)?'macro_data':/uretim.*dur|faaliyet.*dur/.test(text)?'halt':/duzenleme|yonetmelik|yaptirim|tarife|yururluk/.test(text)?'regulation':/\b(pay|hisse)\b.*\b(aldi|satti|alimi|satimi)\b/.test(text)?'share_trade':market&&expected?'market_outlook':'other';
 const promo=/\b(webinar|etkinlik|sponsor|reklam|tanitim|zirvesi|konferans|kayit olun|egitim programi|urun tanitti)\b/.test(text);
 const tech=/\b(yapay zeka|telefon|oyun|teknoloji|uygulama|lansman)\b/.test(text);
 const relevance=codes.length>0||macro||sector||market;
 const sufficient=item.title.trim().length>=15&&item.summary.trim().length>=25;
 let route:NewsRoute='digest';
 if(!eligible){route=Number.isFinite(date)&&now-date>24*3600000?'archive':'digest';reasons.push('invalid_or_old_date');}
 else if(retail){route='archive';reasons.push('retail_consumer_promotion');}
 else if(promo&&!(relevance&&(event!=='other'||denied||expected))){route='archive';reasons.push('promotion_or_event');}
 else if(tech&&!relevance){route='archive';reasons.push('general_technology');}
 else if(!relevance){route='digest';reasons.push('relevance_uncertain');}
 else if(expected||bid){route='digest';reasons.push('expectation_or_allegation');}
 else if(denied){route=sufficient?'instant':'digest';reasons.push('denial_or_correction');}
 else if(decided&&event!=='other'&&sufficient){route='instant';reasons.push('new_concrete_investor_event');}
 else {reasons.push(sufficient?'routine_or_unresolved':'insufficient_metadata');}
 if(entities.some(e=>e.index))reasons.push('verified_index_priority');
 if(codes.some(c=>p.watchlist.includes(c)))reasons.push('watchlist_priority');
 const periods=[...text.matchAll(/\b20\d{2}(?:\s+(?:[1-9]|1[0-2]))?\b/g)].map(m=>m[0]);
 const numbers=[...text.matchAll(/\b\d+(?:\s+\d+)*(?:\s+(?:milyon|milyar|bin|yuzde|tl|dolar))?\b/g)].map(m=>m[0]);
 const occurredDefault=defaultEvent&&/\b(temerrude dustu|aksa\w*|gecik\w*|odeyemedi|yapamadi)\b/.test(text);
 const stage=denied?'denied':expected?'expected':occurredDefault?'occurred':/iptal/.test(text)?'cancelled':/duzelt|revize|tutar.*degis/.test(text)?'corrected':signed?'signed':awarded?'awarded':bid?'bid':decided?'decided':'unresolved';
 return {route,reasons,eligible,confidence:{catalog_version:COMPANY_CATALOG_VERSION,entity:codes.length?'verified':macro?'named_institution':'unresolved',event_confidence:event==='other'?'low':'explicit',evidence:sufficient?'metadata_only':'insufficient',priority:(entities.some(e=>e.index===30)?30:entities.some(e=>e.index===100)?15:0)+(codes.some(c=>p.watchlist.includes(c))?20:0),codes,event,stage,periods,numbers},identity:JSON.stringify([codes.sort(),macro,sector,event,stage,periods,numbers]),normalizedTitle:title};
}
export async function recordNewsCandidate(env:Env,item:Item,source:Source,legacyEligible:boolean,now=Date.now(),p?:NewsPreferences){
 const previous=await env.DB.prepare('SELECT title,summary,published_at FROM news_candidates WHERE url=?').bind(item.url).first<{title:string;summary:string;published_at:string|null}>();
 if(previous&&(previous.title!==item.title.slice(0,1000)||previous.summary!==item.summary.slice(0,4000)||previous.published_at!==item.published_at)){const version=await sha256(JSON.stringify([item.title,item.summary,item.published_at]));item={...item,url:item.url+'#endeks-event='+version.slice(0,16)};}
 const prefs=p??await newsPreferences(env),decision=evaluateNews(item,source,prefs,now),article=await sha256(item.url),id=article.slice(0,32),signature=await sha256(decision.identity);
 const rows=(await env.DB.prepare('SELECT id,title,event_group,signature,confidence,published_at FROM news_candidates WHERE evaluated_at>? ORDER BY evaluated_at DESC LIMIT 250').bind(now-86400000).all<{id:string;title:string;event_group:string;signature:string;confidence:string;published_at:string}>()).results;
 // Unknown entities only yield suggestions. Similarity alone never suppresses an item.
 const related=rows.filter(r=>r.signature===signature&&titleSimilarity(r.title,item.title)>.5);
 const exact=decision.confidence.entity!=='unresolved'?related.find(r=>titleSimilarity(r.title,item.title)>=.9&&Math.abs(Date.parse(r.published_at)-Date.parse(item.published_at??''))<6*3600000):undefined;
 const group=exact?.event_group??id;if(exact&&exact.id!==id)decision.reasons.push('same_event_copy');
 const stages=rows.filter(r=>{const c=JSON.parse(r.confidence);return decision.confidence.codes.some(code=>c.codes?.includes(code))&&['contract','tender','cancel'].includes(c.event)&&['contract','tender','cancel'].includes(decision.confidence.event);});
 const family=/\bReuters\b/i.test(item.summary)?'wire-reuters':/\bAnadolu Ajansı\b|\(AA\)/i.test(item.summary)?'wire-aa':source.family??source.id;
 await env.DB.prepare('INSERT INTO news_candidates(id,article_id,url,source_id,title,summary,published_at,first_seen,expires_at,route,reasons,confidence,rule_version,evaluated_at,legacy_eligible,eligible,signature,event_group,suggestions,family) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET route=excluded.route,reasons=excluded.reasons,confidence=excluded.confidence,rule_version=excluded.rule_version,evaluated_at=excluded.evaluated_at,legacy_eligible=excluded.legacy_eligible,eligible=excluded.eligible').bind(id,article,item.url,source.id,item.title.slice(0,1000),item.summary.slice(0,4000),item.published_at,now,now+7*86400000,decision.route,JSON.stringify(decision.reasons),JSON.stringify(decision.confidence),NEWS_RULE_VERSION,now,Number(legacyEligible),Number(decision.eligible),signature,group,JSON.stringify([...new Set([...related,...stages].filter(r=>r.id!==id).map(r=>r.id))]),family).run();
 return {id,article,decision,group,item};
}
export async function searchNewsArchive(env:Env,query:string,limit=20){return (await env.DB.prepare('SELECT id,title,summary,url,route,reasons,confidence,event_group,suggestions,family FROM news_candidates WHERE (title LIKE ? OR summary LIKE ?) AND expires_at>? ORDER BY evaluated_at DESC LIMIT ?').bind('%'+query.replace(/[%_]/g,'')+'%','%'+query.replace(/[%_]/g,'')+'%',Date.now(),Math.min(20,limit)).all()).results;}
