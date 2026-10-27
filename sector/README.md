# ENDEKS HABER — Telegram haber masası

Aktif sistem Mac mini’de, ayrı `com.sectorhaber.news` servisi altında çalışır.
`@habernewssbot`, sahibinin açık izniyle ENDEKS HABER editör botu olarak yeniden kullanılır.
`@Minihermesimbot` gateway’i, ana Hermes ayarları ve eski X hesabı değiştirilmez.

## Kod ve kapsam

- Aktif ENDEKS HABER kodu `fatihdisci/sector` reposunun `main` dalında, `sector/` dizinindedir. Repo yalnız bu sistemi içerir; önceki uygulamanın dosyaları Git geçmişinde kalır.
- `src/reused/` içindeki ana metin, tablo ve metin yardımcıları aktif okuyucular tarafından kullanılır. Bu bağımsız dosyalar korunur; önceki uygulama veya başka repo çalışma anında gerekmez.
- Hisse fiyatı, AKD, Terane, kurum dağılımı, eski OAuth/MKK anahtarları ve eski X yayın hedefi taşınmadı.
- Yeni kaynak kaydı, Türkçe editör promptu, kaynak denetimi, marka kartları, olay gruplama ve Telegram içerik kuyruğu eklendi.

## Akış

`RSS / resmî PDF → kaynak ve tarih kontrolü → önem filtresi → Telegram başlık/özet → sahibin oluştur düğmesi → ortak tam metin okuyucu → olay adayları → Hermes yazım → bağımsız Hermes kaynak denetimi → kesin sayı/birim/kanıt kontrolleri → 1–4 PNG → tek fotoğraf veya albüm + tek Telegram kontrol mesajı`

Haber kartı, oluşturma istendiğinde aynı mesaj üzerinde okuma, sıra/bekleme,
hazırlama ve teslimat durumlarını gösterir. Durum değişmedikçe Telegram'a tekrar
düzenleme isteği yapılmaz; kaynak kartı silinmişse hata sonraki işleri engellemez.

Diğer Telegram botunun `/kurum`, `/akd ASELS` veya `/takas THYAO` yanıtı
@habernewssbot'a **iletilerek** kaynak olarak kullanılabilir. Metin, fotoğraf ve
görsel dosyaları desteklenir; sistem diğer botlara otomatik komut göndermez.
İleti sahibi kontrolü, tam kaynak, görselin iki model geçişinde kontrolü ve tek
mesajı güncelleyen hazırlama akışı korunur. Bot verisi resmî teyit sayılmaz.
Kurum net işlemi `broker_flow`, hisse işlem dağılımı `akd`, saklama dağılımı
`custody` kartıdır. Takas satırları `card_data.holdings` içinde tutulur; net
alış/satış gibi yorumlanmaz. Mr/Mn ölçeği ve sütunlara özgü sayı biçimi ayrı
kanıt pasajlarına dönüştürülür. Tarihsiz görsele güncel tarih eklenmez, eksik
kurum/sayı satırı sessizce atlanmaz. Yeni veri sağlayıcısı veya hesap oturumu
gerekmez; mevcut model ve otomatik X yayın yasağı korunur.

Yazım ve kart metinleri `gpt-6.1-terra`, `low` ile mevcut Hermes ChatGPT oturumundan hazırlanır.

Hashtagler yalnız taslağın `hashtags` alanında tutulur; modelin gövdeye eklediği etiket satırları teslimattan ve kopyalamadan önce tek satırda birleştirilir. Tek hisse için `#Borsa #BIST #KOD` kullanılır. Çok hisseli devre kesici grubunda bütün doğrulanmış asıl kodlar korunur; bu gruplar için genel 2–3 etiket sınırı uygulanmaz. Doğrulanmış kod yoksa `#DevreKesici` kullanılır. Kaynak metin ve kanıt alıntıları değiştirilmez.
Araç, MCP, bellek enjeksiyonu, alternatif model ve ücretli API sağlayıcısı kapalıdır.
Oturum yenilemesini Hermes’in kendi kilitli kimlik çözümleyicisi yapar; tokenlar kopyalanmaz veya Cloudflare’a aktarılmaz.
Üyeliğin kota sınırları geçerlidir. Bir aday en fazla bir kaynak denetimli düzeltme turu alır.

Sayı denetimi İngilizce/Türkçe ondalık ve binlik ayırıcıları, milyon/milyar ölçeklerini ve para birimini kayan nokta hesabı olmadan karşılaştırır.
Bu denetim haberin dış dünyada kesin doğru olduğunu kanıtlamaz: resmî kaynak, çoklu kaynak ailesi veya tek kaynak aktarımı ayrı belirtilir.
Eksik/çelişkili kanıtlar, belirsiz galeri/PDF veya doğrulamadan geçmeyen metinler kullanıcıya tamamlanmış haber gibi gönderilmez.

### Piyasa özeti kartı

Sermaye Borsası'nın tam BIST 100 görünümü genel başlık/paragraf kartına indirgenmez.
`card_data.overview`, endeks ve puan/yüzde değişimi, hacim, gün içi düşük/yüksek,
endeks katkısı ve hacim liderleri, piyasa genişliği ve iki kurum tablosunu tek sabit 1080×1350
kartta korur. Tweet doğrudan haber diliyle yazılır; “kaynak tablosunda/görselde”
gibi dolgu kullanılmaz. Endekse pozitif ve negatif katkı veren ilk beşer hisse
ayrı gruplarda hashtagli verilir; puan katkısı fiyat yüzdesi değildir. Kaynak,
bilinmeyen ölçüm zamanı ve okuma notları editör kanıtında kalır. Eksik panel,
eşleşmeyen satır veya okunabilir kapasite aşımı inceleme gerektirir; satırlar
sessizce silinmez, boş üç metrikli karta düşülmez. Kaynakta para birimi
belirtilmeyen hacme TL eklenmez. Bu sabit kartta rastgele tasarım/hücre düzeltme
sunulmaz; PNG ve tablo/kanıt görünümü kullanılabilir.

## Kaynak kaydı

