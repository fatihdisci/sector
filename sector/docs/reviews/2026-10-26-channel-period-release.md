# Özgün kanal yayınına göre piyasa başlığı — onaylı bakım sürümü

Bu sürüm önceki yerel tarih incelemesini tamamlar. Kullanıcının yeni açık onayı: Sentinel_9907ec1eed2c81918991141b42b24ae0, “...bildirimin kanaldan geldiği saat belli... bu saate göre ... gün ortası ... ve evet onaylıyorum işi bitirelim artık”. Önceki tek-deneme onayı yeniden kullanılmaz; yeni onay yalnız bir yeni kontrollü denemeye aittir. Fotoğraf dalı bu kapsama girmez.

## Zamanın anlamı ve kaynaklar

Başlık bölümü veri ölçüm zamanı veya bugünkü fiyat teyidi değildir. Yalnız sunucu tarafından kaynağın özgün Telegram mesajına bağlanmış yayın zamanının Europe/Istanbul karşılığı kullanılır. Tarama, düzenleme, üretim, retry veya kullanıcının görüntüyü yeniden gönderme zamanı kullanılmaz. Yayın zamanı ile ölçüm zamanı ayrı metadata alanlarında kalır. Tarih/saat görsele basılmaz.

Resmî kaynaklar 26 Ekim 2026'da kontrol edildi:
- https://www.borsaistanbul.com/files/pay-piyasasi-proseduru.pdf — güncel çizelgeler, s.154–155.
- https://www.borsaistanbul.com/files/pay-piyasasi-2026-yili-tatil-tablosu.pdf
- https://www.borsaistanbul.com/piyasalar/pay-piyasasi/islem-saatleri

Dosya SHA256'ları ve alınma zamanı src/data/bist-equity-session-2026.json içindedir. Çizelgede normal seans 09:40–18:10, yarım gün 09:40–12:40'tır. 11:00/15:00 ayrımları editoryal seçimdir, resmî ayrı seans iddiası değildir.

|Aralık (başlangıç dahil, bitiş hariç)|Tam gün|Yarım gün|
|---|---|---|
|09:40–10:00|Güne başlarken|Güne başlarken|
|10:00–11:00|Açılışın ilk dakikaları|Açılışın ilk dakikaları|
|11:00–15:00|Gün ortası|11:00–12:30 Kapanışa doğru|
|15:00–18:00|Kapanışa doğru|—|
|18:00–18:10|Kapanışta|12:30–12:40 Kapanışta|

Seans dışı, kapalı gün veya bilinmeyen takvim yılı: tarafsız kaynak başlığı. Takvim şimdilik 2026'nın resmî tatil/yarım günlerini içerir; 2027 sessizce tahmin edilmez. Plansız olağanüstü seans kesintisinin bu yıllık görüntüyle bağımsız izlendiği iddia edilmez. “Kapanışta” bir editoryal bölüm adıdır; kapanış fiyatı kesinleşti veya piyasa belli seviyeden kapandı sonucu üretmez.

Kaynak görselindeki açık veri tarihi/ölçüm saati, eski veya çelişkili veri ve bilinen forward bilgisi mesaj zamanından önce gelir. Böyle kaynaklarda mesaj-zamanı etiketi uygulanmaz. Grafik eksenindeki son saat tek başına ölçüm saati sayılmaz. Eski kayıtlarda forward bilgisi yoksa unknown kalır; uydurulmaz.

## Güvenli uygulama

