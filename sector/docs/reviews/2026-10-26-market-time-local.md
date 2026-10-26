# BIST100 kaynak görselinin tarih/provenance incelemesi

Durum: `work/market-time-local`, main `2d800e7607e68c25d9e20035f20a1c305b3ea998` tabanından ayrı yerel inceleme. Bu turda commit/push/deploy, canlı DB/ayar/servis değişikliği, model çağrısı, kuyruk talebi veya Telegram/X teslimi yok. Önceki tek gerçek deneme tüketilmiştir. Önceki SONUC ve gözlem dosyaları değiştirilmedi.

## Kesin kök neden

14:00 isteğinin tek canlı denemesinde eksi işareti ve kanıt alıntısı düzelmişti. İş `semantic_review_failed` durumunda kaldı. Model görünür metinde “Endeks %1,01 düşüşte” gibi bir piyasa durumu anlatırken `uncertainties` içinde veri tarihinin bilinmediğini korudu. scripts/validate_draft.ts, validateDraft sonucunun `needs_review` olması üzerine çözülmemiş belirsizlik uyarısını audit'e ekler. Denetim bu nedenle `supported=false` kaldı; acceptHermes bunu reddetti. Bu, yeni bir kuyruk veya teslimat sorunu değildir. Tarih belirsizliğinin otomatik silinmesi çözüm değildir.

İnceleme sonunda salt okunur yeniden kontrol edilen iş: `ad9f9332-d431-414f-938f-ff9758838fe8`, created_at=1793014841 (26 Ekim 14:40:41 TRT), needs_review / semantic_review_failed, result_draft boş. Yeni deneme veya başarılı üretim kanıtı yoktur.

## Erişilen provenance

Kaynak: https://t.me/SermayeBorsasi/26431
Kanal kimliği: SermayeBorsasi / 2426639373; toplayıcı bu kimliği sabit eşleştirmeyle kontrol eder.

|Alan|Kaydedilmiş değer|Neyi kanıtlar?|
|---|---|---|
|Mesaj kimliği|26431|Kaynak kanal mesajı|
|Yayın zamanı|26 Ekim 2026 14:00:03 TRT|Kanalın yayın zamanı; veri günü değildir|
|Düzenleme zamanı|26 Ekim 2026 14:01:11 TRT|Mesaj düzenlemesi; veri yenilendiğinin kanıtı değildir|
|İlk gözlem|14:01:44.151 TRT|Toplayıcının gözlemi|
|Manifest yakalama|14:02:45.317 TRT|Kanıtın yerel yakalanması|
|Başlık|📈 BIST 100 — 14:00|Kanalın verdiği başlık/saat|
|Grafik son eksen etiketi|13:40|Yalnız grafikteki saat etiketi; kesin ölçüm zamanı değildir|
|Takvim tarihi|Görselde bulunmuyor|Veri gününü kurmaya yetmez|
|Forward/orijinal kaynak zamanı|Kaydedilmemiş|İletilmiş/eski olmadığı söylenemez|

Başlıkta 14:00 ve grafikte 13:40 bulunması tek başına çelişki kanıtı değildir; paylaşım gecikmesi olabilir. Bunları eşitlemek veya takvim gününe dönüştürmek de doğru değildir.

Manifest hash: `fa988adb0a8a19e30fb45eaf63f7a9539c0bc33678c90c3e2bcc276a053fce28`.
Mesaj fingerprint: `fdbe1ac8b26afe2571a70c3a59a8d72b4de6d7ccbd93e650bfdb19d93063287c`.

Kaydedilmiş özgün JPEG dosyası mevcut; 205591 byte, 1080×1649. Byte boyutu manifest ile eşleşti. SHA256:
`c5e4313deb33fc404bdc9b742557f395088c3c1e9a79b3daff0cbda9eb1b86f7`.
Dosya: `/Users/fatihdisci/Library/Application Support/sector-haber/source-pdf/c5e4313deb33fc404bdc9b742557f395088c3c1e9a79b3daff0cbda9eb1b86f7.image`.

İşlenen PNG SHA256:
`003cb1c7333da51f865563787fc1b6997e4708ce95437f31d0ffdc802533a38c`.
Dosya: `/Users/fatihdisci/Library/Application Support/sector-haber/source-pdf/image-c5e4313deb33fc404bdc9b742557f395088c3c1e9a79b3daff0cbda9eb1b86f7/source.png`.

Özgün JPEG'in DateTime/DateTimeOriginal/DateTimeDigitized EXIF alanları yok. Olsaydı bile çekim/dosya tarihi tek başına piyasa verisinin günü sayılamazdı. Dosya sistemi zamanı veri tarihi yapılmadı. Gerçek PNG görsel olarak incelendi; takvim günü görünmüyor.

## Eksik bilgi ve çıkarım sınırı

scripts/telegram_channel.py message_value, mesajın yayın/düzenleme zamanı, metin, grup, medya türü ve byte boyutunu kaydeder. `m.fwd_from`, orijinal forward günü/kanal/mesaj kimliği kaydedilmez; fingerprint kapsamına da girmez. src/telegram-channel.ts içindeki channel_context bunları sonradan yeniden kuramaz. Bu inceleme eski kayıtlara hayalî forward bilgisi eklemez ve yeni Telegram sorgusu çalıştırmaz.

Mevcut kanıt bu tablonun 26 Ekim'e ait olduğunu veya “şu an”ı gösterdiğini güvenilir biçimde kurmaz. Aynı gün yayımlanması ve kanalın sık paylaşım yapması yeterli değildir. Yeni adapter sürümünde forward/provenance yakalama ayrıca değerlendirilebilir; eski kayıtlara geçmiş bilgi uydurulmamalı ve fingerprint değişikliğinin eski postları düzeltme diye topluca oynatması engellenmelidir. Bu turda collector/fingerprint/kanal kapsamı değiştirilmedi.

