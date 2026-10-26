# 14:00 Sermaye Borsası piyasa görünümü — yerel inceleme

Durum: yalnız yerel kod/test. Commit, push, deploy, servis yeniden başlatma, canlı veri onarımı ve gerçek model/Telegram/X denemesi yapılmadı.

## Salt okunur üretim kanıtı

İnceleme tabanı main `1e49359602575346d87450adb25b1702e6dae70d`. Yerel dal `work/news-progress-local`; fotoğraflı haber dalı ayrıdır. Canlı uygulama symlink'i `a041b3cf05fe476ab78d340a1d5047f6` sürümüne bağlıdır. Bu sürümün runtime kaydı ve yerel tabanı karşılaştırıldı; yeni kod kurulmadı.

Kaynak: https://t.me/SermayeBorsasi/26431 — “📈 BIST 100 — 14:00”.

|Kayıt|Kimlik / durum|
|---|---|
|article|`c49c8d3c2a07ab10f10cccf220388dea8b18ef8f76f9039486fa53306670714e`, model_queued, article.error boş|
|candidate|`c49c8d3c2a07ab10f10cccf220388dea`, digest/routine_or_unresolved; kanal tablosunun ayrı önizleme yolu ve açık kullanıcı isteği çalışmış|
|news card|`431a3880-36f6-4f78-9262-08267a978f71`, mesaj 3306, failed|
|model job|`ad9f9332-d431-414f-938f-ff9758838fe8`, news, needs_review, unsupported_number_or_unit, result_draft boş|
|model review|retries=0; son denetim 14:06:51 TRT|
|draft/teslim|Bu işin result_draft ve article.draft_id alanları boş; teslim edilecek taslak oluşmamış|

İstek zamanı 14:04:02, model işi oluşturulma zamanı 14:04:06 TRT. Son lease bitişi 14:16:14; sabit 600 saniyelik lease kuralından son lease başlangıcı 14:06:14 olarak hesaplanabilir. Bu bir başlangıç olay günlüğü değildir. Oluşturulma ile son lease arasında yaklaşık 128 saniye vardır; o aralığın tam nedeni için geçmiş heartbeat/queue olay geçmişi yoktur. O anda kesinlikle başka iş yoktu veya işleyici bozuktu sonucu çıkarılmadı. İnceleme anında aktif queued/retry_pending/leased iş yoktu; eski paused işler aktif lease değildir. Global model_paused_until kaydı yoktu.

Denetimin iki somut gerekçesi:

- Taslak body alanındaki `112,62 puan`, kaynakta `-112,62 puan` olarak bulunan işaretli değerle eşleşmemiş.
- claims[0] içindeki `%1,01` iddiasının seçilen alıntısı aynı sayı/birimi kanıtlamamış. Kaynakta hem ham noktalı yüzde pasajı hem Türkçe normalize edilmiş virgüllü pasaj bulunmaktadır; alıntı seçiminin bu ayrımı koruması gerekir.

Son-model-result dosyası başka bir KAP işiyle üzerine yazılmış. Bu haberin tam başarısız taslağı mevcutmuş gibi sunulmadı. Yerel regresyonda yalnız halka açık kaynak pasajı ve açıkça sentetik hatalı taslak kullanıldı. Kaynak ham değerleri değiştirilmedi.

14:11:05 tarihli model_health hatası başka KAP işine aittir. Bu son tamamlanma kaydı, güncel model işleyicisi heartbeat'i değildir. Toplayıcı, Telegram ve kanal tarama kayıtları günceldi. Genel servis arızası veya kaynak arızası sonucu çıkarılmadı.

## Doğrulanan kod kusurları ve düzeltmeler

