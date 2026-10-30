import {OutputCapacityError} from './output-capacity';
export interface CircuitEvent {id:number;tickers:string[];published_at:string;}
export interface CircuitIndices {bist30:string[];bist100:string[];checkedAt:string;source:string;}
export interface CircuitSelection {
 version:1;rule:'bist30-bist100-repeats-code-v1'|'all-market-new-events-v1';limit:number;
 total_events:number;total_tickers:number;selected_tickers:string[];omitted:number;
 all_rows:{label:string;value:string}[];
 indices:{status:'verified'|'missing'|'not_required';snapshot:CircuitIndices|null};
 tweet_style?:'hashtags'|'plain';
}
export const CIRCUIT_REPORT_LIMIT=120;
const code=/^[A-Z][A-Z0-9]{3,4}$/;
export function circuitOmissionNote(s:Pick<CircuitSelection,'total_tickers'|'omitted'>):string{return s.omitted?`${s.total_tickers} hisse; ${s.omitted} gösterilmedi.`:'';}
/** Selection affects presentation only. Every event and aggregate remains archived. */
export function selectCircuitReport(events:readonly CircuitEvent[],indices:CircuitIndices|null,at:number,limit=CIRCUIT_REPORT_LIMIT,generalArtwork=false){
 if(!Number.isSafeInteger(limit)||limit<1||limit>(generalArtwork?10000:CIRCUIT_REPORT_LIMIT))throw Error('invalid_output_limit');
 const counts=new Map<string,number>();for(const event of events)for(const ticker of new Set(event.tickers)){if(!code.test(ticker))throw Error('circuit_report_ticker_invalid');counts.set(ticker,(counts.get(ticker)??0)+1);}
 const members=(values:unknown,n:number):values is string[]=>Array.isArray(values)&&values.length===n&&new Set(values).size===n&&values.every(v=>typeof v==='string'&&code.test(v));
 const checked=indices?Date.parse(indices.checkedAt):NaN;
 const verified=!!indices&&indices.source==='https://www.kap.org.tr/tr/Endeksler'&&members(indices.bist30,30)&&members(indices.bist100,100)&&indices.bist30.every(c=>indices.bist100.includes(c))&&Number.isFinite(checked)&&checked<=at+300_000&&at-checked<=36*3600_000;
 if(counts.size&&!verified)throw Error('circuit_report_indices_unavailable');
 const tier=(c:string)=>verified?(indices!.bist30.includes(c)?30:indices!.bist100.includes(c)?100:999):999;
 const sorted=[...counts].sort((a,b)=>tier(a[0])-tier(b[0])||b[1]-a[1]||(a[0]<b[0]?-1:a[0]>b[0]?1:0));
 if(sorted.length>limit)throw new OutputCapacityError('multi_card_capacity_exceeded',{version:1,kind:'visual',events:events.length,tickers:sorted.length,fields:[{name:'report.rows',rows:sorted.length,per_card:30}],required_cards:Math.ceil(sorted.length/30),max_cards:4});
 const all_rows=sorted.map(([ticker,n])=>({label:'#'+ticker,value:`${n} bildirim${tier(ticker)<999?' · BIST '+tier(ticker):''}`}));
 const rows=all_rows.slice(0,limit);
 const selection:CircuitSelection={version:1,rule:'bist30-bist100-repeats-code-v1',limit,total_events:events.length,total_tickers:counts.size,selected_tickers:rows.map(r=>r.label.slice(1)),omitted:counts.size-rows.length,all_rows,indices:{status:verified?'verified':'missing',snapshot:verified?{bist30:[...indices!.bist30],bist100:[...indices!.bist100],checkedAt:indices!.checkedAt,source:indices!.source}:null}};
 return {rows,selection};
}

/** No index dependency for owner-requested all-market automatic batches. */
export function selectCircuitBatch(events:readonly CircuitEvent[],indices:CircuitIndices|null=null,at=Date.now()){
 const counts=new Map<string,number>();for(const e of events)for(const ticker of new Set(e.tickers)){if(!code.test(ticker))throw Error('circuit_report_ticker_invalid');counts.set(ticker,(counts.get(ticker)??0)+1);}
 const rows=[...counts].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([ticker,n])=>({label:'#'+ticker,value:`${n} bildirim`}));
 const selection:CircuitSelection={version:1,rule:'all-market-new-events-v1',limit:10000,total_events:events.length,total_tickers:counts.size,selected_tickers:rows.map(r=>r.label.slice(1)),omitted:0,all_rows:rows,indices:{status:'not_required',snapshot:null}};
 const tags=circuitIndexTags(selection.selected_tickers,indices,at);
 if(tags!==null)selection.indices={status:'verified',snapshot:indices};
 return{rows,selection};
}

/** Missing/stale membership omits optional tags, never excludes market events. */
export function circuitIndexTags(codes:readonly string[],indices:CircuitIndices|null,at:number):string[]|null {
 const members=(a:unknown,n:number):a is string[]=>Array.isArray(a)&&a.length===n&&new Set(a).size===n&&a.every(c=>typeof c==='string'&&code.test(c));
 const checked=indices?Date.parse(indices.checkedAt):NaN;
 if(!indices||indices.source!=='https://www.kap.org.tr/tr/Endeksler'||!members(indices.bist30,30)||!members(indices.bist100,100)||!indices.bist30.every(c=>indices.bist100.includes(c))||!Number.isFinite(checked)||checked>at+300000||at-checked>36*3600000)return null;
 return codes.some(c=>indices.bist30.includes(c))?['#bist30','#bist100']:codes.some(c=>indices.bist100.includes(c))?['#bist100']:[];
}
