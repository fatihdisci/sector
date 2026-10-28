import {akdColumns} from './akd-columns';
import {COLORS,PROFILE_DATA,BRAND_NAME,MARK_PATH} from './brand';
import {CARD_LAYOUTS,type CardLayout} from './card-layout';
import type {CardTheme} from './card-theme';
import type {Draft,CardRow} from './types';
type Box={x:number;y:number;width:number;height:number;size:number;min:number;weight:number;color:string;align?:'center'};
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
// Each content family owns its hierarchy. Layout changes alter frame, rail,
// header or alignment while retaining the same evidence and financial values.
export function marketCard(d:Pick<Draft,'headline'|'body'|'template'|'card_data'>&Partial<Pick<Draft,'tweet_style'>>,theme:CardTheme,layout:CardLayout,fit:(s:string,b:Box)=>string):string {
 if(d.template==='circuit')return circuitCard('navy','editorial',d.card_data?.tickers??[]);
 const bg=COLORS[theme],fg=theme==='navy'?COLORS.paper:COLORS.navy,steel=COLORS.steel;
 const data=d.card_data,variant=CARD_LAYOUTS.indexOf(layout),left=layout==='rail'?122:76,width=1080-left-76;
 const rect=(x:number,y:number,w:number,h:number,fill:string,stroke?:string)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${stroke?` stroke="${stroke}" stroke-width="2"`:''}/>`;
 const text=(s:string,x:number,y:number,size:number,color=fg,weight=400,anchor='start')=>`<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${esc(s.replace(/−/g,'-'))}</text>`;
 const rule=(y:number)=>`<path d="M${left} ${y} H1004" stroke="${steel}" stroke-width="1"/>`;
 const block=(s:string,x:number,y:number,w:number,h:number,size:number=40,color=fg,min=26,weight=400,align?:'center')=>fit(s.replace(/−/g,'-'),{x,y,width:w,height:h,size,min,weight,color,align});
 const summary=d.template==='institutional'&&!!(data?.buy_broker||data?.sell_broker);
 const labels:{[key:string]:string}={circuit:'DEVRE KESİCİ',institutional:summary?'KURUM AKD ÖZETİ':data?.buy?.length&&!data?.sell?.length?'KURUM / ALIM':data?.sell?.length&&!data?.buy?.length?'KURUM / SATIM':'KURUM ALIM / SATIM',akd:'HİSSE / AKD',volume:'İŞLEM HACMİ',broker_flow:'ARACI KURUM / NET İŞLEM',custody:'TAKAS / SAKLAMA',theoretical:'TEORİK EŞLEŞME'};
 const inverse=layout==='brief'||layout==='masthead';
 let art=layout==='frame'?rect(34,34,1012,1282,'none',steel):layout==='rail'?rect(0,0,38,1350,fg)+rect(38,0,6,1350,steel):'';
 if(inverse)art+=rect(0,0,1080,180,fg);
 art+=`<image x="${left}" y="58" width="68" height="68" href="${PROFILE_DATA}"/>`+text('ENDEKS',left+90,88,30,inverse?bg:fg,700)+text('H A B E R',left+92,116,17,steel,700)+text(labels[d.template],1004,102,22,inverse?bg:steel,700,'end');
 art+=rule(182);
 if(data?.as_of)art+=text(data.as_of,left,222,24,steel);
 const centered=layout==='center',align=centered?'center' as const:undefined;
 const separateTicker=data?.ticker&&!d.headline.includes(data.ticker);
 if(d.template==='volume'){
  art+=block(d.headline,left,276,width,200,65,fg,42,700,align);
  if(separateTicker)art+=text(data!.ticker!,1004,505,32,steel,700,'end');
  const hero=data?.metrics?.[0];
  if(hero){art+=text(hero.label,left,557,27,steel,700)+block(hero.value,left,592,width,180,114,fg,60,700);}
  else art+=`<path d="${MARK_PATH}" transform="translate(380 500) scale(.75)" fill="${steel}" opacity=".20"/>`;
  let y=836;for(const row of data?.metrics?.slice(1,3)??[]){art+=rule(y-20)+text(row.label,left,y+16,27,steel)+text(row.value,1004,y+22,36,fg,700,'end');y+=110;}
  art+=rule(1110)+block(d.body,left,1150,width,150,32,fg,26);
 }else if(d.template==='theoretical'){
  art+=block(d.headline,left,268,width,155,61,fg,38,700,align);
  const table=(title:string,rows:CardRow[]|undefined,y:number,invert:boolean)=>{
   if(!rows?.length)return '';if(rows.length>5)throw Error('market_card_capacity_theoretical');
   const ink=invert?bg:fg,muted=invert?bg:steel,x=left+24,inner=width-48,bounds=[0,.24,.50,.72,1];
   let svg=rect(left,y,width,365,invert?fg:bg,invert?undefined:steel)+text(title,x,y+43,25,muted,700);
   ['HİSSE','TEORİK FİYAT','DEĞİŞİM','KALAN'].forEach((h,j)=>svg+=text(h,x+bounds[j]*inner,y+83,20,muted,700));
   rows.forEach((r,i)=>{const cells=[r.label,...r.value.split('|')];if(cells.length!==4)throw Error('theoretical_cell_missing');cells.forEach((v,j)=>svg+=block(v.trim(),x+bounds[j]*inner,y+110+i*49,(bounds[j+1]-bounds[j])*inner-12,48,24,ink,20,j===0?700:400));});return svg;
  };
  art+=table('TEORİK YÜKSELENLER',data?.buy,480,layout!=='masthead')+table('TEORİK DÜŞENLER',data?.sell,860,layout==='masthead');
 }else if(d.template==='custody'){
  if((data?.holdings?.length??0)>5)throw Error('market_card_capacity_custody');
  art+=block(d.headline,left,268,width,155,61,fg,38,700,align);
  if(separateTicker)art+=text(data!.ticker!,1004,455,32,steel,700,'end');
  const hero=data?.metrics?.[0];
  if(hero)art+=text(hero.label,left,500,26,steel,700)+block(hero.value,left,530,width,120,78,fg,44,700);
  if(data?.holdings?.length){
   art+=rect(left,710,width,440,fg)+text(d.tweet_style==='custody_query'?'KURUMLAR':'SAKLAMA KURULUŞLARI',left+28,755,25,bg,700);
   data.holdings.forEach((r,i)=>{const y=778+i*70;art+=block(r.label,left+28,y,width*.40,60,29,bg,20,700)+block(r.value,left+width*.45,y,width*.55-28,60,28,bg,18);});
   if(d.tweet_style!=='custody_query')art+=block(d.body,left,1190,width,110,29,fg,22);
  }else art+=block(d.body,left,735,width,430,45,fg,28);
 }else if(d.template==='akd'&&(data?.buy?.length||data?.sell?.length)){
  art+=block(d.headline,left,268,width,155,61,fg,38,700,align);
  if(separateTicker)art+=text(data.ticker!,1004,446,32,steel,700,'end');
  const table=(title:string,rows:CardRow[]|undefined,y:number,invert:boolean)=>{
   if(!rows?.length)return '';
   if(rows.length>5)throw Error('market_card_capacity_akd');
   const ink=invert?bg:fg,muted=invert?bg:steel,parsed=rows.map(akdColumns),structured=parsed.every(Boolean);
   const units=new Set(parsed.flatMap(p=>p?.unit?[p.unit]:[])),unit=units.size===1?[...units][0]:undefined;
   const bounds=structured?[0,.29,.46,.79,1]:[0,.48,1];
   const headers=structured?['KURUM','ORAN',unit==='lot'?'NET LOT':unit==='adet'?'NET ADET':unit==='pay'?'NET PAY':'NET MİKTAR']:['KURUM','VERİ'];
   if(structured)headers.push('MALİYET');
   const inner=width-48,x=left+24;
   let svg=rect(left,y,width,365,invert?fg:bg,invert?undefined:steel)+text(title,x,y+43,25,muted,700);
   headers.forEach((h,i)=>{svg+=text(h,x+bounds[i]*inner,y+83,20,muted,700);});
   svg+=`<path d="M${x} ${y+96} H${left+width-24}" stroke="${muted}" stroke-width="1" opacity=".45"/>`;
   rows.forEach((r,i)=>{const p=parsed[i],values=structured?[r.label,p?.ratio??'—',p?.quantity?(p.unit?`${p.quantity} ${unit||p.unit}`:p.quantity):'—',p?.cost??'—']:[r.label,r.value];
    values.forEach((v,j)=>{svg+=block(v,x+bounds[j]*inner,y+110+i*49,(bounds[j+1]-bounds[j])*inner-12,48,j===0?27:25,ink,j===0?18:17,j===0?700:400);});
   });return svg;
  };
  art+=table('ALICI KURUMLAR',data.buy,480,layout!=='masthead')+table('SATICI KURUMLAR',data.sell,860,layout==='masthead');
 }else if(d.template==='broker_flow'&&(data?.buy?.length||data?.sell?.length)){
  art+=block(d.headline,left,268,width,155,61,fg,38,700,align);
  if(separateTicker)art+=text(data.ticker!,1004,446,32,steel,700,'end');
  const table=(title:string,rows:CardRow[]|undefined,y:number,invert:boolean)=>{
   if(!rows?.length)return '';
   if(rows.length>5)throw Error('market_card_capacity_broker_flow');
   const ink=invert?bg:fg;let svg=rect(left,y,width,310,invert?fg:bg,invert?undefined:steel)+text(title,left+28,y+46,25,invert?bg:steel,700);
   rows.forEach((row,i)=>{const top=y+69+i*46;svg+=block(row.label,left+28,top,width-360,46,30,ink,18,700)+block(row.value,1004-300,top,272,46,30,ink,18);});
   return svg;
  };
  art+=table(d.template==='broker_flow'?'NET ALICI KURUMLAR':'ALICI KURUMLAR',data.buy,480,layout!=='masthead')+table(d.template==='broker_flow'?'NET SATICI KURUMLAR':'SATICI KURUMLAR',data.sell,836,layout==='masthead');
  art+=block(d.body,left,1190,width,105,30,fg,22);
 }else if(summary&&(data?.buy?.length||data?.sell?.length)){
  art+=block(d.headline,left,260,width,130,55,fg,38,700,align);
  const table=(role:string,broker:string,rows:CardRow[]|undefined,y:number,invert:boolean)=>{
   if(!rows?.length)return '';if(rows.length>5)throw Error('market_card_capacity_institution_summary');
   const ink=invert?bg:fg,muted=invert?bg:steel,x=left+28,inner=width-56,bounds=[0,.30,.65,1],height=154+rows.length*46+12;
   let svg=rect(left,y,width,height,invert?fg:bg,invert?undefined:steel)+text(role,x,y+38,25,muted,700);
   svg+=block(broker+' üzerinden öne çıkan hisseler',x,y+52,inner,48,28,ink,20,700);
   ['HİSSE','NET HACİM','MALİYET'].forEach((h,j)=>svg+=text(h,x+bounds[j]*inner,y+125,21,muted,700));
   svg+=`<path d="M${x} ${y+138} H${left+width-28}" stroke="${muted}" stroke-width="1" opacity=".45"/>`;
   rows.forEach((row,i)=>{const cells=[row.label,...institutionSummaryCells(row.value)];cells.forEach((v,j)=>svg+=block(v,x+bounds[j]*inner,y+150+i*46,(bounds[j+1]-bounds[j])*inner-16,44,j===0?30:27,ink,22,j===0?700:400));});return svg;
  };
  const buyHeight=data?.buy?.length?154+data.buy.length*46+12:0;
  art+=table('EN ÇOK NET ALIM',data?.buy_broker??data?.broker??'Kurum',data?.buy,420,layout!=='masthead');
  art+=table('EN ÇOK NET SATIM',data?.sell_broker??data?.broker??'Kurum',data?.sell,buyHeight?420+buyHeight+26:420,layout==='masthead');
 }else if(d.template==='institutional'&&(data?.buy?.length||data?.sell?.length)){
  art+=block(d.headline,left,268,width,192,61,fg,38,700,align);
  const both=!!(data.buy?.length&&data.sell?.length),gap=26,col=both?(width-gap)/2:width;
  if((data.buy?.length??0)>10||(data.sell?.length??0)>10)throw Error('market_card_capacity_institutional');
  const brokerId=(data.broker??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const brokerLabel=['BANKOFAMERICA','BOFA'].includes(brokerId)?'BofA':'KURUM';
  const panel=(title:string,rows:CardRow[]|undefined,x:number,invert:boolean)=>{
   if(!rows?.length)return '';const ink=invert?bg:fg;
   let svg=rect(x,510,col,650,invert?fg:bg,invert?undefined:steel)+text(title,x+22,558,22,invert?bg:steel,700);
   rows.forEach((r,i)=>{const y=590+i*54,labelWidth=both?(/^[A-Z][A-Z0-9]{3,4}$/.test(r.label)?105:col*.45):col*.35;
    svg+=block(r.label,x+22,y,labelWidth,48,both?29:33,ink,22,700);
    svg+=block(r.value,x+32+labelWidth,y,col-labelWidth-54,48,both?25:33,ink,both?18:23);
   });return svg;
  };
  art+=panel(`${data.buy_broker??brokerLabel} ÜZERİNDEN ALIM`,data.buy,left,layout!=='masthead')+panel(`${data.sell_broker??brokerLabel} ÜZERİNDEN SATIM`,data.sell,both?left+col+gap:left,layout==='masthead');
  // Institutional tables carry their own units; no generated prose footer.
 }else{
  art+=block(d.headline,left,268,width,192,61,fg,38,700,align);
  if(data?.ticker)art+=text(data.ticker,1004,486,34,fg,700,'end');
  const gap=26,col=(width-gap)/2,start=535;
  const panel=(title:string,rows:CardRow[]|undefined,x:number,invert:boolean)=>{
   if(!rows?.length)return '';
   if(rows.length>5)throw Error('market_card_capacity_market');
   const ink=invert?bg:fg,paper=invert?fg:bg;
   let svg=rect(x,start,col,530,paper,invert?undefined:steel)+text(title,x+25,start+47,25,invert?bg:steel,700);
   for(let i=0;i<rows.length;i++){
    const y=start+82+i*85;
    svg+=block(rows[i].label,x+25,y,col-50,38,d.template==='akd'?28:35,ink,23,700);
    svg+=block(rows[i].value,x+25,y+40,col-50,38,30,ink,22);
   }
   return svg;
  };
  if(data?.buy?.length||data?.sell?.length){art+=panel(d.template==='akd'?'ALICI KURUMLAR':'EN ÇOK ALINAN',data.buy,left,layout!=='masthead');art+=panel(d.template==='akd'?'SATICI KURUMLAR':'EN ÇOK SATILAN',data.sell,left+col+gap,layout==='masthead');}
  else art+=block(d.body,left,586,width,420,48,fg,32);
  if(data?.buy?.length||data?.sell?.length)art+=rule(1120)+block(d.body,left,1160,width,150,31,fg,25);
 }
 // A visible footer mark differentiates frame variants without invented charts.
 art+=`<path d="M${left} 1308 H${left+56+variant*22}" stroke="${steel}" stroke-width="${layout==='brief'?7:3}"/>`;
 return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1350" viewBox="0 0 1080 1350" role="img"><title>${BRAND_NAME} — ${esc(d.headline)}</title>${rect(0,0,1080,1350,bg)}<g font-family="Noto Sans">${art}</g></svg>`;
}
// Only the source-validated ticker list can supplement the circuit headline.
// Never extract codes from prose or silently truncate an overcrowded batch.
function circuitCard(theme:CardTheme,layout:CardLayout,tickers:string[]):string {
 if(!Array.isArray(tickers)||tickers.some(c=>typeof c!=='string'||!/^[A-Z][A-Z0-9]{3,4}$/.test(c)))throw Error('invalid_circuit_tickers');
 const codes=[...new Set(tickers)],dense=codes.length>24;
 const bg=COLORS[theme],ink=theme==='navy'?COLORS.paper:COLORS.navy,steel=COLORS.steel;
 const centered=layout==='center',x=centered?540:layout==='rail'?130:80,anchor=centered?'middle':'start';
 const panel=layout==='brief'||layout==='masthead',fg=panel?bg:ink;
 const frame=layout==='frame'?`<rect x="32" y="32" width="1016" height="1286" fill="none" stroke="${steel}" stroke-width="2"/>`:layout==='rail'?`<rect width="24" height="1350" fill="${ink}"/><rect x="24" width="6" height="1350" fill="${steel}"/>`:'';
 const left=layout==='rail'?130:80,width=1000-left;
 const y=dense?370:codes.length>6?450:layout==='brief'?540:layout==='masthead'?570:centered?565:550;
 const size=dense?86:codes.length>6?148:174;
 const listTop=dense?480:codes.length>6?720:830,listHeight=1250-listTop;
 let grid='';
 if(codes.length){
  const tags=codes.map(c=>'#'+c),gap=dense?10:14;
  let settings:{font:number;cell:number;columns:number;row:number}|undefined;
  for(const font of [44,40,36,32,30,28,26,24,22]){
   const cell=Math.ceil(Math.max(...tags.map(t=>[...t].reduce((n,c)=>n+(/[MW]/.test(c)?.98:/[IL1]/.test(c)?.4:.75),0)*font)))+(dense?12:28);
   const columns=Math.min(codes.length,Math.max(1,Math.floor((width+gap)/(cell+gap)))),row=Math.ceil(font*1.25)+(dense?6:16);
   if(Math.ceil(codes.length/columns)*row<=listHeight){settings={font,cell,columns,row};break;}
  }
  if(!settings)throw Error('circuit_card_capacity');
  const {font,cell,columns,row}=settings,total=columns*cell+(columns-1)*gap,start=centered?left+(width-total)/2:left;
  grid=tags.map((tag,i)=>{const tx=start+(i%columns)*(cell+gap),ty=listTop+Math.floor(i/columns)*row;
   return `<g data-circuit-ticker="${esc(codes[i])}"><rect x="${tx}" y="${ty}" width="${cell}" height="${row-6}" fill="none" stroke="${steel}" stroke-width="1"/><text x="${tx+cell/2}" y="${ty+(row-6)/2+font*.34}" font-size="${font}" font-weight="700" text-anchor="middle" fill="${ink}">${esc(tag)}</text></g>`;
  }).join('');
 }
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img"><title>${BRAND_NAME} — DEVRE KESİCİ</title>
 <rect width="1080" height="1350" fill="${bg}"/>${frame}
 <image x="80" y="66" width="76" height="76" href="${PROFILE_DATA}"/>
 <g font-family="Noto Sans"><text x="178" y="103" font-size="36" font-weight="700" fill="${ink}">ENDEKS</text><text x="180" y="136" font-size="20" font-weight="700" letter-spacing="6" fill="${steel}">HABER</text>
 <path d="M80 192 H1000" stroke="${steel}" stroke-width="1"/>
 ${panel?`<rect x="48" y="${dense?246:codes.length>6?270:310}" width="984" height="${dense?180:codes.length>6?395:470}" fill="${ink}"/>`:''}
 <path d="M${centered?474:x} ${y-(dense?120:180)} h132" stroke="${steel}" stroke-width="${dense?8:12}"/>
 ${dense?`<text x="${x}" y="${y}" font-size="${size}" font-weight="700" letter-spacing="-2" text-anchor="${anchor}" fill="${fg}">DEVRE KESİCİ</text>`:`<text x="${x}" y="${y}" font-size="${size}" font-weight="700" letter-spacing="-5" text-anchor="${anchor}" fill="${fg}">DEVRE</text><text x="${x}" y="${y+size+22}" font-size="${size}" font-weight="700" letter-spacing="-5" text-anchor="${anchor}" fill="${fg}">KESİCİ</text>`}
 ${grid}
 <path d="M80 1300 H1000" stroke="${steel}" stroke-width="1"/><path d="M80 1300 H${240+CARD_LAYOUTS.indexOf(layout)*28}" stroke="${ink}" stroke-width="6"/>
 </g></svg>`;
}

export function institutionSummaryCells(value:string):[string,string]{
 const match=/^(.*?)\s*(?:[·|;]\s*)?maliyet\s*:?\s*(.+)$/iu.exec(value);
 if(match){const net=match[1].trim().replace(/[·|;]\s*$/u,'').trim().replace(/^net hacim\s*[:=]?\s*/iu,'').replace(/\s+net hacim$/iu,'');if(!net||!match[2].trim())throw Error('institution_summary_cells_invalid');return[net,match[2].trim()];}
 if(/[·|;]/u.test(value))throw Error('institution_summary_cells_invalid');
 return[value.trim()||'—','—'];
}
