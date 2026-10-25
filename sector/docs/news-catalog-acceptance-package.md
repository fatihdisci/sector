# Sahip incelemesi için en küçük katalog/kapsam karar paketi

25 Ekim 2026 09:35 TRT — yalnız salt okunur kaynak karşılaştırması. Bu belge onay kaydı değildir.

## Kodun gerçekten istediği

`src/news-readiness.ts` içindeki `newsReadiness()` tek `entity_review` kaydının sahip kimliğini, gerçek zamanını ve sıralanmış ad/kod listesinin hash’ini doğrular. Her farklı kod için `sources` içinde KAP/Borsa İstanbul HTTPS URL’si ve inceleme zamanından ileri olmayan `checked_at` ister. Aynı resmî liste URL’si birden çok kod için kullanılabilir. Kod 710 ayrı insan onayı veya her satırın tek tek okunduğunu gösteren 710 kayıt istemez. Önceki “tek tek insan incelemesi zorunlu” ifadesi belge yorumu ile teknik koşulu karıştırıyordu.

`scope_review` tek sahip kabulü + zaman + hash ister. Hash; sıralı watchlist, entity hash, digest_enabled ve digest_times alanlarını kapsar. Boş takip listesi bilinçli kapsam olarak kabul edilebilir. Bu iki kabul kaydı şu an yoktur; kaynak karşılaştırması veya 12 rota onayı bunları otomatik oluşturmaz.

## Kaynak ve çalıştırılan kontroller

- Resmî liste: https://www.kap.org.tr/tr/bist-sirketler
- İndirme: 2026-10-23T11:48:46.074Z (23 Ekim 14:48:46 TRT); bugün yeniden çekilmiş güncel piyasa listesi iddiası yok.
- Katalog: `kap-companies-2026-10-23-v2-9349306c1bc7`
- Dosya SHA256: `cffbff22a41205bc088e2485e279deae52c49ee3b4f328c6cfd24585bfd11958`
- Orijinal resmî HTML SHA256: `d99e4e7d4ae5d75c2e0cd6fda2efc643d1ba9466452e247658590ad391376423` — yerelde tutulan kaynakla eşleşti.
- 710 kayıt, 710 tekil kod, 710 tekil kuruluş OID. Kaynak kod–yasal unvan–OID karşılaştırmasında 0 uyuşmazlık.
- Katalog kayıtları hash’i doğrulandı. Normalize ad/aliasın farklı kodlarla çakışması: 0. Kabul edilen kaynak altkümesinde eksik/fazla kayıt: 0.
- Aktiflik sınırı: yalnız KAP listesindeki `kapMemberType=IGS` ve tek kod biçimi kontrol edildi. Kaynak alanlarında işlemde/askıda/kottan çıkmış durumu yok. 710 kaydın tamamının bugün işlem gören pay olduğu veya güncel aktiflik durumu doğrulanmış değildir.

## Değişen aliasların tam listesi (v1 → v2)

| Kod | Alias | Kaynaktaki yasal unvan |
|---|---|---|
| ARCLK | Arçelik | ARÇELİK A.Ş. |
| ASTOR | Astor Enerji | ASTOR ENERJİ A.Ş. |
| BYDNR | Baydöner | BAYDÖNER RESTORANLARI A.Ş. |
| KCHOL | Koç Holding | KOÇ HOLDİNG A.Ş. |
| NETAS | Netaş | NETAŞ TELEKOMÜNİKASYON A.Ş. |
| THYAO | Türk Hava Yolları | TÜRK HAVA YOLLARI A.O. |

Bu altı eşleştirme yukarıdaki KAP listesindeki ayırt edici unvanlardan açıkça seçildi; marka/iştirak çıkarımı yapılmadı. Diğer mevcut aliaslar:
- AKFGY: Akfen GYO, Akfen Gayrimenkul Yatırım Ortaklığı
- ASELS: Aselsan
- BIMAS: BİM, Bim Birleşik Mağazalar
- CRFSA: CarrefourSA
- EBEBK: Ebebek
- EREGL: Erdemir, Ereğli Demir ve Çelik

EREGL alias kaynağı: https://www.kap.org.tr/tr/sirket-bilgileri/ozet/944-eregli-demir-ve-celik-fabrikalari-t-a-s ; 23 Ekim 2026 11:52:48 UTC. Yerel orijinal profil hash’i `2c8754d8e921570f76ccab061872ffe9217c85f2b709c7afbe52484ee6c5526a` eşleşti. Diğerleri kaynak yasal unvanından; GYO ve BİM gibi kısaltmalar açık kuraldır, bağımsız başka kaynak teyidi iddiası yok.

