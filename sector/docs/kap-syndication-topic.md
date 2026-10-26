# Sendikasyon başlık filtresi

Yalnız resmî KAP konu başlığı Türkçe karakter/büyük-küçük harf/boşluk normalizasyonundan sonra tam olarak `Sendikasyon Kredisi Hakkında` ise teslimat kapalıdır. Gövdedeki ifade, başka kredi/finansman başlığı ve uzatılmış başlıklar bu dar kuralla engellenmez. Takip listesi ve endeks önceliği açık başlık engelini aşamaz.

Hafif listede kesin başlık varsa ID/zaman/neden `checks` kaydına alınır, ayrıntı/ek/model/kart işlemi açılmaz. Ayrıntı metaverisi üzerinden gelen aynı konu da üretim öncesinde durur. Önceden kuyruğa girmiş gönderilmemiş işler mevcut son uygunluk kontrolünden geçer. Gönderilmiş veya sonucu belirsiz kayıtlar silinmez ve yeniden gönderilmez. Eski kaynaklar silinmez, notification_start/cursor tercihleri sıfırlanmaz.

Bu bir kategori genellemesi değildir. Geri dönüş önceki uygulama/plist sürümüne yapılır; güncel veritabanı eski yedekle değiştirilmez. BIST30 devre kesici politikası korunur.
