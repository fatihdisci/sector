# Şirket/pay kodu katalog karar paketi — 25 Ekim 2026

Bu belge yeni kapsamın teknik inceleme paketidir; insan kabulü veya aktif filtre izni değildir. Önceki 45 çok-kodlu kuruluşu toptan dışlayan yaklaşım kaldırıldı. KAP filtresi, panel, canlı kayıtlar ve gönderim defteri değiştirilmedi.

## Kaynak ve ayrım
- Katalog: `kap-equities-2026-10-25-v3-d35b3b466e3b`; dosya SHA256 `0cfd919e2e164f84d801eb6d693d20bd0bf4af75b79d95d0dc71a058293f327c`.
- 755 kuruluş OID, 604 kanıtlı pay kodu, 600 payı doğrulanmış kuruluş; 155 kuruluş için pay türü henüz doğrulanmadı.
- Resmî şirket başlığındaki virgüllü kodlar yalnız kuruluş ilişkisini gösterir; kurum üye/borçlanma/pay ayrımı sayılmaz. XUTUM içerik satırındaki stockCode + mkkMemberOid veya şirket profilindeki Fiili Dolaşımdaki Paylar / Borsa Kodu alanı pay kanıtıdır. Her pay satırında URL, alınma zamanı, kaynak hash’i ve alan adı vardır.
- BIST30/100 üyeliği bu katalogda öncelik alanı olarak kullanılmaz. XUTUM yalnız araç türü kanıtıdır. Güncel işlem/askı/kottan çıkma durumu bütün kayıtlarda unknown; aktif işlem iddiası yok.
- Kuruluş listesi: https://www.kap.org.tr/tr/bist-sirketler, 2026-10-25T06:43:29.689841+00:00, SHA256 `500cb49c4051b78251ea4e1f6ed915d64a455513ac9f1a3e55fc6a5773c2723f`.
- XUTUM görüntüsü: https://www.kap.org.tr/tr/Endeksler, 2026-10-25T06:44:38.204672+00:00, SHA256 `7a5dfeaccccb4828846a91656744f163fb94c156112a707985d39b1c1317bf3a`.
- 99 profil projeksiyonu alındı; 96 profil isteği sonuçlanmadı. Son doğrudan deneme HTTP 429 döndü. Eksik profil, pay yokluğu veya kottan çıkma kanıtı değildir. Yeniden istek yağmuru yapılmadı.
- ISATR/ISBTR/ISCTR ve KRDMA/KRDMB/KRDMD aynı OID altında ayrı paylardır. Genel İş Bankası/Kardemir adı tek sınıfa veya tüm sınıflara çevrilmez: kuruluş ve aday sınıflar ayrıca gösterilir. ISKUR başlıkta mevcut, eldeki tür kanıtında yok; unresolved korunur, TIB ile birlikte rastgele paylaştırılmaz.
- QNB Yatırım banka payı sayılmaz; Borusan ve yabancı Carrefour belirsizliği, KOCHL yazımının düzeltilmemesi, iştirak/negatif bağlam korumaları geçerlidir.

## Kod farkı
Yeni kanıtla kazanılan 21 kod: A1CAP, ALBRK, GARAN, GLBMD, HALKB, ICBCT, INFO, ISATR, ISBTR, ISCTR, ISMEN, KRDMA, KRDMB, KRDMD, OSMEN, OYYAT, SKBNK, SKYMD, TSKB, VAKBN, YKBNK.
Önceki tek-kod varsayımından pay kanıtı bulunamayan 127 kod: ADLVY, AKCVR, AKDFA, AKFK, AKSFA, AKTVK, ALJF, ARSNF, ARSVY, ATAVK, ATLFA, BLKOM, BNPPI, BRGFK, BRKT, CAGFA, CLKMT, CMSAN, DENFA, DENVA, DFKTR, DGRVK, DIMES, DKVRL, DKYVK, DMLKT, DNFIN, DNYVA, DNZEN, DOGVY, DRPHN, DTRND, DVRLK, DYBNK, ECZIP, EKER, EKOFA, EKTVK, EMIRV, EMVAR, ERGLI, FAIRF, FIGOF, FKPET, GARFL, GGBVK, GSIPD, GYVAR, HALKF, HAYVK, HDFFL, HDFVK, HLVKS, HUZFA, INALR, ISBIR, ISFAK, ISTFK, ISTVY, ISYAT, KATVK, KENT, KERVN, KFILO, KLVKS, KNTFA, KOCFN, KONTR, KORTS, KPTGY, KSFIN, KSTUR, KTKVK, KTSVK, MBFTR, MDIAZ, MEGAP, MILKS, MINTF, MMCAS, MNGFA, MRBKF, MTRYO, NURVK, OPET, ORFIN, ORMA, OSVKS, OTOSR, OYAYO, PRFFK, QNBFF, QNBFK, QNBVK, QUFIN, QYHOL, RALYH, SARTN, SMRFA, SNPAM, SODSN, SUMAS, TAMFA, TARFN, TEBFA, TEVKS, TFNVK, TRFFA, TRILC, TRKFN, TRKNT, TRYKI, TV8TV, UMPAS, USAK, VAKVK, VDFAS, VDFLO, VKFYO, YATVK, YBTAS, YKFIN, YKFKT, YONGA, YYAPI, ZKBVK, ZKBVR.
Bu kuruluşlar silinmedi: issuers kayıtlarında kaynak kodları ve unresolved_codes korunur; pay oldukları iddia edilmez.

