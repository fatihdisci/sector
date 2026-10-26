// Public status text is an allowlisted summary, never raw model diagnostics.
export type NewsProgress={status:string;job_state:string|null;delivery_state:string|null;error?:string|null;job_error?:string|null;review_issues?:string|null;requested_at?:number|null;job_lease_until?:number|null;article_lease_until?:number|null};
export type ProgressContext={now?:number;activeJobs?:number;workerAt?:number;workerStopped?:boolean};
export function newsProgressNote(row:NewsProgress,paused=false,context:ProgressContext={}):string {
 const now=context.now??Math.floor(Date.now()/1000),longWait=!!row.requested_at&&now-row.requested_at>=180;
 if(row.delivery_state==='sent')return 'Tweet ve görsel hazırlandı.';
 if(['waiting','sending'].includes(row.delivery_state??''))return 'Tweet ve görsel hazır, Telegram’a iletiliyor.';
 if(row.job_state==='leased'){
  if(row.job_lease_until!=null&&row.job_lease_until<=now)return 'Hazırlama süresi doldu; önceki işlemin sonucu kontrol edilmeli. Otomatik yeniden çağrı yapılmadı.';
  if(context.workerStopped||context.workerAt!=null&&now-context.workerAt>60)return 'Hazırlama görevi ayrılmış, ancak işleyiciden güncel yanıt alınamıyor. Sonuç kontrol edilmeden otomatik tekrar yapılmayacak.';
  return (longWait?'Hazırlama beklenenden uzun sürdü. ':'')+'Tweet ve görsel hazırlanıyor; kaynak ve sayılar kontrol ediliyor.';
 }
 if(paused)return 'İsteğin kaydedildi. İçerik hazırlama geçici olarak beklemede; otomatik devam edecek.';
 if(row.job_state==='paused')return 'Bu iş beklemeye alınmış; otomatik hazırlanacağı doğrulanamadı. Durum kontrolü gerekiyor.';
 if(['queued','retry_pending'].includes(row.job_state??'')){
  if(context.workerStopped||context.workerAt!=null&&now-context.workerAt>60)return 'İstek bekliyor; içerik işleyicisinden güncel yanıt alınamıyor. Tekrar istek oluşturmana gerek yok.';
  if((context.activeJobs??0)>0)return longWait?'Bekleme uzadı. Başka bir içerik şu anda hazırlanıyor; bu istek korunuyor.':'İsteğin sırada. Başka bir içerik şu anda hazırlanıyor.';
  if(longWait)return context.workerAt==null?'Bekleme uzadı; başka aktif içerik görünmüyor. İşleyicinin güncel durumu doğrulanamadı; istek korunuyor.':'Bekleme uzadı; başka aktif içerik görünmüyor. İstek işleyicinin almasını bekliyor.';
  return row.job_state==='retry_pending'?'Kontrollü yeniden deneme sırada; işleyicinin alması bekleniyor.':'İsteğin kaydedildi; işleyicinin alması bekleniyor.';
 }
 if(row.status==='needs_review')return newsFailureNote(row);
 if(row.status==='queued'&&row.error)return 'Kaynak okuma hatası oluştu; sınırlı yeniden deneme bekleniyor.';
 if(longWait)return 'Kaynak okuma beklenenden uzun sürdü; istek korunuyor. Tam metin veya görsel okuma sonucu bekleniyor.';
 return 'Haberin tam metni okunuyor.';
}
export function newsFailureNote(row:NewsProgress):string {
 const sourceFailure=row.status==='needs_review';
 const code=sourceFailure?(row.error??''):(row.job_error??row.error??'');
 // Use issue contents only for classification. They are never shown verbatim.
 let issues:string[]=[];try{const parsed=JSON.parse(row.review_issues??'[]');if(Array.isArray(parsed))issues=parsed.filter(x=>typeof x==='string');}catch{}
 if(sourceFailure){
  if(code.startsWith('gallery_'))return 'Galerinin sayfa ve tablo bütünlüğü doğrulanamadı. İnceleme gerekiyor; eksik veriden içerik üretilmedi. Kaynak düzeltildikten sonra yeniden deneyebilirsin.';
  return 'Kaynak metni veya görseli eksiksiz okunamadı. İnceleme gerekiyor; eksik veriden içerik üretilmedi.';
 }
 const codes=[code,...issues];
 if(code==='quota_paused'||code==='hermes_auth_unavailable')return 'İçerik hazırlama geçici olarak durakladı. Yeni içerik üretilmedi; bağlantı/kota durumu kontrol edilmeli.';
 if(code==='lease_expired'||code==='invalid_job_lease')return 'Hazırlama süresi doldu; önceki işlemin sonucu doğrulanamadı. Otomatik tekrar yapılmadı; aynı düğmeyle kontrollü yeniden deneyebilirsin.';
 if(code==='expired'||row.job_state==='expired')return 'İsteğin süresi doldu. Güncel kaynakla aynı düğmeden yeniden isteyebilirsin.';
 if(codes.some(c=>/^(?:unsupported_number_or_unit|claim_number_mismatch|market_row_value_mismatch|market_currency_missing_use_rank)$/.test(c)||/^(?:body|headline|card_body|card_headline|card_data\.|claims\[).*sayı.*birim/u.test(c)))return 'Kaynak ile taslaktaki sayı, işaret veya birim eşleşmedi. Hatalı içerik gönderilmedi. Aynı düğmeyle kontrollü yeniden deneyebilirsin.';
 if(codes.some(c=>/^(?:market_card_capacity|output_capacity|card_(?:text|word|content)_overflow|card_capacity|tweet_capacity|theoretical_card_capacity|report_(?:card|cell|footer)_capacity|general_(?:card|cell)_capacity|circuit_card_capacity)/.test(c)))return 'Veriler seçilen görsel veya metin alanına sığmadı. Satır atılmadı; düzen ya da kapsam seçimi gerekiyor.';
 if(code.startsWith('gallery_'))return 'Galerinin sayfa ve tablo bütünlüğü doğrulanamadı. İnceleme gerekiyor; eksik veriden içerik üretilmedi. Kaynak düzeltildikten sonra yeniden deneyebilirsin.';
 if(row.status==='needs_review'||/^(?:source_|article_|pdf_|image_|channel_|vision_|empty_document)/.test(code))return 'Kaynak metni veya görseli eksiksiz okunamadı. Eksik veriden içerik üretilmedi; kaynak incelemesi gerekiyor.';
 if(['hermes_job_failed','subscription_turn_failed','JSONDecodeError','repair_budget_expired'].includes(code))return 'Model işlemi tamamlanamadı. İçerik gönderilmedi; aynı düğmeyle kontrollü yeniden deneyebilirsin.';
 if(['invented_evidence','missing_evidence','semantic_review_failed','unsupported_entity'].includes(code))return 'Taslağın kaynak dayanağı doğrulanamadı. İçerik gönderilmedi; aynı düğmeyle kontrollü yeniden deneyebilirsin.';
 return 'Taslak doğrulanamadı. Aynı düğmeyle kontrollü yeniden deneyebilirsin.';
}
