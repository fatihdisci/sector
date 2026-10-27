# ENDEKS HABER — ayrı KAP toplama hattı

## Güncel bildirim kapsamı (27 Ekim 2026)

Aşağıdaki kapsam bu dosyadaki eski bildirim kapsamı açıklamalarının önüne geçer. Şirket bildirimleri için KAP Endeksler sayfasından güncel BIST 30 veya BIST 100 üyeliği gerekir. Yeni iş ilişkisi ve yeni sözleşme başlıkları endeks koşulundan muaftır; mevcut açık başlık susturmaları ve konu tercihleri korunur. Genel sözleşme, ihale veya esas sözleşme başlıkları bu istisnaya otomatik girmez. Piyasa geneli ve doğrulanmış BIST 30 devre kesici kuralları ayrıca korunur.

Fonların adı, başlığı, özeti, kodu veya fon türünde Türkçe harf duyarsız sözcük eşleşmesiyle Tera, Pusula, Atlas ya da tasfiye varsa anlık bildirim kapsamındadır; diğer fonlar dışlanır. Bu açık istek önceki fon kapalı/özet terciğinin yerine geçer. Eşleşme KAP liste/detay metaverisinde yapılır; bu aşamada henüz indirilmemiş ekler veya tam metin aranmaz.

Endeksler KAP'ın resmî /tr/Endeksler sayfasından her başarılı yenilemeden 24 saat sonra tekrar çekilir; 30/50/100 sayıları ve altküme ilişkisi doğrulanır. Hatalarda son liste saklanır, ancak 36 saatten eski veya geçersiz listeyle üyelik kararı verilmez: yeni kayıtlar tekrar denenmek üzere bekler, hazır teslimatlar incelemeye alınır. Devre kesiciye özgü sabit dönem kanıtı başarısızsa devre kesici ayrı olarak bekler; bu durum geçerli yeni BIST 100 listesinin kaydedilmesini engellemez. Geçmiş bildirimler yeniden kuyruğa alınmaz.

## Doğrulanan sözleşme (21 Ekim 2026)

- Resmî ana sayfanın kendi JavaScript dosyaları `GET_NOTIFICATION_DATA_LIGHT = api/disclosure/list/light` yolunu kullanıyor. `GET https://www.kap.org.tr/tr/api/disclosure/list/light` kimliksiz 200 JSON döndürdü. Bu site içi keşif kaynağıdır; lisanslı MKK API bağlantısı veya sürüm garantili API değildir.
- Detaylar `https://www.kap.org.tr/tr/Bildirim/{id}` üzerinden Accept:text/html ile okunuyor. Güncel örnekler: 1685154 (devre kesici), 1685148 (fon), 1685001 (geri alım), 1685126 (şirket), 1684874 (finansal rapor). Başlangıç kimliği olarak sabitlenmezler.
- Next.js Flight içindeki `disclosureBasic` mevcut. Detay tarihi `YYYY.MM.DD HH:mm:ss`, keşif listesi tarihi `DD.MM.YYYY HH:mm:ss`; ikisi de İstanbul saati. 1685155 kontrol anında HTTP 404 döndürdü; bu sadece o kimliğin o andaki durumudur.
- Endeksler: `https://www.kap.org.tr/tr/Endeksler`; XU030/XU100 içerikleri Flight içinde. Güncel canlı veri üzerinde sayı, kod ve altküme doğrulaması yapılır; eski sabit liste taşınmaz.
- Bir finansal rapor HTML'si yaklaşık 5 MB: eski küçük haber okuyucu sınırı kullanılmaz. KAP için 16 MiB üst sınır ve gövdeyi de kapsayan 12 saniye süre sınırı vardır. Sınır aşımı hatadır.

## Uygulama sırası ve davranış ayrımı