## En küçük yerel öneri

1. src/market-time.ts, yalnız Sermaye Borsası `market_overview` belgeleri için yayın günü, düzenleme zamanı, kaynak üzerinde açıkça etiketli veri günü adayları, forward durumu ve grafik saatini ayrı gösterir. Veri/işlem/ölçüm tarihi etiketi dışındaki yayın tarihi veri gününe yükseltilmez. Etiketli tarih bile bağımsız teyit diye işaretlenmez (`independent_date_verification=false`).
2. Tweet ve görsel açıkça “Kaynak tablosunda / Görselde” bağlamında statik kaynak betimlemesi taşımalıdır. Bugün/anlık/güncel, kaynaksız takvim günü veya ölçüm saati/idari “itibarıyla” çıkarımları reddedilir. Çelişkili veya geçersiz kaynak tarihleri inceleme gerektiren hata olur. Yalnız başlık/mesaj zamanından veri zamanı kurulmaz.
3. editorialPolicy bu ayrımı modele salt kanıt bağlamı olarak sağlar; EDITOR_PROMPT statik anlatımı açıklar ve eski “anlık değer” yönlendirmesini kaldırır. Görüntüye tarih yazmak zorunlu değildir. Çıktı, kaynakta gerçekten görülen sayıları/pasajları korur; haberin dönemini etkileyen çelişki hâlâ uncertainties içinde kalır.
4. Uncertainties otomatik temizlenmez, kaynağın günü doldurulmaz. AUDIT_PROMPT, acceptHermes, numericTokens/numericIssues, kanıt alıntısı kontrolleri ve validate_draft belirsizlik engeli değiştirilmedi. Yeni kontrol ek kısıttır; semantik/audit koruması gevşetilmedi. Yerel fixture'daki statik taslağın kural denetimini geçmesi gerçek semantik model onayı değildir.
5. KAP, RSS/normal haber ve diğer AKD/kurum şablonları bu yeni dar kontrolün dışında kalır. Liste/satır seçimi, fiyat/birim onayı ve render altyapısı değişmedi.

Tarih bilinmeyen kaynak için örnek dar anlatım:
“Kaynak tablosunda BIST 100. Görselde endeks 11.004,37 puan, değişim %1,01 düşüş ve puan farkı -112,62 puan olarak gösteriliyor.”
Bu cümle kaynak görselini betimler; güncel piyasa değeri iddiası değildir. Aynı sayı başka özneye/döneme aitse, görüntü okunamıyorsa veya sayı/işaret çelişiyorsa bu anlatım bile onaylanmamalıdır.

## Test ve görsel kanıt

- 8 yeni deterministik regresyon: gerçek metadata'nın sınırı; kaynak üzerinde açık veri günüyle aynı yayın günü; eski/forward fixture; tarihsiz kaynak; çelişkili/geçersiz tarih; yüzde/puan/kanıt korunması; çözülmemiş uncertainties'nin hâlâ reddi; KAP/AKD kapsamı; gerçek PNG render.
- Aynı gün/eski/forward senaryolarının tarih ve forward alanları sentetik fixture'dır; gerçek üretimde okunmuş provenance gibi sunulmaz.
- Tam TypeScript takımı: 497/497 başarılı; TypeScript check ve dry-run build başarılı.
- Mevcut doğrulama venv'iyle Python: 80 test, 2 skip, hata yok. Ayrı macOS OCR 1/1 ve geri alım OCR 3/3.
- ZIP temiz üretildi, manifest/kaynak bağımlılıkları/runtime parity ve 31 PNG testi geçti. Üye dosyalar eski paketle byte byte aynı olduğundan sadece arşiv zaman damgası farkı kaldırılıp mevcut arşiv korundu. SHA256: `cd58e9475b71a33d37e285ea136151bc4b9f4dcc27c17ae1db336ea6265e8722`.
- Yerel kod tabanlı görsel: `Endeks-BIST100-Tarih-Inceleme-2026-10-26/yerel-statik-ornek.png`. Elle kurulmuş deterministik şablon örneği; gerçek yeni model çıktısı, insan onayı, Telegram teslimi veya üretim başarısı değildir. Tarih/saat/alt dipnot eklenmedi, PNG görsel olarak incelendi.

## Dosyalar / sonraki aşama

Değişiklikler: src/market-time.ts (yeni), src/style.ts, src/editorial.ts, test/market-time.test.ts (yeni), bu yerel rapor. Başka kullanıcı dalı/fotoğraf dosyası değiştirilmedi. Yeni maintenance/aktif filtre onayı üretilmedi.

Bu aşamada commit/push/deploy veya yeni gerçek deneme yok. Canlı sürüm ve eski isteğin needs_review durumu korunur. İleride onay verilirse önce bu dar tarih politikası incelenmeli, ilgili commit ve CI doğrulanmalı, mevcut staged/yedek/rollback yoluyla kurulmalıdır. Gerçek model etkisi ve yeniden üretim ancak ayrıca açıkça yetkilendirilen yeni tek denemeyle değerlendirilebilir; mevcut tüketilmiş onay tekrar kullanılamaz.

Sonraki aşama notu: Bu belge ilk salt yerel incelemenin tarihsel kaydıdır. Kullanıcının sonraki açık yayın-zamanı başlığı ve kontrollü canlı geçiş onayıyla hazırlanan sürüm, 2026-10-26-channel-period-release.md belgesinde ayrıca anlatılır. İlk incelemenin “forward yakalanmıyor / yalnız yerel” tespitleri o aşamaya aittir; yeni sürüm eski kayıtlara forward bilgisi uydurmadan yeni okumalarda provenance saklar.
