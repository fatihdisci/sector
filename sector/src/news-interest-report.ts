import type {Env} from './types';
const parse=(s:unknown,fallback:any=null)=>{try{return typeof s==='string'?JSON.parse(s):fallback;}catch{return fallback;}};
const choice=(s:string|null)=>s==='like'?'BEĞENDİM':s==='dislike'?'BEĞENMEDİM':'SEÇİM KALDIRILMIŞ';
const reasonNames:Record<string,string>={invalid_or_old_date:'Tarih geçersiz/eski',retail_consumer_promotion:'Perakende indirim veya tüketici kataloğu',promotion_or_event:'Tanıtım/etkinlik',general_technology:'Somut piyasa ilgisi bulunmayan teknoloji',relevance_uncertain:'Yatırımcı ilgisi belirsiz',expectation_or_allegation:'Beklenti, görüş veya henüz kesinleşmemiş iddia/teklif',denial_or_correction:'Yalanlama/düzeltme',new_concrete_investor_event:'Somut yeni yatırımcı gelişmesi',routine_or_unresolved:'Rutin veya önemi netleşmemiş',insufficient_metadata:'Başlık/özet yetersiz',verified_index_priority:'Doğrulanmış endeks önceliği',watchlist_priority:'Takip listesi önceliği',same_event_copy:'Aynı olayın benzer tekrarı'};
const reasons=(xs:string[])=>xs.map(x=>`${reasonNames[x]??x} [${x}]`).join('; ');
const date=(n:number|null)=>n?new Date(n).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',hour12:false})+' (İstanbul)':'Kayıt yok';
export async function interestReportData(env:Pick<Env,'DB'|'TELEGRAM_USER_ID'>){
 const tables=(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('news_interest_context','news_interest_snapshots')").all<{name:string}>()).results.map(r=>r.name);
 const contexts=tables.includes('news_interest_context')?(await env.DB.prepare('SELECT * FROM news_interest_context WHERE actor=?').bind(env.TELEGRAM_USER_ID!).all<any>()).results:[];
 const snapshots=tables.includes('news_interest_snapshots')?(await env.DB.prepare('SELECT * FROM news_interest_snapshots WHERE actor=? ORDER BY captured_at,update_id').bind(env.TELEGRAM_USER_ID!).all<any>()).results:[];
 // Start from ALL owner ledger records; never from the bounded candidate sample.
 const interests=(await env.DB.prepare(`SELECT i.*,a.title article_title,a.url article_url,n.id matched_candidate,n.title candidate_title,n.url candidate_url,n.summary,n.published_at,n.route,n.reasons,n.confidence,n.rule_version,n.evaluated_at,s.config source_config
 FROM news_interests i LEFT JOIN articles a ON a.id=i.article_id LEFT JOIN news_candidates n ON n.id=COALESCE((SELECT n2.id FROM news_candidates n2 WHERE n2.id=i.candidate_id AND n2.article_id=i.article_id),(SELECT n2.id FROM news_candidates n2 WHERE n2.article_id=i.article_id ORDER BY n2.evaluated_at DESC LIMIT 1))
 LEFT JOIN sources s ON s.id=i.source_id WHERE i.actor=? ORDER BY i.updated_at,i.article_id`).bind(env.TELEGRAM_USER_ID!).all<any>()).results;
 const actions=(await env.DB.prepare('SELECT update_id,article_id,choice,created_at FROM news_interest_actions WHERE actor=? ORDER BY created_at,update_id').bind(env.TELEGRAM_USER_ID!).all<any>()).results;
 return {records:interests.map(r=>{const c=contexts.find(c=>c.article_id===r.article_id);return {...r,title:r.article_title??r.candidate_title??c?.title??null,url:r.article_url??r.candidate_url??c?.url??null,context_provenance:c?.provenance??null,source_name:parse(r.source_config,{})?.name??r.source_id,current_decision:r.matched_candidate?{route:r.route,reasons:parse(r.reasons,[]),confidence:parse(r.confidence,{}),rule_version:r.rule_version,evaluated_at:r.evaluated_at}:null};}),actions,snapshots};
}
export function formatInterestReport(data:Awaited<ReturnType<typeof interestReportData>>,at=Date.now()){
 const {records,actions,snapshots}=data;
 const lines=['Borsa Çakalı — AYRINTILI GERİ BİLDİRİM',`Rapor zamanı: ${date(at)}`,`Kayıt: ${records.length} | Beğendim: ${records.filter(r=>r.choice==='like').length} | Beğenmedim: ${records.filter(r=>r.choice==='dislike').length} | Kaldırılmış: ${records.filter(r=>!r.choice).length}`,
 'Güncel seçim oy sayılır; tıklama geçmişi ayrı gösterilir. Tıklanmama olumsuz değildir. Beğeni rota etiketi/onayı değildir. Otomatik kaynak/şirket/konu yasağı üretilmez.',
 'Mevcut karar en son kayıtlı değerlendirmedir, tıklama anındaki karar değildir. Eski kayıtlarda geçmiş görüntü yoksa yeniden oluşturulmaz. Son 100 aday sınırı uygulanmaz.'];
 for(const [i,r] of records.entries()){
 const current=r.current_decision,atClick=snapshots.find(s=>s.update_id===r.update_id);
 lines.push('',`${i+1}. Haber kimliği: ${r.article_id}`,`Aday: ${r.candidate_id??'Kayıt yok'} | Eşleşme: ${r.article_title?'haber mevcut':'haber kaydı silinmiş/eşleşmedi'}; ${r.matched_candidate?'aday mevcut':'aday silinmiş/eşleşmedi'}`,
 `Başlık: ${r.title??'EŞLEŞMEDİ'}`,`Bağlantı: ${r.url??'EŞLEŞMEDİ'}`,`Kaynak: ${r.source_name} (${r.source_id})`,
 `Güncel seçim: ${choice(r.choice)} | Seçim zamanı: ${date(r.updated_at)}`,
 `Mevcut rota: ${current?.route??'Kayıt yok'} | Gerekçeler: ${current?reasons(current.reasons):'Kayıt yok'}`,
 `Şirket/hisse kodları: ${current?.confidence.codes?.join(', ')||'Yok / çözümlenmemiş'}`,`Kural: ${current?.rule_version??'Kayıt yok'} | Değerlendirme: ${date(current?.evaluated_at)}`,
 `Son seçim anı karar görüntüsü: ${atClick?atClick.decision??'Aday kararı o anda bulunamadı':'YOK — geçmiş karar sonradan uydurulmadı'}`,
 `Asgari metadata kaydı: ${r.context_provenance??'Yok; mevcut haber/aday ile eşleşti'}`);
 }
 lines.push('','DÜĞME GEÇMİŞİ (AYRI OY DEĞİLDİR)');
 for(const a of actions){const snap=snapshots.find(s=>s.update_id===a.update_id);lines.push(`${a.update_id} | ${a.article_id} | basılan: ${choice(a.choice)} | ${date(a.created_at)} | ${snap?'sonuç: '+choice(snap.result_choice)+' | karar: '+(snap.decision??'o anda aday yok'):'sonuç/karar görüntüsü yok (eski veya sırası geçmiş callback)'}`);}
 return lines.join('\n')+'\n';
}
export async function detailedInterestReport(env:Pick<Env,'DB'|'TELEGRAM_USER_ID'>,at=Date.now()){return formatInterestReport(await interestReportData(env),at);}
