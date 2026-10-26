import {outputView} from './output-preferences';
import {kapIndexHashtags} from './kap/index-tags';
import {cardDataFields} from './card-data';
import {repairKapShareWording} from './kap-unit-evidence';
import {verifiedEquityCodes} from './equity-codes';
import {isRecentIpoTicker} from './kap/ticker-scope';
import type {Document,Draft} from './types';
const fold=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/ı/g,'i');
export function editorialPolicy(documents:Document[]){
 const text=documents.map(d=>d.title+'\n'+d.body).join('\n');
 const allCodes=verifiedEquityCodes(documents),preference=documents.find(d=>d.output_preferences)?.output_preferences;
 let codes=allCodes;
 const institution=documents.find(d=>d.market_data?.kind==='institutional')?.market_data;
 const selection=preference??(documents.some(d=>d.editor_corrections?.length)?{side:'both',list:'all',count:undefined}:undefined);
 if(selection&&institution?.rows){const selected=(['buy','sell'] as const).flatMap(side=>selection.side&&selection.side!=='both'&&selection.side!==side?[]:institution.rows!.filter(r=>r.side===side).slice(0,selection.list==='all'?Infinity:selection.count).map(r=>r.symbol));codes=codes.filter(c=>selected.includes(c));}
 else if(preference?.list==='first')codes=codes.slice(0,preference.count);
 const excluded=[...new Set(allCodes.filter(c=>!codes.includes(c)).concat(documents.flatMap(d=>d.circuit_scope?.excluded_codes??[])))];
 const fundWord=/(?:^|[^\p{L}\p{N}])(?:fon(?:lar(?:i(?:n(?:in)?)?|da|dan|a|in)?|un|u|a|da|dan|daki|unun)?|tefas|pblk)(?=$|[^\p{L}\p{N}])/u;
 // KAP templates contain empty "İlgili Fonlar" fields and buyback budget
 // labels. Neither makes a company's contract/buyback a fund story.
 const kap=documents.find(d=>d.source_id==='kap');
 const circuit=documents.some(d=>d.source_id==='kap'&&/devre kesici/i.test(d.title));
 const market=documents.some(d=>d.market_data);
 const fund=!market&&(kap?[kap]:documents).some(d=>d.source_id==='kap'
  ?fundWord.test(fold(d.title))||/(?:\btefas\b|\bpblk\b|yatirim fon|emeklilik fon|serbest fon|fon(?:lar)?(?:in|un|u)?\s+(?:kriz|tasfiye|katilma|iade|ödeme|odeme))/u.test(fold(d.body))
  :fundWord.test(fold(d.title+'\n'+d.body)));
 const bist=codes.length>0||/\bbist\b|borsa istanbul/i.test(fold(text));
 const indexTags=fund?[]:kapIndexHashtags(documents);
 const ipo=!!kap?.official&&!fund&&codes.some(isRecentIpoTicker),ipoTag=ipo?['#HalkaArz']:[];
 return {output_preferences:preference,excluded_equity_codes:excluded,required_hashtags:circuit?['#Borsa','#BIST',...(codes.length?codes.map(c=>'#'+c):['#DevreKesici']),...ipoTag,...indexTags]:fund?['#Fon','#PBLK','#Tasfiye']:bist?['#Borsa','#BIST',...(documents.some(d=>d.market_data?.kind==='institutional')?[]:codes.map(c=>'#'+c)),...ipoTag,...indexTags]:[],verified_equity_codes:codes,
  publisher_names:[...new Set(documents.filter(d=>!d.official).map(d=>d.source_name))],
  instruction:(documents.some(d=>d.circuit_scope?.kind==='pay')?'Bu yalnız BIST30 kapsamındaki pay devre kesici bildirimlerinin seçkisidir, tüm piyasa toplamı değildir. Dışlanan kodları çıktıya ekleme. ':documents.some(d=>d.circuit_scope?.kind==='market')?'Bu kodsuz piyasa geneli/endekse bağlı devre kesicidir; tek bir pay bildirimi değildir. Hisse kodu veya piyasa toplamı tahmin etme. ':'')+'Etiketleri yalnız hashtags dizisinde ver; başlık, gövde ve kart alanlarına hashtag satırı ekleme. Devre kesici gruplarında #Borsa #BIST ve gruptaki bütün doğrulanmış asıl hisse kodlarını kullan; yalnız kod yoksa #DevreKesici kullan. Bu gruplarda zorunlu kodlar 3 etiket sınırından önceliklidir; ek konu etiketi ekleme. Yayıncıya göre/haberine göre veya Kaynak satırı yazma. Kaynak düğmede bulunur. İddia, koşul ve açıklamanın gerçek sahibini koru. Çok hisseli haberlerde kodları gruplandırıp her grubun ilk beşini tweet gövdesinde göster; doğrulanmış kod etiketleri 3 etiket sınırından önceliklidir. Görselde tam listeyi koru. Diğer içeriklerde konu etiketleri 2–3 adet; required_hashtags zorunludur. KAP endeks etiketlerinde yalnız required_hashtags içindeki doğrulanmış #BIST30 ve #BIST100 etiketlerini kullan; index_tier veya metinden üyelik tahmin etme. Fon içeriklerinde yalnız #Fon #PBLK #Tasfiye kullan; bu üç etiket hisse etiketlerinden önceliklidir. Diğer içeriklerde doğrulanmış tek şirket kodu varsa kullan. BIST dışındaki haberleri BIST diye etiketleme.'};
}
export function hasPublisherAttribution(text:string,names:string[]):boolean {
 const t=fold(text);
 if(/(?:^|\n)\s*kaynak\s*:/i.test(t)||/(?:haberine|haberlerinde|aktardiğina|aktardigina)\s+göre/i.test(t))return true;
 return names.filter(Boolean).some(name=>{
  const pattern=fold(name).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/[-\s]+/g,'[-\\s]*');
  return new RegExp(pattern+"(?:['’]?[a-zçğıöşü]+)?\\s+(?:haberine|haberindeki|aktardiğina|aktardigina|bildirdiğine|bildirdigine|göre|kaynakli|tarafindan aktarilan)",'iu').test(t);
 });
}
export function styleIssues(draft:Draft,documents:Document[]):string[]{
 const p=editorialPolicy(documents),issues:string[]=[];
 const display=normalizeEquityDisplay(draft,documents);
 if(['headline','body','card_headline','card_body'].some(k=>display[k as keyof Draft]!==draft[k as keyof Draft])||JSON.stringify(display.card_data)!==JSON.stringify(draft.card_data))issues.push('market_suffix_in_display');
 if(p.excluded_equity_codes.length&&new RegExp('(?<![\\p{L}\\p{N}_])('+p.excluded_equity_codes.join('|')+')(?![\\p{L}\\p{N}_])','u').test([draft.headline,draft.body,draft.card_headline,draft.card_body,JSON.stringify(draft.card_data??{}),draft.hashtags.join(' ')].join(' ')))issues.push('output_scope_mismatch');
 if(invalidEmojiPlacement(draft))issues.push('invalid_emoji_placement');
 if([draft.headline,draft.body,draft.card_headline,draft.card_body].some(t=>typeof t==='string'&&hasTextHashtags(t)))issues.push('misplaced_hashtags');
 if(hasPublisherAttribution([draft.headline,draft.body,draft.card_headline,draft.card_body].join('\n'),p.publisher_names))issues.push('publisher_attribution');
 if(draft.hashtags.some(t=>/^#BIST(?:30|100)$/i.test(t)&&!p.required_hashtags.includes(t.toUpperCase())))issues.push('unverified_index_hashtag');
 if(p.required_hashtags.some(tag=>!draft.hashtags.some(t=>fold(t)===fold(tag))))issues.push('missing_market_hashtags');
 if(documents.some(d=>d.market_data)&&/bugün|anlık|son seans/iu.test([draft.headline,draft.body,draft.card_headline,draft.card_body,...cardDataFields(draft.card_data).map(([,v])=>v)].join('\n')))issues.push('unsupported_market_relative_period');
 return issues;
}

// Hashtags have one owner: the hashtags array. Preserve inline subjects such
// as #THYAO as plain text; remove only standalone/trailing tag lists. Never
// rewrite URL fragments or the source documents/evidence themselves.
const tagToken='#[\\p{L}\\p{N}_]{2,40}';
function withoutUrls(text:string,change:(s:string)=>string):string {
 return text.split(/(https?:\/\/[^\s]+)/u).map(s=>/^https?:\/\//u.test(s)?s:change(s)).join('');
}
// .E identifies the equity trading series, not part of the display ticker.
// Only strip it for verified equities. Other series (e.g. .TE) can carry a
// different transaction meaning and must not be blindly treated as equities.
export function normalizeEquityDisplay(value:Draft,documents:Document[]):Draft {
 const codes=editorialPolicy(documents).verified_equity_codes;if(!codes.length)return value;
 const pattern=new RegExp(`(?<![\\p{L}\\p{N}_./])(${codes.join('|')})\\.E(?![\\p{L}\\p{N}_])`,'giu');
 const clean=(text:string)=>withoutUrls(text,part=>part.replace(pattern,(_match,code:string)=>code.toUpperCase()));
 const result={...value};
 for(const key of ['headline','body','card_headline','card_body'] as const)if(typeof value[key]==='string')result[key]=clean(value[key]);
 if(value.card_data&&typeof value.card_data==='object'&&!Array.isArray(value.card_data)){
  const data={...value.card_data};
  for(const key of ['ticker','broker','as_of'] as const)if(typeof data[key]==='string')data[key]=clean(data[key]);
  for(const key of ['buy','sell','holdings','metrics'] as const)if(Array.isArray(data[key]))data[key]=data[key].map(row=>!row||typeof row!=='object'?row:{...row,...(typeof row.label==='string'?{label:clean(row.label)}:{}),...(typeof row.value==='string'?{value:clean(row.value)}:{})});
  result.card_data=data;
 }
 return result;
}
function hasTextHashtags(text:string):boolean {
 let found=false;withoutUrls(text,s=>{found ||= /(?<![\p{L}\p{N}_#])#[\p{L}\p{N}_]{2,40}/u.test(s);return s;});return found;
}
export function normalizeHashtagPlacement(value:Draft):Draft {
 const extracted:string[]=[];
 const clean=(text:string,collect=false)=>withoutUrls(text,part=>part.split('\n').map(line=>{
  const list=new RegExp(`^\\s*(?:(?:etiketler|hashtags)\\s*:\\s*)?(?:${tagToken}\\s*)+$`,'iu');
  if(list.test(line)){if(collect)extracted.push(...line.match(new RegExp(tagToken,'gu'))??[]);return '';}
  line=line.replace(new RegExp(`([.!?…])\\s+((?:${tagToken}\\s*)+)$`,'u'),(_m,end,tags)=>{if(collect)extracted.push(...tags.match(new RegExp(tagToken,'gu'))??[]);return end;});
  return line.replace(/(?<![\p{L}\p{N}_#])#([\p{L}\p{N}_]{2,40})/gu,'$1');
 }).join('\n')).replace(/\n(?:[ \t]*\n){2,}/g,'\n\n').trim();
 const body=typeof value.body==='string'?clean(value.body,true):value.body;
 const tags=(Array.isArray(value.hashtags)?value.hashtags:[]).filter((t):t is string=>typeof t==='string').flatMap(t=>new RegExp(`^\\s*(?:${tagToken}\\s*)+$`,'u').test(t)?t.match(new RegExp(tagToken,'gu'))??[]:[t]).concat(extracted);
 const seen=new Set<string>(),hashtags=tags.map(t=>'#'+t.trim().replace(/^#+/,'').replace(/[^\p{L}\p{N}_]/gu,'')).filter(t=>{const key=fold(t);if(seen.has(key))return false;seen.add(key);return true;});
 return {...value,body,hashtags,...Object.fromEntries((['headline','card_headline','card_body'] as const).filter(k=>typeof value[k]==='string').map(k=>[k,clean(value[k])]))};
}

const emoji=/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u;
export function headlineWithEmoji(headline:string):string{headline=headline.replace(/^\s*🏢\uFE0F?\s*/u,'📢 ');return !headline.trim()||emoji.test(headline)?headline:'📢 '+headline.trim();}
export function invalidEmojiPlacement(draft:Draft):boolean {
 const headline=draft.headline.trim();
 const rest=headline.replace(/^(?:📢|🚨|📊|🏦|🌍|⚡|💻|📈|📉)\uFE0F?\s+/u,'');
 return emoji.test(rest)||[draft.body,draft.card_headline,draft.card_body,...draft.hashtags,...cardDataFields(draft.card_data).map(([,value])=>value)].some(t=>emoji.test(t??''));
}

// These repairs select only source-backed category/ticker tags, never facts.
// Run before the semantic audit as well as at the submission boundary.
export function repairDraftStyle(value:Draft,documents:Document[]):Draft {
 if(!value||typeof value!=='object')return value;
 const preference=documents.find(d=>d.output_preferences)?.output_preferences;
 const {output_preferences:_ignored,...plain}=value;value={...plain,...(preference?{output_preferences:preference}:{})};
 value=normalizeEquityDisplay(normalizeHashtagPlacement(value),documents);
 const policy=editorialPolicy(documents),required=policy.required_hashtags;
 const tags=Array.isArray(value.hashtags)?[...new Set(value.hashtags.filter((t):t is string=>typeof t==='string').map(t=>'#'+t.trim().replace(/^#+/,'').replace(/[^\p{L}\p{N}_]/gu,'')))]:[];
 const valid=tags.filter(t=>!(policy.excluded_equity_codes.some(c=>t.toUpperCase()==='#'+c))&&!(/^#BIST(?:30|100)$/i.test(t)&&!required.includes(t.toUpperCase()))&&/^#[\p{L}\p{N}_]{2,40}$/u.test(t)&&!/^#(?:haber|gündem|keşfet|viral)$/iu.test(t));
 const hashtags=required.length?[...required,...valid.filter(t=>!required.some(r=>fold(r)===fold(t)))].slice(0,Math.max(3,required.length)):valid;
 const circuit=documents.some(d=>d.official&&d.source_id==='kap'&&/devre kesici/i.test(d.title));
 const market=documents.find(d=>d.market_data)?.market_data;
 const period=market?.editorial_period;
 if(period){
  const prefix=(s:string)=>fold(s).includes(fold(period))?s:period+' — '+s;
  if(typeof value.headline==='string'){const m=/^((?:📢|🚨|📊|🏦|🌍|⚡|💻|📈|📉)\uFE0F?)\s+/u.exec(value.headline);value={...value,headline:(m?m[0]:'')+prefix(m?value.headline.slice(m[0].length):value.headline)};}
  if(typeof value.card_headline==='string')value={...value,card_headline:prefix(value.card_headline)};
 }
 if(market?.kind==='institutional'&&market.broker){
  const ranked={...value.card_data,broker:market.broker};
  for(const side of ['buy','sell'] as const){
   const sourceRows=market.rows?.filter(r=>r.side===side)??[];
   const order=new Map(sourceRows.map((r,i)=>[r.symbol,r.rank??i+1]));
   if(ranked[side])ranked[side]=[...ranked[side]!].sort((a,b)=>(order.get(a.label)??Infinity)-(order.get(b.label)??Infinity));
  }
  value={...value,card_data:ranked,...(typeof value.card_headline==='string'&&!fold(value.card_headline).includes(fold(market.broker))?{card_headline:market.broker+'\n'+value.card_headline}:{})};
 }
 return outputView(repairKapShareWording({...value,...(circuit?{template:'circuit' as const,category:'bist' as const,card_data:policy.verified_equity_codes.length?{...value.card_data,tickers:policy.verified_equity_codes}:value.card_data}:market?{template:market.kind,category:'bist' as const,...(market.ticker?{card_data:{...value.card_data,ticker:market.ticker}}:{})}:{}),headline:typeof value.headline==='string'?headlineWithEmoji(value.headline):value.headline,hashtags},documents));
}
