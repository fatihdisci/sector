import {createHash} from 'node:crypto';
export type Source={url:string;retrieved_at:string;sha256:string};
export type CatalogInput={issuers_source:{source_url:string;retrieved_at:string;sha256:string};index_source:Source;issuers:{mkkMemberOid:string;kapMemberTitle:string;stockCode:string}[];equity_index:{stockCode:string;mkkMemberOid:string;title:string}[];profiles:{url:string;retrieved_at:string;sha256:string;issuer_oid:string;listed_codes:string;tables:{headers:string[];rows:string[][]}[]}[];aliases:{code:string;aliases:string[];excluded_contexts:string[];source_url:string;alias_basis:string}[];alias_sources:Source[];profile_fetch_errors:{oid:string;reason:string}[]};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// A comma-separated issuer header is NOT an instrument-type declaration.
export function buildCatalog(input:CatalogInput){
 const byOid=new Map(input.issuers.map(r=>[r.mkkMemberOid,r]));
 if(byOid.size!==input.issuers.length)throw Error('duplicate issuer OID');
 const evidence=new Map<string,{oid:string;sources:(Source&{field:string})[]}>();
 function add(oid:string,code:string,source:Source,field:string){
  const issuer=byOid.get(oid);
  if(!issuer||!issuer.stockCode.split(',').map(s=>s.trim()).includes(code)||!/^[A-Z][A-Z0-9]{3,4}$/.test(code))throw Error('instrument/issuer source mismatch: '+code);
  const old=evidence.get(code);if(old&&old.oid!==oid)throw Error('equity code belongs to conflicting issuers: '+code);
  evidence.set(code,{oid,sources:[...(old?.sources??[]),{...source,field}]});
 }
 for(const r of input.equity_index)add(r.mkkMemberOid,r.stockCode,input.index_source,'XUTUM.content[].stockCode + mkkMemberOid');
 for(const p of input.profiles)for(const table of p.tables){
  const pos=table.headers.indexOf('Borsa Kodu');
  if(pos<0||!table.headers.includes('Toplam Pay Adedi'))continue;
  for(const row of table.rows){const code=row[pos]?.trim();if(code&&code!=='—')add(p.issuer_oid,code,p,'Fiili Dolaşımdaki Paylar / Borsa Kodu');}
 }
 const newAliases:Record<string,string[]>={KRDMA:['Kardemir'],KRDMB:['Kardemir'],KRDMD:['Kardemir'],ISATR:['Türkiye İş Bankası','İş Bankası'],ISBTR:['Türkiye İş Bankası','İş Bankası'],ISCTR:['Türkiye İş Bankası','İş Bankası']};
 const companies=[...evidence.entries()].map(([code,e])=>{const issuer=byOid.get(e.oid)!,a=input.aliases.find(a=>a.code===code);return {code,oid:e.oid,title:issuer.kapMemberTitle,aliases:a?.aliases??newAliases[code]??[],alias_basis:a?.alias_basis??'Explicit distinctive legal-title short name; no parent/brand inference',excluded_contexts:a?.excluded_contexts??[],source_url:e.sources[0].url,equity_evidence:e.sources,trading_status:'unknown'};}).sort((a,b)=>a.code.localeCompare(b.code,'en'));
 const issuers=input.issuers.map(i=>({oid:i.mkkMemberOid,title:i.kapMemberTitle,source_codes:i.stockCode.split(',').map(s=>s.trim()),equity_codes:companies.filter(c=>c.oid===i.mkkMemberOid).map(c=>c.code),unresolved_codes:i.stockCode.split(',').map(s=>s.trim()).filter(c=>!evidence.has(c)),trading_status:'unknown',source_url:input.issuers_source.source_url})).sort((a,b)=>a.oid.localeCompare(b.oid));
 return {version:'kap-equities-'+input.issuers_source.retrieved_at.slice(0,10)+'-v3-'+hash({companies,issuers}).slice(0,12),source_url:input.issuers_source.source_url,retrieved_at:input.issuers_source.retrieved_at,source_sha256:input.issuers_source.sha256,input_sha256:hash(input),companies_sha256:hash(companies),issuers_sha256:hash(issuers),alias_sources:input.alias_sources,policy:'Issuer OID and equity instrument code are distinct. XUTUM rows or official free-float table establish equity; issuer header codes alone remain unresolved, not classified as debt. Trading/suspension/delisting status unknown. Multiple equity classes never resolve a general issuer mention to one class. Index membership is not a routing priority here.',companies,issuers};
}
