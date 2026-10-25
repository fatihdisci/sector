# Haber filtresi: sürümlü hazırlık incelemesi

Bu belge canlı etkinleştirme talimatı veya onayı değildir. Bu çalışma sırasında hiçbir üretim hazırlık kaydı yazılmadı. Aktif mod isteği tek başına yeterli değildir; etkili mod `newsPreferences()` tarafından hesaplanır.

## Salt okunur inceleme aracı

Sahip erişimli `/golgerapor`, güncel kural sürümünü, şirket/kapsam/etiket örneklemi hash'lerini, inceleme adaylarını ve son insan etiketlerine göre gerçek hata sayılarını verir. Uzun rapor dosya olarak gelir. Rapor üretmek onay kaydı oluşturmaz. `/haberfiltre` istenen/etkili modu, seçkinin yapılandırmasını, gerçek gönderim durumunu ve eksik hazırlık nedenlerini ayrı gösterir. Gölge modda otomatik seçki gönderimi kapalıdır; sahibin `/secki` isteği otomatik etkinleştirme değildir.

Gerçek inceleme için:

1. `entities` içindeki ad–kod eşleştirmelerinin kaynak ve kapsamını incele. Kod, tek bir entity_review kabulü ile her kod için resmî kaynak/zaman referansı ister; kişi başına 710 ayrı tıklama ya da her satırın insan tarafından okunduğuna dair ayrı kayıt şartı yoktur. Satır bazında inceleme önerilen doğrulama yöntemidir; otomatik kaynak karşılaştırması insan kabulü yerine geçmez. Ad benzerliği/iştirak ilişkisi yeterli değildir. Her kod için resmî HTTPS bağlantısını ve gerçek kontrol zamanını kaydet.
2. Takip listesi, endeks kapsamı ve seçki saatlerini gözden geçir. Boş takip listesi de bilinçli olarak incelenmelidir. Kaynak güvenilirliği rota doğruluğu anlamına gelmez.
3. `/golgerapor` adaylarını kaynaklarıyla incele; `/aday <kimlik> instant|digest|archive` ile beklenen rotayı etiketle. Karar/beklenti, iddia/yalanlama, yeni dönem bilançosu, endeks dışı şirket, şirket adı içermeyen makro olay ve kopyaları örnekleme dahil et. Eski filtreye takılan adayları da incele.
4. En az 12 gerçek etiket, üç beklenen rota ve `legacy_eligible=0/1` gruplarının ikisi gerekir. Bu yalnız asgari kabul tabanıdır; 12 etiket bütün trafiğin hatasız olduğunu kanıtlamaz. Kritik kaçırma, önemli haberi arşivleme ve yanlış kritik sayıları sıfır olmalı; yoksa kuralları düzeltip etiketlerle yeniden karşılaştır. Etiket yoksa doğruluk ölçülmüş sayılmaz.
5. Raporun güncel `hashes.entities`, `hashes.scope`, `hashes.sample` değerlerini ve gerçek sonuçları insan gözden geçirir. Sonrasında ayrıca yetkilendirilmiş bir geçiş çalışmasında aşağıdaki şemaya uygun kayıt oluşturulabilir. Bu teslim kaydı üretmez ve otomatik onaylayıcı içermez.

## Hazırlık kaydı sözleşmesi

`system_state.news_filter_readiness` JSON'u `NewsReadinessRecord` tipindedir (`src/news-readiness.ts`). Gerekli alanlar:

- `version`: `NEWS_READINESS_VERSION` (şu anda 2), `rule_version`: rapordaki güncel kural sürümü.
- `entity_review`: `hash` rapordaki şirket hash'i; `reviewer` sahip Telegram kimliği; `reviewed_at` gerçek inceleme zamanı (epoch milisaniye); `sources` her kod için `{code,url,checked_at}`. Resmî bağlantı yalnız referanstır; gerçek insan kaynak kontrolünün yerine geçmez.
- `scope_review`: aynı reviewer/zaman alanları, `hash` rapordaki kapsam hash'i.
- `evaluation_review`: aynı reviewer/zaman alanları, `hash` rapordaki etiketli örneklem hash'i ve gerçek insan kabulünden sonra `accepted=true`.

