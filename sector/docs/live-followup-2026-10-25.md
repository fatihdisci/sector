# Canlı geçiş teknik kontrolü — 25 Ekim 2026

Başlangıç main ve origin/main: d5134191ed8456de9ab1be7d9e6bc5845542f366; çalışma ağacı temizdi. Haber çalışma sürümü d9fe8390dcb94d968605d041c28a39d0, katalog kap-companies-2026-10-23-v2-9349306c1bc7 (710 şirket). Filtre varsayılan shadow, seçki gönderimi kapalı. Kullanıcı kayıtlarına yazılmadı.

## Mini App: çözüldü, yeniden dağıtım gerekmiyor

23 Ekim tarihli rapordaki TLS engeli sonraki kontrollü dağıtımda giderilmiş. Mevcut Cloudflare projesi endeks-haber-panel, üretim sürümü b36c2a82-a97f-49bb-9660-ed851fca6839. Telegram menüsü https://panel.discilaw.com/ adresini açıyor. Yerel panel sürümü 160accdc63784b759fa0c4c05fa1039e; worker, app.js, snapshot ve sync kodları güncel main ile aynı.

Bugünkü salt okunur API kontrolünde sağlık, sahip feed erişimi ve sahip PNG erişimi 200; kimliksiz erişim, yanlış sahip, süresi geçmiş kimlik ve kimliksiz PNG erişimi 401. Buluttaki app.js yerel dosyayla birebir aynı (SHA256 6e7afc85a26c3fb7687e1fde964ff7935cece3d2be492cb5d16124b3ec88c80c). 1502 öğe, 20 beğeni ve 81 beğenmeme mevcut canlı kayıtlarla uyumlu. Deneme oyu verilmedi. Bu kontrol imzalı protokol testidir; kullanıcının telefonundaki Telegram WebView'i fiilen açıldığı iddiası değildir.

## KAP: teknik keşif hatası ve içerik incelemesi ayrı

Gerçek resmî light liste endpoint'i HTTP başarılı `[]` döndürüyor. Parser bunu kap_listing_shape sayıyordu; ayrıca store boş listede min/max/reduce işlemlerini güvenle yapamıyordu. Yalnız geçerli boş dizi kabul edilir; yanlış şema/bozuk satır hâlâ reddedilir. Boş ilk kurulum imleç başlatmaz. Mevcut kurulum yüksek su işaretini, imleçleri, tercihleri ve kuyruğu korur. Bir sonraki gerçek liste normal sessiz bootstrap davranışını korur.

43 needs_review kaydı onaylanmadı veya tekrar gönderilmedi: 28 sayı/birim, 3 anlam, 4 PDF görsel sayfa sınırı, 2 PDF metin sınırı, 2 kanıt boyutu, 2 eski operation_failed, 1 eski Hermes hatası, 1 kanıt okuma hatası. Bağlantılı model işlerinin 33'ü expired, biri needs_review; kalan dokuz kayıt model işinden önce kanıt aşamasında durmuştur. Kayıtlar geçmiş sorunları gösterir; mevcut model/Telegram döngülerinin arızalı olduğuna kanıt değildir. Güvenlik kontrolleri kaldırılmadı, insan kararı yerine geçilmedi. Eski ham belgeler saklama süresi nedeniyle mevcut değilse geçmiş hatanın daha ayrıntılı kök nedeni uydurulamaz.

## Geri alım: gerçek kaynak dry-run başarılı; yeni olay henüz yok

Bugünkü gerçek saatle tarama no_new_report döndürüyor. En son rapor 23 Ekim yayınlı, 22 Ekim işlemlerine ait; 48 saat tazelik sınırı dışında. Eski rapor güncel yayın olarak kullanılmadı.

Ayrı bellek veritabanında, açık tarihsel değerlendirme saati 2026-10-23T18:54:45Z kullanılarak gerçek RSS → sayfa → sayfadaki tam boy görsel → yerel Vision OCR → 54 satır → PNG/CSV zinciri yeniden çalıştırıldı. Eski rapordan elde edilmiş değişmez, kaynak/tarihli endeks görüntüsü kullanıldı; bugünkü üyelik geçmişe mal edilmedi. Gerçek okuma, kaynak/görsel hash'i ve seçim kanıtı yerel receipt.json'dadır. MASFN fiyat/tutar null, CSV 54 satır. PNG görsel olarak incelendi; tüm satırlar, büyük başlık ve boş hücre işaretleri korunuyor.

Seçilen kodlar: TRALT, ENERY, MAVI, AHGAZ, CVKMD, LMKDC, TCKRC, GRSEL, AKFGY, GEDIK. İlk kod BIST30, sonraki yedi BIST100, son iki diğer grubundan miktara göre seçildi. Gerçek Telegram teslimatı ve gelecekteki yeni raporun otomatik işlenmesi bu dry-run tarafından doğrulanmış değildir. Canlı buyback_reports boş; gönderim durumu değiştirilmedi.

## Doğrulama ve geçiş sınırı

Node22 check, 406 TypeScript testi (ZIP manifest/kaynak/runtime ve 26 PNG dahil), dry-run build başarılı. Mevcut Python venv: 68 test, iki koşullu OCR atlaması; ayrıca macOS OCR testleri 1+3 test açık OCR ikilisiyle başarılı.

Üç yeni regresyon: boş resmî liste ve bozuk şema ayrımı; mevcut imleç/tercih/kuyruk korunması ve keşif hata durumunun gerçek başarılı gözlemle toparlanması; boş ilk kurulum sonrası tarihçe tekrarını önleyen bootstrap.

ZIP değişmedi: 7916100962f698d8482645e053ebda8636c5454bff5de2c52b1c488b7548aec5.

Yalnız KAP collector kodu değişti; haber/panel/Hermes yeniden başlatılmaz. Şema değişikliği yok. Aynı commit CI başarı koşulundan sonra mevcut staged KAP installer kullanılır. Geçiş öncesi tutarlı yerel SQLite yedeği ve önceki uygulama/plist yolu korunur. Uygulama geri dönüşü eski DB'yi canlıya kopyalamaz; dış gönderim tekrar oynatılmaz. Bu belge dağıtım makbuzu değildir; kesin çalışan yeni sürüm ve CI bağlantısı kurulum sonrası sonuçta verilir.