`sources.json` ortak kayıttır. Sağlık, etag, son başarılı kontrol ve hata bekleme süreleri ayrı veritabanında tutulur.
Kaynaklar tek tek `sources.candidates.json` ve `reports/source-check.json` üzerinden doğrulanmıştır.
Kurulumda eski RSS arşivi canlı kuyruğa boşaltılmaz; başlangıç anı ve kısa zaman payı kaydedilir. Önem ve güncellik birlikte sıralanır.
Günlük en fazla 240 model adayı ve aynı anda en fazla 12 teslim edilmemiş taslak kullanılır. Teslim edilmiş içerikler yeni haberleri durdurmaz. X paylaşımı yalnız açık Paylaş düğmesiyle ve günde en fazla 20 içerik için yapılır.
NTV’nin denenen RSS’i ve TCMB’nin özel PPK beslemesi eski kaldığı için etkinleştirilmedi. PPK basın duyuruları genel TCMB basın akışından takip edilir.
TÜİK RSS adayı 404, güncel veri portalı ise otomatik istemciye koruma sayfası verdi; bültenler okunmuş gibi sisteme eklenmedi.
Haber okuyucusu KAP bağlantılarını birincil kaynak olarak okuyabilir. Ayrıca bağımsız KAP toplayıcısı çalışır; kalıcı cursor, saklama ve kuyruk kuralları [KAP.md](KAP.md) içindedir. Devre kesici gönderimi `circuitNotifications` tercihine bağlıdır; KAP kuyruğu haber servisindeki bağımsız Telegram tüketicisine bağlıdır.
Devre kesici, pay alım-satım ve pay geri alım bildirimleri ayrıca hisse kapsamı filtresinden geçer: kullanıcı tarafından belirlenen son halka arz/fon krizi listesi veya günlük KAP endeks sayfasından doğrulanmış BIST 30/100 üyeliği gerekir. Endeks üyeleri sabitlenmez; KAP sayfası günlük alınır, 30/50/100 üye sayısı ve altküme ilişkisi doğrulanır. Kapsam dışı bildirim kaynak geçmişinde kalır fakat Telegram kuyruğuna girmez. Halka arz listesindeki hisselerin KAP tweet'ine bir kez `#HalkaArz` eklenir. Hisse listeleri ve ayrıntılı davranış [KAP.md](KAP.md) içindedir.
SPK’nın güncel bülten listesi ve PDF’leri ayrı okuyucuyla takip edilir; sayfa ve tablo sınırları korunur.

Kamuya açık RSS veya okunabilir sayfa, yeniden yayın/görsel lisansı sayılmaz.
Kaynaklar özel editöryal değerlendirme ve özgün, atıflı olgular için kullanılır. Yayıncı fotoğrafları alınmaz.
Bloomberg HT, TRT, CNBC-e, BBC vb. kullanım koşulları kayıt altındadır; doğrudan içerik çoğaltımı ve lisans gerektiren kullanım izni varsayılmaz.

## Telegram ve X güvenliği

- Yalnız sabit kullanıcı kimliği + özel sohbet eşleşmesi işlem yapabilir.
- Onay, ret, kaynakla yeniden denetlenen düzenleme ve bir saat erteleme desteklenir.
- Tekrarlanan/eski düğmeler sürüm kontrolünden geçemez.
- Fotoğraf, Telegram’a PNG dosyası olarak yüklenir; link önizlemesi değildir.
- Belirsiz gönderim zaman aşımı otomatik tekrar edilmez; çift kart oluşturulmaz.
- **X paylaşımı isteğe bağlıdır.** OAuth 1.0 bağlantısı kurulduğunda yalnız @endeks_haber için açık Paylaş düğmesi kullanılır. Eski onay düğmeleri yalnız yerel taslak durumu değiştirir; yayın kaydı oluşturmaz.

### Telegram komut menüsü

Bot, özel sohbetlerde Türkçe komut menüsünü servis açılışında Telegram'a kaydeder ve günde bir kez yeniler. Kayıt geçici olarak başarısız olursa servis çalışmayı sürdürür ve yeniden dener.

| Komut | Açıklama |
| --- | --- |
| `/start`, `/help` | Kullanım bilgisi |
| `/devrekesici` | Günün devre kesici raporu |
| `/gerialim` | Günün ilk 10 pay geri alımı |
| `/genelgerialim` | Tüm pay geri alımlarının tablosu |
| `/kurum` | Aracı kurum özeti; kurum adı eklenirse kurum analizi |
| `/akd TICKER` | Hisse aracı kurum dağılımı, ör. `/akd ASELS` |
| `/takas TICKER` | Hisse takas dağılımı, ör. `/takas THYAO` |
| `/sorgular` | Diğer botlardan alınan piyasa sorguları hakkında yardım |

## Kurulum ve işletim

### MacBook üzerinden geliştirmeye devam

`main` dalını çekip `sector/` altında geliştirme ve test yapılabilir. Canlı haber ve KAP servisleri Mac mini'de çalışır; Git pull/push canlı servisi kendiliğinden güncellemez.
MacBook'ta kurulum scriptlerini veya `local_service.ts` dosyasını çalıştırmak ikinci bir bot tüketicisi başlatabilir. Geliştirme için aşağıdaki kurulum komutlarından yalnız bağımlılık, kontrol, test ve build adımlarını kullan; canlı kurulum Mac mini'de yapılır.
Gizli bilgiler, Hermes oturumu, canlı SQLite veritabanları ve medya Git ile taşınmaz. Mevcut canlı servislere erişim olmadan dağıtım yapılmış gibi raporlanmamalıdır.

Güncel kararlar: X'e zamanlanmış/otomatik yayın yok; kullanıcı yalnız Telegram'daki açık Paylaş düğmesiyle gönderir. Telegram'da tek kart veya 1–4 görsellik albüm ile tek tweet/kontrol mesajı; kaynak, düzenleme, tasarım, PNG/veri/kanıt ve yayın yardımcı işlemleri; model `gpt-6.1-terra` / `low`, mevcut Hermes ChatGPT oturumu; kodla üretilen 1080×1350 lacivert/gri kartlar. Ana Hermes gateway'i ve diğer projeler değiştirilmez.

Gizli bilgiler repo dışında, `~/Library/Application Support/sector-haber/secrets.json` içinde `0600` izinle saklanır.
Çalışma kodu `.../sector-haber/app`, veritabanı `sector-haber.sqlite`, medya `media/` altındadır.
SQLite’ın uygulama kimliği `SECT` olarak sabittir; başka uygulama veritabanı açılmaz.
Normal haber/KAP kaynaklarının tam metin geçici kaydı 24 saatle sınırlıdır; resmi SPK PDF gövdeleri de bu kurala dahildir. Model işlerinin ham belgeleri terminal duruma geldiğinde temizlenir. SPK/Fintables X gönderileri ve ekleri için tekrar okuma önbelleği, yeniden indirme ve kaynak doğrulama ihtiyacı nedeniyle ayrı olarak en fazla 7 gün tutulur. PDF ve raster ara dosyaları 24 saati aşınca servis başlangıcında ve saatlik olarak temizlenir; etkin kuyruk/iş kayıtlarının hâlâ başvurduğu dosyalar korunur. Kanıt pasajları taslak onay kaydında korunur.

