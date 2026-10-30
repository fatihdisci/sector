# Çoklu kart — yerel inceleme sürümü

İnceleme aşaması: yerelde uygulandı ve doğrulandı. Bu bölüm önceki yerel doğrulamanın kaydıdır; canlı geçiş ayrıca CI ve özel operasyon makbuzuyla doğrulanır. HEAD ve origin/main: 789b98d7ccaef99043baaad2093df1abb0e0c40c. Canlı news/KAP/panel süreç kimlikleri değişmedi; canlı ayar, veri veya kullanıcı geri bildirimi taşınmadı. Bot modeli gpt-6-luna/medium ve Hermes oturum düzeni korunur.

## Uygulama

Ortak card-pages motoru seçilmiş, değişmez veriyi dengeli 1–4 karta böler. Kurumda kart başına 10; AKD/aracı kurum/takasta 5; günlük devre kesici raporunda 15; devre kesici kod gridinde 36; büyük geri alım tablosunda 60 satır/kod kullanılır. Bunlar okunabilirlik kapasitesidir; satır atılmaz veya aşım için font daha da küçültülmez. Mevcut şablonların yazı boyutları korunur; günlük rapor değerleri 28 px, geri alım 28–32 px, sayfa numarası 24 px. Çok uzun hücre, eksik okunabilirlik veya dört kart aşımında açık hata vardır. Otomatik thread yok. Raporlarda olay kimliği/zamanı ile benzersiz şirket sayısı ayrı korunur; aynı şirketin ayrı olayları birleştirilmez.

54 satırlı geri alım tek okunaklı kart kalır; kaynak null hücreler, işlem tarihi, sıralama ve BIST30 → BIST100 → diğerleri öncelikli ilk-10 tweet seçimi değişmez. Tweet varsayılanı kısa özet olabilir; görseller bütün seçilmiş satırları taşır. Açık tüm-hisseler-tweette isteği gerçek X metin sınırına sığmıyorsa kesilmez, kapasite uyarısı verilir. Endeks dışındaki hisselerin all isteğinde kaybolması da regresyonla kapatıldı.

Yeni medya manifesti mevcut system_state tablosunda içerik hash'i ve bütün PNG anahtar/hash'lerini tutar; yeni SQL şeması yok. Eski tek media_key kayıtları okunur. Bütün kartlar render edilmeden sürüm değişmez. Revision/expiry ve medya hash kontrolü eski işin yeni metin/görsel üzerine yazmasını veya X'e karışık bir sürüm göndermesini engeller. Orijinal PNG indirme bütün sayfaları verir. Yeni birincil dosya adları, mevcut Mini App senkronizasyonunun sayısal ad kuralına uyar; albümün bütün sayfalarını gösteren yeni Mini App arayüzü bu kapsamda eklenmedi.

Telegram: 2–4 görsellik tek albüm ve ona yanıt olan tek kontrol mesajı. Ana işlemler Hemen paylaş / Zamanla / Düzenle / Diğer; albüm fotoğraflarında düğme yığını yok. Albüm ve kontrol ayrı kalıcı teslim kayıtlarıdır. Kontrol 429 hatası alırsa bilinen albüm yeniden yüklenmez. Sonucu belirsiz albüm/kontrol yeniden yollanmaz; manuel uzlaştırma gerekir. Tek kart akışı ve albümden tek karta geçiş korunur. Eski kartın düğmeleri kapatılır; yeni revision kontrolleri sunulur. Eski albümler silinmez, düğmesiz tarihçe olarak kalabilir.

X: bütün dosyalar okunur/hash'lenir; bütün medya yüklemeleri başarıyla tamamlandıktan ve revision/süre/medya tekrar denetlendikten sonra tek POST yapılır. Eksik medya, kısmi upload, değişen sürüm/süre veya hash halinde POST yok. Belirsiz POST kör tekrarlanmaz. Bir içerik, görsel sayısından bağımsız tek günlük bütçe rezervasyonudur. Yayın kaydı bütün medya anahtar/hash'lerini içerir; kullanıcı onayı ve günlük 20 sınırı korunur.

## Test ve örnekler

- Node 22.22.3: TypeScript check başarılı; tam paket 385/385, 0 başarısız/atlanmış. Önceki 371 test korunur; artış 14 yeni TypeScript testidir. Kit testine bağımsız render.mjs dört-sayfa yeniden üretim kontrolü de eklendi ve ayrıca geçti.
- Geçici/sahte taşıyıcılarla kapasite sınırları, 1/2/3/4 ve kapasite üstü, null hücre/sıra, değişmez medya, eksik dosya, albüm/kontrol 429 ve belirsiz sonuç, eski sürüm, yeniden tasarımın bütün sayfaları, PNG indirme tekrarı, X kısmi upload/expiry/revision/uncertain ve tek POST test edildi. Mevcut sahip/menü/manuel yayın/erteleme kontrolleri de tam pakette geçti.
- Mevcut PDF sanal ortamıyla Python 67/67. macOS Vision OCR 1 ve gerçek fixture geri alım OCR 3 test ayrıca çalıştırıldı; bu dört test toplam 67 içinde de yer alır.
- Worker build yalnız --dry-run ile başarılı. Gerçek Telegram/X/model test gönderimi yapılmadı. Çoklu kart için canlı albüm/X teslimatı henüz doğrulanmadı.
- Offline preview_multi_cards komutu 5 veri kümesinden 16 PNG/SVG üretti. 54 satırlı geri alım, 60 şirketli günlük rapor (4 kart), 120 kodlu devre kesici grubu (4 kart), 17+17 satırlı AKD (4 kart), 14 satırlı takas (3 kart). Temsilî ilk/son sayfalar görsel olarak incelendi; taşma/çakışma görülmedi. Örnek devre kesici kodları ve kurum rakamları sentetiktir; üretim olayı veya kullanıcı kaydı değildir.
- ChatGPT ZIP temiz staging'de yeniden üretildi: 96 dosyanın hash manifesti, transitif kaynak bağımlılıkları, güncel bundle eşitliği, 20 örneğin 23 PNG'si ve bağımsız ZIP render CLI dört PNG çıktısı doğrulandı.

