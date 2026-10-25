import catalog from './data/news-companies.json';
export const COMPANY_CATALOG_VERSION=catalog.version;
export const COMPANY_CATALOG_PROVENANCE={version:catalog.version,source_url:catalog.source_url,retrieved_at:catalog.retrieved_at,source_sha256:catalog.source_sha256,companies_sha256:catalog.companies_sha256,issuers_sha256:catalog.issuers_sha256,input_sha256:catalog.input_sha256,issuer_count:catalog.issuers.length,equity_count:catalog.companies.length};
export const catalogEntities=catalog.companies.flatMap(c=>[c.title,...c.aliases].map(name=>({name,code:c.code,issuer_oid:c.oid,verified:true,excluded_contexts:c.excluded_contexts})));
export function matchingIssuerMentions<T extends {name:string;code:string;verified:boolean;issuer_oid?:string;excluded_contexts?:string[]}>(text:string,entities:T[],fold:(s:string)=>string){
 const padded=' '+text+' ';
 const ownMention=(name:string)=>{const needle=' '+fold(name)+' ';let at=padded.indexOf(needle);while(at>=0){const tail=padded.slice(at+needle.length);if(!/^(?:(?:nin|in|un|nun|nın) )?(?:ana sirketi|ana ortagi|istiraki|bagli ortakligi|markasi)\b/.test(tail))return true;at=padded.indexOf(needle,at+needle.length);}return false;};
 const candidates=entities.filter(e=>e.verified&&ownMention(e.name)&&!e.excluded_contexts?.some(s=>padded.includes(' '+fold(s)+' ')));
 // An alias shared by distinct legal entities is not a verified identity.
 return candidates.filter(e=>new Set(entities.filter(x=>fold(x.name)===fold(e.name)).map(x=>x.issuer_oid??x.code)).size===1);
}

export function matchingCompanies<T extends {name:string;code:string;verified:boolean;issuer_oid?:string;excluded_contexts?:string[]}>(text:string,entities:T[],fold:(s:string)=>string){
 const matches=matchingIssuerMentions(text,entities,fold);
 // General issuer names do not select every share class or arbitrarily pick the liquid class.
 return matches.filter(e=>new Set(entities.filter(x=>(x.issuer_oid??x.code)===(e.issuer_oid??e.code)).map(x=>x.code)).size===1);
}

// Only catalogued equity codes in explicit equity context; ordinary words/fund lists do not qualify.
export function explicitEquityCodes(raw:string,fold:(s:string)=>string):string[]{
 const folded=fold(raw);
 if(/\bfon (?:kodu|kodlari)\b/.test(folded))return [];
 if(!/\b(hisse\w*|borsa\w*|bist|pay senedi)\b/.test(folded))return [];
 const known=new Set(catalog.companies.map(c=>c.code));
 return [...new Set([...raw.matchAll(/(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{3,4})(?![A-Za-z0-9])/g)].map(m=>m[1]).filter(c=>known.has(c)))];
}

// Official issuer identity is weaker than instrument-type evidence. Never put these codes in equity output.
export function unresolvedIssuerMatches(raw:string,fold:(s:string)=>string){
 const folded=fold(raw),business=/\b(sozlesme\w*|yatirim\w*|bilanco\w*|finansal\w*|ihale\w*|temerrut\w*|sirket\w*|pay\w*|hisse\w*)\b/.test(folded);
 const names=catalog.issuers.filter(i=>i.unresolved_codes.length).map(i=>({name:i.title,code:i.oid,verified:true}));
 const titleMatches=new Set(matchingIssuerMentions(folded,names,fold).map(i=>i.code));
 const tokens=new Set([...raw.matchAll(/(?:^|[^A-Za-z0-9])([A-Z][A-Z0-9]{3,4})(?![A-Za-z0-9])/g)].map(m=>m[1]));
 return catalog.issuers.filter(i=>i.unresolved_codes.length&&(titleMatches.has(i.oid)||(business&&i.unresolved_codes.some(c=>tokens.has(c)&&catalog.issuers.filter(other=>other.source_codes.includes(c)).length===1)))).map(i=>({oid:i.oid,title:i.title,source_codes:i.unresolved_codes.filter(c=>tokens.has(c)),instrument_status:'unresolved' as const}));
}
