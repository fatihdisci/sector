import {channelProgramme} from './channel-programme';
import {equitySessionLabel} from './market-session';
import {cardDataFields} from './card-data';
import type{Document,Draft}from'./types';
const months=['ocak','şubat','mart','nisan','mayıs','haziran','temmuz','ağustos','eylül','ekim','kasım','aralık'];
const dates=/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{4}|\d{1,2}\s+(?:Ocak|Şubat|Mart|Nisan|Mayıs|Haziran|Temmuz|Ağustos|Eylül|Ekim|Kasım|Aralık)\s+\d{4})\b/giu;
function day(text:string):string|null{
 const parts=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);let y:number,m:number,d:number;
 if(parts)[y,m,d]=parts.slice(1).map(Number);else{const p=/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(text);if(p)[d,m,y]=p.slice(1).map(Number);else{const p=/^(\d{1,2})\s+(\p{L}+)\s+(\d{4})$/u.exec(text);if(!p)return null;d=Number(p[1]);m=months.indexOf(p[2].toLocaleLowerCase('tr-TR'))+1;y=Number(p[3]);}}
 const t=new Date(Date.UTC(y!,m!-1,d!));return m!>0&&t.getUTCFullYear()===y!&&t.getUTCMonth()===m!-1&&t.getUTCDate()===d!?t.toISOString().slice(0,10):null;
}
const market=(d:Document)=>d.source_id==='sermaye-telegram'&&d.source_layout?.kind==='market_overview';
export function marketTimeContext(documents:Document[]){
 return documents.filter(market).map(d=>{
  let c:any={};try{c=JSON.parse(d.passages.find(p=>p.id==='channel_context')?.text??'{}');}catch{}
  const cp=d.channel_publication,verified=!!cp&&cp.channel==='SermayeBorsasi'&&cp.peer_id===2426639373&&d.url===`https://t.me/SermayeBorsasi/${cp.message_id}`&&/^[a-f0-9]{64}$/.test(cp.version);
  const publish=verified?cp!.posted_at:typeof c.posted_at==='string'?c.posted_at:d.published_at;
  const publication_day=publish&&Number.isFinite(Date.parse(publish))?new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(publish)):null;
  // Only an explicit DATA/TRADE/MEASUREMENT label in source evidence is a
  // candidate data day. Publication, edit, forward and capture dates are not.
  const labelled=d.passages.filter(p=>!p.id.startsWith('channel_')).flatMap(p=>[...p.text.toLocaleLowerCase('tr-TR').matchAll(/(?:veri|işlem|ölçüm)\s+tarihi\s*:\s*([^\n;]+)/giu)].flatMap(m=>[...m[1].matchAll(dates)].map(x=>day(x[0]))));
  const invalid_date=labelled.some(x=>x===null),source_data_days=[...new Set(labelled.filter((x):x is string=>!!x))].sort();
  const explicitTimes=d.passages.filter(p=>!p.id.startsWith('channel_')).flatMap(p=>[...p.text.toLocaleLowerCase('tr-TR').matchAll(/(?:veri|ölçüm)\s+(?:saati|zamanı)\s*:\s*(\d{1,2}:\d{2}(?::\d{2})?)/gu)].map(m=>m[1]));
  const forwarded=verified?cp!.forwarded:c.forwarded;
  let session=equitySessionLabel(verified?publish:null);
  const programme=verified?channelProgramme(publish!,typeof c.caption==='string'?c.caption:d.title,d.source_layout?.kind,forwarded):null;
  if(programme&&['opening','first_moves','close'].includes(programme.kind))session={...session,label:programme.label,reason:'owner_channel_programme'};
  if(invalid_date||source_data_days.length||explicitTimes.length)session={...session,label:null,reason:'explicit_source_time_precedes_publication'};
  if(forwarded===true)session={...session,label:null,reason:'forwarded_source'};
  const graph=d.passages.find(p=>/^Grafik\s*:/iu.test(p.text))?.text??'';
  return{url:d.url,message_id:c.message_id??null,posted_at:publish,edited_at:verified?cp!.edited_at:c.edited_at??null,publication_day,forward_state:forwarded===true?'forwarded':forwarded===false?'not_forwarded':'unknown',forwarded_at:verified?cp!.forwarded_at:typeof c.forwarded_at==='string'?c.forwarded_at:null,source_data_days,data_day_status:invalid_date?'invalid':source_data_days.length>1?'conflict':source_data_days.length===1?'source_labelled':'unknown',same_as_publication_day:source_data_days.length===1&&publication_day?source_data_days[0]===publication_day:null,caption_time:typeof c.caption==='string'?c.caption.match(/\b\d{2}:\d{2}\b/)?.[0]??null:null,graph_last_label:[...graph.matchAll(/\b\d{2}:\d{2}\b/g)].at(-1)?.[0]??null,measurement_time:explicitTimes.length===1?explicitTimes[0]:null,editorial_session:session,independent_date_verification:false};
 });
}
export function marketTimeIssues(draft:Draft,documents:Document[]):string[]{
 const contexts=marketTimeContext(documents);if(!contexts.length)return[];
 const label=contexts.length===1?contexts[0].editorial_session.label:null;
 const strip=(title:string)=>{if(!label)return title;const clean=title.replace(/^(?:\p{Extended_Pictographic}\uFE0F?\s*)+/u,'');const folded=clean.toLocaleLowerCase('tr-TR'),expected=label.toLocaleLowerCase('tr-TR');if(folded===expected)return '';if(folded.startsWith(expected+' — '))return clean.slice(label.length+3);if(label==='Gün ortası'&&folded.startsWith('gün ortasında '))return clean.slice('Gün ortasında '.length);return title;};
 const tweet=[strip(draft.headline),draft.body].join('\n'),card=[strip(draft.card_headline),draft.card_body].join('\n');
 const visible=[tweet,card,...cardDataFields(draft.card_data).map(([,v])=>v),...(draft.claims??[]).map(c=>c.text)].join('\n').toLocaleLowerCase('tr-TR');
 const issues:string[]=[];
 if(contexts.some(c=>c.data_day_status==='conflict'))issues.push('market_source_date_conflict');
 if(contexts.some(c=>c.data_day_status==='invalid'))issues.push('market_source_date_invalid');
 if(/(?<!\p{L})(?:bugün|anlık|güncel|şimdi)(?!\p{L})|şu an|son seans|son durum|gün sonu|gün ortası|kapanış(?:ta|ı)|açılış(?:ta|ı)/iu.test(visible))issues.push('unsupported_market_currentness');
 if(/kaynak tablos|kaynak görsel|görselde|tabloda/iu.test([draft.headline,draft.body,draft.card_headline,draft.card_body].join('\n')))issues.push('market_source_prose_in_public_output');
 const days=contexts.flatMap(c=>c.source_data_days),one=contexts.every(c=>c.data_day_status==='source_labelled')&&new Set(days).size===1?days[0]:null;
 const cardVisible=[draft.card_headline,draft.card_body,...cardDataFields(draft.card_data).map(([,v])=>v)].join('\n').toLocaleLowerCase('tr-TR');
 if([...cardVisible.matchAll(dates)].length||/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(cardVisible))issues.push('market_card_datetime_forbidden');
 const outputDates=[...visible.matchAll(dates)];
 if(outputDates.some(m=>!one||day(m[0])!==one)||/\b\d{1,2}\s+(?:ocak|şubat|mart|nisan|mayıs|haziran|temmuz|ağustos|eylül|ekim|kasım|aralık)(?!\p{L})/iu.test(visible.replace(dates,'')))issues.push('unsupported_market_data_day');
 if(!one&&draft.card_data?.as_of?.trim())issues.push('unsupported_market_measurement_time');
 // A time in the caption or on the x-axis is not an as-of measurement time.
 if(/\b\d{1,2}:\d{2}(?::\d{2})?\b/.test(visible)||/itibarıyla|itibariyle/iu.test(visible))issues.push('unsupported_market_measurement_time');
 return[...new Set(issues)];
}

