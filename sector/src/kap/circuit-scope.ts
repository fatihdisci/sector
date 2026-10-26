import{createHash}from'node:crypto';
import proof from'../data/circuit-bist30-2026q4.json';import catalog from'../data/news-companies.json';
import{normalize,EQUITY,type Disclosure,type Indices}from'./parser';
export const CIRCUIT_LIGHT_TTL=7*86400_000,CIRCUIT_LIGHT_MAX=20_000,CIRCUIT_INDEX_MAX_AGE=36*3600_000;
export const CIRCUIT_POLICY={version:1,authority:'Sentinel_0b3b5acd1e7881918fe77806bb1b0570',scope:'bist30+market'}as const;
export type CircuitPolicy=typeof CIRCUIT_POLICY&{activated_at:number};
export type CircuitSnapshot={version:string;members:string[];checked_at:string;source:string;source_sha256:string;effective_from:string;effective_until:string;period_source:string;period_sha256:string;members_sha256:string;hash:string};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function circuitSnapshot(indices:Indices,now:number):CircuitSnapshot{
 if(indices.source!==proof.source||!indices.sourceSha256||!/^[a-f0-9]{64}$/.test(indices.sourceSha256))throw Error('kap_circuit_index_evidence_missing');
 if(!Number.isFinite(Date.parse(indices.checkedAt))||Date.parse(indices.checkedAt)>now+300000||now-Date.parse(indices.checkedAt)>CIRCUIT_INDEX_MAX_AGE)throw Error('kap_circuit_index_stale');
 if(now<Date.parse(proof.effective_from)||now>=Date.parse(proof.effective_until))throw Error('kap_circuit_index_period_unverified');
 if(indices.bist30.length!==30||new Set(indices.bist30).size!==30||hash(JSON.stringify([...indices.bist30].sort()))!==proof.members_sha256)throw Error('kap_circuit_index_members_changed');
 const {version,members,effective_from,effective_until,period_source,period_sha256,members_sha256}=proof,body={version,members,checked_at:indices.checkedAt,source:indices.source,source_sha256:indices.sourceSha256,effective_from,effective_until,period_source,period_sha256,members_sha256};return{...body,hash:hash(JSON.stringify(body))};
}
export function snapshotProblem(s:CircuitSnapshot|null,blocked:string|null,now:number):string|null{
 if(blocked)return blocked;if(!s)return'kap_circuit_index_missing';
 const{hash:expected,...body}=s;if(expected!==hash(JSON.stringify(body))||s.version!==proof.version||s.members_sha256!==proof.members_sha256||hash(JSON.stringify(s.members))!==proof.members_sha256||s.period_source!==proof.period_source||s.period_sha256!==proof.period_sha256||s.source!==proof.source||s.effective_from!==proof.effective_from||s.effective_until!==proof.effective_until)return'kap_circuit_index_evidence_invalid';
 if(now<Date.parse(s.effective_from)||now>=Date.parse(s.effective_until))return'kap_circuit_index_period_unverified';
 const age=now-Date.parse(s.checked_at);return!Number.isFinite(age)||age< -300000||age>CIRCUIT_INDEX_MAX_AGE?'kap_circuit_index_stale':null;
}
export type CircuitScope={kind:'other'|'pay'|'market'|'review';codes:string[];excluded:string[];reason:string;version?:string};
export function circuitScope(d:Pick<Disclosure,'title'|'summary'|'company'|'subjectCodes'|'relatedCodes'>,snapshot:CircuitSnapshot|null,blocked:string|null,now:number):CircuitScope{
 const text=normalize(d.title+' '+(d.summary??'')),result=(kind:CircuitScope['kind'],reason:string,codes:string[]=[],excluded:string[]=[]):CircuitScope=>({kind,reason,codes,excluded,version:snapshot?.version});
 if(!text.includes('DEVRE KESICI'))return result('other','not_circuit');
 const issuer=normalize(d.company??'').replace(/[^A-Z0-9 ]/g,'').replace(/\s+/g,' ');
 if(!['BORSA ISTANBUL BISTECH DEVRE KESICI UYGULAMASI','BORSA ISTANBUL AS'].includes(issuer))return result('review','kap_circuit_issuer_unverified');
 const market=/ENDEKSE BAGLI DEVRE KESICI|PIYASA GENEL(?:I|INDE).*DEVRE KESICI/.test(text),pay=/PAY BAZINDA/.test(text);
 if(market&&pay)return result('review','kap_circuit_scope_conflict');if(market)return result('market','market_exception');
 const codes=[...new Set([...d.subjectCodes,...d.relatedCodes])];
 const known=new Set(catalog.companies.map(c=>c.code));if(!codes.length||codes.some(c=>!EQUITY.test(c)||!known.has(c)))return result('review','kap_circuit_code_unverified');
 const problem=snapshotProblem(snapshot,blocked,now);if(problem)return result('review',problem);
 const included=codes.filter(c=>snapshot!.members.includes(c)),excluded=codes.filter(c=>!included.includes(c));return result('pay',included.length?'bist30_pay':'bist30_outside',included,excluded);
}
// Only an exact official pay notice summary is sufficient to skip the detail page.
export function listingCircuit(d:{title:string;summary:string;company:string},snapshot:CircuitSnapshot|null,blocked:string|null,now:number):CircuitScope|null{
 if(normalize(d.title)!=='PAY BAZINDA DEVRE KESICI BILDIRIMI')return null;
 const m=/^([A-Z][A-Z0-9]{3,4})\.E işlem sırasında Pay Bazında Devre Kesici Uygulaması devreye girmiştir\.?$/u.exec(d.summary);if(!m)return null;
 return circuitScope({...d,subjectCodes:[m[1]],relatedCodes:[]},snapshot,blocked,now);
}