1. Güvenli Flight okuyucu, metadata, İstanbul tarihi, hisse/ilgili hisse ayrımı ve etiketli tablolar.
2. Saf deterministik saklama/gönderim kuralları; varsayılan fon kapalı, diğer önemli şirketler açık, endeks önceliği açık. Pay işlemleri fon-kapalı kontrolünden sonra, başlık istisnalarından önce geçer. BIST 50 kısıtı **yoktur**.
3. Yeni, yalnız KAP'a ait SQLite veritabanı. Kaynak, akış, kuyruk ve cursor tek transaction; kimlik/üyelik benzersizlikleri. RSS/AI tablolarına yazılmaz.
4. Ayrı kalıcı canlı/geçmiş/uzlaştırma/endeks işleri. Eski canlı 3 kayıt, 30 saniye/yoğunlukta 5 saniye; geçmiş 3 kayıt/10 dakika ve sessiz son 24 saat davranışı korunur.
5. Yeni iyileştirme: güncel keşif listesinden başlangıç, bulunamayan kimlikler için kalıcı tekrar deneme ve bağımsız uzlaştırma. Parse/HTTP/erişim hatası 404 değildir; parse hatasında canlı cursor ilerlemez. Başka kimlikler bağımsız uzlaştırmada alınabilir. Sonraki gerçek kimlik görülmüşse 404 boşluğu kayıt altına alınarak tarama ilerleyebilir; boşluk tekrar denenmeye devam eder. Bu durumda cursor “kalıcı olarak hesabı tutulmuş tarama sınırı”dır; bütün önceki kimliklerin geçerli bildirim olduğunu iddia etmez.
6. Devre kesici kayıtları ayrı kuyruk düzenleyicisinde üç dakikalık saat pencereleriyle tek grupta sabitlenir (örneğin 10:30–10:33). Kontrol üç dakika sınırlarında yapılır; aynı penceredeki kayıtlar 100 üyelik parçalara bölünmez. Canlı taramanın sınıra ulaşması beklenmez. Toplayıcının çıktısı teslimata hazır kuyruktur; devre kesici gönderimi kapalıdır.
7. Offline hata/regresyon testleri ve gerçek sayfalarda salt okunur sözleşme kontrolü. İlk aşamada yalnız toplama servisi kuruldu. Sonraki kullanıcı talebiyle aşağıdaki bağımsız Telegram tüketicisi bağlandı; X bağlantısı yoktur; kullanıcı talebiyle tam belgeye dayalı AI üretimi eklenmiştir.

## Sınırlar

Keşif uç noktası değişebilir veya sınırlı bir zaman aralığı gösterebilir. 24 saatlik liste uzlaştırması geçmişin tamamını garanti etmez; kalıcı sıralı cursor ve tekrar denemeler tamamlayıcıdır. Boşluklar silinmez; çözülmeyenler sağlık çıktısında görünür. Endeks erişimi bozulursa son doğrulanan liste ve yaşı gösterilir; ilk doğrulama yoksa endeks önceliği karar üretmez.

Tam metin yalnız `.disclosureScrollableArea` içeriği ve tablolarından çıkarılır. Özet tam metin yerine kullanılmaz. Ek bağlantıları ayrıca döner; PDF içeriği alınmış gibi sunulmaz. Sitedeki erişim kontrolleri aşılmaz, MKK anahtarı kullanılmaz. Haricî teslimat ayrı tüketicide yapılır; `sent_at` başarılı Telegram yanıtında yazılır. Exactly-once teslimat iddiası yoktur.

## Çalıştırma ve işletim

