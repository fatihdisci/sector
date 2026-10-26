# BIST30 devre kesici kapsamı

Pay bazlı devre kesiciler için sürümlü `circuit_policy` etkinleştirildiğinde yalnız doğrulanmış BIST30 kodları işlenir. Kod içermeyen resmî endekse bağlı/piyasa geneli devre kesiciler ayrı olay olarak korunur. Diğer KAP türleri ve mevcut tercihler değişmez. Karışık grubun tweet/görsel kapsamına dışlanan kodlar dahil edilmez.

Resmî üyelik kanıtı `src/data/circuit-bist30-2026q4.json`: KAP Endeksler sayfası ile Borsa İstanbul'un 1666347 numaralı dönem duyurusu, 01.10.2026–31.12.2026. Mevcut indeks taraması bu üyeleri, kaynak hash'ini ve alınma zamanını doğrular. 36 saatten eski, değişmiş veya dönem dışı liste pay bildirimlerini incelemeye alır; piyasa geneli istisnasını durdurmaz. Yeni dönem/üye değişikliği için yeni resmî kanıt, test ve incelenmiş sürüm gerekir; sessiz üyelik tahmini yapılmaz.

Kesin resmî hafif liste metaverisi yeterliyse kapsam dışı ayrıntı sayfası indirilmez. Eksik/ambiguous listede yalnız temel ayrıntı metaverisi okunur; kapsam dışı için tam metin, ek, PDF/görsel, model ve kart üretimi açılmaz. Bu ağ maliyetinin sıfır olduğu anlamına gelmez. `circuit_light` yalnız ID, zamanlar, neden ve liste sürümünü saklar; 7 gün TTL ve 20.000 satır üst sınırı vardır. Geçmiş kaynaklar silinmez. Bilinmeyenler hariç sayılmaz, görünür inceleme kaydı olur.

Etkinleştirme mevcut notification_start/circuit_since/cursor değerlerini sıfırlamaz. Eski gönderimler ve uncertain kayıtlar yeniden oynatılmaz. İndeks erişimi düzeldiğinde yeni bildirimler normal akışa döner; daha önce incelemeye ayrılan hafif kayıtlar onaylanmış sayılmaz. Sağlık görünümü problem/review ve bekleyen teslimatları gösterir. İnsan değerlendirmesi olmadan geçmiş toplu retry yapılmaz.

Kurulum: aynı kaynak için başarılı CI, iki veritabanının tutarlı yerel yedeği ve şema provası, mevcut staged installer, ardından taze resmî üyelik kanıtıyla policy aktivasyonu. Geri dönüş uygulama/plist yollarını geri alır; güncel veritabanlarını eski kopyayla değiştirmez. Eski kod yeni kapsamı uygulayamadığı için uygulama geri dönüşünden önce yalnız devre kesici teslimatı durdurulmalıdır; diğer tercihler ve defterler korunur.
