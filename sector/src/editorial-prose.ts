import type {Draft} from './types';
export const EDITORIAL_GUIDE='Doğal ve doğrudan Türkçe kullan. Başlık ana gelişmeyi söylesin; gövde aynı cümleyi tekrar etmeden doğrulanmış ayrıntıyı eklesin. Sonuç cümlesi bilgi katmıyorsa yazma. Veri başlığı konuya uygunsa soru olabilir; zorunlu soru, abartı veya merak tuzağı kullanma. Fiyat, neden, tarih ve üyelik uydurma. Hisse kodlarını doğrulanmış büyük harfli veri sözleşmesinde koru; küçük harf yalnız son tweet etiketinin görünümüdür.';
const normalized=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function proseIssues(d:Pick<Draft,'headline'|'body'>):string[]{
 const headline=normalized(d.headline.replace(/#[\p{L}\p{N}_]+/gu,'')),body=normalized(d.body),issues:string[]=[];
 if(headline.split(' ').length>=3&&body.startsWith(headline))issues.push('repeated_headline');
 const sentences=d.body.split(/(?:[.!?](?:\s|$)|\n{2,})/u).map(normalized).filter(s=>s.split(' ').length>=3);
 if(new Set(sentences).size!==sentences.length)issues.push('repeated_body_or_conclusion');
 return issues;
}
