import type {Draft,CardRow} from './types';
// Unspecified fields preserve the existing product defaults (including tweet first-five).
export interface OutputPreferences {list?:'all'|'first';count?:number;side?:'buy'|'sell'|'both';show_time?:boolean;show_footer?:boolean;presentation?:string;}
export const MAX_OUTPUT_LIMIT=999;
export const OUTPUT_LIMIT_MESSAGE='İlk N için 1–999 arasında tam sayı belirt. Desteklenmeyen sayı kısaltılmadı; içerik oluşturulmadı.';
export function outputPreferences(text:string,current?:OutputPreferences):OutputPreferences|undefined{
 const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('tr-TR').replace(/ı/g,'i');
 const all=/tum(?:u|unu|u?nun| liste| hisse)|hepsini|tam liste/.test(t),n=/ilk\s+([+-]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?)/.exec(t);
 const buy=/sadece.*(?:alis|alim|alinan)|yalniz.*(?:alis|alim|alinan)/.test(t),sell=/sadece.*(?:satis|satim|satilan)|yalniz.*(?:satis|satim|satilan)/.test(t),both=/(?:alis.*satis|alim.*satim|alinan.*satilan).*ikisi|her iki|iki taraf/.test(t);
 const p:OutputPreferences={...current};let changed=false;
 if(n){const count=Number(n[1]);if(!/^\d+$/.test(n[1])||!Number.isSafeInteger(count)||count<1||count>MAX_OUTPUT_LIMIT)throw Error('unsupported_output_limit');}
 if(all){p.list='all';delete p.count;changed=true;}else if(n){p.list='first';p.count=Number(n[1]);changed=true;}
 if(buy||sell||both){p.side=both||buy&&sell?'both':buy?'buy':'sell';changed=true;}
 // Stop at punctuation so “saat yazma, alt not göster” remains independent.
 for(const [field,pattern] of [['show_time',/saat(?:(?!alt not|dipnot)[^,;.!\n])*/],['show_footer',/(?:alt not|dipnot)(?:(?!saat)[^,;.!\n])*/]] as const){
  const clause=pattern.exec(t)?.[0];if(!clause)continue;
  if(/yazma|olmasin|ekleme|gosterme|gizle|kaldir/.test(clause)){p[field]=false;changed=true;}
  else if(/yaz|goster|ekle/.test(clause)){p[field]=true;changed=true;}
 }
 return changed?p:undefined;
}
export function outputView<T extends Pick<Draft,'card_data'|'output_preferences'>>(d:T):T{
 const p=d.output_preferences;if(!p)return d;
 if(p.list==='first'&&(!Number.isInteger(p.count)||p.count!<1||p.count!>MAX_OUTPUT_LIMIT))throw Error('invalid_output_limit');
 if(!d.card_data)return d;
 const take=<R>(rows:R[])=>p.list==='first'?rows.slice(0,p.count):[...rows];
 const data={...d.card_data};
 for(const side of ['buy','sell'] as const)if(data[side])data[side]=p.side&&p.side!=='both'&&p.side!==side?[]:take(data[side]!);
 if(data.holdings)data.holdings=take(data.holdings);
 if(data.tickers)data.tickers=take(data.tickers);
 if(data.report?.buyback){data.report={...data.report,rows:[...data.report.rows]};return {...d,card_data:data};}
 if(data.report?.circuit&&p.list==='first')throw Error('circuit_report_subset_requires_recalculation');
 if(data.report?.general&&p.list==='first')throw Error('general_report_subset_requires_recalculation');
 if(data.report)data.report={...data.report,rows:take(data.report.rows),footer:p.show_footer===false?'':data.report.footer};
 if(!p.show_time)delete data.as_of;
 return {...d,card_data:data};
}
export function selectedRows(d:Pick<Draft,'card_data'|'output_preferences'>):CardRow[]{
 const data=outputView(d).card_data;return data?[...(data.buy??[]),...(data.sell??[]),...(data.holdings??[]),...(data.report?.rows??[])]:[];
}
export function assertSelectedRows(expected:CardRow[],actual:CardRow[]){
 if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('selected_row_coverage_mismatch');
}
export function tweetListLimit(d:Pick<Draft,'output_preferences'>,fallback:number){return d.output_preferences?.list==='all'?Infinity:d.output_preferences?.list==='first'?d.output_preferences.count??fallback:fallback;}