## Çok-kodlu 45 kuruluşun tamamı
| Kaynak kodları | Kanıtlı paylar | Türü henüz çözülmeyen kodlar |
|---|---|---|
| FBB, FBBNK | — | FBB, FBBNK |
| AFB, AKTIF | — | AFB, AKTIF |
| HALKB, THL | HALKB | THL |
| EXIMB, THR | — | EXIMB, THR |
| AYTEM, YYA | — | AYTEM, YYA |
| ATA, ATAYM | — | ATA, ATAYM |
| GLB, GLBMD | GLBMD | GLB |
| BRGAN, BUR | — | BRGAN, BUR |
| ISMEN, IYM | ISMEN | IYM |
| TSK, TSKB | TSKB | TSK |
| MRBAS, MRS | — | MRBAS, MRS |
| GARAN, TGB | GARAN | TGB |
| ISATR, ISBTR, ISCTR, ISKUR, TIB | ISATR, ISBTR, ISCTR | ISKUR, TIB |
| ADB, ADBNK | — | ADB, ADBNK |
| KRDMA, KRDMB, KRDMD | KRDMA, KRDMB, KRDMD | — |
| KLN, KLNMA | — | KLN, KLNMA |
| OYA, OYYAT | OYYAT | OYA |
| NRBNK, NYB | — | NRBNK, NYB |
| TVB, VAKBN | VAKBN | TVB |
| A1CAP, ACP | A1CAP | ACP |
| TERA, TRA | — | TERA, TRA |
| PBT, PBTR | — | PBT, PBTR |
| IAZ, INVAZ | — | IAZ, INVAZ |
| TAC, TCRYT | — | TAC, TCRYT |
| GRM, GRYAT | — | GRM, GRYAT |
| ALNUS, ANC | — | ALNUS, ANC |
| AKM, AKMEN | — | AKM, AKMEN |
| FIN, QNBTR | — | FIN, QNBTR |
| OMD, OSMEN | OSMEN | OMD |
| ALBRK, ALK | ALBRK | ALK |
| HALKI, HLY | — | HALKI, HLY |
| SEK, SKBNK | SKBNK | SEK |
| YKR, YKYAT | — | YKR, YKYAT |
| YKB, YKBNK | YKBNK | YKB |
| ICB, ICBCT | ICBCT | ICB |
| BLS, BLSMD | — | BLS, BLSMD |
| INFO, IYF | INFO | IYF |
| TRMEN, TVM | — | TRMEN, TVM |
| MEKMD, MSA | — | MEKMD, MSA |
| SKY, SKYMD | SKYMD | SKY |
| MDASM, MDS | — | MDASM, MDS |
| MSY, MSYBN | — | MSY, MSYBN |
| HDFYB, HYB | — | HDFYB, HYB |
| TAE, TRBNK | — | TAE, TRBNK |
| QYATB, YBQ | — | QYATB, YBQ |

## Korunan gerçek rota etiketleri
Özgün onay kaynağı: `thread:01a16797-9b60-72ba-879f-e236fd1d3028; question:Sentinel_fa4f5e1442888191960ea833fbd582cb; owner_answer:Sentinel_22ec5289383c8191be6646295d350e78`. Örnek hash’i `5f271abb3a76b70ea132e6d92ce8bc54e448df88c31e92e745ddc975489e92ea`.
Aşağıdaki yeniden değerlendirme yalnız yayın zamanı + 1 dakika bağlamında teknik karşılaştırmadır. Eski insan etiketleri değiştirilmedi; yeni katalog hash’i için onay uydurulmadı. 12/12 rota aynı (2 instant / 8 digest / 2 archive). Kod/kanıt değişimi yeni sürüm olarak saklanır.
| Haber | Korunan insan etiketi | Yeni teknik rota |
|---|---|---|
| BU ÜRÜNLER YOK SATACAK! BU HAFTA A101’E NELER GELİYOR? (A101 27 EKİM-4 KASIM) | archive | archive |
| Yatırım fonlarında haftanın tablosu: En çok yükselenler ve düşenler | digest | digest |
| Arçelik'ten Manisa'ya 200 milyon euroluk yatırım: Yeni fabrika açıldı | instant | instant |
| OpenAI ve Anthropic’ten biyogüvenlik laboratuvarına 200 milyon sterline kadar destek | archive | archive |
| QNB Yatırım 1.24 milyar TL’lik net satış; ASTOR, THYAO, KCHOL dahil tam 10 hisse… | digest | digest |
| Hangi yatırım aracı ne kazandırdı? | digest | digest |
| Fon soruşturması: Türkiye Sigorta ve Türkiye Hayat Emeklilik eski Genel Müdürü Taha Çakmak tutuklandı | digest | digest |
| BofA: Hisse senetleri ve dolarda düşüş Kasım ortasına kadar sürebilir | digest | digest |
| BofA’dan 19-23 Ekim haftasında yüklü satış! ASELS, EREGL, TUPRS, KOCHL... | digest | digest |
| Carrefour hisselerinde küresel finans krizinden beri en sert düşüş | digest | digest |
| Bu hafta yatırımcılarına temettü dağıtacak 5 şirket | digest | digest |
| Aselsan, Netaş, Baydöner, Borusan... Borsada 8 şirket milyarlık anlaşma ve yatırım açıkladı | instant | instant |

