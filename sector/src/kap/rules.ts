import {EQUITY,normalize,syndicationTitle,type Disclosure,type Indices} from './parser';
import {focusedDisclosureTickers} from './ticker-scope';
import {kapIndexMembership} from './index-tags';
export const TOPICS=['dividend','buyback','financial','capital','business','share_trade','circuit','other'] as const;
export type Topic=typeof TOPICS[number];
export interface Preferences {
 version:1; circuitNotifications:boolean; funds:'instant'|'digest'|'off'; fundDigestTime:string; priorityIndices:boolean;
 otherCompanies:'important'|'topics'|'off'; otherTopics:Topic[];
 watchlist:{ticker:string;mode:'all'|'important'|'topics';topics:Topic[]}[]; excludedTitles:string[];
}
export const DEFAULTS:Preferences={version:1,circuitNotifications:false,funds:'off',fundDigestTime:'19:00',priorityIndices:true,otherCompanies:'important',otherTopics:[],watchlist:[],excludedTitles:['İhraç Belgesi','Fon İhraç Sözleşmesi','Kredi Kullanımı']};
export function preferences(value:unknown):Preferences {
 const raw=value as Preferences;const p={...raw,circuitNotifications:raw?.circuitNotifications??false};const topics=(x:unknown)=>Array.isArray(x)&&x.every(t=>TOPICS.includes(t));
 if(!p||p.version!==1||typeof p.circuitNotifications!=='boolean'||!['instant','digest','off'].includes(p.funds)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.fundDigestTime)||typeof p.priorityIndices!=='boolean'||!['important','topics','off'].includes(p.otherCompanies)||!topics(p.otherTopics)||!Array.isArray(p.watchlist)||!Array.isArray(p.excludedTitles)||p.excludedTitles.some(t=>typeof t!=='string'||!t.trim()||t.length>200))throw new Error('kap_preferences_invalid');
 if(p.watchlist.some(w=>!w||!EQUITY.test(w.ticker)||!['all','important','topics'].includes(w.mode)||!topics(w.topics))||new Set(p.watchlist.map(w=>w.ticker)).size!==p.watchlist.length)throw new Error('kap_watchlist_invalid');
 return structuredClone(p);
}
// Only generic KAP headings need their subject summary. Do not scan full text:
// a board decision date inside a buyback is not a governance announcement.
export function subject(d:Disclosure):string {
 const title=normalize(d.title);
 return /^(OZEL DURUM ACIKLAMASI(?: \(GENEL\))?|GENEL ACIKLAMA)$/.test(title)?normalize(d.summary??''):title;
}
export function classify(d:Disclosure):Topic[] {
 const t=subject(d),result:Topic[]=[];
 if(/TEMETTU|KAR PAYI/.test(t))result.push('dividend');
 if(/GERI ALIM|GERI ALIN|GERI SATIM|GERI SATIS|GERI SATIL/.test(t))result.push('buyback');
 if(/FINANSAL (RAPOR|TABLO|SONUC)|FINANSALLAR|BILANCO|FAALIYET RAPOR/.test(t))result.push('financial');
 if(/SERMAYE ART|SERMAYE AZAL|BEDELLI|BEDELSIZ/.test(t))result.push('capital');
 if(/YENI IS(?:LER| |$)|SOZLESME|IHALE|SIPARIS|ANLASMA/.test(t)&&!/BORSA DISI|FON IHRAC SOZLESMESI/.test(t))result.push('business');
 if(/PAY(?:LARIN)? (ALIM|SATIM|ALIS|SATIS|ALIN|SATIL)/.test(t)&&!result.includes('buyback'))result.push('share_trade');
 if(normalize(d.title+' '+(d.summary??'')).includes('DEVRE KESICI'))result.push('circuit');
 return result.length?result:['other'];
}
export function muted(title:string):boolean {
 const t=normalize(title);
 return /ESAS\s+SOZLESME|IC\s*TUZUK|FON GIDER BILGILERI|ARACI KURUMA ODENEN KOMISYON VE VARLIK ALIM SATIM BILGILERI|FON TOPLAM GIDER ORANI|FON TOPLAM GIDERININ DAGILIMI/.test(t)
 ||(/FAIZSIZ|FAIZ ICEREN/.test(t)&&/PAY DIS(?:I|INDA) SERMAYE PIYASASI ARACI/.test(t))
 ||/YONETIM BILGI FORMU|KREDI DERECELENDIR/.test(t)
 ||(/YONETIM KURULU/.test(t)&&!/GERI ALIM|GERI ALIN|PAY ALIM|PAY SATIM|FINANSAL RAPOR|FAALIYET RAPOR|SOZLESME|IHALE|YENI IS|SIPARIS|ANLASMA|TEMETTU|KAR PAYI|SERMAYE ART|SERMAYE AZAL/.test(t));
}
// MKK settlement notices are excluded by issuer AND title, not by related shares.
export function mkkSettlement(d:Disclosure):boolean {
 const company=normalize(d.company??'').replace(/[^A-Z0-9 ]/g,'');
 const title=normalize(d.title).replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ');
 return /^MERKEZI KAYIT KURULUSU(?: |$)/.test(company)&&/^BORCLANMA ARACLARI YATIRIM FONLARI VE VARANT ITFA KUPON GETIRI NAKDI UZLASI ODEME ISLEMLERI(?: |$)/.test(title);
}
// Explicit topic opt-outs still apply when a narrower circuit scope overrides index routing.
export function circuitOptOut(d:Disclosure,p:Preferences):boolean {
 return syndicationTitle(d.title)||!p.circuitNotifications||(d.isFund&&p.funds==='off')||mkkSettlement(d)||muted(d.title)||muted(subject(d))||p.excludedTitles.some(t=>normalize(d.title).includes(normalize(t)));
}
export function important(d:Disclosure):boolean {
 if(mkkSettlement(d))return false;
 const t=subject(d);
 if(/FINANSAL TAKVIM|SORUMLULUK BEYANI|GENEL KURUL BILDIRIMI/.test(t)&&classify(d).every(topic=>topic==='other'))return false;
 return !(/PORTFOY DAGILIM RAPORU|BORSA DISI VAAD SOZLESMESI|BORSA DISI REPO|BORSA DISI TERS REPO|FON SUREKLI BILGILENDIRME|KREDI DERECELENDIR|YATIRIMCI BILGI FORMU|RISK OLCUM|DEGERLEME ESASLARI|SIRKET GENEL BILGI FORMU|HAK KULLANIM SUREC DURUM/.test(t)||(/FAIZ/.test(t)&&/PAY DISI SERMAYE PIYASASI ARACI/.test(t))||muted(d.title)||muted(t));
}
export function criticalFund(d:Disclosure):boolean {
 const text=normalize(d.title+' '+(d.company??'')+' '+(d.summary??''));
 return (d.isFund||/FON|PORTFOY|TEFAS/.test(text))&&/TEMERRUT|TASFIYE|ISLEMLERIN DURDURUL|KATILMA PAYI IADESI|ODEME/.test(text);
}
export interface Decision {store:boolean;action:'off'|'instant'|'digest'|'circuit';reason:string;topics:Topic[];important:boolean;critical:boolean;indexTier:30|100|null;}
export function decide(d:Disclosure,p:Preferences,indices:Indices|null):Decision {
 const topics=classify(d),significant=important(d),critical=criticalFund(d),shares=topics.includes('buyback')||topics.includes('share_trade');
 const tracked=p.watchlist.filter(w=>d.subjectCodes.includes(w.ticker));
 const explicit=tracked.some(w=>w.mode==='all'||w.mode==='topics'&&w.topics.some(t=>topics.includes(t)));
 const selected=p.otherCompanies==='topics'&&p.otherTopics.some(t=>topics.includes(t));
 const store=significant||explicit||selected||shares||topics.includes('circuit')||(d.isFund&&p.funds!=='off');
 const indexTier=indices&&d.subjectCodes.some(c=>indices.bist30.includes(c))?30:indices&&d.subjectCodes.some(c=>indices.bist100.includes(c))?100:null;
 const result=(action:Decision['action'],reason:string):Decision=>({store,action:store?action:'off',reason,topics,important:significant,critical,indexTier});
 if(syndicationTitle(d.title))return{...result('off','syndication_title'),store:false};
 // Explicit user opt-out wins over share overrides, watchlists and index priority.
 if(topics.includes('circuit')&&!p.circuitNotifications)return result('off','circuit_disabled');
 if(d.isFund&&p.funds==='off')return result('off','funds_off');
 if(/ESAS\s+SOZLESME/.test(normalize(d.title)))return result('off','mandatory_mute');
 if(mkkSettlement(d))return result('off','mkk_settlement_excluded');
 // Circuit/share transaction alerts are intentionally narrowed to the user’s
 // IPO/crisis cohorts plus the currently verified BIST 30/100 constituents.
 // Keep out-of-scope source records for audit, but do not enqueue them.
 if((topics.includes('circuit')||shares)&&!focusedDisclosureTickers(d,indices).length)return result('off','ticker_out_of_scope');
 if(shares)return result('instant','share_transaction_override');
 if(muted(d.title)||muted(subject(d)))return result('off','mandatory_mute');
 if(p.excludedTitles.some(t=>normalize(d.title).includes(normalize(t))))return result('off','excluded_title');
 if(critical)return result('instant','critical_fund');
 if(d.isFund)return result(p.funds==='instant'?'instant':'digest','fund_preference');
 const instant=topics.includes('circuit')?'circuit':'instant';
 if(tracked.length)return result(tracked.some(w=>w.mode==='all'||w.mode==='important'&&significant||w.mode==='topics'&&w.topics.some(t=>topics.includes(t)))?instant:'off','watchlist');
 if(p.priorityIndices&&indexTier&&significant)return result(instant,'index_priority');
 if(p.otherCompanies==='important'&&significant||selected)return result(instant,'other_companies');
 return result('off','other_companies_off');
}
// Apply the owner's delivery scope independently to funds and companies.
// Only an explicitly described new commercial relationship or contract bypasses the index check.
export function newBusinessException(d:Disclosure):boolean {
 const title=normalize(d.title),t=subject(d);
 if(/ESAS\s+SOZLESME|FON IHRAC SOZLESMESI/.test(title))return false;
 return /(?:^|[^A-Z0-9])YENI IS ILISK(?:ISI|ISINE|ISININ|ILERI)?(?:$|[^A-Z0-9])|(?:^|[^A-Z0-9])YENI SOZLESME(?:$|[^A-Z0-9])|(?:^|[^A-Z0-9])SOZLESME(?:NIN)? IMZALAN(?:MASI|DI|MISTIR|ACAK)(?:$|[^A-Z0-9])/.test(t);
}
export function matchingFund(d:Disclosure):boolean {
 if(!d.isFund)return false;
 const text=normalize([d.company,d.title,d.summary,d.issuerRaw,d.fundType].filter(Boolean).join(' '));
 return /(?:^|[^A-Z0-9])(?:TERA|PUSULA|ATLAS|TASFIYE(?:SI|SININ|SINE|SINI|YE)?)(?=$|[^A-Z0-9])/.test(text);
}
export function scopedDecision(d:Disclosure,p:Preferences,indices:Indices|null,now=Date.now()):Decision {
 const base=decide(d,p,indices);
 if(d.isFund){
  if(syndicationTitle(d.title)||mkkSettlement(d))return {...base,store:false,action:'off',reason:'fund_mandatory_mute'};
  return matchingFund(d)?{...base,store:true,action:'instant',reason:'fund_keyword'}:{...base,store:false,action:'off',reason:'fund_keyword_excluded'};
 }
 // Existing explicit title opt-outs and market-wide circuit handling remain in place.
 if(['syndication_title','circuit_disabled','mandatory_mute','mkk_settlement_excluded','excluded_title'].includes(base.reason))return base;
 if(newBusinessException(d))return {...base,reason:'new_business_exception'};
 // Official index data must be current and complete; unknown membership is retried, not guessed.
 const membership=kapIndexMembership(d.subjectCodes,indices,now);
 if(!membership||!indices?.sourceSha256||!/^[a-f0-9]{64}$/.test(indices.sourceSha256))return {...base,store:true,action:'off',reason:'index_unavailable'};
 if(!membership.bist30.length&&!membership.bist100.length)return {...base,action:'off',reason:'index_outside'};
 return base;
}
export function digestAt(now:number,time:string):number {
 const local=new Date(now+3*3600_000);const [h,m]=time.split(':').map(Number);
 let due=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate(),h-3,m);
 if(due<=now)due+=86400_000;return due;
}
