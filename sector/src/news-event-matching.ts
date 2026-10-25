import {titleSimilarity} from './dedupe';
export const eventFold=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('tr-TR').replace(/ı/g,'i').replace(/[^a-z0-9]+/g,' ').trim();
export function articleURL(url:string){return url.replace(/#endeks-event=[a-f0-9]+$/,'');}
export function legalStage(title:string){const t=eventFold(title);return /yeniden gozalt/.test(t)?'redetained':/tutuklan/.test(t)?'arrested':/yakalama karari/.test(t)?'wanted':/gozalt/.test(t)?'detained':/sorusturma/.test(t)?'investigated':null;}
function persons(raw:string){
 const stop=new Set(eventFold('Fon Soruşturması Soruşturmasında Türkiye Sigorta Genel Müdür Müdürü Yardımcısı İstanbul Cumhuriyet Başsavcılığı Sermaye Piyasası Piyasalarında Yönetim Kurulu Başkanı Holding AK Parti Eski Yeni').split(' '));
 const found=new Set<string>();for(const m of raw.matchAll(/\b[\p{Lu}][\p{Ll}]+(?:\s+[\p{Lu}][\p{Ll}]+){1,6}/gu)){const words=m[0].split(/\s+/);for(let n=2;n<=3;n++)for(let i=0;i+n<=words.length;i++){const w=words.slice(i,i+n).map(eventFold);if(w.every(x=>!stop.has(x)))found.add(w.join(' '));}}
 return [...found].sort();
}
type Story={url?:string;title:string;summary?:string;published_at:string|null;confidence?:string|{event?:string;stage?:string}};
export function sameNewsEvent(a:Story,b:Story){
 const at=Date.parse(a.published_at??''),bt=Date.parse(b.published_at??'');if(!Number.isFinite(at)||!Number.isFinite(bt)||Math.abs(at-bt)>6*3600000)return false;
 const aa=eventFold(a.title+' '+(a.summary??'')),bb=eventFold(b.title+' '+(b.summary??''));
 const quantities=(r:Story)=>[...new Set(((r.title+' '+(r.summary??'')).replace(/−/g,'-').match(/[+-]?\d+(?:[.,]\d+)*/g)??[]).map(n=>n.replace(/^\+/,'')))].sort().join('|');
 if(quantities(a)!==quantities(b))return false;
 const periods=(t:string)=>[...new Set(eventFold(t).match(/\b(?:(?:ilk|ikinci|ucuncu|dorduncu|son) (?:ceyrek|yari|ay|yil)|ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)\b/g)??[])].sort().join('|');
 if(periods(a.title+' '+(a.summary??''))!==periods(b.title+' '+(b.summary??'')))return false;
 const actions=(t:string)=>[...new Set(eventFold(t).match(/\b(?:artirdi|indirdi|sabit tuttu|imzaladi|iptal etti|onayladi|yururluge girdi|tutuklandi|gozaltina alindi|yakalama karari)\b/g)??[])].sort().join('|');
 if(actions(a.title)!==actions(b.title))return false;
 if(aa===bb)return true;
 // Same canonical article and substantive summary: headline rewriting is not a new event.
 if(a.url&&b.url&&articleURL(a.url)===articleURL(b.url)&&eventFold(a.summary??'').length>=40&&eventFold(a.summary??'')===eventFold(b.summary??''))return true;
 const nums=(s:string)=>[...new Set(s.match(/\b\d+(?: \d+)*\b/g)??[])].sort().join('|');if(nums(aa)!==nums(bb))return false;
 const ca=typeof a.confidence==='string'?JSON.parse(a.confidence):a.confidence,cb=typeof b.confidence==='string'?JSON.parse(b.confidence):b.confidence;
 const sa=legalStage(a.title),sb=legalStage(b.title);
 if(sa||sb){if(sa!==sb)return false;const pa=persons(a.title+' '+(a.summary??'')),pb=persons(b.title+' '+(b.summary??''));return pa.some(p=>pb.includes(p))&&/fon sorustur/.test(aa)&&/fon sorustur/.test(bb);}
 if(ca&&cb&&(ca.stage!==cb.stage||ca.event!==cb.event))return false;
 const metric=(r:Story)=>{const raw=r.title+' '+(r.summary??''),t=eventFold(raw),subject=r.title.match(/([A-Z][\p{L}0-9]{2,})['’](?:te|ta|de|da|in|un|nin|nun)/u)?.[1];
  return subject&&/kullanici basina(?: dusen| ortalama)? (?:izleme|izlenme) suresi(?:nin)? (?:dusuyor|dustu|azal\w*|geril\w*)|kullanici etkilesimi(?:ndeki)? (?:gerile\w*|dusuyor|dustu)/.test(t)?eventFold(subject)+':per_user_engagement:down':null;};
 const ma=metric(a),mb=metric(b);if(ma&&ma===mb)return true;
 return titleSimilarity(a.title,b.title)>=.9&&titleSimilarity(a.summary??'',b.summary??'')>=.85;
}
