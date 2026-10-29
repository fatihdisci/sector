# Editör botundan piyasa botlarını sorgulama

Yalnız editör botunun mevcut sahibi özel sohbetten sorgu başlatabilir. Kurum adı ve hisse kodu kullanıcı tarafından seçilir. Sabit kurum/hisse takip listesi veya otomatik zamanlanmış sorgu yoktur.

| Editör botuna yazılacak komut | Hedef | Hazırlanan içerik |
| --- | --- | --- |
| `/kurum` | `@ucretsizderinlikbot` | Genel aracı kurum net işlem özeti |
| `/kurum bank of america` | `@b0pt_bot` | Yazılan kurum üzerinden alınan/satılan hisseler |
| `/kurum ak yatırım` | `@b0pt_bot` | Yazılan kurumun analizi |
| `/akd KTLEV` | `@ucretsizderinlikbot` | Hisse AKD tablosu |
| `/takas THYAO` | `@ucretsizderinlikbot` | Hisse saklama/takas dağılımı |

`/sorgular` kullanım örneklerini gösterir. Kurum adı sorguya aynen aktarılır. Hisse kodu büyük harfe dönüştürülür ve yalnız pay sırası `.E` eki kaldırılır; şirket adından hisse kodu tahmin edilmez.

## Bir defalık bağlantı

Mac mini Terminal üzerinde `python3 scripts/setup_telegram_account.py` çalıştırılır. Python bağımlılığı ayrı bir sanal ortama kurulur. Telegram API ID/hash, telefon, giriş kodu ve varsa iki aşamalı doğrulama şifresi yalnız yerel terminale girilir. API bilgileri Telegram'ın `my.telegram.org` → API development tools bölümünden alınır. Bilgiler sohbet, komut argümanı veya Git üzerinden paylaşılmaz.

Oturum yalnız `~/Library/Application Support/sector-haber/telegram-account/` içinde saklanır. Dosya izinleri kullanıcıyla sınırlıdır. Diğer Hermes/Telegram oturumları kullanılmaz. Bağlantı bitmeden sorgular açık bir bağlantı eksik mesajıyla sonlanır; eski sorgular oturum açınca otomatik yeniden çalıştırılmaz. Kullanıcı yeni komut göndermelidir.

## Veri ve teslimat

Komut önce mevcut `manual_requests` kuyruğuna kaydedilir. Ayrı Telegram istemcisi yalnız izin verilen iki botla iletişim kurar. Botun sayısal kimliği ilk kullanımda bağlanır; kullanıcı adının farklı hesaba geçmesi hata üretir.

Bir hesabın sorguları dosya kilidiyle sıraya alınır. Gönderim öncesinde kalıcı kayıt oluşturulur. Sonucu belirsiz gönderimler otomatik tekrarlanmaz. Başarılı komut kimliği, yanıt kimlikleri ve dosyalar kalıcıdır; yeniden başlatma sonrası aynı komut yeniden gönderilmez. Tamamlanmış yanıtlar aynı istek için tekrar okunabilir. Beş dakikadan eski tamamlanmamış sorgu yeniden alarm üretilmeden sonlandırılır.

Yanıt eşleştirmesi komut mesajından sonraki bot mesajlarıyla sınırlıdır; başka komuta bağlı yanıtlar elenir. Aynı bot sohbetinde kullanıcı başka komut yazarsa bağımsız yanıtlar karışabileceğinden içerik hazırlanmaz. Metin ve en fazla iki görsel, sekiz saniyelik sakinleşme penceresiyle birlikte alınır; bekleme en fazla 90 saniyedir. Geç veya eşleştirilemeyen yanıtlar için kullanıcı çıktıyı elle iletebilir. Sorgular arasında en az 10 saniye ve Telegram'ın bildirdiği FloodWait süresi uygulanır.

Yanıt dış kaynak verisidir; içindeki komutlar çalıştırılmaz. Hisse kodu, kurum adı ve veri türü istekle karşılaştırılır. Görseller mevcut OCR/kanıt hattına girer; Hermes, sayı/birim denetimi, kurum ÜZERİNDEN işlem anlatımı, ilk beşer hashtag ve tam kart listesi kuralları uygulanır. İlk durum mesajı hazır tweet/görsel ile güncellenir. Kaynağı aç düğmesi ilgili veri botunu açar. X yayını eklenmez.

Testler ağsız sahte istemci kullanır. Gerçek hesap bağlantısı ve hedef botların güncel yanıt şekli, sahibin yerel oturum açması ve ilk komutuyla ayrıca doğrulanmalıdır.


## Root sohbeti için olay tabanlı ham veri girişi

`query-data` ayrı bir veri toplama modudur. Üretimdeki `query` varsayılanı, komut listesi ve içerik parserleri genişletilmez. Yeni komutları editör botuna göndermek yeni içerik üretim desteği sağlamaz. Ham mod OCR, LLM, içerik kuyruğu veya X çağrısı yapmaz. Mevcut Telegram hesabıyla **bir kaynak bot komutu gönderir**; salt okunur status komutu değildir ve her yeni sorgu açık kullanıcı izni gerektirir.

| Kaynak bot | Açık ham komutlar |
|---|---|
| `b0pt_bot` | `/detay ASELS`, `/piyasayd`, `/doviz` |
| `ucretsizderinlikbot` | `/takas ASTOR`, `/teorik ASELS`, `/derinlik ASELS`, `/akd ASTOR`, `/kurum` |