```sh
npm ci --ignore-scripts
npm run check
npm test
python3 -m unittest discover -s test -p 'test_*.py'
npm run build
python3 scripts/install_local.py
```

Güncelleme: `python3 scripts/install_local.py --update`. Yalnız ENDEKS servisi durdurulur.
Durdurma: `launchctl bootout gui/$(id -u)/com.sectorhaber.news`.
Ana Hermes gateway’i ve başka proje servisleri bu komutlara dahil değildir.

## Cloudflare

Yeni ve ayrı Worker `sector-haber-review`, D1 `sector-haber-db`, R2 `sector-haber-media` oluşturuldu.
Genel `workers.dev` / `pages.dev` ulaşımında TLS/erişim sorunu doğrulandığı için aktif yayın akışı bu adrese bağlanmaz.
Cloudflare cron kapalı ve `MODE=dry_run` durumundadır. Aynı pipeline D1/R2 adaptörleriyle burada da çalışabilecek şekilde korunur.
API anahtarı / ChatGPT oturumu buluta aktarılmaz. Zamanlanmış X yayını yoktur; yalnız özel sohbetteki Paylaş düğmesi X gönderimini başlatır.

## Doğrulamalar

`npm test` XML/Atom, yönlendirme güvenliği, tam metin, kaynak kimliği, sayısal ölçek/para birimi, kanıtlar, olay tekrarları,
altı kart yerleşimi ve iki renk teması, Telegram yetkisi/onayları, SQLite işlemleri, iş kiralama ve tekrar sonuç teslimini test eder.
Gerçek haber denemeleri `scripts/demo.ts`, erişim raporları `reports/` içindedir. Ham yayıncı metinleri/görselleri Git’e eklenmez.

## Ayrı KAP toplama hattı

KAP bildirimleri için ayrı cursor, kurallar, kalıcı kayıt ve kuyruk uygulaması: [KAP.md](KAP.md). Toplayıcı ayrı kayıt/kuyruk üretir; tüketici tam metin, tablolar ve PDF eklerini doğrulanmış taslak üretimine aktarır.

## Tek mesaj ve sade kartlar

Haberler önce metin önizlemesi olarak gelir. Sahibin istediği taslak bir PNG ve açıklamasındaki tweet metniyle tek Telegram mesajıdır. KAP bu taslağı otomatik hazırlar. Kaynak, önem puanı ve teknik durum için ikinci mesaj gönderilmez. “Kaynağı aç” birincil belgeyi açar; “Düzenle” kaynak denetimli revizyon ister. Yeni biçimde teslim edilmiş bir taslağın revizyonu aynı fotoğraflı mesajı günceller. Eski iki mesajlı geçmiş silinmez.