export function withMarketEditorialContext(documents:Document[]):Document[]{
 const contexts=marketTimeContext(documents);
 return documents.map(d=>{const c=contexts.find(c=>c.url===d.url);if(!c)return d;return{...d,market_editorial_context:{version:1,label:c.editorial_session.label,basis:c.editorial_session.basis,calendar_version:c.editorial_session.version,measurement_time_verified:false,publication_is_not_data_day:true,reason:c.editorial_session.reason}};});
}
export function applyMarketEditorialHeader(draft:Draft,documents:Document[]):Draft{
 if(!['market','volume'].includes(draft.template))return draft;
 const contexts=marketTimeContext(documents);if(contexts.length!==1)return draft;
 const c=contexts[0],label=c.editorial_session.label;
 const change=(title:string)=>{if(typeof title!=='string'||!title.trim())return title;const emoji=/^(?:\p{Extended_Pictographic}\uFE0F?\s*)+/u.exec(title)?.[0]??'',plain=title.slice(emoji.length),folded=plain.toLocaleLowerCase('tr-TR'),old=/^(?:güne başlarken|açılışın ilk dakikaları(?:nda)?|gün ortası(?:nda)?|kapanışa doğru|kapanışta)(?:\s*[—–:-]\s*|\s+|$)/u.exec(folded);let rest=old?plain.slice(old[0].length):plain;
  if(label)rest=rest.replace(/^kaynak tablosunda(?:\s*[—–:-]\s*|\s+)/iu,'');
  return emoji+(label?label+' — '+rest:old?'Piyasa özeti — '+rest:rest);
 };
 if(draft.source_notes!==undefined&&!Array.isArray(draft.source_notes))return draft;
 const note='Editoryal zaman etiketi (kanal yayını): '+(label??'tarafsız kaynak başlığı')+'. Özgün kanal mesajı esas alındı; veri ölçüm günü/saati veya güncel fiyat teyidi değildir. İletim durumu: '+c.forward_state+'.';
 const source_notes=[...(draft.source_notes??[]).filter(n=>!n.startsWith('Editoryal zaman etiketi (kanal yayını): ')),note];
 return{...draft,headline:change(draft.headline),card_headline:change(draft.card_headline),source_notes};
}
