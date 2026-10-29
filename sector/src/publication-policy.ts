// Editorial experiment from reports/x-yayin-stratejisi-2026-10-22/RAPOR.md.
// These are advisory ranges, never X algorithm thresholds or publication locks.
export function cadence(last:number|null,now=Date.now()) {
 if(last===null)return 'İlk kayıt. Önemli haberi bekletme.';
 const minutes=Math.max(0,Math.floor((now-last)/60000)),hour=new Date(now+10800000).getUTCHours();
 return `${minutes} dk. `+(hour<8||hour>=22?'Dinlenme saati; yayın zorunlu değil.':minutes<20?'Çok yakın; rutinse beklet. Son dakika hariç.':minutes<45?'Kısa aralık; rutin için 45–75 dk dene.':minutes<=75?'Rutin için uygun aralık (45–75 dk).':minutes<=90?'Tablolar için uygun aralık (60–90 dk).':'Uzun ara; yalnız değerli yeni haber varsa paylaş.');
}
export function dailyAdvice(total:number,now=Date.now()) {
 const weekday=new Date(now+10800000).getUTCDay();
 if(total>=20)return '20+ yayın: rutinleri özete al.';
 if(total>=16)return '16+ yayın: yalnız güçlü yeni gelişmeler.';
 if(weekday===0||weekday===6)return total>=3?'Hafta sonu: 3+ yayın; sayı doldurma.':'Hafta sonu: 1–3 kaliteli içerik dene.';
 if(total>=12)return '12+ yayın: seçici ol, rutinleri birleştir.';
 if(total>=8)return '8–12 deneme aralığındasın; sayı doldurma.';
 return 'Normal gün: 8–12 dene; haber yoksa zorlama.';
}
export function publicationAdvice(last:number|null,total:number,now=Date.now()) {
 return cadence(last,now)+' '+dailyAdvice(total,now);
}
export const publicationPlan=`Borsa Çakalı · Yayın planı (İstanbul)
Normal gün 8–12; yoğun gün 12–16. Sakin gün 4–6, hafta sonu 1–3 kaliteli içerik yeterli olabilir. Bunlar deneme aralıkları; algoritma kuralı veya doldurulacak kota değil.
Rutinler: 45–75 dk. Güçlü tablolar: 60–90 dk. Doğrulanmış son dakika bekletilmez.
08:45–09:30 güne hazırlık
10:05–11:15 açılış
12:00–13:15 gün ortası kurum/AKD
14:00–16:00 önemli gelişmeler
17:15–18:20 kapanış
19:00–20:30 bilanço ve toplu geri alım
21:00 yalnız önemli geç haber
Her pencerede yayın zorunlu değil.
Rutin geri alımları /genelgerialım ile toplulaştır; devre kesicide her grubu X’e taşımak yerine önemli dalgayı ve /devrekesici gün raporunu seç.
İlk 2 hafta 8 ve 12 paylaşım planlarını benzer hafta günlerinde karşılaştır. Sonraki 2 hafta günlük sayıyı sabitleyip rutin aralıklarını karşılaştır. Acil haberleri ayrı değerlendir.
Elle paylaşınca ✅; gecikmeli işaretlediysen 🕒 ile gerçek saati düzelt. /yayinlar durumu, /yayinraporu son 28 günün CSV kaydını verir. Gösterim/etkileşimler otomatik okunmaz; X Analytics’ten ekle.`;
