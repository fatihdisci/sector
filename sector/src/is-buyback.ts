import {sha256} from './utils/text';
import {DOMParser} from 'linkedom';
import twitter from 'twitter-text';
import {safeUrl} from './network';
import {kapIndexMembership} from './kap/index-tags';
import type {Indices} from './kap/parser';
import type {BuybackRow,BuybackTable,BuybackEvidence,BuybackSelectionEvidence} from './buyback-types';
import type {Draft,Document,Source} from './types';
export const BUYBACK_HOST='arastirma.isyatirim.com.tr';
export const BUYBACK_FEED='https://'+BUYBACK_HOST+'/category/gunluk-raporlar/pay-geri-alimlari/feed/';
export const buybackSource:Source={id:'is-buyback',name:'İş Yatırım',url:BUYBACK_FEED,family:'is-yatirim',language:'tr',official:false,allowed_hosts:[BUYBACK_HOST],poll_seconds:600,fresh_hours:48,enabled:true,checked_at:'2026-10-23',terms_url:'https://'+BUYBACK_HOST+'/',rights_note:'Tablodaki olgular; özgün görsel kullanılmaz.',review_mode:'telegram',method:'rss'};
export function reportImage(html:string,url:string):string{
 safeUrl(url,[BUYBACK_HOST]);const doc=new DOMParser().parseFromString(html,'text/html');
 const body=doc.querySelector('.content-inner')??doc.querySelector('.entry-content');if(!body)throw Error('buyback_article_body_missing');
 const images=new Set<string>();
 for(const img of body.querySelectorAll('img')){
  const parent=img.closest('a')?.getAttribute('href');
  const src=parent&&/\.(?:png|jpe?g)(?:\?|$)/i.test(parent)?parent:img.getAttribute('data-src')||img.getAttribute('src');
  if(!src)continue;
  const target=safeUrl(new URL(src,url).href,[BUYBACK_HOST]);
  if(!new URL(target).pathname.startsWith('/wp-content/uploads/'))continue;
  images.add(target);
 }
 // Never infer a dated filename or silently pick the cover/related-post image.
 if(images.size!==1)throw Error('buyback_table_image_ambiguous');return [...images][0];
}
export function trDecimal(raw:unknown):string|null{
 if(raw===null)return null;if(typeof raw!=='string'||! /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,8})?$/.test(raw))throw Error('buyback_invalid_number');
 const s=raw.replace(/\./g,'').replace(',','.');if(s.length>24)throw Error('buyback_number_capacity');return s;
}
export function transactionDay(raw:string):string{
 const m=/^(\d{2})\.(\d{2})\.(20\d{2})$/.exec(raw);if(!m)throw Error('buyback_invalid_date');const d=`${m[3]}-${m[2]}-${m[1]}`;
 if(new Date(d+'T12:00:00Z').toISOString().slice(0,10)!==d)throw Error('buyback_invalid_date');return d;
}
export function validateTable(input:any,published:string):BuybackTable{
 if(!input||input.complete!==true||!Array.isArray(input.issues)||input.issues.length||!Array.isArray(input.rows)||!input.rows.length||input.rows.length!==input.row_count||input.rows.length>200)throw Error('buyback_row_coverage');
 const days=new Set<string>(),codes=new Set<string>();
 for(const r of input.rows){
  if(!/^[A-Z][A-Z0-9]{2,4}$/.test(r.ticker)||codes.has(r.ticker))throw Error('buyback_duplicate_or_invalid_ticker');codes.add(r.ticker);days.add(transactionDay(r.day));
  for(const key of ['nominal','price','amount'])trDecimal(r[key]);
  if(!Array.isArray(r.raw)||r.raw.length!==5)throw Error('buyback_raw_cells_missing');
 }
 if(days.size!==1)throw Error('buyback_mixed_transaction_dates');const day=[...days][0],publication=Date.parse(published);
 if(!Number.isFinite(publication)||Date.parse(day+'T00:00:00+03:00')>publication||publication-Date.parse(day+'T00:00:00+03:00')>7*86400000)throw Error('buyback_publication_date_mismatch');
 return {day,rows:input.rows,row_count:input.row_count,reader:input.reader??'unknown'};
}
const quantity=(r:BuybackRow)=>{const s=trDecimal(r.nominal);if(s===null)return null;const [a,b='']=s.split('.');return BigInt(a+b.padEnd(8,'0'));};
export function selectBuyback(table:BuybackTable,indices:Indices|null,now:number){
 const membership=kapIndexMembership(table.rows.map(r=>r.ticker),indices,now);
 const tier=(r:BuybackRow)=>membership?.bist30.includes(r.ticker)?0:membership?.bist100.includes(r.ticker)?1:2;
 return {known:!!membership,rows:[...table.rows].sort((a,b)=>{const t=tier(a)-tier(b);if(t)return t;const x=quantity(a),y=quantity(b);return x===y?a.ticker.localeCompare(b.ticker,'en'):x===null?1:y===null?-1:x>y?-1:1;}).slice(0,10)};
}
export function buybackTweet(table:BuybackTable,indices:Indices|null,now:number,correction=false){
 const selection=selectBuyback(table,indices,now);if(!selection.rows.length)throw Error('buyback_row_coverage');
 transactionDay(table.day.split('-').reverse().join('.'));
 const months=['Ocak’ta','Şubat’ta','Mart’ta','Nisan’da','Mayıs’ta','Haziran’da','Temmuz’da','Ağustos’ta','Eylül’de','Ekim’de','Kasım’da','Aralık’ta'];
 const [,month,day]=table.day.split('-').map(Number),date=`${day} ${months[month-1]}`;
 const one=table.rows.length===1,intro=one?`${date} paylarını geri alan şirket hangisi?`:`${date} hangi şirketler kendi paylarını geri aldı?`;
 const closing=one?'Şirketin geri alım işlemlerinin detayları görselde.':'Geri alım yapan şirketlerin tamamı ve işlem detayları görsellerde.';
 const text=`${correction?'Düzeltme: ':''}${intro}\n\n${selection.rows.map(r=>'#'+r.ticker).join(' ')}\n\n${closing}`;
 const parsed=twitter.parseTweet(text);if(!parsed.valid||parsed.weightedLength>280)throw Error('buyback_tweet_capacity');return {text,...selection,weightedLength:parsed.weightedLength};
}
export function buybackDraft(table:BuybackTable,evidence:BuybackEvidence,indices:Indices|null,now:number,correction=false):{draft:Draft;documents:Document[]}{
 const selected=buybackTweet(table,indices,now,correction),[headline,...paragraphs]=selected.text.split('\n\n'),body=paragraphs.join('\n\n');
 if(evidence.selection&&JSON.stringify(evidence.selection.selected.map(r=>r.ticker))!==JSON.stringify(selected.rows.map(r=>r.ticker)))throw Error('buyback_selection_evidence_mismatch');
 const notes=['Tek kaynak tablo aktarımı; bağımsız KAP doğrulaması değildir.','Kaynak kapsamı: rapordaki satırlar; tüm piyasayı kapsadığı iddia edilmez.',...(selected.known?[]:['Endeks üyeliği doğrulanamadı; miktar sıralaması kullanıldı.']),...(table.rows.some(r=>r.nominal===null||r.price===null||r.amount===null)?['Kaynakta boş hücreler var; null / — korunmuştur. Toplamlar hesaplanmadı.']:[])];
 const raw=JSON.stringify(evidence);
 const doc:Document={source_id:'is-buyback',source_name:'İş Yatırım',family:'is-yatirim',official:false,url:evidence.report_url,title:'Pay geri alımları '+table.day,body:raw,published_at:evidence.published_at,passages:[{id:'source_table',text:raw}],equity_codes:table.rows.map(r=>r.ticker),buyback_evidence:evidence};
 return {draft:{headline,body,hashtags:[],category:'bist',importance:80,template:'info',card_headline:'PAY GERİ ALIMLARI',card_body:table.day,card_data:{report:{rows:table.rows.map(r=>({label:r.ticker,value:r.nominal??'—'})),footer:'',buyback:table}},output_preferences:{list:'all',show_time:false,show_footer:false},claims:[{text:body,evidence:[{document:0,passage:'source_table',quote:raw}]}],entities:table.rows.map(r=>r.ticker),event_key:'daily-buyback:'+table.day,uncertainties:[],source_notes:notes},documents:[doc]};
}
export function buybackCsv(t:BuybackTable){const q=(v:string|null)=>'"'+(v??'').replace(/"/g,'""')+'"';return '\uFEFF'+[['İşlem tarihi','Hisse','Nominal pay tutarı','Ortalama fiyat (TL)','Toplam (TL)'],...t.rows.map(r=>[r.day,r.ticker,r.nominal,r.price,r.amount])].map(r=>r.map(q).join(';')).join('\r\n');}

/** A new evidence record, never an invented backfill for a previously produced draft. */
export async function buybackSelectionEvidence(table:BuybackTable,indices:Indices|null,now:number):Promise<BuybackSelectionEvidence>{
 const selection=selectBuyback(table,indices,now),members=selection.known&&indices?{bist30:[...indices.bist30].sort(),bist100:[...indices.bist100].sort()}:null;
 const snapshot=members&&indices?{schema_version:1 as const,source_url:indices.source,retrieved_at:indices.checkedAt,members}:null;
 return {algorithm:'index-nominal-v1',transaction_date:table.day,evaluated_at:new Date(now).toISOString(),index_snapshot:snapshot?{...snapshot,sha256:await sha256(JSON.stringify(snapshot))}:null,selected:selection.rows.map((r,i)=>({ticker:r.ticker,rank:i+1,nominal:r.nominal,reason:!members?'membership_unknown':members.bist30.includes(r.ticker)?'BIST30':members.bist100.includes(r.ticker)?'BIST100':'other'}))};
}
