/** Local experimental classifier. No network, publication or source verification. */
import calendar from './data/bist-equity-session-2026.json';
import {equitySessionLabel} from './market-session';
type Level={price:string;lot:number};
type Side={complete:boolean;levels:Level[]};
export type DepthFrame={ticker:string;frame_complete:boolean;mode:'continuous'|'theoretical'|'unknown';measured_at:string|null;buy:Side;sell:Side;ceiling:string|null;floor:string|null};
function price(p:string){if(!/^\d{1,7}(?:[.,]\d{1,2})?$/.test(p))return null;const [a,b='']=p.replace(',','.').split('.');return Number(a)*100+Number(b.padEnd(2,'0'));}
function side(s:Side,ascending:boolean){if(!s||typeof s.complete!=='boolean'||!Array.isArray(s.levels))return null;const seen=new Set<number>();let last:number|undefined;for(const r of s.levels){const n=price(r.price);if(n===null||n<=0||!Number.isSafeInteger(r.lot)||r.lot<=0||seen.has(n)||(last!==undefined&&(ascending?n<=last:n>=last)))return null;seen.add(n);last=n;}return s;}
function continuous(at:string){const x=equitySessionLabel(at);if(!x.label)return false;const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)),v=(k:string)=>Number(p.find(x=>x.type===k)!.value),minutes=v('hour')*60+v('minute'),session=x.kind==='half'?calendar.half_session:calendar.full;return minutes>=session.continuous_start&&minutes<session.closing_start;}
export function classifyDepth(frame:DepthFrame,now:number,maxAgeMs=90000){
 const buy=side(frame.buy,false),sell=side(frame.sell,true),bestBuy=buy?.levels[0]??null,bestSell=sell?.levels[0]??null;
 const unknown=(reason:string)=>({candidate:null,bestBuy,bestSell,reason} as const);
 if(!buy||!sell)return unknown('invalid_or_duplicate_levels');
 if(!/^[A-Z][A-Z0-9]{3,4}$/.test(frame.ticker)||!frame.frame_complete||!buy.complete||!sell.complete)return unknown('incomplete_frame');
 const t=frame.measured_at?Date.parse(frame.measured_at):NaN;if(!Number.isFinite(t)||!frame.measured_at||!/(?:Z|[+-]\d\d:\d\d)$/.test(frame.measured_at)||!Number.isFinite(now)||t>now||now-t>maxAgeMs)return unknown('measurement_time_unverified_or_stale');
 if(frame.mode!=='continuous'||!continuous(frame.measured_at)||!continuous(new Date(now).toISOString()))return unknown('not_continuous_session');
 if(!buy.levels.length&&!sell.levels.length)return unknown('both_sides_empty');
 if(buy.levels.length&&!sell.levels.length){if(frame.ceiling!==null&&(price(frame.ceiling)===null||price(frame.ceiling)!==price(bestBuy!.price)))return unknown('ceiling_mismatch');return {candidate:'ceiling_candidate',bestBuy,bestSell,reason:'complete_empty_ask'} as const;}
 if(!buy.levels.length&&sell.levels.length){if(frame.floor!==null&&(price(frame.floor)===null||price(frame.floor)!==price(bestSell!.price)))return unknown('floor_mismatch');return {candidate:'floor_candidate',bestBuy,bestSell,reason:'complete_empty_bid'} as const;}
 return unknown('both_sides_present');
}