Telegram fotoğraf açıklamasının teknik sınırı 1024 UTF-16 karakterdir. Başlık/gövde/etiketler bu sınırı aşarsa Hermes aynı sınırlı düzeltme turunda anlamı koruyarak yeniden yazar ve tekrar denetlenir. Metin kesilmez, ikinci mesaja bölünmez; sığmayan doğrulanmamış sonuç gönderilmez. [Telegram sözleşmesi](https://core.telegram.org/bots/api#sendphoto).

1080×1350 kartlarda yalnız marka, güçlü başlık ve kısa açıklama bulunur; gerçek son dakika şablonunda küçük bir konu etiketi vardır. Tarih, kullanıcı adı, kaynak listesi, puan ve DENEME filigranı bulunmaz. Altı farklı yerleşim ve iki renk teması vardır; yeni içerikte rastgele seçilir ve revizyon boyunca saklanır. Kartı yeniden tasarla düğmesi metni değiştirmeden, AI çağrısı yapmadan aynı mesajda farklı bir yerleşim uygular. Renkler ve onaylı logo korunur; başlık boyutu ve satır yerleşimi metne uyarlanır, taşma sessizce kesilmez.

## Akış kapasitesi ve KAP teslimatı

Kaynak filtresi 60 puan ve üzeri ekonomi/şirket adaylarını toplar; haber üretimi artık yalnız sahibin isteğiyle başlar; açıkça istenen taslakta ek bir önem puanı engeli uygulanmaz. Kaynak denetimi, sayı/kanıt kontrolleri ve çözümlenmemiş belirsizlik engeli korunur. Günlük 240 model adayı sınırı teslim edilmiş mesaj sayısı değildir; başarısız adaylar da bu bütçeyi kullanır. ChatGPT kota sınırında otomatik bekleme devam eder.

Haber teslimatı kaynak taramasından ayrı 10 saniyelik döngüde çalışır. KAP tüketicisi tam metni, tabloları ve tüm PDF eklerini okur. Taranmış ekler OCR ve sayfa görüntüsüyle modele ve denetçiye iletilir. Eksik/okunamayan ek varsa özetten taslak üretilmez. KAP için ayrı günlük model bütçesi uygulanır; aynı Hermes abonelik kotası paylaşılır. Telegram'a bir görsel, tweet metni ve Kaynağı aç düğmesi tek mesajda gelir.

## Kendi haberini gönder

@habernewssbot özel sohbetine desteklenen kaynaklardan haber bağlantısı, KAP bağlantısı, PDF dosyası veya en az 100 karakterlik haber metni gönder. Yalnız kayıtlı hesap sahibi kabul edilir. Hazırlanıyor bildirimi tamamlanan tweet ve görselle aynı mesajda değiştirilir. Aynı kaynak denetimi ve görsel üretimi uygulanır; Otomatik X yayını yoktur. @Minihermesimbot genel Hermes sohbetidir. Bilinmeyen sitelerde tam metni veya PDF'yi gönder. Dosya/metin taslaklarının kaynak düğmesi orijinal Telegram gönderisini açmak için bot bağlantısını kullanır.

## Haberler: önce önizleme, sonra istek üzerine üretim

RSS ve SPK haberleri önce kaynak adı, başlık ve kaynak özetiyle Telegram'a gelir. Bu aşamada model çağrısı, görsel üretimi ve AI bütçe rezervasyonu yapılmaz. `Tweet ve görsel oluştur` düğmesi yalnız kayıtlı sahibin özel sohbetinde çalışır. Basıldığında tam kaynak okunur; aynı kanıt/denetim ve ortak tek/çoklu kart taslak akışı çalışır. Tekrarlanan tıklamalar aynı işi kullanır. Çok benzer başlıklar 6 saatlik pencerede ilk iki sözcük ve rakamlar eşleşiyorsa kota harcamadan gruplanır; farklı rakamlı gelişmeler korunur. Anlamı aynı fakat başlığı farklı haberler yine gelebilir; otomatik model harcaması yapmazlar.

KAP'ın otomatik belge/PDF okuma ve üretim akışı ile sahibin doğrudan gönderdiği haberler değişmez. Eski otomatik haber işlerinin bekleyenleri geçişte silinmeden duraklatılır. Yeni kurulumda önceki bütün haberleri bildirim olarak yığmamak için önizleme başlangıcı ayrıca saklanır. İstekler ayrı 5 saniyelik döngüde hazırlanır. Geçici Telegram belirsizlikleri otomatik yeniden gönderilmez.

## Tweet dili ve etiketler

Tweet ve görsel metninde yayıncıya atıf veya Kaynak satırı kullanılmaz; kaynak düğmede kalır. İddia, plan, koşul ve açıklama sahibinin kimliği korunur. BIST şirket haberleri ve doğrulanmış hisse kodlu KAP bildirimlerinde `#Borsa #BIST #HİSSEKODU` kullanılır. Kod kurum kısaltmasından tahmin edilmez. Birden fazla şirket/kod varsa iki piyasa etiketi ve ilgili konu etiketi seçilir; yabancı şirket haberlerine BIST etiketi eklenmez. Diğer haberlerde doğrudan ilgili 2–3 şirket/konu etiketi kullanılır. Yazım kuralı ihlali mevcut sınırlı düzeltme/denetim turuna girer; kaynak delilleri değiştirilmez.

Kartlarda lacivert zemin/açık alt panel ile açık zemin/lacivert alt panel, haber türünden bağımsız yaklaşık eşit olasılıkla seçilir. Seçim ilk hazırlamada saklanır; yeniden denemede ve taslak düzenlemesinde korunur. Mevcut kartların renkleri değiştirilmez. Bu seçim AI çağrısı gerektirmez.

Tweet başlığı tek bir uygun emojiyle başlar (varsayılan 📢, gerçekten acil gelişmelerde 🚨). Gövde, etiketler ve görsel metninde emoji bulunmaz. Eksik başlık emojisi ek model çağrısı olmadan tamamlanır; yanlış yerleşim mevcut sınırlı düzeltme turunda ele alınır.

## Metin ve görseli alma

Fotoğraflı taslaklarda metin kopyalama (📋) düğmesi kaldırılmıştır. Metin, Telegram'ın kendi mesaj seçme/kopyalama işleviyle alınabilir. Orijinal PNG indirme (🖼) korunur. Eski mesajlardaki metin callback'lerinin sürüm/sahip/idempotency korumaları uyumluluk için sürer; yeni klavyeler bu callback'i üretmez. Düğmelerin tamamının açıklaması: [Telegram düğme rehberi](docs/telegram-buttons.md).

## Toparlanma ve güvenli güncelleme

- `src/telegram-inbox.ts`, `src/telegram.ts`, `src/worker.ts` ve `scripts/local_service.ts`: Telegram update'leri offset ilerlemeden kalıcı kuyruğa yazılır. Geçici hatalar en fazla üç kez denenir; kalıcı ve sonucu belirsiz hatalar ayrı kaydedilir. Başarılı dış işlem makbuzları aynı update tekrar işlenirse yeniden gönderimi önler. Terminal kayıtlar mesaj gövdesini tutmaz.
- `src/news-inbox.ts`, `src/delivery-recovery.ts`, `src/pipeline.ts`: Hazır taslağın teslimatı ile model hatası ayrıdır. Bilinen mesaj aynı yerde düzenlenir. Bilinmeyen teslimatta otomatik tekrar gönderim yapılmaz; kullanıcı çift mesaj olasılığını belirten ayrı düğmeyle onaylar. Teslimat denemesi üçle sınırlıdır.
- `src/ingest.ts`, `src/model-recovery.ts`, `scripts/manual_reader.ts`: Aynı URL'nin açıkça yeniden gönderilmesi, uygun model hatasını yeni ve tam kanıtla en fazla iki kez yeniden sıraya alabilir. İş kimliği, deneme sayacı ve günlük bütçe korunur. Çalışan/tamamlanmış işler çoğaltılmaz; teslimatı belirsiz taslak yeniden üretilmez.
- `src/kap/store.ts`, `src/kap-delivery.ts`, `src/pipeline.ts`: KAP tercihleri hazırlama sırasında ve gerçek gönderimden hemen önce yeniden okunur. Kapatılan bekleyen kayıtlar saklanır, gönderilmez ve kategori tekrar açıldığında geçmişe dönük oynatılmaz. Mevcut pay işlemi önceliği değişmez. Tercih deposuna erişilemiyorsa gönderim bekler.
- `migrations/0003_recovery.sql`: Yalnız yeni gelen-kuyruk/işlem-makbuzu tabloları eklenir. Yerel başlangıç şeması aynı ekleri içerir; veri silen migration yoktur.

`scripts/install_local.py --update`, temiz bir `releases/<kimlik>/app` dizininde bağımlılıkları, TypeScript/Python testlerini, dry-run build'i ve macOS OCR derlemesini tamamlar. Ardından yalnız ENDEKS servisi durdurulur ve sürüm değiştirilir. Yeni süreç hazır olduğunu bildirene kadar haber/Telegram/model döngülerini başlatmaz (`scripts/startup_gate.ts`). Başlangıç doğrulanınca etkinleştirilir. Başlatma başarısızsa önceki uygulama, OCR ve servis dosyası geri yüklenir. Normal kurulum mevcut kurulumu değiştirmeyi reddeder.

Geri dönüş kopyaları `backups/update-<kimlik>/rollback.json` içinde listelenir. Başarılı geçişten sonra manuel geri dönüş gerekirse önce yalnız ENDEKS servisi durdurulmalı; bekleyen `telegram_updates` kayıtları uzlaştırılmalı, ardından listedeki önceki dosyalar ters sırayla geri alınmalıdır. Offset geri sarılmamalı ve veritabanı eski kopyayla değiştirilmemelidir. Önceki sürüm yeni gelen-kuyruk tablosunu tüketmediğinden bekleyen istekler göz ardı edilmemelidir. Makbuzu olmayan dış teslimat için exactly-once garantisi yoktur.

## CI ve izole doğrulama

`.github/workflows/checks.yml`, Node 22 ile `npm ci --ignore-scripts`, `npm run check`, `npm test`, `npm run build` ve Python testlerini çalıştırır. Canlı sır, servis kurulumu, gerçek Telegram gönderimi veya deploy adımı bulunmaz. GitHub Actions sürümleri commit kimliğiyle sabittir; izin yalnız repo okumadır.

`test/telegram-recovery.test.ts`, `test/recovery.test.ts`, `test/kap-delivery.test.ts`, `test/startup-gate.test.ts` ve `test/test_install_local.py` hata/toparlanma senaryolarını geçici veritabanları ve sahte dış servislerle sınar. Native Vision OCR kontrolü ayrı macOS işidir (`test/test_macos_ocr.py`); Linux'ta bu test açıkça atlanır. Yerelde `SECTOR_TEST_OCR_BINARY` yalnız geçici dizinde derlenen test binary'sine verilmelidir.


## ENDEKS marka ve kapsam geçişi

Görünür marka ENDEKS HABER, hesap referansı `@endeks_haber` oldu. Teknik `sector-haber` dizinleri, `com.sectorhaber.*` servisleri, SQLite uygulama kimlikleri, Hermes profili ve Cloudflare bağları korunur. Model/oturum `gpt-6.1-terra / low`; Otomatik X yayını kapalıdır.

`src/brand.ts` ortak kimliği, `scripts/generate_brand.ts` profil/banner SVG ve PNG'lerini üretir. `scripts/preview_endeks.ts` altı yerleşim ve iki tema için çevrimdışı örnekleri `reports/endeks-previews/` altına yazar. `circuit`, `kap`, `market`, `finance` şablonları ve `bist`, `kap` kategorileri eski değerleri kaldırmadan eklendi. Özet/etiket/kanıt/birim denetimleri ve mevcut kart yeniden tasarlama korunur.

Yeni RSS eklenmedi. 14 mevcut beslemenin HTTP/XML/tarih sonuçları `reports/endeks-source-check.json` içindedir. Kaynak önceliği ve içerik alt eşiği merkezi `sources.json` kaydında bulunur. KAP bağımsız toplayıcıyla, SPK mevcut PDF hattıyla, TCMB/Fed/ECB kendi kaynaklarıyla izlenir. Borsa İstanbul açıklamaları KAP üzerinden resmî kaynak olarak alınır; doğrulanmamış yeni bir Borsa RSS adresi etkinleştirilmez. [Canlı geçiş](ENDEKS.md).


Haber, devre kesici, kurumların alıp sattığı hisseler, tek hisse AKD ve hacim için ayrı [görsel aileleri](reports/content-templates/contact-sheet.png) vardır. İsteğe bağlı kaynak denetimli `card_data` alanı sayıları ve tabloları taşır; otomatik AKD/hacim veri kaynağı kurulmaz. Ayrıntılar: [ENDEKS.md](ENDEKS.md#konuya-özel-görsel-aileleri).

Devre kesici akışı üç dakikada bir kapanan tek toplu bildirimdir. Aynı penceredeki kodlar tweetin en üst başlık satırında #KOD olarak bir kez yer alır, sonda tekrarlanmaz; kısa metin kaynakta doğrulanan durdurmayı geçmiş zamanla aktarır. Devre kesici görselinde büyük DEVRE KESİCİ başlığının altında doğrulanmış #KOD ızgarası bulunur. Kod sayısı arttıkça başlık ve ızgara yerleşimi uyarlanır; kodlar kesilmez veya gizlenmez. Sığmayan içerik açık kapasite hatası verir; farklı kaynak kodu uydurulmaz. Ayrı KAP taraması ve diğer önemli bildirimlerin hızları korunur.

### İletilen kurum analizleri (BoPT dahil)

BoPT `/kurum bank of america` yanıtının metni veya görseli editör botuna iletilebilir. Bu, botu kişisel Telegram hesabına bağlamaz ve başka bota otomatik komut göndermez. `institutional` tek aracı kurum üzerinden alınan/satılan hisselerdir; `broker_flow` borsa genelindeki kurum net işlemleri, `akd` tek hissenin kurum işlemleri, `custody` saklama/takas dağılımıdır. Bunlar birbirine çevrilmez.

Kaynağa veya hazırlanmış karta **Sadece alınanlar**, **Sadece satılanlar**, **İkisini de göster** diye yanıt vermek yeni bir görünüm oluşturur. Tam asıl kanıt korunur, hazırlanmış kart tekrar OCR ile okunmaz. Düzenle düğmesi de aynı seçimleri anlar. Tek taraf için geniş on satırlık liste, iki taraf için iki ayrı on satırlık panel kullanılır. Alım/satım yönü ve satır-tutar eşleşmesi gönderimden önce doğrulanır; farklı görünümler veya değişen veri görüntüleri başlık benzerliği yüzünden birleştirilmez.

Mr/Mn ve ondalık nokta alan bağlamına göre normalleştirilir; lot/adet binlik noktaları korunur. Yuvarlanmış toplamlar yeniden hesaplanarak değiştirilmez. Görsel para birimi belirtmiyorsa TL tahmin edilmez; aynı tutarı TL ile açıklayan metin kanıt olarak kullanılabilir. Kaynaksız tarihe/saat bilgisine dayanarak anlık veri iddiası üretilmez.

## ChatGPT kart paketi

`npm run kit:export` komutu temiz geçici staging alanında kaynak kodu, transitif importları, renderer/font/marka varlıklarını ve 19 örnek çıktıyı derleyip doğrulayarak `exports/ENDEKS-HABER-ChatGPT.zip` üretir. `node render.mjs content.json kart.png` ile npm kurulmadan PNG üretir. Gizli bilgi veya canlı veri içermez. Devre kesici, tema/yerleşim seçimine bakmadan sabit lacivert/editorial şablonda doğrulanmış kod sayısına uyarlanır.

Elle iletilen kurum/AKD/takas içeriklerinde Telegram’ın ilk mesaj zamanı İstanbul saatine çevrilir: 10–11 Açılışın ilk dakikaları; 11–14 Gün ortası; 14–18 Kapanışa doğru; 18–22 Gün sonu. Başlık bağlamı kaynak ölçüm saati değildir. Yeniden deneme ve seçim yanıtları ilk zamanı korur; açıkça farklı günün verisine veya saat bilgisi olmayan eski işlere bu başlıklar eklenmez.


### Telegram üzerinden X paylaşımı

Yerel Mac servisinde Paylaş düğmesi, ayrı `tweetkit-endeks-haber` / `endeks_haber` Keychain kaydını kullanır; eski `x-credentials.json` okunmaz ve ücretli X API yoluna geri dönüş yoktur. Dağıtımdan önce yalnız bu servis için Python ortamı `~/Library/Application Support/sector-haber/tweetkit-venv` konumunda hazırlanmalı ve `requirements-tweetkit.txt` kurulmalıdır. Paket kaynağı `vendor/tweetkit` altında sabitlenmiştir. Ortam kurulması veya servis yeniden başlatılması tek başına gönderi yapmaz; her servis başlangıcında bekleyen eski gönderi istekleri geçersizleştirilir ve yeni Paylaş tıklaması gerekir.

Yalnız kayıtlı Telegram sahibi Paylaş düğmesine basabilir. Metin ve 1–4 PNG, önceki onaylı karttan alınır. Keychain oturumundaki ID ve salt okunur profil, `@endeks_haber` / `335502216` ile eşleşmelidir. Profil ve yerel oturum ID eşleşmesi, X sunucusundan bağımsız oturum sahibi doğrulaması değildir. tweetkit X'in resmî API'si dışındaki web oturumunu kullanır; X kısıtları ve hesap riski geçerlidir.

Her istek bir kez gönderilir; kesinti veya gönderi sonrası doğrulama başarısızlığı `uncertain` olarak tutulur ve otomatik tekrarlanmaz. Dönen gönderi ID'si, mevcutsa, kontrol için saklanır. Başarı yalnız X'ten aynı ID, yazar, metin ve fotoğraf sayısı geri okunduktan sonra kaydedilir. Günlük 20 rezervasyon ve kart revizyonu kontrolleri korunur. Yerel sınır uzun gönderi erişimini garanti etmez; metin kesilmez veya otomatik zincire çevrilmez.

### Kaynakla birlikte editoryal açıklama

Haber bağlantısı, PDF, metin veya görselle aynı mesajda `Talimat:`, `İstek:` ya da `Notum:` başlığıyla isteğini ekleyebilirsin. Örnek: haber bağlantısı + yeni satırda `Talimat: Yatırım tutarını başlıkta vurgula, kısa yaz. Görselde şirket adı öne çıksın.` Kısa yaz / Bunu kısa yaz gibi açık üretim istekleri de ayrı algılanır. Tercih kaynak kanıtı sayılmaz, sayı veya olgu uydurmaya izin vermez. İletilmiş mesaj içindeki komutlar kaynak verisi olarak kalır. Aynı bağlantıya farklı bir editoryal istek verilirse eski çıktı sessizce geri dönmez; aynı isteğin tekrar iletilmesi ise aynı işi kullanır. X paylaşımı yine yalnız Paylaş düğmesiyle yapılır.

### Günlük KAP raporları ve bağımsız içerik

Editör botuna doğrudan metin, görsel veya PDF gönderilebilir; haber bağlantısı zorunlu değildir. `Talimat:` satırı kaynak olgulardan ayrı tutulur. Kısa metinler (20+ karakter) de işlenir. Önceki kaynak/karta `Talimat: ...` diye yanıt verilerek aynı kanıtla yeni içerik istenebilir.

- `/devrekesici`: İstanbul gün başlangıcından komut zamanına kadar kayıtlı bildirimleri sayar; aynı hisseyi tek satırda tekrar sayısıyla gösterir. En çok 40 hisse BIST30 → BIST100 (BIST30 hariç) → diğer önceliğiyle seçilir; grup içinde tekrar sayısı azalan, eşitlikte kod artan sıralanır. BIST50 ayrı katman değildir. Tweet ve görseller aynı seçilmiş kümeyi taşır; toplam ve gösterilmeyen hisse sayısı zorunlu kısa nottur. Ham olaylar ve tam toplamlar arşivde kalır. Güncel doğrulanmış endeks üyeliği yoksa içerik hazırlamak yerine açık uyarı verir.
- `/gerialım` (`/gerialim`): o gün yayımlanmış geri alım kayıtlarını sayar; **işlem tarihi de bugün olan** doğrulanmış alımları lot miktarına göre sıralar. Önceki günün işlemini bugün yapılmış saymaz. En yüksek 10 hisse tweet ve kartta yer alır.

Raporlar model çağrısı yapmaz; normal taslak/Telegram teslimat ve manuel X paylaşım kayıtlarını kullanır. KAP veritabanındaki `report_buybacks` tablosuna her bildirimin işlem satırları arka planda birer birer kaydedilir. Yeniden başlatmada başarıyla okunan kayıtlar tekrar indirilmez. Başarısız okumalar sınırlı tekrar edilir. Program karar tarihi ve işlem satırları bulunamayan/PDF-only kayıtlar tahmini miktarla sıralanmaz; rapor kısmi olarak işaretlenir. Sonraki program tablosu öncekinin yerine geçer; geçmiş satırlar ve program toplamı tekrar toplanmaz. Düzeltme bağlantıları korunur. Yalnız doğrulanmış borsada işlem gören pay tablosunun nominal TL miktarı işlem birimine dönüştürülür; ISKUR ve belirsiz birimler dahil edilmez.

Raporlar tüm piyasanın eksiksiz sayımı iddiasında bulunmaz; toplayıcı kapsamı, gecikme ve başarısız okumalar belirtilir. Günlük devre kesici raporu kart başına 15 satırla seçilmiş en fazla 40 hisseyi 1–3 okunaklı PNG’de gösterir; diğer şablonlar ortak 1–4 kart sınırını korur. Yalnız bu raporda onaylı gösterim seçkisi vardır: tam veri silinmez, gösterilmeyen sayı açıkça yazılır. Tweet önce #KOD dener, aynı seçki 280 karaktere sığmıyorsa hashtagsiz kod kullanır. Bu da sığmazsa kod azaltmadan mümkün kod sayısını bildirir; otomatik thread açmaz. Bu istisna dönemsel devre kesici gruplarına, geri alımın ilk-10 tweet kuralına ve AKD/takasa uygulanmaz. Toplam sayım tüm kayıtları içerir. Geri dönüşte önceki uygulama sürümü etkinleştirilebilir; eklenen önbellek tablosu silinmek zorunda değildir.

Genel manuel görsellerde OCR yardımcıdır: görüntü, mevcut Hermes gpt-6.1-terra/low üzerinden etiket–değer ilişkileriyle okunur ve ayrı görsel kontrolünden geçer. Doğrulanan görsel olgular tweetin sayı/kanıt kontrollerine aktarılır; asıl görüntü üretim ve denetim adımlarında korunur. Yapılandırılmış AKD tabloları mevcut deterministik okuyucuyu ve görsel denetimi kullanır. Görselde bulunmayan tarih/birim veya grafikten hassas fiyat türetilmez.

### SPK X takibi
`spk-x` kaynağı @spkgovtr hesabını 600 saniyede bir ücretsiz Nitter RSS üzerinden kontrol eder. Netbub, Meowing ve pp.ua sırayla denenir; X API anahtarları kullanılmaz. İlk başarılı sorgu sessiz başlangıçtır. Kimlikler ve tarama zamanı `system_state.spk_x_state` içinde kalıcıdır; haber ve takip durumu aynı transaction ile kaydedilir. Erişim/kimlik/XML hatasında takip geçmişi korunur. Son 20 gönderilik pencere ile önceki sorgu örtüşmüyorsa `coverage_gap` işaretlenir; kesintiler sırasında eksiksiz geçmiş garantisi verilmez.
Yeni paylaşım mevcut haber önizlemesine gider; kullanıcı isteyince tweet, SPK sayfasının yalnız içerik alanındaki bağlantılar/PDF'ler ve tweetin görselleri tek kanıt paketine dönüşür. PDF ve görseller mevcut okuyucu/vision ile işlenir; başarısız ek atlanmaz. Tam paket tekrar denemelerde yeniden AI okumamak için önbelleğe alınır. SPK dışı bağlantı, video veya güvenli sınırları aşan paket incelemeye kalır; bunlar tam okunmuş sayılmaz. X kopyası resmî doğrulama sayılmaz; bağlı SPK belgeleri resmî olarak işaretlenir. Kaynak kayıtlarında `enabled=0` yapılması takibi kapatır; yeniden deploy bunu geri açmaz. Mevcut kullanıcı onaylı X paylaşımı değişmez.

### Fintables X takibi
`fintables-x`, @fintables hesabını SPK ile aynı ücretsiz Nitter okuyucusuyla 10 dakikada bir kontrol eder; durumu `fintables_x_state` anahtarında bağımsız tutulur. İlk tarama eski gönderimleri sessiz kaydeder. Finansal tablo/bilanço, bilanço takvimi, sektör ve uçuş trafik verileri seçilir. Reklam, yayın/konuk duyurusu, eğitim ve bültene yönlendiren salt tanıtım devam mesajları, retweet ve konusu metinden anlaşılamayan görsel paylaşımları seçilmez. Son 20 gönderilik gerçek RSS örneğinde 10 özgün finansal/veri paylaşımı seçildi (22 Ekim 2026).

### Günlük X paylaşım raporu
Yerel haber servisi `@endeks_haber` herkese açık Nitter RSS aynalarını 5 dakikada bir okur ve İstanbul takvim gününe ait gönderi kimliklerini SQLite `system_state` içinde biriktirir. Her gün saat 23:00'te (Europe/Istanbul) gerçek Nitter kayıtlarındaki tweet saatleriyle özgün gönderi sayısı, saatler ve ardışık paylaşım aralıkları Telegram'a tek rapor olarak gönderilir; ortalama, medyan, en kısa ve en uzun aralık da hesaplanır. Retweet'ler ayrıca sayılır, özgün gönderi toplamına katılmaz. Bu rapor X API'sini ve elle “paylaşıldı” işaretlerini kullanmaz.

Nitter aynaları üçüncü taraf ve kesintiye açık olduğundan kayıtlar gün boyu gözlenir; yalnız son 20 gönderiyi veren RSS penceresi veya servis kesintisi eksik kapsama neden olabilir. Böyle durum raporda açıkça belirtilir; ayna erişilemediğinde “0 tweet” sonucu kesinmiş gibi sunulmaz. Telegram teslimatı belirsiz kalırsa aynı rapor körlemesine yeniden gönderilmez.

Üretim yalnız kullanıcı isteğiyle başlar. Paylaşımdaki bütün görseller mevcut pixel-first vision ve bağımsız denetimden geçer; OCR yardımcıdır. Görseller son üretim/denetim paketinde de korunur. Görsel denetimi bir hata bulursa en fazla bir düzeltme ve bağımsız yeniden denetim yapılır; başarısız sonuç kanıt sayılmaz. Finansallarda her tablonun karşılaştırma dönemleri, kümülatif/çeyreklik ayrımı, negatif değer, N/A, para birimi ve ölçek kontrol edilir. Şirket genel sayfası ve bilinen mobil uygulama indirme bağlantısı rapor eki sayılmaz; değişen canlı değerler eski bilanço görseline karıştırılmaz. Diğer Fintables bağlantılarında içerik alanı/PDF/ek görseller okunur; erişilemeyen, desteklenmeyen veya kayıtlı alan adı dışındaki bir ek sessizce atlanmaz, üretim durdurulur. Üyelik duvarı aşılmaz. Fintables üçüncü taraf kaynağıdır, resmî KAP doğrulaması olarak gösterilmez. Başka kaynaklardan gelen aynı olayın anlamsal tekilleştirmesi mutlak garanti değildir; mevcut önizleme/onay akışı korunur.


ChatGPT için indirilebilir çevrimdışı kart ve prompt paketi: [`exports/ENDEKS-HABER-ChatGPT.zip`](exports/ENDEKS-HABER-ChatGPT.zip). Kaynak paketi aynı dizindeki `exports/ENDEKS-HABER-ChatGPT/` klasöründe ve `scripts/export_chatgpt_kit.ts` ile yeniden üretilebilir.

KAP tweetlerinde güncel resmî KAP endeks listesinden doğrulanan BIST 30 hisselerine `#BIST30 #BIST100`, yalnız BIST 100 hisselerine `#BIST100` eklenir. Diğer hisselere endeks etiketi eklenmez. Üyelik bildirimin asıl hisse kodlarıyla eşleştirilir; PDF içindeki ilgisiz şirketlerden veya model tahmininden çıkarılmaz. Liste günlük yenilenir; doğrulaması 36 saatten eskiyse endeks etiketi üretilmez.


### Editör iş akışı ve gölge haber filtresi
Yeni RSS filtresi varsayılan `shadow` modundadır. Mevcut bildirim akışı değişmez; KAP kapsamı ile sahibin doğrudan link/metin/PDF/görsel ve açık üretim istekleri bu otomatik filtreye tabi değildir. İzinli RSS başlık/özet/link/tarih metaverisi puandan önce `news_candidates` içinde 7 gün saklanır. Tam metin arşivi açılmaz. Rota, nedenler, eşleşme güveni, kural sürümü ve eski filtre uygunluğu kaydedilir. Aynı olay kopyaları gruplanır; dönem/tutar/karar aşaması ve aynı URL'deki içerik değişimi ayrı sürüm olarak korunur.

- `/arsiv sözcük`: yedi günlük aday metaverisinde arama (ilk 20 sonuç).
- `/haberfiltre`: gölge/aktif durum ve rota dağılımı; ayar değiştirmez.
- `/golgerapor`: eski filtre altındaki adaylar dahil rota/inceleme karşılaştırması ve önizleme gecikmesi.
- `/aday <aday_id> instant|digest|archive`: insan inceleme etiketi; otomatik kural veya rota değiştirmez.
- `/olay <yeni_aday_id> <önceki_aday_id>`: açık olay ilişkisi; haber bastırmaz ve bağımsız teyit yaratmaz.
- `/secki`: acil olmayan adaylardan açık istekle içerik üretimi. Otomatik seçki varsayılan kapalıdır; önerilen saatler İstanbul 12:30 / 18:30.
- `/durum`: son tarama/üretim/teslimat sağlıkları, bekleyen ve belirsiz işler, kota/bekleme; yeni haber olmaması kaynak arızası sayılmaz.
- `/yayinurl <taslak_id> https://x.com/endeks_haber/status/<id>`: manuel yayın beyanına isteğe bağlı bağlantı; API teyidi değildir.

Kartlarda orijinal PNG, kanıt ve uygun tablo veri görünümü bulunur. Hedefli düzeltme `buy.0.value = 123 lot` gibi satır/alan yolu ile yapılır; ilk sürüm `buy/sell/holdings/metrics` altında `label/value` alanlarını destekler. Önce/sonra farkı saklanır, kaynak değiştirilmez, kullanıcı düzeltmesi ayrı ve resmî olmayan kanıt olarak mevcut denetime girer. Tweet ve kart denetimden sonra birlikte yenilenir. Sabit rapor/devre kesici kartlarına düzen değiştirme düğmesi sunulmaz.

`output_preferences` ortak kapsam sözleşmesidir: `list=all|first`, `count`, `side=buy|sell|both`, `show_time`, `show_footer`. Açık tüm-liste isteği tweetin eski beşli kesmelerine önceliklidir. Şablon kapasitesi yetmiyorsa satır atılmaz, en çok dört okunaklı kart kullanılır; dört kart da yetmiyorsa açık hata verilir ve otomatik thread açılmaz. Kısmi veri ve çelişkiler editör görünümünde korunur. Genel geri alımın ilk-N altküme toplamlarını yeniden hesaplamak henüz desteklenmez; bunun için açık hata verilir. İlk-10 geri alım ürünü mevcut varsayılanını korur.

Yayın kaydı artık revision, metin, kaynak bağlantıları ve PNG hash'inin değişmez görüntüsünü saklar. Manuel kayıt kullanıcı beyanıdır; API makbuzu ve Nitter dış gözlemi ayrı tutulur. Eski kaydın anlık görüntüsü yoksa CSV alanları bugünkü taslaktan doldurulmaz. Nitter raporu **23.00 itibarıyla** etiketlidir; tam takvim günü iddiası değildir. Gözlem kesintisi yayımlanmadı kanıtı sayılmaz.

Etkinleştirme, geri dönüş, geçiş testi ve kalan kararlar: [editör iş akışı inceleme raporu](docs/editor-workflow-review.md). Bu geliştirme push/deploy yapmadan inceleme için hazırlanmıştır.

Editör iş akışının takip düzeltmeleri, ayrı Python/OCR/build sonuçları ve güncel ZIP hash’i: [takip incelemesi](docs/editor-workflow-followup.md). Aktif filtreye geçişin sürümlü insan incelemesi şartları: [hazırlık kontrolü](docs/news-filter-readiness.md). Bu dosyalar etkinleştirme yapmaz.

Telegram ana menüleri sadeleştirilmiştir: haber önizlemesinde İçerik oluştur / ❤️ / 👎 / Diğer; hazır kartta X’te paylaş / Düzenle / Diğer. İkincil işlemler aynı karttaki açılır menüdedir; Geri ana menüye döner. Yayın sayacı `/yayinlar`, sağlık `/durum`, filtre `/haberfiltre`, gölge ve ayrı ilgi özeti `/golgerapor` ile erişilir. Beğeni seçimi yayın veya rota onayı değildir. [Güncel rehber](docs/telegram-buttons.md).

### İş Yatırım günlük geri alım tablosu ve sade panel

RSS'den bulunan tam tablo görseli mevcut yerel OCR ile okunur; bütün satırlar özgün PNG/CSV'ye, endeks önceliğiyle en çok 10 hisse tweet'e aktarılır. İşlem tarihi, nominal kaynak birimi ve boş hücreler korunur. Tekrar/düzeltme ve eski günlük raporla gün bazında çakışma kontrolü mevcut Telegram inceleme akışına bağlıdır; otomatik X paylaşımı yoktur. Ayrıntılar, kapasite ve devreye alma sınırları: [yerel doğrulama raporu](reports/buyback-preview/README.md).

Mini app'de Beğendiklerim / Beğenmediklerim ayrımı sahibin mevcut kayıtlarını salt okunur gösterir; kaynak/filtre tercihini değiştirmez. Mevcut 7 günlük panel kapsamı korunur.

Geri alımın endeks/10 hisse seçim kanıtı, resmî şirket kataloğu, v2 gölge sınıflandırması ve bütün beğeni geçmişini indiren `/golgerapor` için [23 Ekim takip raporu](docs/news-catalog-feedback-followup.md). Asgari geri bildirim metadata/karar anlık görüntüleri oy defteriyle korunur; tam haber metni içermez ve 7 günlük haber aday saklama politikasından ayrıdır. Eski karar geçmişi geriye dönük uydurulmaz. Bu yerel değişiklikler aktif filtre veya canlıya geçiş onayı değildir.

Kanal yayın programı (orijinal mesaj zamanı, Europe/Istanbul): 09:55 yalnız BIST 100 açılış seviyesi/yüzde/puan; 10:01 yalnız yükselenler, düşenler ve hacim liderleri (ilk beşer). Gün içi genel özet ve 18:11 gün sonu: endeks, katkı puanları, hacim liderleri, piyasa genişliği ve ilk beşer alıcı/satıcı kurum. Genel özette yükselen/düşen hisse listeleri ve Diğer kurum satırları gösterilmez; kaynak kaydı korunur. Bunlar borsanın resmî seans saatlerini değiştirmez. Kanal 15 saniyelik aralıklarla taranır; ağ süresi bu aralığa eklenir. Tek mesajlar ve teorik eşleşmeler ilk başarılı taramada kaydedilir; 09:53/18:05 saat beklemesi yoktur. Kanal önizlemeleri RSS taramasını beklemeden, aynı güvenli önizleme kuyruğundan gönderilir. Albümlerde eksik görsel alınmaması için 60 saniyelik sakinleşme beklemesi korunur. Hatalarda 60 saniye beklenir; Telegram FloodWait süresi ve hesap kilidi aşılmaz. Haber mesajları mevcut haber akışındadır. Geç düzenleme yeni önizleme oluşturmaz; henüz üretilmemiş kartın açık İçerik oluştur isteği en yeni kayıtlı sürümü kullanır. Hazır/belirsiz teslimat yeniden üretilmez.