## Belirsizlikler ve kapsam kayıpları

- Carrefour → CRFSA, QNB Yatırım → QNB banka ve genel Borusan → tek şirket eşleştirmesi yapılmaz. KOCHL otomatik KCHOL düzeltilmez. Fon kodları pay kodu sayılmaz. İştirak/ana şirket ve ASELSAN NET, Erdemir Madencilik gibi dışlanan bağlamlar korunur.
- Kaynakta 45 çok-kodlu kuruluş kataloğa alınmamış. Bu güvenli belirsizlik tercihinin gerçek kapsama maliyeti var: GARAN, ISCTR, YKBNK, VAKBN, HALKB, KRDMD ve ISMEN gibi paylar da katalogda yok. Bunların ad/kod doğrulaması bu katalogla yapılamaz. Mevcut görev bu eşlemeleri sessizce genişletmez.
- Tam dışlanan kaynak kod grupları: AKM, AKMEN; AFB, AKTIF; ALBRK, ALK; ALNUS, ANC; ADB, ADBNK; ATA, ATAYM; AYTEM, YYA; A1CAP, ACP; BLS, BLSMD; BRGAN, BUR; FBB, FBBNK; GRM, GRYAT; GLB, GLBMD; HALKI, HLY; HDFYB, HYB; ICB, ICBCT; IAZ, INVAZ; INFO, IYF; ISMEN, IYM; KRDMA, KRDMB, KRDMD; MRBAS, MRS; MEKMD, MSA; MDASM, MDS; MSY, MSYBN; NRBNK, NYB; OMD, OSMEN; OYA, OYYAT; PBT, PBTR; QYATB, YBQ; FIN, QNBTR; SKY, SKYMD; SEK, SKBNK; TAC, TCRYT; TAE, TRBNK; TERA, TRA; TRMEN, TVM; GARAN, TGB; HALKB, THL; EXIMB, THR; ISATR, ISBTR, ISCTR, ISKUR, TIB; KLN, KLNMA; TSK, TSKB; TVB, VAKBN; YKR, YKYAT; YKB, YKBNK.

## İncelenecek takip kapsamı

- Yalnız KAP dışı otomatik haber rotası. Manuel istekler ve KAP kapsamı değişmez. BIST/Türkiye ekonomisi öncelikli; somut yatırımcı etkisi olan küresel gelişmeler korunur. Kaynak güvenilirliği rota kararıyla aynı şey değildir.
- Ek watchlist boş. Katalogda endeks üyeliği alanı yok; bu nedenle mevcut varsayılan haber eşleştirmelerinde BIST30/100 önceliği eklenmiş sayılmaz. KAP’ın ayrı endeks filtresi korunur.
- Onaylanmış 12 taze örnek: 2 instant / 8 digest / 2 archive. Bu etiketler korunuyor; tekrar istenmiyor. Like/dislike politika veya yasak değildir.
- Planlanan seçki 12:30 ve 18:30 Europe/Istanbul; sayfa başına 10, tüm uygun gruplar sayfalı. Şu an shadow/off. Aktivasyon olursa yeni kesimle eski haber replay’i önlenir.

## Parent’ın kullanıcıya sunacağı tek somut karar

“Bu kaynak/tarih/hash ile tanımlanan mevcut katalog ve açıkça belirtilen kapsam eksiklerini (45 çok-kodlu kuruluş ve bağımsız aktiflik teyidi yokluğu dahil), ad/alias eşleştirme politikası ve boş ek takip listesiyle haber filtresinin bu sürümü için kabul ediyor musun; yoksa önce çok-kodlu kuruluş/aktiflik doğrulamasını mı tamamlayalım? 12 haber rota onayı zaten korunuyor; tekrar istenmiyor.”

Bu karar henüz alınmış gibi işaretlenmedi. Sahip kabul ederse gerçek kaynak referansları ve gerçek kabul zamanı ile tek entity_review/scope_review kaydı bağlanabilir; eski tarih veya 710 ayrı insan kontrolü uydurulmaz. Kabul yoksa shadow/off ve kurulum/aktivasyon bu kapıda durur.
