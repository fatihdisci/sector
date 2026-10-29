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


## Root sohbeti için ham veri girişi

Yalnız `@b0pt_bot /piyasayd` için ayrı `query-data` modu vardır. Üretimdeki `query` varsayılanı ve 10+10 metin tamlık kontrolü değişmez. Ham mod OCR, LLM, içerik kuyruğu veya X çağrısı yapmaz; kaynak oturumunu kullanarak bir Telegram komutu gönderir. Bu nedenle aşağıdaki giriş yalnız tek sorgu için açık izin verildiğinde çalıştırılmalıdır; okuma/status komutu değildir.

`sector/` çalışma dizininde, mevcut hesap sanal ortamındaki Python ile `scripts/telegram_account.py query-data` çalışır. stdin JSON şeması: `{"bot":"b0pt_bot","command":"/piyasayd","key":"BENZERSIZ_SAYISAL_KIMLIK"}`; `key` 1–20 rakamdır. Her yeni onaylı sorgu yeni kimlik kullanır. Tamamlanan aynı kimlik kayıtlı sonucu döndürür; terminal/belirsiz istekler yeniden gönderilmez. Üretim ve ham mod arasında aynı tamamlanmış kimlik kullanılamaz.

Ham sonuç `data_only:true`, `bot`, `command`, `message_ids`, `text`, `images`, `messages` ve varsa `received_at` içerir. `messages` içinde mesaj/reply/sender/chat kimlikleri ile Telegram tarih/edit zamanı bulunur. Bunlar tablodaki verinin işlem tarihi değildir. Caption ve aynı sorguya açıkça bağlı ayrı metin birlikte korunur. Metinsiz medya kabul edilir; `images` dosyaları mevcut telegram-account köküne göre göreli yollardır, en fazla iki görsel ve dosya başına 20 MB sınırı vardır.

“Hazırlanıyor” benzeri placeholder sonuç sayılmaz. Aynı ID düzenlemeleri ve sorguya bağlı ek yanıtlar, ortak 90 saniyelik toplama süresi içinde izlenir. Metin/görsel adayı son değişiklikten sonra en az sekiz saniye sakin kaldığında döner; bundan sonraki bütün düzenlemelerin son sürümünü garanti etmez. Geçici `None` okuma hiçbir yeni kimlik/bağ üretmez ve süreyi erken kesmez; yeniden okuma en az bekleme aralıklarıyla sınırlıdır. Yanlış bot/chat/reply/ID çelişkisi terminal hatadır. Hata kaydı yalnız neden/faz (`initial`, `followup`, `refetch`), eksik okuma sayıları ve doğrulanmış mesaj ID'lerini içerir; kaynak içeriği veya sır içermez.

Yeni script repo içinden, mevcut hesap venv'iyle izole çağrılabilir; servis kurulumu veya yeniden başlatma gerektirmez. Bu, kurulu üretim release'ini değiştirmez. Gerçek Telegram bağlantısı ve veri güncelliği ayrıca tek kontrollü sorguyla doğrulanmalıdır.