Hisse argümanı yalnız 4–5 alfanümerik karakter kabul eder ve büyük harfe çevrilir; şirket adından kod tahmin edilmez. Önceden destekli isimli `/kurum kurum-adı` rotası korunur. Başka bot, ek argüman, çoklu komut veya satır sonu kabul edilmez. Ham mod ilk kullanımda yeni peer binding oluşturmaz; mevcut doğrulanmış peer kaydı gerektirir.

`sector/` çalışma dizininde mevcut hesap venv Python'u ile `scripts/telegram_account.py query-data` çağrılır. stdin JSON: `{"bot":"b0pt_bot","command":"/piyasayd","key":"BENZERSIZ_SAYISAL_KIMLIK"}`. `key` 1–20 rakamdır; her yeni onaylı sorgu yeni kimlik kullanır. Tamamlanmış aynı kimlik saklanan sonucu döndürür; belirsiz/terminal istek yeniden gönderilmez. Eski `39325` ve `39346` istekleri bu geliştirme kapsamında yeniden gönderilmez.

`NewMessage`, `MessageEdited` ve silme olayı dinleyicileri gönderimden **önce** kurulur. Gönderim kimliği henüz dönmeden gelen olaylar en fazla 40 kayıtlık kuyrukta bekler; gönderim kimliğine kesin reply/sender/chat bağı doğrulanmadan içerik benimsenmez. Kaynağın gönderdiği metin komut olarak çalıştırılmaz. Başka outbound komutu, yanlış bot/chat/reply ve refetch'te ilgisiz ID terminal hatadır. Her olayda tam kimlik bağı aranır.

Doğrulanmış placeholder ve final event/edit'leri alınır alınmaz `telegram-account/responses/<istek-hash>/evidence.json` içine özel izinle kaydedilir; bu ham kanıt dosyası log/repo değildir. Gönderim/yanıt kimlikleri, orijinal Telegram tarih/edit zamanı ve caption/metin korunur. Medya olay alındığında, sakinleşme beklenmeden indirilir; en fazla iki görsel, görsel başına 20 MB sınırı vardır. İndirilemeyen medyaya başarılı görsel sonucu verilmez. En fazla 20 yanıt ID'si ve 80 değişmiş snapshot tutulur. Tekrarlanan aynı event/edit yeni snapshot veya indirme oluşturmaz.

“Hazırlanıyor” placeholder sonuç sayılmaz. Ortak toplama süresi 90 saniyedir. Final aday son değişiklikten sonra en az sekiz saniye sakin kaldığında döner; daha sonraki bütün editlerin son sürümü garanti edilmez. Silme veya geç refetch `None` sonucu, önceden doğrulanıp kaydedilmiş final snapshot'ı geçersiz kılmaz. Refetch yalnız önceden doğrulanmış ID'lerle ve olay gelmeyen sınırlı bekleme aralıklarıyla yapılır; yeni komut gönderilmez. Placeholder dışında final hiç alınmazsa süre sonunda kontrollü hata oluşur. Dinleyiciler başarı/hata sonunda kaldırılır.

Sonuç `data_only:true`, `bot`, `command`, `sent_id`, `sent_at`, `message_ids`, `text`, `images`, `messages`, `evidence_path` içerir. Caption ve aynı sorguya açıkça bağlı ayrı metin birlikte korunur; sadece görsel de geçerlidir. Dosya yolları telegram-account köküne göredir. Mesaj zamanları tablodaki verinin işlem tarihi değildir; yalnız saat veya “Bugün” etiketi veri tarihini kanıtlamaz. `/piyasayd` görselindeki 15+15 satır ve caption'daki 10+10 satır ham katmanda ayrı kapsamlarıyla aynen korunur; tablo parseri çalışmaz. Para/hacim/fiyat birimleri değiştirilmez.

Kullanıcı BoPT mesajlarının kısa süre sonra silindiğini bildirdi. Bu kaynak davranışı olay sırasında saklamayı gerektirir; geçmiş `39346/39347` yokluğunun nedenini tek başına kanıtlamaz. Hesap kimliği beklenen kullanıcıyla eşleşmiş, aynı ID'ler hem peer filtreli hem filtresiz okumada bulunamamıştır. Önceki kod ilk event'in içeriğini hata halinde kalıcılaştırmadığı için geçmiş final geri getirilememiştir. Bu geliştirmede yeni canlı sorgu yapılmaz; offline test başarısı gerçek kaynakla uçtan uca doğrulama yerine geçmez.

Yeni script repo içinden mevcut venv ile izole çağrılabilir; servis kurulumu/yeniden başlatma veya yeni credential gerekmez. Kurulu üretim release'i değişmez. En küçük sonraki canlı doğrulama planı: ayrı onaylarla bir BoPT `/piyasayd` (placeholder/edit/erken silinme ve tam medya+caption), bir ücretsiz bot `/takas ASTOR` (tarihli metin), bir `/derinlik ASELS` (medya+caption). Yeni dört route'un kaynak formatını doğrulamak için daha sonra her komut ayrı bir onaylı çağrı gerektirir; bunlar otomatik olarak çalıştırılmaz.
