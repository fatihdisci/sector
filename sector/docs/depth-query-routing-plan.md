# Yerel derinlik denemesi — yayımlanmadı

Hedef yönlendirme: `@ucretsizderinlikbot`: `/derinlik`, `/takas`, `/akd`; `@b0pt_bot`: `/kurum`, `/doviz`, `/viop`, `/piyasayd`. Bu liste planı belirtir; mevcut üretim botuna yeni komut eklemez. Kullanıcının 30 Ekim'de sağladığı VİOP ve döviz yanıtları örnek niteliğindedir; doğrulanmış kabul profili veya sorgu etkinleştirilmez. Döviz örneğinde XU100 metni 10759, görseli 10760 gösteriyor; çelişki giderilmeden değer seçilmez.

`src/depth-limit-candidate.ts` yalnız yerel deneydir; veri edinme, görselin tamamlığını veya veri ölçüm zamanını kendisi doğrulamaz, girişte doğrulanmış kanıt gerektirir. Tam çerçeve, eksiksiz iki taraf, doğrulanmış taze ölçüm zamanı ve resmî takvimde sürekli seans gerekir. Eksik taraf boş taraf sayılmaz. Tavan/taban açık belirtiliyorsa ilgili en iyi fiyat eşleşmelidir. Sonuç adaydır; toplam kademe miktarı kullanılmaz. İki tarafın boşluğu, yinelenmiş fiyat, teorik eşleşme, tatil, kapanış veya bilinmeyen/stale zaman tavan/taban iddiası üretmez. Telegram mesajının alınma zamanı veri ölçüm zamanı olarak kullanılamaz.

Sonraki adım: görsel okuyucusunun tamlık, her iki taraf ve gerçek ölçüm zamanı için kanıt üretmesini ayrı testlerle bağlamak; örneklerle `/viop` profilini ve dövizdeki değer farklarını doğrulamak. Bu belge herhangi bir sorguyu veya yayını etkinleştirmez.
