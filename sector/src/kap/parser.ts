import {parseHTML} from 'linkedom';
export const ORIGIN='https://www.kap.org.tr';
export const EQUITY=/^[A-Z][A-Z0-9]{3,4}$/;
export interface Disclosure {
 id:number; sourceRef:string; url:string; title:string; summary:string|null; company:string|null;
 issuerRaw:string|null; issuerCode:string|null; relatedCodes:string[]; subjectCodes:string[];
 disclosureClass:string; disclosureType:string; category:string; fundType:string|null; isFund:boolean;
 oid:string|null; relatedOid:string|null; changeStatus:string|null; isCorrection:boolean;
 publishedAt:string; attachmentCount:number;
}
export const normalize=(s:string)=>s.toLocaleUpperCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/İ/g,'I').replace(/\s+/g,' ').trim();
export function jsonValue(s:string,start:number):unknown {
 const stack:string[]=[];let quoted=false,escaped=false;
 if(!['{','['].includes(s[start]))throw new Error('kap_json_start');
 for(let i=start;i<s.length;i++) {const c=s[i];
  if(quoted){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"'){quoted=true;continue;}
  if(c==='{'||c==='[')stack.push(c);
  else if(c==='}'||c===']'){if(stack.pop()!==(c==='}'?'{':'['))throw new Error('kap_json_bracket');if(!stack.length)return JSON.parse(s.slice(start,i+1));}
 }
 throw new Error('kap_json_incomplete');
}
export function flightText(html:string):string {
 const chunks:string[]=[];
 for(const [,script] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
  if(!script.includes('self.__next_f.push'))continue;
  const match=script.match(/^\s*self\.__next_f\.push\((\[[\s\S]*\])\)\s*;?\s*$/);
  if(!match)throw new Error('kap_flight_shape');
  const value:unknown=JSON.parse(match[1]);if(!Array.isArray(value))throw new Error('kap_flight_array');
  if(value[0]===1){if(typeof value[1]!=='string')throw new Error('kap_flight_chunk');chunks.push(value[1]);}
 }
 return chunks.join('');
}
export function kapDate(value:unknown,list=false):string {
 if(typeof value!=='string')throw new Error('kap_date_type');
 const m=value.match(list?/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/:/^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
 if(!m)throw new Error('kap_date_format');
 const [,a,b,c,h,mi,se]=m.map(Number);const [y,mo,d]=list?[c,b,a]:[a,b,c];
 const date=new Date(Date.UTC(y,mo-1,d,h,mi,se));
 // This collector handles modern live disclosures, after Turkey adopted permanent UTC+3.
 if(y<2017||date.getUTCFullYear()!==y||date.getUTCMonth()!==mo-1||date.getUTCDate()!==d||h>23||mi>59||se>59)throw new Error('kap_date_invalid');
 return new Date(date.getTime()-3*3600_000).toISOString();
}
function object(x:unknown):Record<string,unknown>{if(!x||typeof x!=='object'||Array.isArray(x))throw new Error('kap_object');return x as Record<string,unknown>;}
function string(x:unknown,key:string,required=false):string|null {if(x==null&&!required)return null;if(typeof x!=='string'||(required&&!x.trim()))throw new Error('kap_field_'+key);return x.trim();}
function oid(x:unknown,key:string):string|null {const s=string(x,key);if(s&&!/^[a-f0-9]{32}$/i.test(s))throw new Error('kap_oid_'+key);return s;}
function codes(x:unknown):string[] {
 if(x==null)return [];
 if(typeof x!=='string'&&!Array.isArray(x))throw new Error('kap_related_stocks');
 const values=typeof x==='string'?x.split(/[,;\s]+/):x.map(v=>typeof v==='string'?v:string(object(v).code,'related_code',true)!);
 return [...new Set(values.map(v=>v.trim().toUpperCase()).filter(v=>EQUITY.test(v)))];
}
export function parseDisclosure(html:string,id:number):Disclosure {
 if(!Number.isSafeInteger(id)||id<=0)throw new Error('kap_id');
 const text=flightText(html);const found=[...text.matchAll(/"disclosureBasic"\s*:\s*(?=\{)/g)];
 if(!found.length)throw new Error('kap_basic_missing'); // A 200 login/protection/empty page is never a missing ID.
 const basics=found.map(m=>object(jsonValue(text,m.index!+m[0].length)));
 if(basics.some(b=>b.disclosureIndex!==id))throw new Error('kap_id_mismatch');
 if(basics.some(b=>JSON.stringify(b)!==JSON.stringify(basics[0])))throw new Error('kap_conflicting_basic');
 const b=basics[0],title=string(b.title,'title',true)!,company=string(b.companyTitle,'companyTitle');
 const summary=string(b.summary,'summary'),issuerRaw=string(b.stockCode,'stockCode');
 const disclosureClass=string(b.disclosureClass,'class',true)!,disclosureType=string(b.disclosureType,'type',true)!;
 const category=string(b.disclosureCategory,'category')??'',fundType=string(b.fundType,'fundType');
 const isFund=disclosureType==='FON'||category==='FON'||!!fundType||/\bFON(U)?\b/.test(normalize(company??''));
 const institution=/PORTFOY YONETIM|EMEKLILIK VE HAYAT/.test(normalize(company??''));
 const issuerCode=!isFund&&!institution&&issuerRaw&&EQUITY.test(issuerRaw.toUpperCase())?issuerRaw.toUpperCase():null;
 const relatedCodes=codes(b.relatedStocks);
 const circuit=normalize(title+' '+(summary??'')).includes('DEVRE KESICI');
 const subjectCodes=circuit?[...new Set([...relatedCodes,...(issuerCode?[issuerCode]:[])])]:issuerCode?[issuerCode]:relatedCodes.length===1?relatedCodes:[];
 const changeStatus=string(b.isChanged,'isChanged');
 if(b.attachmentCount!=null&&(!Number.isSafeInteger(b.attachmentCount)||Number(b.attachmentCount)<0))throw new Error('kap_attachment_count');
 return {id,sourceRef:`kap:${id}`,url:`${ORIGIN}/tr/Bildirim/${id}`,title,summary,company,issuerRaw,issuerCode,relatedCodes,subjectCodes,
  disclosureClass,disclosureType,category,fundType,isFund,oid:oid(b.disclosureId,'disclosureId'),relatedOid:oid(b.relatedDisclosureOid,'relatedOid'),changeStatus,
  // Preserve both statuses; do not discard the relation if the page was corrected later.
  isCorrection:changeStatus==='DUZENLENEN'||changeStatus==='DUZELTILEN',publishedAt:kapDate(b.publishDate),attachmentCount:Number(b.attachmentCount??0)};
}
export interface Listing {id:number;publishedAt:string;}
export function parseListing(value:unknown,now=Date.now()):Listing[] {
 if(!Array.isArray(value)||value.length>10000)throw new Error('kap_listing_shape');
 const result=value.map(x=>{const row=object(x);if(!Number.isSafeInteger(row.disclosureIndex)||Number(row.disclosureIndex)<=0)throw new Error('kap_listing_id');string(row.subject,'subject',true);return {id:Number(row.disclosureIndex),publishedAt:kapDate(row.publishDate,true)};});
 if(new Set(result.map(x=>x.id)).size!==result.length||result.some(x=>Date.parse(x.publishedAt)>now+300_000))throw new Error('kap_listing_invalid');
 return result.sort((a,b)=>a.id-b.id);
}
export interface Indices {bist30:string[];bist50?:string[];bist100:string[];checkedAt:string;source:string;}
export function parseIndices(html:string,now=Date.now()):Indices {
 const text=flightText(html);
 const read=(code:string,count:number)=>{const m=new RegExp('"code"\\s*:\\s*"'+code+'"\\s*,\\s*"content"\\s*:\\s*(?=\\[)').exec(text);if(!m)throw new Error('kap_index_missing');
  const rows=jsonValue(text,m.index+m[0].length);if(!Array.isArray(rows))throw new Error('kap_index_array');
  const values=rows.map(r=>string(object(r).stockCode,'index_code',true)!);
  if(values.length!==count||new Set(values).size!==count||values.some(c=>!EQUITY.test(c)))throw new Error('kap_index_members');return values.sort();};
 const bist30=read('XU030',30),bist50=read('XU050',50),bist100=read('XU100',100);if(bist30.some(c=>!bist50.includes(c))||bist50.some(c=>!bist100.includes(c)))throw new Error('kap_index_subset');
 return {bist30,bist50,bist100,checkedAt:new Date(now).toISOString(),source:`${ORIGIN}/tr/Endeksler`};
}
export function fullText(html:string,id:number) {
 const disclosure=parseDisclosure(html,id),{document}=parseHTML(html);
 const areas=[...document.querySelectorAll('.disclosureScrollableArea')];
 const clean=(s:string)=>s.replace(/\u00a0/g,' ').replace(/[\t ]+/g,' ').trim();
 for(const area of areas)for(const el of area.querySelectorAll('script,style,noscript,[aria-hidden="true"]'))el.remove();
 const tables=areas.flatMap(a=>[...a.querySelectorAll('table')].map(t=>{
  const grid:string[][]=[];
  [...t.querySelectorAll('tr')].filter(r=>r.closest('table')===t).forEach((row,y)=>{
   grid[y]??=[];let x=0;
   for(const cell of [...row.querySelectorAll('th,td')].filter(c=>c.closest('table')===t)){
    while(grid[y][x]!==undefined)x++;
    const rs=Number(cell.getAttribute('rowspan')??1),cs=Number(cell.getAttribute('colspan')??1);
    if(!Number.isInteger(rs)||!Number.isInteger(cs)||rs<1||cs<1||rs>500||cs>100)throw Error('kap_table_span');
    const copy=cell.cloneNode(true) as typeof cell;
    for(const br of copy.querySelectorAll('br'))br.replaceWith(' ');
    for(const el of copy.querySelectorAll('td,th,p,tr,div'))el.append(' | ');
    const value=clean(copy.textContent??'');
    for(let dy=0;dy<rs;dy++){grid[y+dy]??=[];for(let dx=0;dx<cs;dx++)grid[y+dy][x+dx]=value;}x+=cs;
   }
  });return grid.filter(r=>r.length).map(r=>Array.from(r,v=>v??''));
 }));
 const text=[...new Set(areas.map(a=>{for(const br of a.querySelectorAll('br'))br.replaceWith('\n');for(const cell of a.querySelectorAll('th,td'))cell.append(' | ');for(const el of a.querySelectorAll('p,tr,div'))el.append('\n');return clean(a.textContent??'');}).filter(Boolean))].join('\n\n');
 const links=new Map<string,string>();
 for(const a of document.querySelectorAll('a[href]')){const raw=a.getAttribute('href')!;let u:URL;try{u=new URL(raw,ORIGIN);}catch{continue;}
  if(u.origin===ORIGIN&&/\/tr\/(?:api\/)?(?:BildirimPdf|api\/file|api\/attachment)|\/ek-indir\//i.test(u.pathname))links.set(u.href,clean(a.textContent??'Ek'));}
 // Attachment arrays are transported separately from the visible body on current pages.
 const flight=flightText(html);
 for(const m of flight.matchAll(/"attachments"\s*:\s*(?=\[)/g)){
  const values=jsonValue(flight,m.index!+m[0].length);if(!Array.isArray(values))continue;
  for(const v of values){const a=object(v);if(typeof a.objId==='string'&&/^[a-f0-9]{32}$/i.test(a.objId))links.set(`${ORIGIN}/tr/api/file/download/${a.objId}`,typeof a.fileName==='string'?a.fileName:'Ek');}
 }
 const transactionRows=tables.flatMap(t=>{const n=t.findIndex(r=>r.some(c=>normalize(c)==='ISLEM TARIHI'));return n<0?[]:t.slice(n+1).filter(r=>r.length===t[n].length).map(r=>Object.fromEntries(t[n].map((label,i)=>[label,r[i]])));});
 const labels=tables.flatMap(t=>t.filter(r=>r.length===2).map(r=>({label:r[0],value:r[1]})));
 return {disclosure,status:text?'available':'unavailable',text:text||null,tables,labels,
  transactionRows,transactionDates:[...labels.filter(r=>/ISLEM TARIHI|GERI ALIM TARIHI/.test(normalize(r.label))&&/\d{2}\.\d{2}\.\d{4}/.test(r.value)),...transactionRows.flatMap(r=>Object.entries(r).filter(([k])=>normalize(k)==='ISLEM TARIHI').map(([label,value])=>({label,value})))],
  correctionFields:labels.filter(r=>/DUZELTME|GUNCELLEME/.test(normalize(r.label))),
  boardDecisionDates:labels.filter(r=>/YONETIM KURULU KARAR TARIHI/.test(normalize(r.label))),
  attachmentStatus:[...links.keys()].filter(u=>u.includes('/file/download/')).length>=disclosure.attachmentCount?'links_available':'links_incomplete',
  attachments:[...links].map(([url,label])=>({url,label,contentStatus:'not_fetched' as const})),
  expectedAttachments:disclosure.attachmentCount};
}