## Gereken en küçük gerçek karar ve geçiş sınırı
Sahip, yukarıda hash ile belirtilen kuruluş/pay ayrımını, açık unresolved kayıtlarını, ad/alias politikasını ve boş ek takip listesiyle BIST/Türkiye merkezli haber kapsamını inceleyip kabul etmeli. Eski eksik katalog için risk kabulü istenmiyor; düzeltilmiş kanıtlı liste sunuluyor. Kabul henüz alınmış değil. Aynı 12 haber etiketini yeniden üretmek gerekmiyor; bunların yeni kod/sürümle bağlanması ayrıca izlenebilir kabul gerektirir.
Hazırlık kapısı eski hash veya investor-v3 onayını investor-v4 için kabul etmez. Shadow/off korunur. Aktif filtre veya otomatik seçki açılmaz. TEST 3189 yeniden gönderilmez.
Main commit/CI, canlı release ile aynı şey değildir. Sonraki yetkili kurulumda d513419 tabanına yalnız filtre commitleri cherry-pick -x ile ayrı release hazırlanmalı; 0d4e4a KAP commit’i dahil edilmemeli. Ayrı release commit’inin CI’si, kaynak manifesti ve tutarlı yerel yedek doğrulanmadan kurulum yapılmamalı. Uygulama rollback’i canlı DB üzerine eski yedek kopyalamaz.

## Yerel doğrulama

Node 22 TypeScript kontrolü, 415 test (ZIP manifest/kaynak/runtime ve 26 PNG dahil), dry-run build geçti. Proje PDF venv ile 68 Python testi geçti, iki koşullu OCR atlandı; ayrıca macOS Vision için 1 OCR ve 3 gerçek geri alım görsel testi geçti. Beş yeni katalog regresyonu kaynak yeniden üretimi, OID/pay ayrımı, eski eksik önemli kodlar, çoklu sınıf, çakışma ve negatif bağlamı kapsıyor. ZIP değişmedi: `7916100962f698d8482645e053ebda8636c5454bff5de2c52b1c488b7548aec5`.

## Kuruluş kimliğinin yönlendirmeye bağlanması — investor-v5

155 kuruluşun pay türü doğrulanmamış olması, resmî kuruluş kimliğinin kaybolması anlamına gelmez. Kaynak listesindeki OID/unvan/kod ilişkisi artık ayrı `unresolved_issuers` alanında taşınır. Tam resmî unvan veya büyük harfle yazılmış, tek kuruluşla ilişkili 4–5 karakterli kaynak kodu ve şirket olayı bağlamı gerekir. Yeni kısa ad/marka tahmini eklenmedi. Bu kodlar `confidence.codes` doğrulanmış pay listesine girmez. Kuruluş kanıtı tek başına instant veya watchlist önceliği sağlamaz; somut haber güvenli digest rotasına gider. Tazelik, promosyon ve tüketici kataloğu kontrolleri önce uygulanır. KAP kapsamı değişmez.

Sentetik KONTR/KORTS/ISYAT/KENT teknoloji yatırımı+sözleşme ve yalnız sözleşme örneklerinin sekizi de digest, `official_issuer_instrument_unresolved`, equity codes=[], priority=0 sonucu verir. Bunlar gerçek haber veya üretim başarısı ölçümü değildir. Negatif testler: ilgisiz teknoloji, promosyon, perakende katalog, eski tarih, sıradan küçük harfli kent, KOCHL, QNB Yatırım, Borusan ve yabancı Carrefour. Önceki testlerde çoklu pay sınıfı, çakışan alias ve iştirak/negatif bağlam korumaları korunur.

Önceki gerçek 12 etiket yerinde durur. Canlıdaki önceki saf değerlendiriciyle sabit yayın+1 dakika bağlamında rota/gerekçe/kod/olay/aşama karşılaştırmasında 12/12 aynı sonuç vardır. Bu, yeni semantik kapsam için insan kabulü yerine geçmez; hash kapısı gevşetilmedi. Katalog kaynağı/sürümü/hash'i yukarıdaki gibidir; değişen sınıflandırıcı sürümü investor-v5'tir. Yeni kabul kaydı oluşturulmadı.

`src/news-company-catalog.ts` SHA256: `ef5b4eaa745c0cdd9b92f4f46182015c91685ba03d1cde2cac66250fb9b717fa`.

`src/news-routing.ts` SHA256: `62d70b8861a2b1be62370caaa41e54390f79a0350abb7c8eee61f4ea36de8de1`.