- Kod: `src/kap/`; bağımsız giriş: `scripts/kap_service.ts`.
- Kurulum: `python3 scripts/install_kap.py`. Yalnız `com.sectorhaber.kap` servisini yönetir. Ana Hermes ve haber servisine dokunmaz. KAP'a ayrılmış önceki uygulama kopyası `previous-app` altında tutulur.
- Veriler: `~/Library/Application Support/sector-haber/kap/kap.sqlite`; dosya 0600, klasör 0700, WAL ve foreign key açık, ayrı `SKAP` uygulama kimliği. Yanlış veritabanıyla açılış reddedilir.
- `npm run kap:status`: canlı/geçmiş cursor, son başarı/hata, tekrar deneme bekleyen kimlikler, kuyruk büyüklüğü, endeks yaşı ve keşif kapsamını gösterir. `cursorLagIds` bildirim adedi veya saniye gecikmesi değildir; kimlik farkıdır.
- `npm run kap:probe`: beş güncel türde salt okunur sözleşme testi; çıktı `reports/kap-contract.json`.
- `npm run kap:once -- --db /tmp/sector-kap-check.sqlite`: ayrı veritabanıyla tek toplama turu; hiçbir dış mesaj göndermez.
- `node --import tsx scripts/kap_service.ts --full-text NUMARA`: gerçek detay gövdesi, tablolar, işlem tarihleri, karar tarihleri ve ek bağlantıları. PDF'ler `not_fetched`; eksik gövde `unavailable`, eksik ek listesi `links_incomplete` olarak işaretlenir.
- Tercihler: `kap.preferences.example.json` örneğini düzenleyip `node --import tsx scripts/kap_service.ts --preferences /mutlak/yol/tercihler.json` ile uygula. Şema doğrulanır; devre kesici kapatılınca hazır devre kesiciler susturulur. Tüketici diğer tercihleri de teslimattan önce yeniden değerlendirir. Konular: `dividend`, `buyback`, `financial`, `capital`, `business`, `share_trade`, `circuit`, `other`.
- Canlı, geçmiş ve uzlaştırma ayrı kiralarla korunur. En çok iki eşzamanlı HTTP isteği; tamamı için 12 saniye zaman aşımı. Her canlı/geçmiş/uzlaştırma turunda en çok üç detay isteği. Hatalar 30/60/120/240/300 saniye bekler. Keşif 60 saniyede, endeks başarılı yenilemeden 24 saat sonra çalışır.
- Başlangıçta bulunan kimlik aralığı ve başlangıç zamanından eski yayınlar sessizdir. Başlangıç tarihçesi yalnız 3 kayıt/10 dakika geçmiş işiyle doldurulur; uzlaştırma bu sınırı topluca aşmaz. Geçmiş doldurma bu nedenle yavaştır ve son 24 saat penceresi dışında kalanlar akışa eklenmez.
- Kaynak `disclosures`, kullanıcı akışı `feed`, karar ve teslimata hazır işler `queue/queue_members` tablolarında; filtrelenenlerin kimlikleri `checks` içinde tutulur. Aynı kaynak kimliği ikinci akış veya kuyruk işi üretmez. Farklı düzeltme kimlikleri birleştirilmez.
- Fon özet tercihi ilgili kaydı 19:00 İstanbul zamanına erteleyen `digest` kuyruğu oluşturur. Özet metni hazırlamak/göndermek bu kapsamda yoktur.
- `src/kap-delivery.ts` tüketicisi haber servisi içinde bağımsız döngüdür; en yeni hazır anlık bildirimden başlayarak 5 saniyede bir ilerler. Sessiz başlangıç/geçmiş kayıtları gönderilmez. Hazır kayıtlar sırf RSS yaş sınırından dolayı silinmez.

## Güncel tercih: devre kesici gönderimi kapalı

`circuitNotifications: false` varsayılandır ve eski tercih kayıtlarında alan yoksa da kapalı kabul edilir. Başlık veya özette devre kesici saptanırsa hisse takibi, endeks önceliği ve pay işlemi istisnasından önce gönderim engellenir. Kaynak/akış kayıtları korunur; hazır devre kesici kuyrukları silinmeden `suppressed` yapılır. Henüz kapanmamış gruplar da gönderime kapalı kaydedilir.

Yeni iş ilişkisi, sözleşme, ihale, sipariş, finansal rapor/tablolar ve bilanço `business`/`financial` konularında kalır. Temettü ve önemli sermaye işlemleri de mevcut önemli bildirim kapsamındadır. Rutin fon raporları ve susturulan başlıklar açılmaz. Toplayıcı yalnız kayıt/kuyruk üretir; ayrı Telegram tüketicisi uygun anlık kayıtları teslim eder.

## Telegram tüketicisi

`kap_model_jobs` kuyruk kimliğini haber servisindeki model işiyle ilişkilendirir. KAP kaydı ancak ortak Telegram göndericisi başarılı mesaj kimliği kaydettiğinde `sent` olur. Belirsiz teslimat otomatik tekrarlanmaz. En fazla iki KAP model işi eşzamanlı bekler; hazırlama hataları en fazla üç deneme alır. Toplayıcı, belge okuma/model üretimi ve teslimat bağımsızdır.

Tam HTML metni ve satır/sütun birleşimleri açılmış tablolar okunur. Her resmî dosya eki indirilir; Java byte[] taşıma sarmalayıcısı kod çalıştırmadan doğrulanır. PDF'nin tüm sayfaları ve tabloları çıkarılır. Taranmış sayfalar Apple Vision OCR ile okunur; sayfa görüntüleri hem yazara hem bağımsız denetçiye verilir. Okunamayan/eksik, 20 MB üzeri, 200 sayfa üzeri veya 20 görsel sayfayı aşan belgeler kısmen sunulmaz; incelemeye ayrılır. İşlem tarihi, kurul kararı ve yayın tarihi ayrı tutulur. Geri alım programı gerçekleşmiş işlem gibi yazılmaz.