1. Önceki newsProgressNote queued/retry_pending için başka aktif işe bakmadan “Önce başlayan içerik” diyordu. Yeni mesaj bu iddiayı yalnız halen geçerli başka aktif lease bulunduğunda yapar. İşleyicinin işi almasını bekleme, global geçici duraklama, ayrı paused iş, 3 dakika üstü bekleme ve eksik/eski heartbeat ayrı gösterilir.
2. refreshNewsRequests article.error okuyor, job.error ve model_reviews.issues okumuyordu. Yeni sorgu bunları bağlar. Yeniden okuma sırasında eski model hatası yeni kaynak hatasını gölgelemez; önceki deneme tarihinden kalan review yeni denemeye mal edilmez. Kullanıcı mesajları yalnız izinli kısa sınıflardır; ham model çıktısı, alıntı veya özel hata metni dışarı çıkmaz. Kaynak okuma, sayı/işaret/birim, kanıt, model çalışması, yerleşim kapasitesi ve teslim belirsizliği ayrılır.
3. Eski başarısızlık mesajı gönderimi hata verirse kart hemen failed olduğu için son durum güncellemesi kaybolabiliyordu. Aynı mevcut karta düzenleme şimdi retry/throttle kaydıyla yapılır; başarılı veya kalıcı olarak erişilemez düzenlemeden sonra kart terminal olur. 429 yeni mesaj, model veya teslimat üretmez.
4. model_worker_heartbeat her 15 saniyede yerel canlılık kaydı yazar; tamamlanmış modelin başarı/hata bilgisinden bağımsızdır. Döngü bitiminde stopped kaydı bırakır, interval temizlenir. Model/lease/teslim durumunu değiştirmez ve yeni tüketici açmaz.
5. Editör promptu, işaretli puan farkının işaretini korumayı ve yüzde/puan/hacim için ilgili gerçek pasajdan birebir kanıt seçmeyi açıklığa kavuşturur. Model, effort, oturum, çağrı sayısı ve kabul kuralları değişmedi. Sayı denetimi gevşetilmedi.

Süresi dolan model lease'i mevcut leaseJob davranışıyla needs_review olur; otomatik yeniden çağrı veya teslimat yoktur. Durum ekranı bunu başka aktif iş gibi saymaz. Bu takip işi stale lease'i körlemesine yeniden kuyruğa alma mekanizması eklemez.

## Değişen dosyalar

- src/news-progress.ts (yeni): güvenli durum/hata metni sınıflaması.
- src/news-inbox.ts: gerçek iş/denetim bağları, aktif lease ve heartbeat bağlamı, güvenli son durum düzenlemesi.
- scripts/model_heartbeat.ts (yeni), scripts/local_service.ts: model işleyicisinin salt canlılık işareti.
- src/editorial.ts: kaynak işareti/kanıt seçimi talimatı, prompt sürümü 17.
- test/news-progress.test.ts (yeni): 7 regresyon.
- test/news-inbox.test.ts: çalışan lease fixture'ı artık geçerli gelecek lease_until içerir.
- Bu rapor.

## Kontroller

- Node 22.22.3, npm ci --ignore-scripts; kilit dosyası/bağımlılıklar değiştirilmedi.
- TypeScript check başarılı.
- Tam TypeScript takımı: 489/489 başarılı. Son mesaj ayrımı değişikliklerinden sonra hedefli 7/7 tekrar başarılı.
- Mevcut doğrulama Python sanal ortamı: 80 test, 2 atlanan, hata yok.
- macOS Vision OCR ayrı: 1/1; geri alım görsel OCR ayrı: 3/3 başarılı.
- Dry-run build başarılı; deploy yapılmadı.
- Kit temiz üretildi; 117 hash kaydı, 31 örnek PNG, kaynak bağımlılıkları/runtime parity ve manifest kontrolleri geçti. Üretimden sonraki bütün ZIP üyeleri mevcut paketle byte byte aynı çıktı. Yalnız ZIP zaman damgası farkını taşımamak için mevcut eş içerikli arşiv korundu.
- Korunan ZIP SHA256: `cd58e9475b71a33d37e285ea136151bc4b9f4dcc27c17ae1db336ea6265e8722`.
- git diff --check başarılı. Gerçek dış taşıyıcı yok; testler sahte Telegram taşıyıcısıyla yalnız editMessageText bekler. X ve yeni model çağrısı yoktur.
- Yeni CI çalışması yok: bu dal push edilmedi. CI sonucu yerel test sonucu olarak sunulmadı.
- npm mevcut bağımlılık ağacında 3 güvenlik bildirimi gösterdi (2 moderate, 1 high). Bu dar düzeltmede bağımlılık yükseltmesi/force fix yapılmadı.