ZIP SHA256: `e12652ae93388bd63fd9a89e76ffabe42f07bbbed035a5fcec3de48b3cb325fd`.

Örnekler ve köken/hash listesi: reports/multi-card-preview/manifest.json. Tekrar üretim: npm run kit:export; npm run check; npm test; npm run build; node --import tsx scripts/preview_multi_cards.ts. Python OCR komutları mevcut sanal ortam ve SECTOR_TEST_OCR_BINARY ile çalıştırılır.

## Kontrollü geçiş ve geri dönüş

Canlı geçiş ayrı olarak onaylandı. Aynı commit başarılı CI ve tutarlı canlı DB/yapılandırma yedeği aktivasyon ön koşuludur; bu doküman tamamlanmış deploy makbuzu değildir. Önce mevcut staged kurucu ile yalnız ilgili haber bileşeni geçilir; dış gönderimi belirsiz işler yeniden oynatılmaz. Filtre shadow, seçki kapalı, KAP kapsamı ve model/oturum aynı kalır. Yeni DB şeması gerekmese de yeni canlı kayıtlar asla eski geliştirme DB'siyle değiştirilmez. Telegram albümünün gerçek görünümü ve ilk gerçek onaylı X çoklu medya yayını ayrıca doğrulanmalıdır; bu test turunda yapılmadı.

Eski uygulama çoklu medya manifestini bilmez. Geri dönüşte yeni çoklu kartları eski tek-medya tüketicisine açık bırakmak güvenli değildir: önce yeni gönderimleri durdurup gönderilmemiş çoklu kartları inceleme bekleyen durumda tutmak ve düğmelerini kapatmak gerekir. Gönderilmiş veya sonucu belirsiz dış işlemlerin defteri korunur; kuyruk baştan oynatılmaz. Ardından uygulama/plist/OCR geri dönebilir. Manifestler ve yeni kayıtlar silinmez; veri kurtarma uygulama rollback'inden ayrıdır. Bu adımlar burada uygulanmadı.

## Değişen kod, test ve dokümanlar

- `README.md`
- `docs/chatgpt-kit-prompt.txt`
- `docs/chatgpt-kit-readme.txt`
- `docs/multi-card-review.md`
- `exports/ENDEKS-HABER-ChatGPT.zip`
- `scripts/bridge.ts`
- `scripts/export_chatgpt_kit.ts`
- `scripts/local_service.ts`
- `scripts/manual_reader.ts`
- `scripts/preview_multi_cards.ts`
- `scripts/validate_draft.ts`
- `scripts/x_client.ts`
- `src/bridge.ts`
- `src/buyback-pipeline.ts`
- `src/card-data.ts`
- `src/card-pages.ts`
- `src/card-redesign.ts`
- `src/delivery-recovery.ts`
- `src/draft-assets.ts`
- `src/editorial.ts`
- `src/kap-report-save.ts`
- `src/kap/reports.ts`
- `src/media-set.ts`
- `src/pipeline.ts`
- `src/publication-snapshot.ts`
- `src/report-card.ts`
- `src/report-text-metrics.ts`
- `src/telegram-album.ts`
- `src/telegram.ts`
- `src/types.ts`
- `src/worker.ts`
- `src/x-publish.ts`
- `test/chatgpt-kit.test.ts`
- `test/content-templates.test.ts`
- `test/kap-reports.test.ts`
- `test/multi-card.test.ts`
- `test/panel-snapshot.test.ts`
- `reports/multi-card-preview/`: 16 PNG, 16 SVG ve örnek manifesti.

Rollback ön koşulu: haber tüketicisi durduktan sonra `python3 scripts/hold_multi_cards.py <news.sqlite>` salt okunur plan; `--apply` yalnız gönderilmemiş çoklu ürünleri incelemeye alır, sıradaki/yüklenen X işlerini durdurur ve POST aşamasını belirsiz korur. Sent/uncertain X makbuzları, kullanıcı oyları, kaynaklar ve medya manifestleri silinmez. Dönen bilinen kontrol mesajlarının düğmeleri operatörce kapatılır; bilinmeyen kontrol kimliği açıkça raporlanır. Eski DB canlıya geri kopyalanmaz. Bu koruma 3 Python regresyonuyla sınandı.