Bir bildirim tek görsel, tweet ve Kaynağı aç düğmesi olarak gönderilir. Her KAP numarası ayrı olaydır; başlık benzerliği farklı bildirimleri birleştirmez. Model bütçesi haberlerden ayrıdır; abonelik kotası ortaktır. Fon özeti tüketicisi yoktur; fonlar ve devre kesiciler kapalı kalır. `deliveryEnabled` son 60 saniyedeki tüketici kalp atışını gösterir.

## ENDEKS yayın odağı

Önemli iş/sipariş/ihale/sözleşme; finansal sonuç, bilanço/faaliyet raporu; geri alım, pay işlemleri, temettü ve sermaye işlemleri korunur. `kap.preferences.example.json` bu konulara devre kesiciyi ve doğrulanmış BIST 30/100 önceliğini ekler. Diğer şirketler dışlanmaz. Genel kütüphane varsayılanı eski tercih sözleşmesini korur; mevcut tercihler kurulumla kendiliğinden değişmez.

Devre kesiciler üç dakikalık sabitlenmiş gruplarla ayrı `circuit` içeriği olur. Grubun her üyesinin resmî tam metni okunur; tek AI işi ve tek görselli Telegram kartı hazırlanır. Eksik kaynak metadata ile tamamlanmaz. Tweet, kaynakta doğrulanan durdurmayı kısa geçmiş zamanlı metinle aktarır; bütün doğrulanmış hisse kodları tweetin en üst başlık satırında hashtag olarak tek kez gösterilir. Tek tek saat, fiyat ve gerekçe listesi yazılmaz. Görselde büyük DEVRE KESİCİ başlığının altında, yalnız kaynakla doğrulanan `card_data.tickers` listesinden üretilen #KOD ızgarası bulunur. Kalabalık gruplarda daha sıkı yerleşim kullanılır; kodlar gizlenmez, kesilmez veya +N ile değiştirilmez. Saat veya modelin ayrıntı metni görsele taşınmaz. Diğer KAP konularının 30/5 saniyelik toplama aralığı korunur. Grubun ilk resmî bildirimi aynı mesajdaki Kaynağı aç düğmesindedir; bütün üyeler kanıt belgelerinde saklanır.

Devre kesici tercihi kapalıdan açığa geçerken `circuit_since` etkinleştirme zamanı kaydedilir. Bu zamandan eski yayınlar ve eski susturulmuş kuyruklar yeniden açılmaz. KAP'ın saniye çözünürlüğündeki yayın saati etkinleştirmeden önce kalıyorsa bildirim sessiz tutulur. Kapatma, AI/teslimat bekleyen grupları da susturur. Gönderimden hemen önce bütün üyeler yeniden tercihe göre denetlenir.

Doğrulanmış günlük BIST 30/100 listesi hem kaynak belgelerindeki `index_tier` alanını hem iş sıralamasını besler. Endeks önceliği zamanla sınırlı bir avantajdır (8/4 dakika); diğer şirketlerin önemli bildirimleri kuyrukta kalıcı olarak geriye atılmaz. Yönetim/personel formları ve derecelendirmeler susturulur; pay işlemlerinin BIST 50 kısıtlaması yoktur.

### Devre kesici ve pay işlemi bildirimlerinde hisse kapsamı (22 Ekim 2026)
Devre kesici, pay alım-satım ve pay geri alımı bildirimleri yalnız kullanıcının ekran görüntülerinden aktarılan son halka arz grubu (`NETGL, BKRGY, INTET, KPEKS, CITAS, VEYAS, TKNKA, KARCL, QUICK, MASFN, ALBTN, METEN, SARAE, ISVEA`), fon krizinden etkilenen grup (`KTLEV, TRHOL, TEHOL, ODINE, GUNDG, OZATD, DSTKF, KARCL, ASTOR`) veya o anda KAP'tan doğrulanmış BIST 30/100 üyeliği bulunan hisseler için kuyruğa alınır. Ekran görüntülerindeki `MASFN` kodu, KAP'ın resmî 2026/4 dönem PDF'sinde de `MASFN — MASFEN ENERJİ` olarak doğrulanmıştır.

