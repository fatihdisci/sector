import type {OutputPreferences} from '../src/output-preferences';
import {generalBuyback} from '../src/general-buyback';
import {KapStore} from '../src/kap/store';
import {KapClient} from '../src/kap/client';
import {istanbulDay,purchases,report,type Purchase} from '../src/kap/reports';
import {normalize,type Disclosure,type Indices,type Listing} from '../src/kap/parser';
export class KapReports {
 constructor(private store:KapStore,private client=new KapClient()){
  store.db.exec(`CREATE TABLE IF NOT EXISTS report_buybacks(id INTEGER PRIMARY KEY REFERENCES disclosures(id),rows_json TEXT,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_try INTEGER NOT NULL DEFAULT 0);`);
  if(!store.rows<{name:string}>("PRAGMA table_info(report_buybacks)").some(c=>c.name==='version'))store.db.exec("ALTER TABLE report_buybacks ADD COLUMN version INTEGER NOT NULL DEFAULT 0");
 }
 async cacheOne(at=Date.now()){
  const day=istanbulDay(at),start=day+'T00:00:00+03:00';
  const r=this.store.row<{id:number}>(`SELECT d.id FROM disclosures d LEFT JOIN report_buybacks b ON b.id=d.id WHERE julianday(d.published_at)>=julianday(?) AND julianday(d.published_at)<=julianday(?) AND json_extract(d.metadata,'$.title') LIKE '%Geri Alınmasına%' AND (b.id IS NULL OR (b.version<2 AND b.error IS NULL) OR (b.error IS NOT NULL AND b.attempts<3 AND b.next_try<=?)) ORDER BY d.id DESC LIMIT 1`,start,new Date(at).toISOString(),at);
  if(!r)return;
  let rows:Purchase[]|null=null,error:string|null=null;
  try{rows=purchases(await this.client.fullText(r.id));}catch(e){error=e instanceof Error&&/^[a-z_]+$/.test(e.message)?e.message:'kap_report_read_failed';}
  this.store.run(`INSERT INTO report_buybacks(id,rows_json,error,attempts,next_try,version) VALUES(?,?,?,1,?,2) ON CONFLICT(id) DO UPDATE SET rows_json=excluded.rows_json,error=excluded.error,attempts=report_buybacks.attempts+1,next_try=excluded.next_try,version=2`,r.id,rows?JSON.stringify(rows):null,error,at+60000);
 }
 async build(kind:'circuit'|'buyback'|'general_buyback',at:number,now=Date.now(),preferences?:OutputPreferences,purpose?:'automatic_batch'){
  if(!['circuit','buyback','general_buyback'].includes(kind)||!Number.isSafeInteger(at)||at>now+60000)throw Error('kap_report_invalid');
  if(kind==='general_buyback'&&preferences?.list==='first')throw Error('general_report_subset_requires_recalculation');
  const start=istanbulDay(at)+'T00:00:00+03:00',end=new Date(at).toISOString();
  const rows=this.store.rows<{id:number;metadata:string;rows_json:string|null;error:string|null}>(`SELECT d.id,d.metadata,b.rows_json,b.error FROM disclosures d LEFT JOIN report_buybacks b ON b.id=d.id WHERE julianday(d.published_at)>=julianday(?) AND julianday(d.published_at)<=julianday(?) AND d.first_seen<=?`,start,end,at);
  const listing=this.store.get<{at:number}>('last_listing');
  const gaps=this.store.row<{n:number}>("SELECT COUNT(*) n FROM gaps WHERE first_seen>=?",Date.parse(istanbulDay(at)+'T00:00:00+03:00'))?.n??0;
  const delayed=!listing||at-listing.at>180000||gaps;
  const coverage=kind==='circuit'?(delayed?'Toplayıcıda gecikme veya eksik kayıt olabilir; rapor kayıtlı bildirimlerle sınırlıdır.':'Rapor, KAP sistemine ulaşan günlük bildirimlerle sınırlıdır.'):(delayed?'Toplayıcıda gecikme veya eksik kayıt olabilir; rapor kayıtlı bildirimlerle sınırlıdır.':'Rapor komut saatine kadar sisteme alınan KAP kayıtlarıyla sınırlıdır.');
  const entries=rows.map(r=>({disclosure:JSON.parse(r.metadata) as Disclosure,purchases:r.rows_json?JSON.parse(r.rows_json):undefined,error:r.error??undefined}));
  if(kind==='circuit'){
   // circuit_light intentionally stores only the ID for BIST30-excluded notices.
   // Rebuild the full day from KAP's official light listing plus those IDs, then
   // verify every missing notice from its official detail page before reporting.
   const dayStart=Date.parse(start),stored=new Set(rows.map(r=>r.id));
   const light=this.store.rows<{id:number}>('SELECT id FROM circuit_light WHERE julianday(published_at)>=julianday(?) AND julianday(published_at)<=julianday(?) AND created_at<=? ORDER BY id',start,end,at);
   let listing:Listing[];try{listing=await this.client.listing();}catch{throw Error('circuit_report_source_incomplete');}
   const sourceIds=new Set<number>(light.map(r=>r.id));
   for(const item of listing)if(item.circuit&&Date.parse(item.publishedAt)>=dayStart&&Date.parse(item.publishedAt)<=at)sourceIds.add(item.id);
   const missing=[...sourceIds].filter(id=>!stored.has(id)).sort((a,b)=>a-b);
   if(missing.length>10_000)throw Error('circuit_report_source_limit');
   const fetched:Disclosure[]=[];let next=0;
   const workers=Array.from({length:Math.min(2,missing.length)},async()=>{while(next<missing.length){const id=missing[next++];let d:Disclosure|null;try{d=await this.client.disclosure(id);}catch{throw Error('circuit_report_source_incomplete');}if(!d)throw Error('circuit_report_source_incomplete');fetched.push(d);}});
   await Promise.all(workers);
   const official=(d:Disclosure)=>normalize(d.title+' '+(d.summary??'')).includes('DEVRE KESICI')&&['BORSA ISTANBUL BISTECH DEVRE KESICI UYGULAMASI','BORSA ISTANBUL AS'].includes(normalize(d.company??''));
   for(const d of fetched){if(Date.parse(d.publishedAt)<dayStart||Date.parse(d.publishedAt)>at||!official(d))throw Error('circuit_report_source_incomplete');entries.push({disclosure:d,purchases:undefined,error:undefined});}
  }
  const indices=this.store.get<Indices>('indices');if(kind==='general_buyback'){const result=generalBuyback(kind,entries,indices,at,coverage);if(preferences)result.draft.output_preferences=preferences;return result;}return report(kind,entries,indices,at,coverage,preferences,kind==='circuit',purpose==='automatic_batch');
 }
}
