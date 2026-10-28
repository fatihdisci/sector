import {parseMarketOverview,isFullOverview,overviewEvidence} from './market-overview';
import type {CardData,CardRow,Document} from './types';
import {verifiedEquityCodes} from './equity-codes';
export function cardDataFields(data?:CardData):[string,string][] {
 if(!data)return [];
 if(data.overview)return overviewEvidence(data.overview).map(p=>[p.id,p.text]);
 const values:[string,string][]=[];
 if(Array.isArray(data.tickers))data.tickers.forEach((code,i)=>values.push([`card_data.tickers[${i}]`,code]));
 for(const key of ['ticker','broker','as_of','buy_broker','sell_broker'] as const)if(typeof data[key]==='string')values.push(['card_data.'+key,data[key]!]);
 for(const key of ['buy','sell','holdings','metrics'] as const)if(Array.isArray(data[key]))data[key]!.forEach((row,i)=>{if(typeof row?.label==='string')values.push([`card_data.${key}[${i}].label`,row.label]);if(typeof row?.value==='string')values.push([`card_data.${key}[${i}].value`,row.value]);});
 return values;
}
export function validateCardData(value:unknown,documents:Document[]):void {
 if(value===undefined)return;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_card_data');
 const data=value as CardData;
 if(data.overview){const d=documents.find(isFullOverview);if(!d||JSON.stringify(data.overview)!==JSON.stringify(parseMarketOverview(d))||Object.keys(data).some(k=>k!=='overview'))throw Error('market_overview_source_mismatch');return;}
 if(Object.keys(data).some(k=>!['ticker','tickers','broker','as_of','buy','sell','holdings','metrics','buy_broker','sell_broker'].includes(k)))throw Error('invalid_card_data');
 if(data.tickers!==undefined){
  const verified=new Set(verifiedEquityCodes(documents));
  if(!Array.isArray(data.tickers)||!data.tickers.length||data.tickers.length>1000||new Set(data.tickers).size!==data.tickers.length||data.tickers.some(c=>typeof c!=='string'||!verified.has(c)))throw Error('unsupported_card_tickers');
 }
 for(const key of ['ticker','broker','as_of','buy_broker','sell_broker'] as const)if(data[key]!==undefined&&(typeof data[key]!=='string'||!data[key]!.trim()||data[key]!.length>(key==='broker'?80:64)))throw Error('invalid_card_data');
 for(const key of ['buy','sell','holdings','metrics'] as const){
  const rows=data[key];if(rows===undefined)continue;
  if(Array.isArray(rows)&&rows.length>(key==='metrics'?3:(key==='buy'||key==='sell')&&documents.some(d=>d.market_data?.kind==='institutional')?40:20))throw Error('multi_card_capacity_exceeded');
  if(!Array.isArray(rows)||!rows.length||rows.some((r:CardRow)=>!r||Object.keys(r).some(k=>!['label','value'].includes(k))||typeof r.label!=='string'||!r.label.trim()||r.label.length>60||typeof r.value!=='string'||!r.value.trim()||r.value.length>64))throw Error('invalid_card_data');
 }
 if(!cardDataFields(data).length)throw Error('invalid_card_data');
 if(data.broker&&!documents.some(d=>d.market_data?.broker?.toUpperCase()===data.broker!.toUpperCase()))throw Error('unsupported_card_broker');
 const source=documents.map(d=>d.title+'\n'+d.body).join('\n');
 if(data.ticker&&(!/^[A-Z][A-Z0-9]{3,4}$/.test(data.ticker)||!documents.some(d=>d.equity_codes?.includes(data.ticker!))&&!new RegExp('(?<![A-Z0-9])'+data.ticker+'(?![A-Z0-9])').test(source)))throw Error('unsupported_card_ticker');
 // Audit evaluates row/value association and time period; this guard ensures
 // names themselves were supplied, rather than inferred from arbitrary codes.
 const norm=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/\s+/g,' ');
 for(const key of ['buy_broker','sell_broker']as const)if(data[key]&&!norm(source).includes(norm(data[key]!)))throw Error('unsupported_card_broker');
 const single=documents.find(d=>d.market_data?.kind==='institutional'&&d.market_data.broker)?.market_data?.broker;
 if(single&&!documents.some(d=>d.source_layout?.kind==='institution_summary'))for(const key of ['buy_broker','sell_broker'] as const)if(data[key]&&norm(data[key]!)!==norm(single))throw Error('unsupported_card_broker');
 for(const row of [...data.buy??[],...data.sell??[],...data.holdings??[]])if(!norm(source).includes(norm(row.label)))throw Error('unsupported_card_entity');
}