Güncel endeks bileşenleri koda gömülmez: KAP `/tr/Endeksler` sayfası günde bir okunur; 30/50/100 üye sayısı, kod biçimi ve altküme ilişkisi doğrulanır. 2026/4 dönem değişikliklerinin resmî KAP bildirimi 21 Eylül 2026'da yayımlandı ve 1 Ekim–31 Aralık dönemi için geçerlidir; dönem içi KAP değişiklikleri de günlük sayfa yenilemesine yansır. Sayfa ilk kurulumu sırasında henüz doğrulanmamışsa bu özel bildirim türleri kapalı kalır. Başarısız güncellemede son doğrulanmış liste korunur.

Bu kapsam yalnızca devre kesici, pay alım-satım ve geri alım sinyallerini sınırlar; diğer önemli şirket açıklamaları mevcut kurallarla işlem görmeye devam eder. Kapsam dışı özel işlem bildirimleri kaynak/akış geçmişinde saklanır ancak Telegram kuyruğuna alınmaz. Bu gruptaki bir halka arz hissesinin KAP tweet'inin etiketlerine sona `#HalkaArz` eklenir; diğer bildirimlere bu etiket eklenmez. Gelecek halka arzlar ve kullanıcı tarafından değişen kriz hisseleri `src/kap/ticker-scope.ts` içindeki listede yönetilir.

Güncelleme: `python3 scripts/install_kap.py --update`. Haber servisiyle aynı doğrulanmış staging, başlangıç kapısı ve otomatik geri dönüş kullanılır. Yalnız `com.sectorhaber.kap` yönetilir; bot/Hermes erişim bilgileri yüklenmez ve tercihler değiştirilmez. Ayrıntılı kontrollü etkinleştirme: [ENDEKS.md](ENDEKS.md).

## Hızlı doğrulama ve sınırlı yeniden inceleme

KAP tablo hücreleri birimleriyle birlikte satır pasajlarına dönüştürülür; orijinal metin ve tablolar korunur. Sayı/birim kontrolü modelin mevcut tek düzeltme turuna geri bildirim sağlar. Yanlış/yuvarlanmış sayı kontrolü kaldırılmaz. İçerik doğrulama hatasında bütün model hattı 60 saniye yerine 2 saniye bekler; kota ve bağlantı beklemeleri korunur. Sayı kanıtları her kontrol için bir kez indekslenir.

`node --import tsx scripts/review_kap.ts` yeniden inceleme adaylarını gösterir; `--apply` son 24 saatteki uygun hata kayıtlarını sürüm başına yalnız bir kez `retry_pending` durumuna alır. Yeni işler bu yeniden denemelerden önce işlenir. Mevcut filtreye uymayanlar susturulur, tamamlanmış veya belirsizlik içeren taslaklar otomatik onaylanmaz. Kaynak kayıtları silinmez.

## Hazırlama hatalarında kontrollü toparlanma

Kaynak keşfi ile içerik hazırlama ayrı izlenir. Toplanmış fakat model denetiminde kalan kayıt, taramada kaçmış sayılmaz. Hazır yeni işler önce işlenir; son 24 saatin tam kaynaklı KAP model hataları günlük KAP bütçesinden sayılarak en fazla iki ek deneme alır. İlk deneme için en az 30 saniye, ek denemeler arasında en az 5 dakika beklenir. Denetim gerekçeleri `model_reviews` içinde iş başına saklanır ve sonraki yazım turuna aktarılır. Tamamlanmış taslaklar, eksik belgeler ve belirsiz Telegram teslimatı otomatik yeniden üretilmez. İncelemede kalan kuyruk varsa sağlık durumu `idle` yerine `needs_review` gösterir.

Boş “İlgili Fonlar” alanı veya geri alım bütçesindeki “fon” sözcüğü şirket haberini fon haberi yapmaz. Gerçek fon/TEFAS/PBLK içeriklerinin etiketleri korunur. Alıntı metni aynı belgede birebir varsa yanlış paragraf kimliği bağımsız denetimden önce düzeltilir; alıntı, rakam veya iddia değiştirilmez. Kaynakta olmayan alıntı onaylanmaz; düzeltme turuna gerçek pasaj bilgisi verilir.

