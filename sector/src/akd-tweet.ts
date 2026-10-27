// Source-bound /akd prose: the single ticker is already displayed in the
// leading hashtag. Substitute natural subjects without touching numbers/cards.
export function akdProse(text:string,ticker:string):string{
 if(!/^[A-Z][A-Z0-9]{3,4}$/.test(ticker))return text;
 const code=`(?<![\\p{L}\\p{N}_])#?${ticker}(?:\\.E)?`;
 const end='(?![\\p{L}\\p{N}_])';
 return text
  .replace(new RegExp(code+"\\s+dağılımında"+end,'giu'),'Dağılımda')
  .replace(new RegExp(code+"\\s+aracı\\s+kurum"+end,'giu'),'Aracı kurum')
  .replace(new RegExp(code+"['’]?(?:nın|nin|nun|nün|ın|in|un|ün)"+end,'giu'),'Hissenin')
  .replace(new RegExp(code+"['’]?(?:da|de|ta|te)"+end,'giu'),'Hissede')
  .replace(new RegExp(code+"['’]?(?:dan|den|tan|ten)"+end,'giu'),'Hisseden')
  .replace(new RegExp(code+"['’]?(?:ya|ye|a|e)"+end,'giu'),'Hisseye')
  .replace(new RegExp('\\(\\s*'+code+end+'\\s*\\)','giu'),'')
  .replace(new RegExp(code+end,'giu'),'hisse')
  .replace(/\s+([,.;:])/gu,'$1').replace(/ {2,}/gu,' ').trim();
}
