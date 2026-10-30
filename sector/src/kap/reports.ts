import twitter from 'twitter-text';
import type {OutputPreferences} from '../output-preferences';
import {normalize,type Disclosure,type Indices,type fullText} from './parser';
import type {Document,Draft} from '../types';
import {OutputCapacityError} from '../output-capacity';
import {selectCircuitReport,circuitOmissionNote,CIRCUIT_REPORT_LIMIT} from '../circuit-selection';
export const istanbulDay=(at:number)=>new Date(at+10800000).toISOString().slice(0,10);
const clean=(s:string)=>s.replace(/[|\s]+$/g,'').trim();
export interface Purchase {ticker:string;day:string;units:string;program:string;priceMicros?:string;}
// Thousandths of a trading unit, avoiding floating point sums and rounding.
export function quantity(s:string):bigint {
 s=clean(s);if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,3})?$/.test(s))throw Error('kap_report_quantity');
 const [a,b='']=s.replace(/\./g,'').split(',');return BigInt(a)*1000n+BigInt(b.padEnd(3,'0'));
}
export function formatQuantity(s:string):string {const n=BigInt(s),a=(n/1000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.'),b=(n%1000n).toString().padStart(3,'0').replace(/0+$/,'');return a+(b?','+b:'');}
export function purchases(page:ReturnType<typeof fullText>):Purchase[]{
 if(!/PAYLARIN GERI ALINMASINA/.test(normalize(page.disclosure.title)))throw Error('kap_report_not_buyback');
 const board=page.labels.find(r=>normalize(clean(r.label))==='YONETIM KURULU KARAR TARIHI');
 if(!board||!/^\d{2}\.\d{2}\.\d{4}$/.test(clean(board.value)))throw Error('kap_report_program_missing');
 const program=clean(board.value),out:Purchase[]=[];let found=false;
 for(const raw of page.tables){const table=raw.map(r=>r.map(clean));
  const h=table.findIndex(r=>r.includes('İşlem Tarihi')&&r.some(c=>/^İşleme Konu Payların Nominal Tutarı \(TL\)$/iu.test(c)));if(h<0)continue;
  found=true;const header=table[h],date=header.indexOf('İşlem Tarihi'),amount=header.findIndex(c=>/^İşleme Konu Payların Nominal Tutarı \(TL\)$/iu.test(c)),stock=header.indexOf('İşleme Konu Pay');
  if(stock<0)throw Error('kap_report_stock_missing');
  for(const row of table.slice(h+1)){if(row.every(c=>!c))continue;if(row.length!==header.length)throw Error('kap_report_row_invalid');
   const m=row[stock].match(/\b([A-Z][A-Z0-9]{3,4}),\s*TR[A-Z0-9]{10}\b/);const dt=row[date].match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
   if(!m||m[1]==='ISKUR'||!dt)throw Error('kap_report_row_invalid');
   const day=`${dt[3]}-${dt[2]}-${dt[1]}`;if(new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)throw Error('kap_report_date');
   const priceCol=header.findIndex(c=>/^(ISLEM FIYATI|ORTALAMA ALIM FIYATI) \(TL(?:\/ADET)?\)$/.test(normalize(c)));
   let priceMicros:string|undefined;
   if(priceCol>=0&&row[priceCol]){const v=row[priceCol].replace(/\./g,'');if(!/^\d+(?:,\d{1,6})?$/.test(v))throw Error('kap_report_price');const [a,b='']=v.split(',');const n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));if(n<=0n)throw Error('kap_report_price');priceMicros=n.toString();}
   out.push({ticker:m[1],day,units:quantity(row[amount]).toString(),program,priceMicros});
  }
 }
 if(!found)throw Error('kap_report_table_missing');return out;
}
export interface ReportRecord {disclosure:Disclosure;purchases?:Purchase[];error?:string;}
export function report(kind:'circuit'|'buyback',records:ReportRecord[],indices:Indices|null,at:number,coverage:string,preferences?:OutputPreferences,generalArtwork=false):{draft:Draft;documents:Document[]}{
 const limit=(n:number)=>preferences?.list==='all'?Infinity:preferences?.count??n;
 const day=istanbulDay(at),time=new Date(at).toLocaleTimeString('tr-TR',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit'});
 const relevant=records.filter(r=>istanbulDay(Date.parse(r.disclosure.publishedAt))===day&&Date.parse(r.disclosure.publishedAt)<=at&&(kind==='circuit'?normalize(r.disclosure.title+' '+r.disclosure.summary).includes('DEVRE KESICI'):/PAYLARIN GERI ALINMASINA/.test(normalize(r.disclosure.title))));
 const unique=[...new Map(relevant.map(r=>[r.disclosure.id,r])).values()];
 const replaced=new Set(unique.map(r=>r.disclosure.relatedOid).filter(Boolean));
 const current=unique.filter(r=>!r.disclosure.oid||!replaced.has(r.disclosure.oid));
 const rows:{label:string;value:string}[]=[],parts:string[]=[];
 let heading='',footer='KAP kayıtları • '+day+' '+time+' itibarıyla';
 if(kind==='circuit')return circuitDailyReport(current.map(r=>r.disclosure),indices,at,coverage,preferences,generalArtwork);
 {
  const failed=current.filter(r=>!r.purchases||r.error).length;
  // Each programme table is a snapshot. Later disclosures replace earlier
  // tables for that issuer/programme; identical transactions within a table
  // remain separate genuine trades, never collapsed by amount/date.
  const blocked=new Set(current.filter(r=>!r.purchases||r.error).map(r=>r.disclosure.issuerCode??r.disclosure.company));
  const snapshots=new Map<string,{id:number;rows:Purchase[]}>();
  for(const r of current.sort((a,b)=>a.disclosure.id-b.disclosure.id)){
   if(!r.purchases||r.error||blocked.has(r.disclosure.issuerCode??r.disclosure.company))continue;
   const groups=new Map<string,Purchase[]>();for(const p of r.purchases){const key=(r.disclosure.issuerCode??r.disclosure.company)+':'+p.program+':'+p.ticker;groups.set(key,[...(groups.get(key)??[]),p]);}
   for(const [key,values] of groups)snapshots.set(key,{id:r.disclosure.id,rows:values});
  }
  const sums=new Map<string,bigint>();for(const snap of snapshots.values())for(const p of snap.rows)if(p.day===day)sums.set(p.ticker,(sums.get(p.ticker)??0n)+BigInt(p.units));
  const ranked=[...sums].filter(([,n])=>n>0n).sort((a,b)=>a[1]===b[1]?a[0].localeCompare(b[0]):a[1]>b[1]?-1:1);
  heading=failed?'Pay geri alım raporu (kısmi)':`Pay geri alım raporu: ${ranked.length} hisse`;
  parts.push(`${day} saat ${time} itibarıyla ${unique.length} KAP bildirimi kaydedildi. Düzeltmeler sonrası ${current.length} kayıt; bugüne ait doğrulanmış alım bulunan ${ranked.length} hisse.`);
  for(const [c,n] of ranked.slice(0,limit(10))){rows.push({label:'#'+c,value:formatQuantity(n.toString())+' lot'});parts.push(`#${c}: ${formatQuantity(n.toString())} lot`);}
  if(failed)parts.push(`${failed} bildirimin işlem miktarı henüz doğrulanamadı; sıralama eksiktir.`);
  footer='Yalnızca KAP’ta yer alan pay geri alımı bildirimleri esas alınmıştır. Farklılık gösterebilir.';
 }
 if(coverage)parts.push(coverage);
 let body=parts.join('\n\n');
 const title='📢 '+heading;
 const source='https://www.kap.org.tr/tr/bildirim-sorgu';
 const doc:Document={source_id:'kap-daily-report',source_name:'KAP günlük kayıt raporu',family:'kap-report',official:true,url:source+'#'+kind+'-'+at,title:heading,body,passages:[{id:'computed_report',text:body}],published_at:new Date(at).toISOString(),primary_urls:current.map(r=>r.disclosure.url),language:'tr'};
 const draft:Draft={...(preferences?{output_preferences:preferences}:{}),headline:title,body,hashtags:['Borsa','BIST'],category:'kap',importance:85,template:'info',card_headline:heading,card_body:day+(preferences?.show_time?' • '+time+' itibarıyla':''),card_data:{report:{rows,footer}},claims:[{text:body,evidence:[{document:0,passage:'computed_report',quote:body}]}],entities:[],event_key:kind+'-'+at,uncertainties:[],source_notes:[]};
 if(!preferences?.list&&!twitter.parseTweet([draft.headline,draft.body,'#Borsa #BIST'].join('\n\n')).valid){draft.body=`${rows.length} hissede pay geri alımı bildirimi.\n\n`+rows.map(r=>rows.length<6?r.label+': '+r.value:r.label).join(' ');}
 const tweet=twitter.parseTweet([draft.headline,draft.body,'#Borsa #BIST'].join('\n\n'));
 if(!tweet.valid)throw new OutputCapacityError('tweet_capacity_exceeded',{version:1,kind:'tweet',events:current.length,tickers:rows.length,tweet_length:tweet.weightedLength,tweet_limit:280,preference:preferences?.list??'default_summary'});
 return {draft,documents:[doc]};
}

function circuitDailyReport(current:Pick<Disclosure,'id'|'subjectCodes'|'publishedAt'|'url'>[],indices:Indices|null,at:number,coverage:string,preferences?:OutputPreferences,generalArtwork=false):{draft:Draft;documents:Document[]}{
 const events=current.map(d=>({id:d.id,tickers:[...d.subjectCodes],published_at:d.publishedAt}));
 const {rows,selection}=selectCircuitReport(events,indices,at,generalArtwork?10000:CIRCUIT_REPORT_LIMIT,generalArtwork);
 const reportDate=new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',day:'numeric',month:'long'}).format(new Date(at));
 const headline=`${reportDate} günü kaç hissede devre kesici çalıştı?`,note='';
 const codes=selection.selected_tickers.slice(0,20);
 const body=rows.length?`${selection.total_tickers} hissede ${events.length} devre kesici bildirimi kaydedildi.\n\nÖne çıkanlar: ${codes.map(c=>'#'+c).join(' ')}\n\nTüm liste görsellerde.`:'Gün içinde kaydedilmiş devre kesici bildirimi yok.';
 const tweet=twitter.parseTweet([headline,body].join('\n\n'));
 if(!tweet.valid)throw new OutputCapacityError('tweet_capacity_exceeded',{version:1,kind:'tweet',events:events.length,tickers:selection.total_tickers,selected_tickers:codes.length,tweet_length:tweet.weightedLength,tweet_limit:280});
 selection.tweet_style='hashtags';
 const source='https://www.kap.org.tr/tr/bildirim-sorgu',day=istanbulDay(at);
 const evidence=`${day}: ${events.length} bildirim; ${selection.total_tickers} farklı hisse. Gösterilen ${rows.length}; gösterilmeyen ${selection.omitted}. Öncelik BIST30, BIST100 (BIST30 hariç), diğer; grup içinde tekrar sayısı azalan, eşitlikte kod artan.\n`+selection.all_rows.map(r=>r.label+': '+r.value).join('\n')+'\n'+coverage;
 const document:Document={source_id:'kap-daily-report',source_name:'KAP günlük kayıt raporu',family:'kap-report',official:true,url:source+'#circuit-'+at,title:'Devre kesici raporu',body:evidence,passages:[{id:'computed_report',text:evidence}],published_at:new Date(at).toISOString(),primary_urls:current.map(d=>d.url),language:'tr'};
 const draft:Draft={...(preferences?{output_preferences:preferences}:{}),headline,body,hashtags:[],category:'kap',importance:85,template:'info',card_headline:'Devre kesici raporu',card_body:`${events.length} bildirim · ${selection.total_tickers} farklı hisse`,card_data:{report:{rows,footer:note,events,circuit:selection}},claims:[{text:evidence,evidence:[{document:0,passage:'computed_report',quote:evidence}]}],entities:[],event_key:'circuit-'+at,uncertainties:[],source_notes:[]};
 return {draft,documents:[document]};
}

/** Automatic cards use only verified index members; manual reports retain all markets. */
export function indexCircuitSummary(summary:ReturnType<typeof report>,at:number):ReturnType<typeof report>{
 const events=summary.draft.card_data?.report?.events,indices=summary.draft.card_data?.report?.circuit?.indices.snapshot??null;
 if(!Array.isArray(events))throw Error('circuit_auto_evidence_missing');
 selectCircuitReport(events,indices,at,10000,true);
 const members=new Set(indices?.bist100??[]),urls=new Set(summary.documents.flatMap(d=>d.primary_urls??[]));
 const selected=events.map(e=>({...e,tickers:e.tickers.filter(t=>members.has(t))})).filter(e=>e.tickers.length);
 const records=selected.map(e=>{const url='https://www.kap.org.tr/tr/Bildirim/'+e.id;if(!urls.has(url))throw Error('circuit_auto_source_url_missing');return{id:e.id,subjectCodes:e.tickers,publishedAt:e.published_at,url};});
 return circuitDailyReport(records,indices,at,'Otomatik içerik yalnız doğrulanmış BIST 30 ve BIST 100 paylarını kapsar.',summary.draft.output_preferences,true);
}
