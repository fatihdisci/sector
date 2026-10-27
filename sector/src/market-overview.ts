import {documentProgramme} from './channel-programme';
import {marketTimeContext} from './market-time';
import type{Document,Draft}from'./types';import type{MarketOverview,OverviewPanel}from'./market-overview-types';
const fold=(s:string)=>s.normalize('NFKC').toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const number=(s:string)=>{s=s.replace(/−/g,'-').replace(/[.,]+$/,'');return !s.includes(',')&&/^[-+]?\d+\.\d{1,2}$/.test(s)?s.replace('.',','):s;};
export const isFullOverview=(d:Document)=>d.source_id==='sermaye-telegram'&&d.source_layout?.kind==='market_overview'&&(d.source_layout.minimum_rows>0||d.source_layout.panels.length>0||documentProgramme(d)?.kind==='opening');
export function parseMarketOverview(d:Document):MarketOverview{
 const ps=d.passages.filter(p=>p.id.startsWith('image_normalized_'));const original=ps.length?ps:d.passages.filter(p=>!p.id.startsWith('channel_')&&!p.id.startsWith('overview_'));
 // The prior reader joined two explicitly labelled contribution sections. Split
 // labels only; preserve every original number and bind against layout symbols.
 const source=original.flatMap(p=>{const m=/^Endeks etkisi\s*[—–-]\s*yükseltenler:\s*(.*?)\s*Düşürenler:\s*(.*)$/iu.exec(p.text);return m?[{...p,text:'Endeksi yükseltenler: '+m[1]},{...p,text:'Endeksi düşürenler: '+m[2]}]:[p];});
 const find=(re:RegExp)=>{const p=source.find(p=>re.test(fold(p.text)));if(!p)throw Error('market_overview_section_missing');return p.text;};
 const programme=documentProgramme(d),view=programme?.kind==='opening'?'opening':programme?.kind==='first_moves'?'first_moves':programme?.kind==='close'?'close':'summary';
 const index=view==='first_moves'?'':find(/^bist\s*100\s*:/),take=(re:RegExp)=>{const m=re.exec(index);if(view==='first_moves')return ['', '', ''];if(!m)throw Error('market_overview_index_incomplete');return m;};
 const level=number(take(/BIST\s*100:\s*([\d.,]+)\s*puan/i)[1]),p=take(/%([-+−]?[\d.,]+)(?:\s+(düşüş|yükseliş))?/iu),points=number(take(/([-+−]\d[\d.,]*)\s*puan/)[1]);
 const direction=p[2]?.startsWith('düş')?'down':p[2]?.startsWith('yük')?'up':/^[-−]/.test(p[1])?'down':/^\+/.test(p[1])?'up':null;
 if(view!=='first_moves'&&(!direction||p[2]&&/^[-−]/.test(p[1])&&direction==='up'||p[2]&&/^\+/.test(p[1])&&direction==='down'))throw Error('market_overview_index_incomplete');
 const v=view==='opening'?['','','','']:take(/hacmi\s+([\d.,]+)\s*(milyar|milyon|Mr|Mn)\s*(TL|₺)/iu),volume=(view==='opening'||view==='first_moves')?'':number(v[1])+' '+v[2].replace(/^Mr$/i,'milyar').replace(/^Mn$/i,'milyon')+' TL';
 const low=view==='opening'?'':number(take(/(?:en\s+)?düşük\s+([\d.,]+)/iu)[1]),high=view==='opening'?'':number(take(/(?:en\s+)?yüksek\s+([\d.,]+)/iu)[1]);
 const panels:OverviewPanel[]=[];
 const specs=[['contribution_up','ENDEKSE POZİTİF KATKI',/^endeksi yukseltenler/],['contribution_down','ENDEKSE NEGATİF KATKI',/^endeksi dusurenler/],['gainers','YÜKSELENLER',/^en cok yukselenler/],['losers','DÜŞENLER',/^en cok dusenler/],['volume','HACİM LİDERLERİ',/^hacim liderleri/]]as const;
 for(const[key,title,re]of specs){if(view==='opening'||(view==='first_moves'?!['gainers','losers','volume'].includes(key):['gainers','losers'].includes(key)))continue;const text=find(re),quantity=key.startsWith('contribution')?'point':key==='volume'?'volume':'percent',pattern=quantity==='point'?/\b([A-Z][A-Z0-9]{3,4})\s+([-+−]?\d[\d.,]*)/g:quantity==='percent'?/\b([A-Z][A-Z0-9]{3,4})\s+%([-+−]?\d[\d.,]*)/g:/\b([A-Z][A-Z0-9]{3,4})\s+([-+−]?\d[\d.,]*)\s*(Mr|Mn|milyar|milyon)(?:\s+(TL|USD|EUR))?/g;
  const rows=[...text.matchAll(pattern)].map(m=>({label:m[1],value:quantity==='point'?number(m[2])+' puan':quantity==='percent'?'%'+number(m[2]):number(m[2])+' '+m[3].replace(/^Mr$/i,'milyar').replace(/^Mn$/i,'milyon')+(m[4]?' '+m[4]:'')}));
  const expected=d.source_layout!.panels.find(p=>fold(p.name).replace(/[^a-z ]/g,'').replace(/\s+/g,' ').trim()===fold(text.split(':')[0].replace(/\([^)]*\)/g,'')).replace(/[^a-z ]/g,'').replace(/\s+/g,' ').trim());
  // Panel identities/row order are bound to the original visual layout. No slice.
  const wanted=d.source_layout!.panels.find(p=>fold(p.name).includes(key==='contribution_up'?'yukselten':key==='contribution_down'?'dusuren':key==='gainers'?'yukselen':key==='losers'?'dusen':'hacim'))?.symbols??expected?.symbols;
  if(!wanted||rows.length!==wanted.length||rows.some((r,i)=>r.label!==wanted[i]))throw Error('market_overview_row_coverage');if(rows.length>5||!rows.length)throw Error('market_overview_capacity');panels.push({key,title,rows});
 }
 const breadth=(view==='opening'||view==='first_moves')?'':find(/^piyasa (?:genisligi|geneli)/),count=(re:RegExp)=>{const m=re.exec(breadth);if(!breadth)return '';if(!m)throw Error('market_overview_breadth_missing');return m[1];};
 const brokers:MarketOverview['brokers']=[];
 for(const side of (view==='opening'||view==='first_moves'?[]:['buy','sell'])as ('buy'|'sell')[]){const text=find(side==='buy'?/^kurumsal dagilim.*net alicilar/:/^kurumsal dagilim.*net saticilar/),first=/İlk\s*5:\s*%([\d.,]+)/iu.exec(text);if(!first)throw Error('market_overview_broker_missing');
  const rx=/(?:^|[.;:])\s*([A-Za-zÇĞİÖŞÜçğıöşü][A-Za-z0-9ÇĞİÖŞÜçğıöşü. ]*?(?:\(\d+\))?)(?:\s*:\s*|\s+)([-+−]?\d[\d.,]*)\s*(Mr|Mn|milyar|milyon)(?:\s*(TL|₺))?\s*;\s*%([\d.,]+)\s*;\s*([\d.,]+)\s*(Mr|Mn|milyar|milyon)(?:\s*(TL|₺))?/g;
  const totalHeaderTL=/toplam\s+TL/iu.test(text);
  const rows=[...text.matchAll(rx)].map(m=>{if(!m[8]&&!totalHeaderTL)throw Error('market_overview_broker_coverage');return{name:m[1].replace(/^[.\s]+/,'').trim(),net:number(m[2])+' '+m[3].replace(/^Mr$/i,'milyar').replace(/^Mn$/i,'milyon')+(m[4]?' TL':''),share:'%'+number(m[5]),total:number(m[6])+' '+m[7].replace(/^Mr$/i,'milyar').replace(/^Mn$/i,'milyon')+' TL'};});
  const named=rows.filter(r=>!/^Diğer\s*\(\d+\)$/u.test(r.name));if(named.length!==5||rows.length>6)throw Error('market_overview_broker_coverage');brokers.push({side,first5:'%'+number(first[1]),rows:named});
 }
 return{version:1,view,level,percent:view==='first_moves'?'':'%'+number(p[1]).replace(/^[-+]/,''),direction:direction??'up',points,volume,low,high,panels,breadth:{up:count(/Yükselen\s+(\d+)/iu),neutral:count(/Nötr\s+(\d+)/iu),down:count(/Düşen\s+(\d+)/iu)},brokers};
}
export function overviewEvidence(o:MarketOverview):{id:string;text:string}[]{
 return[...(o.view==='first_moves'?[]:[{id:'overview_index',text:o.view==='opening'?`BIST 100 seviyesi ${o.level} puan; değişim ${o.percent} ${o.direction==='down'?'düşüş':'yükseliş'}; puan farkı ${o.points} puan.`:`BIST 100 seviyesi ${o.level} puan; değişim ${o.percent} ${o.direction==='down'?'düşüş':'yükseliş'}; puan farkı ${o.points} puan; işlem hacmi ${o.volume}; gün içi düşük ${o.low} puan; gün içi yüksek ${o.high} puan.`}]),...o.panels.map(p=>({id:'overview_'+p.key,text:p.title+': '+p.rows.map(r=>r.label+' '+r.value).join('; ')+'.'})),...(o.breadth.up?[{id:'overview_breadth',text:`Yükselen ${o.breadth.up}; Nötr ${o.breadth.neutral}; Düşen ${o.breadth.down}.`}]:[]),...o.brokers.map(b=>({id:'overview_broker_'+b.side,text:(b.side==='buy'?'NET ALICI KURUMLAR':'NET SATICI KURUMLAR')+`; İlk 5 ${b.first5}; `+b.rows.map(r=>`${r.name}: net hacim ${r.net}; oran ${r.share}; toplam ${r.total}`).join('. ')+'.'}))];
}
export function withOverviewEvidence(documents:Document[]):Document[]{return documents.map(d=>{if(!isFullOverview(d))return d;const o=parseMarketOverview(d),passages=overviewEvidence(o),old=d.passages.find(p=>p.id==='overview_numbers_v1'),block=passages.map(p=>p.text).join('\n'),body=old&&d.body.endsWith('\n\n'+old.text)?d.body.slice(0,-old.text.length-2):d.body;return{...d,body:body+'\n\n'+block,passages:[...d.passages.filter(p=>!p.id.startsWith('overview_')),...passages,{id:'overview_numbers_v1',text:block}]};});}
export function overviewPresentation(value:Draft,documents:Document[]):Draft{
 const index=documents.findIndex(isFullOverview);if(index<0||!['market','volume'].includes(value.template))return value;const o=parseMarketOverview(documents[index]),period=marketTimeContext([documents[index]])[0]?.editorial_session.label;
 let headline='📊 '+(period?period+' — BIST 100':'BIST 100')+': '+o.percent+' '+(o.direction==='down'?'ekside':'artıda');
 let body=`Endeks ${o.level} puanda. Hacim ${o.volume}.\n${o.breadth.up} hisse yükseldi, ${o.breadth.down} hisse geriledi.`;
 if(o.view==='opening'){headline='📊 Açılış öncesi görünüm — BIST 100';body=`BIST 100: ${o.level} puan; ${o.percent} ${o.direction==='down'?'düşüş':'yükseliş'}. Puan farkı ${o.points} puan.`;}
 if(o.view==='first_moves'){headline='📊 Açılışın ilk anları';body='Yükselenler, düşenler ve hacim liderleri.';}
 if(o.view==='close')headline='📊 Gün sonu — BIST 100: '+o.percent+' '+(o.direction==='down'?'ekside':'artıda');
 const claims=overviewEvidence(o).map(p=>({text:p.text,evidence:[{document:index,passage:p.id,quote:p.text}]}));
 return{...value,headline,body,card_headline:o.view==='opening'?'Açılış öncesi görünüm':o.view==='first_moves'?'Açılışın ilk anları':o.view==='close'?'Gün sonu':period??'BIST 100',card_body:'BIST 100 piyasa özeti',template:'market',card_data:{overview:o},hashtags:['#Borsa','#BIST'],claims,source_notes:[...(value.source_notes??[]).filter(n=>!n.startsWith('Piyasa tablosu: ')),'Piyasa tablosu: Kanal programına göre seçilen bölümler korunmuştur; genel özette yükselen/düşen hisse listeleri ve Diğer kurum toplamları kullanıcı tercihiyle gösterilmez. Para birimi belirtilmeyen hacim paneline TL eklenmedi.']};
}
