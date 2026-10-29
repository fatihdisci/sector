# Borsa Çakalı haber botu ve hazır yayın paketi

Bu değişiklik canlı kurulum değildir. `@habernewssbot` kullanıcı adı korunur; profil adı/resmi ayrı yönetilir. API hazırlık kodu saklanır, etkinleştirilmez. Haber üretimi için mevcut Hermes `gpt-6.1-terra / low` varsayılanı korunur.

## Geri alınabilir iş akışı

Repo `bot-workflow.json` dosyası `news_only` hedefini açıkça belirtir. Gelecekte onaylı kurulum bu dosyayı release'e taşır; yerel servis başlangıçta okur. `SECTOR_BOT_WORKFLOW_MODE=full|news_only` açık override'dır. Worker kullanımında aynı seçim `BOT_WORKFLOW_MODE` ortam alanıdır; belirtilmezse geriye uyumluluk için `full` kullanılır. Değişiklik canlı servise kendiliğinden uygulanmaz.

`news_only`, yeni veri botu sorguları, kaynak görsel analizi ve piyasa tablosu üretim taleplerini botta durdurur. Haber metni/link/PDF, haber toplama, onaylı seçki, KAP kapsamı, haber tweet taslağı ve owner onaylı X paylaşım/zamanlama kalır. Hazır paket özel bir giriş olduğundan normal manuel haber yoluna sokulmaz. Hiçbir eski kuyruk/uncertain kaydı resetlenmez veya yeniden oynatılmaz. API seçimi/key kurma bu ayarın parçası değildir.

29 Ekim salt okunur kontrolde kurulu release `bd2a7f68c9b046e8af8735a0c25f7e1a`, DB `~/Library/Application Support/sector-haber/sector-haber.sqlite` idi. Kurulu `newsPreferences` fonksiyonu, aynı DB üzerinde readOnly ve mevcut sahibin kimliğiyle hesaplandı: filtre `active`, otomatik seçki açık, efektif plan 24 saat başı, sessiz saatler 00:00–08:00. Eski `digest_times` alanındaki 10:30/14:30/18:30/22:30 listesi efektif saatlik plan değildir. Hiçbiri bu geliştirmede değiştirilmedi.

## Telegram UI üzerinden model çağırmadan hazır paket

Root sohbetinde hazırlanmış kesin metin ve 1–4 PNG, tek `borsa-cakali-post.json` dosyasıdır. Sahip botun özel sohbetine bu dosyayı **dosya/document** olarak, açıklaması tam `/hazir` olacak şekilde yükler. İletilmiş dosya veya başka kullanıcı yetki sayılmaz. Normal haber metni/image upload bu giriş yerine kullanılamaz. Bu girişten sonra native komut çalıştırmak gerekmez; mevcut bot tüketicisi paketi alır ve mevcut teslimat döngüsü owner onay kartını getirir.

Paket şeması: `version:1`, `kind:"owner_ready_post"`, UUID `id`, kesin `text`, UTF-8 `text_sha256`, 1–10 HTTPS `sources`, 1–4 `{png_base64,sha256}` içeren `media`, ve manifest `sha256`. Manifest hash'inin kanonik alan sırası `readyPackageHash` işlevidir; medya baytları yerine sıralı SHA-256 değerleri içerir. UTF-8, boşluklar, satır sonları ve hashtag harfleri değiştirilmez. Başlık/tweet şablonu/model denetimi uygulanmaz; doğrulama türü `owner_provided` olur, AI doğrulanmış gibi sunulmaz.

Sınırlar: metin 4096 karakter; PNG başına 5 MB, toplam PNG 12 MB, JSON dosyası 18 MB. PNG imzası/boyutları, chunk CRC'leri ve bütünlük sonu doğrulanır; JPEG/WEBP sessizce dönüştürülmez. Eksik/fazla/bozuk medya veya hash uyuşmazlığı paketin tamamını durdurur. Metin kesilmez, otomatik zincir üretilmez.

Tek görselde de medya ve metin için ayrı, birbirine bağlı Telegram mesajları kullanılır; kontrol mesajı kesin tweet metnini taşır. En fazla dört medya korunur. X butonuna basılmadan `x_posts`/`x_schedules` kaydı oluşmaz. Hemen/15/30/60 seçimi mevcut owner/message/revision kapısından geçer. Metin ve sıralı medya hashleri içeriğe bağlıdır; X tüketicisi ayrıca hazır paket binding'ini kontrol eder. Sabit hesap `335502216 / @borsacakali`; kimlik kontrolü gevşetilmez.

Paket aynı UUID ve içerikle tekrar gelirse mevcut kayıt kullanılır; eski teslimat veya belirsiz gönderim yeniden açılmaz. Aynı UUID farklı içerikle kullanılamaz. Hazır paket üzerinde modelle düzenleme/tasarım kapalıdır; değiştirmek için yeni açık paket gerekir. Süresi dolmuş, başarısız veya belirsiz kartın aynı paketle yeniden yüklenmesi otomatik teslimat kurtarma yetkisi değildir.