Gelecek tarihli inceleme, başka inceleyici, eski sürüm, değişmiş sözlük/takip kapsamı/seçki ayarları, değişmiş veya eksik etiket örneklemi geçerli sayılmaz. Sürekli yeni ve etiketsiz aday gelmesi mevcut etiket örneklemini değiştirmez. Etiket, karar veya incelenmiş aday metni değişirse örneklem hash'i değişir; tekrar inceleme gerekir. Sahip onayı da ayrıca `approved_by_owner=true` olmalıdır.

Seçki kapalıysa belirsiz fakat önemli şirket haberleri yalnız seçkiye düşüp görünmez kalabilir. Bu sürüm seçki kapalı veya saatsizken aktif moda geçişi engeller; haberleri sessizce arşive atmaz. Geçerli `activated_at` olmadan da geçiş olmaz. Hazırlık yoksa etkili mod gölgedir; eski bildirim filtresi sürer. Seçkiyi açmadan aktif filtre kullanmak için ileride açıkça tasarlanıp incelenmiş başka bir görünür teslim yolu gerekir.

Onaylı geçişte önizleme başlangıcı ve `activated_at` gerçek geçiş anına ayarlanmalı; eski arşiv Telegram'a boşaltılmamalıdır. Geri dönüş `mode=shadow`, ayrı seçki kapalı ve önizleme başlangıcı dönüş anına alınarak yapılır; kaynaklar, teslim makbuzları ve uncertain kayıtları silinmez veya tekrar oynatılmaz. Bunlar bu çalışma sırasında uygulanmadı.

## Sürüm 2: gerçek taze yayın bağlamı onayları

`fresh_publication_owner_review` ayrı bir inceleme kaynağıdır. Onay kaynağı/soru/yanıt referansları ve orijinal örnek/kod/katalog/kapsam hash'leri `news-owner-review-anchor.json` içindeki doğrulanmış referansla eşleşmelidir. Bu dosya yeni onay üretmez; mevcut sahibin belirli paketini tanımlar. Asıl özel paket `system_state.news_owner_review_binding` içinde tutulur; haber metinleri veya kullanıcı seçimleri Git'e eklenmez.

Yeni adapter, onaylanmış sınıflandırma ve teslim dosyalarının birebir aynı kalmasını şart koşar. Eski `news-readiness.ts` hash'i yeni kodun hash'i gibi gösterilmez: orijinal kod hash'i korunur, hazırlık adapter sürümü ve çalışan kaynak dosyalarının yeni parmak izi ayrıca raporlanır. Kural/katalog/kapsam değişikliği bu onayı otomatik taşımaz. Kayıtlar sahibin gerçek kimliğiyle, tam ve tekil örnek kümesiyle, değişmez kaynak görüntüsüyle ve her satırdaki kaynak/bağlam kanıtıyla eşleşmelidir. Sahte/kayıp kaynak, eksik/tekrarlı örnek, stale hash, üç rota veya eski filtre tarafı eksikliği reddedilir.

Geçerli pakette `metrics` taze bağlamı ölçer, `metric_basis` bunu açıklar; `historical_metrics` ve eski labels ayrı kalır. Her örnek yayın + 1 dakika simülasyonuyla yeniden değerlendirilir; bu geçmişte verilmiş gerçek karar veya tarihsel doğruluk oranı değildir. Kabul edilen etiketler çıktıyı zorla değiştirmez; ölçülen kritik hatalar aktivasyonu yine engeller. Beğeniler kullanılmaz.

Mevcut onaylı 12 örnek 2 anlık / 8 seçki / 2 arşiv olarak doğrulanmıştır. Bu, katalog hash’i ve kaynak kapsamının insan tarafından kabul edildiği anlamına gelmez. `entity_review` ve `scope_review` kapıları korunur; eksik kodlar `missing_evidence.company_codes` içinde ayrı raporlanır. Aynı 12 örnek için yeniden onay istenmez.

Yerel `scripts/bind_owner_review.ts <database> <private-binding.json>` varsayılan salt okunur doğrulama yapar; açık `--apply` yalnız doğrulanan bağlam paketini, eski kayıt üzerine yazmadan ekler. `TELEGRAM_USER_ID` güvenli ortamdan alınır. Güncel DB yedeği ve kontrollü kurulum olmadan üretimde çalıştırılmaz. Tercih, oy, tarihsel etiket, TEST veya yayın makbuzu değiştirmez.
