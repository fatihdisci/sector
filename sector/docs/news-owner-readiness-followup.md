# Taze yayın onaylarının hazırlık kapısına bağlanması

25 Ekim 2026. Kapsam yalnız haber filtresi hazırlık bağlantısıdır. `0d4e4a12` KAP değişikliği main'de korunur, bu release'e dahil edilmez. Panel, KAP servisi, DNS/TLS/ağ/kimlik bilgileri ve X işlemleri kapsam dışıdır.

## Kanıt ve değerlendirme

Mevcut gerçek onayın soru/yanıt referansı `Sentinel_fa4f5e1442888191960ea833fbd582cb` / `Sentinel_22ec5289383c8191be6646295d350e78`. Onay paketi hash'i `5f271abb3a76b70ea132e6d92ce8bc54e448df88c31e92e745ddc975489e92ea`.

Doğru kaynak görüntüsü hash'i: `5e630206f0fdd55e89b3e239bde18b52384063864a5a992334993b266649022d`.

Orijinal kod paketi `0c5d15dd7ef8ffb03873ab71e9767ea0dd6d13b53e411938b28e0bc3ede24d80`, katalog `cffbff22a41205bc088e2485e279deae52c49ee3b4f328c6cfd24585bfd11958`, incelenen kapsam `ceb1494cdb0951f21b8ac6d58a7692e579d578b7fc2af64402864cc6eb83a0f9`. Yeni hazırlık adapterinin farklı kod hash'i ayrı tutulur; eski insan onayı yeni kodu görmüş gibi sunulmaz. Sınıflandırma, şirket eşleme ve teslim dosyaları onaylı halleriyle birebir kalır.

Gerçek paketin salt okunur yeniden değerlendirmesi: 12 etiket, 2 instant / 8 digest / 2 archive; kritik kaçırma 0, önemli arşivleme 0, yanlış kritik 0. Bu sonuç yayın + 1 dakika taze bağlam simülasyonudur. Tarihsel etiket sayısı 0; eksik click-time görüntüsü veya news_feedback etiketi oluşturulmaz. Onaylı paketin eksik/tekrarlı satır, sahte kaynak, bozuk/stale kod/katalog/kapsam/örnek hash'i, yanlış sahip veya yetersiz legacy/rota kapsamıyla kabul edilmediği test edilir.

## Gerçek kalan kapılar

`entity_review` yok: mevcut katalog hash’i için sahip adına verilmiş inceleme-kabul kaydı ve her farklı kod için resmî kaynak/zaman referansı yoktur. Kod 710 ayrı onay veya 710 ayrı tıklama istemez; tek entity_review kaydı ile kaynak kapsamını kontrol eder. Her satırın insan tarafından okunması önceki belgedeki inceleme yöntemidir, kodun ölçebildiği bir koşul değildir. `scope_review` yok: şirket listesi, boş takip listesi ve seçki ayarlarına bağlı sürümlü kapsam kabul kaydı yoktur. Onaylı 12 haber bu iki kabulün yerine geçirilmez. Katalog oluşturma kaynakları insan incelemesi olarak etiketlenmez. Ayrıntılı ve sınırlı karar paketi: news-catalog-acceptance-package.md. Dolayısıyla ready=false; shadow ve otomatik seçki kapalı kalır. Aktivasyon başlangıcı ve etkin sonraki slot yoktur; 12:30/18:30 yalnız yapılandırılmış varsayılan saatlerdir. Aynı 12 haber için yeniden onay gerekmez.

## TEST kanıtının sınırı

Korunan tek makbuz `TEST:Sentinel_2bddd04ab8d48191b398b8d7e4a7d94f`, sent, Telegram 3189, bir deneme ve üç örnektir. Bu, aynı sahip sohbetine sendMessage + pick callback taşımasını doğrular; gerçek planlı çok sayfalı teslimat veya yeni gate'in geçmişte çalıştığı kanıtı değildir. Mevcut pick akışı ve sendSelection taşıması değişmedi. 25 grup için 10+10+5, 429, uncertain ve restart davranışı sahte taşıyıcılarla test edilir. Yeni gerçek TEST gönderilmez.

## Release ayrımı ve geri dönüş

Main üzerinde yalnız bu filtre patch'i ayrı commit edilir. Kurulacak release, canlı temel d513419'dan bu tek commit'in `cherry-pick -x` uygulanmasıyla ayrı commit olarak hazırlanır; KAP commit'i ata değildir. İki commit'in de CI'si beklenir. Ana commit/release commit, kaynak dosya hash manifesti ve hariç tutulan KAP commit'i yerel release source.json'a yazılır. Bu bir main commit'ini çalışıyor gibi göstermez.

Staged yalnız haber kurulumu öncesinde tutarlı SQLite ve özel yapılandırma yedeği alınır. Yeni özel bağlam paketi doğrulandıktan sonra eklenir; mevcut onaylar, oylar, history ve TEST makbuzu değişmez. Şema değişikliği yoktur. Rollback uygulama/plist yolunu geri getirir; canlı DB üzerine eski yedek yazmaz. Mevcut shadow/off durumunda rollback ek bir tercih değişikliği gerektirmez. İleride gerçek onayla aktive edilirse rollback ayrıca shadow/off ve yeni önizleme kesimi gerektirir; uncertain makbuzları tekrar gönderilmez.
