import type {Document} from '../types';
import type {Indices} from './parser';

const source='https://www.kap.org.tr/tr/Endeksler';
const maxAge=36*3600_000;
export function kapIndexMembership(codes:string[],indices:Indices|null|undefined,now=Date.now()):Document['index_membership']{
 if(!indices||indices.source!==source||!Array.isArray(indices.bist30)||!Array.isArray(indices.bist100))return undefined;
 const age=now-Date.parse(indices.checkedAt);
 if(!Number.isFinite(age)||age< -300_000||age>maxAge||indices.bist30.length!==30||indices.bist100.length!==100||new Set(indices.bist30).size!==30||new Set(indices.bist100).size!==100||indices.bist30.some(c=>!indices.bist100.includes(c)))return undefined;
 return {bist30:codes.filter(c=>indices.bist30.includes(c)),bist100:codes.filter(c=>indices.bist100.includes(c)),checked_at:indices.checkedAt,source};
}
export function kapIndexHashtags(documents:Document[],now=Date.now()):string[]{
 let thirty=false,hundred=false;
 for(const d of documents){
  if(d.source_id!=='kap'||!d.official||!d.index_membership)continue;
  const m=d.index_membership,age=now-Date.parse(m.checked_at);
  if(m.source!==source||!Number.isFinite(age)||age< -300_000||age>maxAge)continue;
  const codes=d.equity_codes??[];
  thirty ||= m.bist30.some(c=>codes.includes(c)&&m.bist100.includes(c));
  hundred ||= m.bist100.some(c=>codes.includes(c));
 }
 return [...(thirty?['#BIST30']:[]),...(hundred?['#BIST100']:[])];
}
