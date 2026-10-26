import {sha256} from './utils/text';
import type {Draft,Document} from './types';
const normalized=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function marketView(draft:Draft):string|undefined {
 const o=draft.card_data?.overview;
 // Distinct intraday snapshots must not share the model's generic daily key.
 // Include every displayed fact, so a corrected broker/panel is not suppressed.
 if(o)return JSON.stringify(['market-overview-v1',o.view,o.level,o.percent,o.direction,o.points,o.volume,o.low,o.high,
  o.panels.map(p=>[p.key,p.rows.map(r=>[r.label,r.value])]),[o.breadth.up,o.breadth.neutral,o.breadth.down],
  o.brokers.map(b=>[b.side,b.first5,b.rows.map(r=>[r.name,r.net,r.share,r.total])])]);
 if(!['institutional','akd','broker_flow','custody'].includes(draft.template))return;
 const d=draft.card_data;
 // Buy-only, sell-only and combined reports are separately requested views.
 // A new dated snapshot or changed rows must not disappear as an old headline.
 return JSON.stringify([draft.template,d?.as_of??'',d?.ticker??'',normalized(d?.broker??''),...(['buy','sell','holdings','metrics'] as const).map(k=>(d?.[k]??[]).map(r=>[normalized(r.label),normalized(r.value)]))]);
}
export function titleSimilarity(a:string,b:string):number {
 const aa=new Set(normalized(a).split(' ').filter(x=>x.length>2));const bb=new Set(normalized(b).split(' ').filter(x=>x.length>2));
 if(!aa.size||!bb.size)return 0;const shared=[...aa].filter(x=>bb.has(x)).length;return shared/(aa.size+bb.size-shared);
}
export async function eventIdentity(draft:Draft,documents:Document[]):Promise<string> {
 // The model's event key cannot merge different named subjects or dates.
 const subjects=draft.entities.map(normalized).sort().join('|');
 const day=documents.map(d=>d.published_at?.slice(0,10)).find(Boolean)??'undated';
 return sha256([draft.category,subjects,normalized(draft.event_key),day,...(marketView(draft)?[marketView(draft)!]:[])].join('|'));
}
export function sameEvent(a:Draft,b:Draft):boolean {
 if(marketView(a)!==marketView(b))return false;
 const facts=(d:Draft)=>{const text=normalized(d.headline+' '+d.body);return JSON.stringify([[...new Set(text.match(/\b\d+(?: [0-9]+)*\b/g)??[])].sort(),/yalan|reddet/.test(text),/iptal/.test(text),/beklen|tahmin|iddia|olabilir/.test(text),/ihale/.test(text),/sozlesme|sözleşme|anlasma|anlaşma/.test(text)]);};
 if(facts(a)!==facts(b))return false;
 const subjects=a.entities.map(normalized),other=b.entities.map(normalized);
 if(!subjects.some(x=>other.includes(x)))return false;
 return normalized(a.event_key)===normalized(b.event_key)||titleSimilarity(a.headline,b.headline)>.72;
}
export function evidenceFamily(doc:Document):string {
 const text=doc.body.slice(0,5000);
 if(/(?:kaynak|source)\s*:\s*Reuters|\(Reuters\)/i.test(text))return 'wire-reuters';
 if(/(?:kaynak|source)\s*:\s*(?:AA|Anadolu)|\(AA\)/i.test(text))return 'wire-aa';
 if(/(?:kaynak|source)\s*:\s*Foreks/i.test(text))return 'wire-foreks';
 return doc.family;
}