## Ayrı doğrulama sınırları

Yanıltıcı kuyruk mesajı ve kaybolan hata nedeni yerelde düzeltildi/test edildi. Gerçek üretim isteğinin yeniden başarılı üretilmesi doğrulanmadı: canlı iş onarılmadı, yeniden model çağrısı ve gönderim yapılmadı. Kaynak görüntünün bütün hücrelerinin bu takip kapsamında yeniden okunup doğrulandığı iddia edilmiyor. Yeni promptun gelecekteki model başarısı yerel deterministik testten çıkarılamaz.

Fotoğraflı haber dalı work/photo-news-local ve bütün mevcut dosyaları korundu; bu işe birleştirilmedi. Endeks-Fotografli-Haber-Inceleme-2026-10-26 altında nusret-altinbas-iki-satir.png, plant.png, crowd.png ve ornek-kanitlari.json mevcut; bu klasörde SONUC.txt bulunmuyor. Önceki final AKD kontrolüne aitti. Bu takip fotoğraf tesliminin tamamlandığını veya Library'ye yüklenmiş olduğunu varsaymaz, dosyaları yeniden üretmez.

## Canlıya geçiş / geri dönüş

Bu aşamada dur: yerel inceleme, ayrı onaylı commit/push, aynı commit'in CI başarısı, sonra mevcut staged kurulum ve tutarlı yerel yedek gerekir. KAP, haber filtresi/tercihler, model/oturum ve diğer servisler değiştirilmeyecek. Bu değişiklik şema geçişi gerektirmez; yeni system_state anahtarı uygulama tarafından oluşturulur. Haber filtre hazırlık/onay kayıtları otomatik güncellenmedi; mevcut bakım onayı mekanizması normal süreçte değerlendirilmeli, insan onayı uydurulmamalı.

Geri dönüş uygulama sürümünü önceki release'e çevirmektir. Eski veritabanı canlıya kopyalanmaz; yeni kullanıcı geri bildirimleri korunur. Yeni heartbeat anahtarı eski kod tarafından kullanılmaz. Başarısız işi veya belirsiz teslimatı topluca yeniden oynatma. Gerçek haberin yeniden üretimi ayrı açık kullanıcı işlemiyle mevcut güvenlik/süre/bütçe kontrollerinden geçmelidir.

## Sonraki açık onay: kontrollü sürüm hazırlığı

Kullanıcı Sentinel_0a6a8f91e7ec8191b21ae2fcd767d7a8 “Onaylıyorum” yanıtıyla bu dar düzeltmenin CI ve yedekli kurulumdan sonra canlıya alınmasını, teslim edilmediği doğrulanan tek 14:00 isteğinin bir kez kontrollü denenmesini onayladı. Fotoğraf dalı bu onayın dışında kalır. Bu bölüm önceki salt yerel incelemenin tarihsel sınırını değiştirmez.

Bu sürüm için maintenance anchor yalnız yeni dosya parmak izi ve gerçek bakım onayının kaynağı/zamanıyla güncellendi. Üst editoryal ve saat onayları, filtre kapsamı ve tercihler korunur; yeni aktif filtre veya insan etiketli örnek onayı üretilmedi. Mevcut canlı tercihler salt okunur, yeni artifact/maintenance kaydı ise yalnız bellek üzerinde yer değiştirilerek readiness testi yapıldı: active/digest=true ve 10:30/14:30/18:30/22:30 saatleri değişmeden geçerli kaldı. Kurulum ve tek denemenin gerçek sonucu ayrıca işletim raporuna yazılacaktır.