Kaynak içi ikincil çelişki aktarılacak olguları etkilemiyorsa `source_notes` içinde saklanabilir. Bu notlar Telegram metnine eklenmez. Aktarılan tutar, taraf, dönem veya işlem niteliğini etkileyen belirsizlik `uncertainties` içinde kalır ve teslimatı engeller. Her iki alan da bağımsız kaynak denetçisine açıktır.

Günlük komut raporları: `/devrekesici`, `/gerialım`. Üyelik okuyucu artık resmî Endeksler sayfasında 30/50/100 sayıları ve 30 ⊂ 50 ⊂ 100 ilişkisini doğrular. Güncelleme başarısız olursa önceki doğrulanmış kayıt korunur. Rapor miktar önbelleği ve kapsam sınırları README'de açıklanmıştır; canlı toplama cursor'u veya bildirim tercihleri değiştirilmez.

Başlığında “Esas Sözleşme” geçen bildirimler zorunlu olarak susturulur; pay işlemi önceliği ve takip listesi bu yasağı aşamaz. Haber metnindeki sıradan esas sözleşme atıfları yeni iş/geri alım bildirimini engellemez.

MKK kaynaklı `Borçlanma Araçları, Yatırım Fonları ve Varant İtfa/Kupon/Getiri/Nakdi Uzlaşı Ödeme İşlemleri` başlığı, sonuna eklenen şirket kodlarından bağımsız olarak zorunlu susturulur. Kural yayımlayıcı unvanı ile başlık birlikte eşleştiğinde uygulanır; MKK'nın diğer duyurularını veya ilgili hisselerin şirket bildirimlerini engellemez. Kuyruğa giriş ve son teslim kontrolü aynı kuralı kullanır; kaynak geçmişi silinmez.

### Genel geri alım tablosu
`/genelgerialım` (ASCII: `/genelgerialim`) komut saatine kadar sisteme alınmış, İstanbul gününe ait KAP pay geri alımlarını tüm hisselerle gösterir. `/gerialım` ilk 10 lot sıralaması olarak kalır. Genel rapor işlem fiyatı doğrulanmış hisselerde toplam tutara göre sıralanır; lot, lot ağırlıklı ortalama fiyat ve tutar gösterir. Fiyatın kaynağı etiketli işlem fiyatı sütunudur (TL/Adet dahil); aralık veya okunamayan fiyat tahmin edilmez. Kümülatif geçmiş tablolar son şirket/program/hisse snapshot'ıyla, düzeltmeler ilişkili OID ile değiştirilir. Aynı tabloda aynı miktarlı iki işlem ayrı işlem kalır.

Fiyatlar mikro TL, miktarlar binde bir lot ölçeğinde tam sayı hesaplanır; yalnız gösterimde yuvarlanır. Fiyatı eksik hissenin lotu gösterilir, fiyat/tutar `—` olur; üst toplam doğrulanmış fiyatlı hisselerle sınırlı ve kısmi etiketlidir. İşlem miktarı okunamayan yeni bildirim, o şirketin eski tablosundan yanıltıcı toplam üretilmesini engeller. Önbelleğin ek `version` sütunu eski güncel kayıtları fiyat okuması için kontrollü yeniler; geçmiş veritabanı silinmez. Toplayıcı gecikmesi, eksik kayıt ve okuma bekleyenler açıkça belirtilir; rapor tüm KAP piyasasının eksiksiz toplamı garantisi değildir.

Genel tablo için 1/2/3 sütun ve artan PNG yüksekliği kullanılır; 150 şirket testinde 3300×3485 PNG üretilir. Satırlar kesilmez. Telegram önizlemesi küçülebileceği için `Orijinal PNG indir` dosyayı sıkıştırılmadan verir. `CSV indir` UTF-8 BOM, noktalı virgül ayırıcı ve kaynak bağlantılarıyla Excel uyumlu tam listeyi verir. Genel rapor AI çağrısı veya X yayını başlatmaz. `reports/general-buyback/sample-*.png` yalnız kurmaca tasarım testidir, gerçek veri değildir.

Genel geri alım görseli beyaz zemin ve lacivert yazılar kullanır. Marka ve ana başlık tuval genişliğiyle ölçeklenerek büyük kalır; yalnız tablo satırları şirket sayısına göre sıklaşır.
