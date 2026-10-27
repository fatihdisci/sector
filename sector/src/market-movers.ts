import type {Document,Draft} from './types';import {xTextValid} from './x-text';
export type Mover={symbol:string;price:string;change:string};
export type Movers={up:Mover[];down:Mover[];sourceTime:string|null;page?:'up'|'down'};
const fold=(s:string)=>s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
// Strict text-only parser; ambiguous rows, unknown units or stale labelled
// times fail closed. Receipt time is not presented as market measurement time.
export function parseMovers(text:string,receivedAt?:string):Movers{
 if(!text.trim()||text.length>30000)throw Error('bot_query_text_incomplete');
 const normalized=fold(text),headerTL=/(?:fiyat(?:ı|i)?\s*\(?\s*(?:tl|₺)\s*\)?|(?:tl|₺)\s*fiyat)/iu.test(text);
 const clock=/(?:saat|güncelleme|guncelleme)\s*[:：-]?\s*(\d{1,2})[.:](\d{2})(?!\d)/iu.exec(text);let sourceTime:string|null=null;
 if(clock){const hour=Number(clock[1]),minute=Number(clock[2]);if(hour>23||minute>59||!receivedAt||!Number.isFinite(Date.parse(receivedAt)))throw Error('bot_query_time_unverified');sourceTime=String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(receivedAt));const [h,m]=parts.split(':').map(Number),delta=((h*60+m)-(hour*60+minute)+1440)%1440;if(delta>10)throw Error('bot_query_stale');const date=/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/.exec(text);if(date){const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(receivedAt));if(`${date[3]}-${date[2]}-${date[1]}`!==day)throw Error('bot_query_stale');}}
 if(!/yukselen/.test(normalized)||!/dusen/.test(normalized))throw Error('bot_query_text_incomplete');
 const up:Mover[]=[],down:Mover[]=[];let side:Mover[]|null=null;
 for(const line of text.split(/\r?\n/u)){
  const h=fold(line);if(/(?:en cok )?yukselen(?:ler| hisseler)?/.test(h)){if(side===up||up.length)throw Error('bot_query_duplicate_section');side=up;continue;}if(/(?:en cok )?dusen(?:ler| hisseler)?/.test(h)){if(side===down||down.length)throw Error('bot_query_duplicate_section');side=down;continue;}
  const cleaned=line.replace(/^[\s\p{Extended_Pictographic}\uFE0F\-•]*(?:\d{1,2}[.)]\s*)?/u,'');if(!/^[#]?[A-Z][A-Z0-9]{3,4}(?:\.E)?\b/u.test(cleaned))continue;
  if(!side)continue;
  const m=/^#?([A-Z][A-Z0-9]{3,4})(?:\.E)?\s*[:|–—-]?\s*(\d{1,6}[.,]\d{2})\s*(TL|₺)?\s*[,|:;–— ]*\s*\(?(?:(%\s*[+-]?\d{1,3}[.,]\d{2})|([+-]?\d{1,3}[.,]\d{2})\s*%?)\)?\s*$/iu.exec(cleaned);
  if(!m)throw Error('bot_query_row_invalid');if(!m[3]&&!headerTL)throw Error('bot_query_units_missing');const raw=(m[4]??m[5]).replace(/%\s*/,'').replace(',','.');if(!/^[+-]/.test(raw))throw Error('bot_query_row_invalid');const n=Number(raw),price=Number(m[2].replace(',','.'));if(!Number.isFinite(price)||price<=0||!Number.isFinite(n)||Math.abs(n)>100||(side===up?n<=0:n>=0))throw Error('bot_query_row_invalid');
  side.push({symbol:m[1].toUpperCase(),price:price.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})+' TL',change:(n>0?'+':'-')+'%'+Math.abs(n).toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2})});
 }
 if(up.length!==10||down.length!==10||new Set([...up,...down].map(r=>r.symbol)).size!==20)throw Error('bot_query_text_incomplete');
 const number=(r:Mover)=>Number(r.change.replace(/[+\-−%]/g,'').replace(',','.'));
 if(up.some((r,i)=>i>0&&number(up[i-1])<number(r))||down.some((r,i)=>i>0&&number(down[i-1])<number(r)))throw Error('bot_query_order_invalid');
 return {up,down,sourceTime};
}
export function moversReport(doc:Document):{draft:Draft;documents:Document[]}{
 const data=doc.market_movers;if(!data)throw Error('bot_query_text_incomplete');
 const draft:Draft={headline:'📊 Piyasada öne çıkan hisseler',body:'En çok yükselen ve düşen hisseler şöyle sıralandı.'+(data.sourceTime?' Kaynak saati: '+data.sourceTime+'.':''),hashtags:['#Borsa','#BIST'],category:'bist',importance:70,template:'market',card_headline:'Piyasada öne çıkan hisseler',card_body:'En çok yükselenler ve düşenler',card_data:{movers:data},claims:[],entities:[],event_key:'movers-'+doc.url,uncertainties:[],source_notes:[]};
 // Never silently drop the 20 source tickers or accept an unpublishable post.
 const tweet=['📊 '+draft.headline.replace(/^📊\s*/u,''),draft.body,'Yükselenler: '+data.up.map(r=>'#'+r.symbol).join(' '),'Düşenler: '+data.down.map(r=>'#'+r.symbol).join(' '),'#Borsa #BIST'].join('\n\n');
 if(!xTextValid(tweet)||Array.from(tweet).length>25000||tweet.length>1024)throw Error('bot_query_capacity');
 return {draft,documents:[doc]};
}
