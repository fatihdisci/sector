# Sade Telegram arayüzü

## Haber önizlemesi

Ana menüde yalnız **İçerik oluştur**, **❤️**, **👎** ve **Diğer** görünür.

- İçerik oluştur: mevcut tam kaynak okuma/model/kanıt denetimiyle tweet ve görsel hazırlar. Yinelenen istek yeni model işi oluşturmaz.
- ❤️: haber/konu ilgimi çekiyor. Yayın onayı, paylaşıldı işareti veya acil rota değildir.
- 👎: bu tarz haber istemiyorum. Şirketi/kaynağı otomatik susturmaz.
- Aynı geri bildirim düğmesine tekrar basmak seçimi kaldırır; diğerine basmak değiştirir. Seçim `✓` ile görünür. Yerel inline düğmelerdir; native reaksiyon teslimatına veya grup sohbetine dayanmaz.
- Diğer: Kaynağı aç; ilgili filtre adayı hâlâ kayıtlıysa Tekrar haber/Acil değil; gerekiyorsa belirsiz teslimat için açık yeniden gönderim onayı; Geri.

Diğer/Geri ve beğeni seçimleri yalnız mevcut mesajın klavyesini değiştirir. Ayrı teşekkür veya menü mesajı oluşturmaz. Mevcut ayrıntılı geri bildirimler silinmez. Sahip, kaynak article/candidate kimliği ve callback makbuzu kaydedilir. Tekrarlı/eski callback seçim değiştirmez; tıklanmama olumsuz sayılmaz. `/golgerapor` ilgi seçimlerini üç rotalı insan incelemesinden ayrı gösterir.

## Hazır tweet–görsel

Ana menü: **Hemen paylaş**, **Zamanla**, **Düzenle**, **Diğer**. X düğmesi bağlantı/uygunluk koşullarına bağlıdır; gerçek tweet+görsel yayını için açık onaydır. Sahip, revision, süre, medya, X sağlayıcısının geçerli hesap/API sınırları ve tekrar/belirsiz sonuç korumaları korunur.

Diğer menüsünde yalnız o içerikte kullanılabilen işlemler görünür:

| İşlem | Etkisi |
|---|---|
| Kaynağı aç | Asıl kaynağı açar. |
| Tasarımı değiştir | Aynı kartta düzen seçeneklerini açar. Sabit devre kesici/rapor şablonunda yoktur. Rastgele veya adlandırılmış düzen seçilince metin/kanıt korunur. |
| PNG indir | Orijinal PNG dosyasını gönderir. Panoya kopyalama veya yeni AI üretimi değildir. |
| Elle paylaştım | Manuel yayın beyanını kaydeder. X'e paylaşmaz. |
| Ertele | Manuel erteleme işaretidir; otomatik gönderim planlamaz. |
| Kanıtlar | Editöre kaynak/iddia/dayanak/belirsizlik görünümünü açar. |
| Tablo verileri | Uygun yapılandırılmış tablo/rapor satırlarını gösterir. |
| Hücre düzelt | Uygun tablolarda hedefli düzeltme ister; fark kaydı ve mevcut denetim akışı korunur. |
| CSV indir | Genel geri alım raporunda CSV verir. |
| Geri | Aynı kartın ana menüsüne döner. |

**Yayımlanmış:** yalnız Yayın özeti ve Diğer. Özet bu içeriğin yöntem/zamanını gösterir. Manuel saati düzelt/İşareti geri al yalnız uygun manuel kayıtta bulunur; X'teki tweeti silmez. API yayını veya sonucu belirsiz işlem manuel geri alınamaz. Sıradaki/belirsiz API işleminde ikinci paylaşım düğmesi gösterilmez.

**Ertelenmiş:** Hazıra al ve Diğer. Hazıra al erteleme işaretini kaldırır; yayın başlatmaz.

Metni kopyala düğmesi yoktur. Genel yayın sayacı `/yayinlar`, sistem sağlığı `/durum`, filtre `/haberfiltre`, gölge/ilgi raporu `/golgerapor` ile ana komut menüsündedir. Haber paneli mevcut Mini App'i açar. Bu arayüz değişikliği filtreyi veya seçkiyi etkinleştirmez.

## Eski kartların geçişi

`refresh_telegram_menus.ts` yalnız `editMessageReplyMarkup` kullanır; metin, caption, görsel, revision veya yayın durumunu değiştirmez. Sadece mevcut mesaj kimliği ve sürümü hâlâ eşleşen kartlar yenilenir. Aynı mesaj kimliği tekrar planlanmaz. Özel yerel JSON makbuzuyla yeniden başlatılabilir; 429 beklemesi ve sınırlı retry vardır. Kaynak/kanıt veya menü açma testleri sahte taşıyıcılarla yapılır; gerçek X yayını testi yapılmaz. Eski sürümsüz manuel yayın/copy callback'leri güncel menüye yönlendirilir; sürümlü kontroller sunucuda yeniden doğrulanır.