- bindChannelPublication yalnız ayrılmış sabit kanal kaynağı için manifest kimliği/sürümü/mesajı ile dokümanı eşleştirir. Eski cached dokümanlar lease sırasında mevcut kaydedilmiş manifestle bağlanır; yeni görüntü/model okuması gerekmez. Bağlanmış metadata input_hash'e katılır.
- marketTimeContext, yayın/düzenleme/forward/kaynak zamanı ve editoryal başlık rolünü ayrı tutar. market_editorial_context, semantik denetimde de etiketi ölçüm tarihi gibi yorumlamamak için belgede saklanır.
- Başlık öneki deterministik ve idempotent uygulanır. Sadece izinli doğru başlık etiketi güncellik denetiminden ayrılır; gövdedeki bugün/anlık/güncel, kaynaksız tarih/saat ve yanlış seans çıkarımları hâlâ reddedilir. Tweet ve kart gövdesinde açık kaynak görseli bağlamı gerekir.
- Yeni Telegram okumalarında forward flag ve varsa özgün forward zamanı korunur. Bunlar eski fingerprint hesaplandıktan sonra eklenir: metadata ilavesi eski postları değişmiş içerik diye topluca oynatmaz. Okumada daha önce kayıtlı provenance değişirse reddedilir. Eski eksik metadata geçmişe dönük doldurulmaz.
- Sayı/birim/işaret, claims/kanıt, revision/expiry, sahip, idempotency ve belirsiz teslimat kontrolleri korunur. Uncertainties otomatik temizlenmez; gerçek olguyu etkileyen belirsizlik yine needs_review'dur. Yalnız izinli editoryal başlık etiketi için veri günü eksikliğini ölçüm tarihi iddiası gibi değerlendirmemek açık kullanıcı tercihidir; bu, olgusal çelişkiyi onaylama izni değildir.
- KAP kapsamı, filtre/seçki tercihleri, model/effort/oturum ve X yayın onayı değişmez. Maintenance kaydı yeni gerçek onayla yalnız bu kod parmak izine bağlanır; üst editoryal/saat onayları ve kullanıcı kayıtları korunur.
- ChatGPT kiti aynı başlık kurallarını, resmî takvim kaydını ve çevrimdışı saf equitySessionLabel yardımcısını taşır. Orijinal mesaj kanıtı yoksa saat tahmini yasaktır.

## Doğrulama

Yerel tam TypeScript: 503 test başarılı. Bunlar önceki 489 teste tarih/provenance ve seans regresyonlarını ekler. Sabah/açılış/gün ortası/kapanışa doğru/kapanış/seans dışı, yarım/kapalı gün, UTC→Istanbul, bilinmeyen yıl, gecikmiş tarama, sonraki gün retry, edit zamanı, açık eski/çelişkili tarih, forward bilgisi, yanlış kaynak, lease/input_hash, idempotent başlık, gerçek PNG, sayı/kanıt/uncertainties ve KAP/AKD kapsamını içerir.

Python doğrulama venv'i: 81 test, 2 skip. macOS OCR ayrı 1/1 ve geri alım OCR ayrı 3/3. Check ve dry-run build başarılı. ZIP temiz üretilip yeniden açıldı: 120 manifest kaydı, 31 PNG; kaynak bağımlılıkları ve iki runtime bundle parity testi geçer. SHA256: `178da7638942997399ff421376bb933d0e051b7d9dd53c71609d25873e4d04d1`.

Gerçek 26431 kaydının salt okunur manifestinden yerel kod önizlemesi: “Gün ortası — BIST 100 görünümü”. Tarih/saat eklenmedi; bu önizleme model üretimi veya teslim değildir. Yeni gerçek deneme ancak aynı commit CI başarısı ve yedekli staged kurulumdan sonra yapılacaktır. Gerçek deneme başarısı bu hazırlık raporundan çıkarılmaz.

## Canlı geçiş/geri dönüş sınırı

Main'e yalnız bu ilgili kod/test/doküman/ZIP taşınır; fotoğraf dalı karıştırılmaz. Aynı commit'in CI başarısı şarttır. Önce tutarlı SQLite online ve cutover yedeği, özel yerel yapılandırma kopyası; ardından yalnız haber servisi staged kurulum. Yeni şema tablosu/migrasyon yoktur; mevcut SQLite kayıtları korunur. Geri dönüş uygulama/plist/OCR ve önceki maintenance kaydını birlikte geri getirmektir; eski geliştirme/yedek DB canlıya kopyalanmaz, yeni oylar ve teslim kayıtları korunur.

Kontrollü deneme öncesi hedef kaynak/mesaj/kart/iş ve önceki teslim/çalışan iş tekrar kontrol edilir. Başarı veya belirsiz teslim varsa tekrar üretim yok. Yeni onaya ait tek-deneme makbuzu atomik kaydedilir. En çok bir yeni iş denemesi; mevcut bounded model iç onarım bütçesi dışında tekrar yok. X'e test gönderimi yapılmaz. Başarısızlık somut gerekçeyle raporlanır, başarılı denmiş olmaz.
