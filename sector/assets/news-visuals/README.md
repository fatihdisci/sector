# Haber genel görsel havuzu — kapalı hazırlık

Dört Library referansı, koordinatörden aktarılan kırmızı vurgulu yatay SON DAKİKA görselleridir. Bu native çalışma ağacında dosyaları/pikselleri veya doğrulanmış hash'leri yoktur. `manifest.json` referans kaydıdır; indirildi, incelendi veya kullanılabilir kabul edildiği anlamına gelmez. Önceki Library/app erişim reddi nedeniyle başka erişim yolu veya tekrar denenmedi. Yeni görsel üretilmedi.

`src/news-visual-plan.ts` yalnız ayrımı açıklar. Son dakika sınıfı ayrıca doğrulanmadıkça bu havuz normal haberlere uygulanmaz. Normal haber için SON DAKİKA yazmayan ayrı yatay genel görseller eksiktir. Veri kartları siyah/kırık beyazdır; kırmızı izni yalnız gerçek son dakika varlıklarına aittir.

Gelecekte desteklenen yolla dosyalar sağlanıp pikselleri, boyutları, hakları ve SHA256 doğrulandıktan sonra yerel `local_path`/`sha256` alanları doldurulmalıdır. Bu teslim bunları etkinleştirmez. X paylaşımı yalnız sahibin açık Paylaş eylemiyle yapılır.
