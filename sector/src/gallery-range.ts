import{parseHTML}from'linkedom';import{safeUrl}from'./network';import type{Source,Document,Draft,GalleryRange}from'./types';
export type{GalleryRange}from'./types';
const clean=(s:string)=>s.normalize('NFKC').replace(/\s+/g,' ').trim();
export function galleryRange(html:string,url:string,source:Source):GalleryRange{
 const u=new URL(safeUrl(url,source.allowed_hosts));if(u.hostname!=='www.cnbce.com')throw Error('gallery_unsupported_host');
 const {document}=parseHTML(html),title=document.querySelector('h1')?.textContent??'';
 if(!/BIST 30/i.test(title)||!/100.*dip.*zirve/i.test(title))throw Error('gallery_completeness_needs_review');
 const total=Number(/"gallery_total_photos"\s*:\s*(\d+)/.exec(html)?.[1]);if(!Number.isSafeInteger(total)||total<3||total>40)throw Error('gallery_page_budget');
 const slides=[...document.querySelectorAll('.gallery-item')];if(slides.length!==total)throw Error('gallery_missing_pages');
 const bodies=[...document.querySelectorAll('script[type="application/ld+json"]')].flatMap(e=>{try{const d=JSON.parse(e.textContent??'');return typeof d.articleBody==='string'?[clean(parseHTML('<html><body>'+d.articleBody+'</body></html>').document.body.textContent??'')]:[];}catch{return[];}});if(bodies.length!==1)throw Error('gallery_structured_evidence_missing');
 const rows:GalleryRange['rows']=[],page_urls:string[]=[],seen=new Set<number>();
 for(const slide of slides){const page=Number(slide.getAttribute('data-page')),n=Number(slide.querySelector('.number .page')?.textContent),count=Number(slide.querySelector('.number .total')?.textContent);if(!Number.isInteger(page)||page<1||page>total||seen.has(page)||n!==page||count!==total)throw Error('gallery_missing_pages');seen.add(page);
  const pageURL=safeUrl(slide.getAttribute('data-url')??'',source.allowed_hosts),link=new URL(pageURL);if(link.origin!==u.origin||link.pathname!==u.pathname||[...link.searchParams.keys()].some(k=>k!=='sayfa')||Number(link.searchParams.get('sayfa')??1)!==page)throw Error('gallery_page_identity');
  page_urls[page-1]=pageURL;
  const quote=clean(slide.querySelector('.content-text')?.textContent??'');if(!quote||quote.length>4000)throw Error('gallery_text_budget');
  const symbol=/\(([A-Z][A-Z0-9]{3,4})\):/.exec(quote)?.[1];if(!symbol){if(page>2)throw Error('gallery_row_missing');continue;}
  const priceTokens=[...quote.matchAll(/([^\s]+)\s*TL\b/g)],percentTokens=[...quote.matchAll(/yüzde\s+(\S+)/gi)];
  const prices=priceTokens.map(m=>m[1]),percent=percentTokens.map(m=>m[1].replace(/[.,;]$/,''));
  if(prices.some(v=>!/^\d+(?:\.\d{3})*(?:,\d{1,4})?$/.test(v))||priceTokens.some(m=>/\d\s+$/.test(quote.slice(0,m.index)))||percent.some(v=>!/^\d+(?:,\d{1,4})?$/.test(v)))throw Error('gallery_number_conflict');
  if(prices.length!==2||percent.length!==2)throw Error('gallery_cell_missing');const number=(v:string)=>Number(v.replace(/\./g,'').replace(',','.'));if(number(prices[0])<=0||number(prices[1])<number(prices[0])||percent.some(p=>number(p)<0||number(p)>100))throw Error('gallery_number_conflict');
  if(!bodies[0].includes(quote))throw Error('gallery_conflicting_evidence');if(rows.some(r=>r.ticker===symbol))throw Error('gallery_duplicate_or_conflicting_row');rows.push({ticker:symbol,low:prices[0],high:prices[1],fromLow:percent[0],fromHigh:percent[1],page,url:pageURL,quote});
 }
 if(rows.length!==30||seen.size!==total)throw Error('gallery_row_count');return{version:1,mode:'inline',pages:total,page_urls,rows:rows.sort((a,b)=>a.page-b.page)};
}
export function galleryDraft(doc:Document):Draft{
 const data=doc.gallery_range;if(!data||data.rows.length!==30||!data.source_sha256)throw Error('gallery_evidence_incomplete');
 const top=[...data.rows].sort((a,b)=>Number(b.fromHigh.replace(',','.'))-Number(a.fromHigh.replace(',','.'))).slice(0,5);
 return{headline:'BIST 30’da 100 günlük dip–zirve görünümü',body:'Zirvesinden en uzakta kalanlar: '+top.map(r=>'#'+r.ticker+' %'+r.fromHigh).join(', ')+'. Tüm tablo görsellerde.',hashtags:['BIST30'],category:'bist',importance:85,template:'info',entities:data.rows.map(r=>r.ticker),event_key:'range-gallery:'+data.source_sha256,uncertainties:['Tek haber kaynağındaki tablo; bağımsız resmî piyasa teyidi değildir.'],card_headline:'BIST 30 • 100 GÜNLÜK DİP–ZİRVE',card_body:'Son 100 günlük aralık ve uzaklık oranları',output_preferences:{list:'all',show_time:false,show_footer:false},card_data:{report:{kind:'range',rows:data.rows.map(r=>({label:'#'+r.ticker,value:[r.low,r.high,r.fromLow,r.fromHigh].join('|')})),footer:''}},claims:data.rows.map(r=>({text:r.quote,evidence:[{document:0,passage:'gallery_'+r.page,quote:r.quote}]}))};
}