Offline yardımcı: `node --import tsx scripts/package_ready_post.ts manifest.json borsa-cakali-post.json`. Manifest `{id,text_file,sources,png_files}` içerir; çıktı dosyası üzerine yazılmaz. Bu yalnız isteğe bağlı paket oluşturucudur, çalışma/operasyon sohbeti zorunluluğu değildir. Root başka ortamda aynı şemayı üretebilir ve Telegram UI'dan dosyayı yükleyebilir. Yeni endpoint/tunnel/credential veya kalıcı erişim oluşturulmaz.

## Canlıya geçiş sınırı

Repo X kodu `@borsacakali`, kurulu release X kodu eski `@endeks_haber` handle'ını bekliyor; ID aynıdır. Yeni release paketinde düzeltilmiş guard birlikte yer almalıdır. Canlı X hesabı bu geliştirmede sorgulanmadı.

Son kaynakta test/typecheck/build ve offline bakım adayı hazırlanır. Aday dosyası onay değildir. Gerçek canlı geçiş için adayın mevcut bakım prosedürüyle stage edilmesi ve aynı hash'e bağlı gerçek owner bakım onayı gerekir; aşamalı kurulum/yedek yalnız haber servisine uygulanır. Bu tur stage DB yazımı, maintenance kartı/callback, restart veya deploy yapılmaz. KAP ve ana Hermes gateway kapsam dışındadır.


## 120 saniyelik günlük devre kesici özeti

`bot-workflow.json` içindeki `circuit_auto.enabled` hedef release'de açıktır; aralık sabit **120000 ms**'dir. Yerel servis bunu `CIRCUIT_AUTO_ENABLED` alanına taşır. Mevcut `tick`/Worker scheduled girişi aynı fonksiyonu çağırır; kaynak/render portları hazır değilse kaynak çağrısı yapılmaz. Ayrı servis/otomasyon yoktur. Zaman kapısı DB üzerinde atomik olduğundan birden fazla tick aynı aralıkta ikinci tarama başlatmaz. Yerel haber servisinin kendi süreç içi devre kesici timer'ı 120 saniyeden ağ/işlem süresini çıkararak bir sonraki zamanı hesaplar; RSS döngüsünü beklemez. Worker tick de aynı atomik kapıyı kullanır. İşletim sistemi/ağ gecikmesi için gerçek zamanlı milisaniye garantisi verilmez. Yeni servis açılmaz.

Mevcut doğrulanmış BIST takvimi kullanılır: hafta sonu, tam tatil, yarım gün kapanışı ve seans dışında tarama yoktur. Bilinmeyen takvim yılı fail closed'dur. Gün anahtarı Europe/Istanbul'dur. Bugünkü 29 Ekim için canlı kaynak testi yapılmaz.

Kaynak, mevcut `KapReports.build('circuit')` yoludur: ayrı KAP servisinin BIST30 bildirim/push tercihi raporu daraltmaz. Tam günlük light listing ve eksik resmi detaylar birlikte tüm piyasa kayıtlarını doğrular; KAP servisinin kapsam/tercihleri değişmez. KAP ID'si tekilleştirilir; aynı hissedeki farklı gerçek bildirimler ayrı sayılır. Yeni olay yoksa render/model/DB taslağı yoktur. Kaynak kapsamı gerilerse, endeks kanıtı yoksa veya kapasite aşılırsa eksik içerik üretmek yerine durur.

Yeni olayda tek deterministik günlük taslak ve revizyon güncellenir. Sahibe ilk kez bir metin onay kartı gönderilir, sonraki güncellemeler **aynı mesajı düzenler**; iki dakikada bir fotoğraf/albüm yağmuru yoktur. Hazır görseller mevcut PNG indir düğmesinden alınır. Güncel tarih/soru başlığı, BIST30 → BIST100 → tekrar sayısı önceliği, tweet'in 20 küçük harfli hisse etiketi, tüm seçilmiş görsel satırları ve dört medya kapasite kontrolü mevcut rapor motorundan gelir. Otomatik X yayını yapılmaz.

X için queued/uploading/posting/sent/uncertain kayıt veya belirsiz/işlenen Telegram teslimatı varsa taslak dondurulur; reset/replay yapılmaz. Sonraki kaynak olayları `circuit_auto_observed:<TR-gün>` altında korunur, fakat sahibin onayladığı veya planladığı metin/görsel değiştirilmez. Bu durumda yeni yayın ayrıca owner kararı gerektirir. Otomatik günlük kart modelle düzenlenmez; manuel `/devrekesici` yolu ayrı kalır.

Test kanıtı: kapalı gün/yarım gün/hafta sonu/bilinmeyen yıl, 119999/120000 ms sınırı, ID tekilleştirme, aynı hissedeki iki olay, endeks dışı hissenin korunması, tek günlük taslak/same-message update ve frozen X durumları sahte kaynaklarla doğrulanır. Hazır paket → gerçek webhook owner/message kapısı → hemen/15/30/60 kuyruk ve hash/status akışı yalnız izole test DB'sinde doğrulanır; canlı callback veya X planı oluşturulmaz.
