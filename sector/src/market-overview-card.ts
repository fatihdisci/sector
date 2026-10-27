import{COLORS,PROFILE_DATA}from'./brand';import{normalizeCardText}from'./card-text';import{reportTextWidth}from'./report-text-metrics';import type{MarketOverview}from'./market-overview-types';import type{CardTheme}from'./card-theme';
const esc=(s:string)=>normalizeCardText(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const compact=(s:string)=>s.replace(/milyar/g,'Mr').replace(/milyon/g,'Mn');
export function marketOverviewCard(o:MarketOverview,headline:string,theme:CardTheme='paper'):string{
 const bg=theme==='paper'?COLORS.paper:COLORS.navy,fg=theme==='paper'?COLORS.navy:COLORS.paper,steel=COLORS.steel;
 const rect=(x:number,y:number,w:number,h:number,fill=bg)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="${fill}" stroke="${steel}" stroke-width="1"/>`;
 const text=(s:string,x:number,y:number,size:number=24,bold=false,color=fg,anchor='start')=>`<text x="${x}" y="${y}" font-size="${size}" font-weight="${bold?700:400}" fill="${color}" text-anchor="${anchor}">${esc(s)}</text>`;
 const cell=(s:string,x:number,y:number,width:number,size=24,bold=false,anchor='start')=>{let n=size;while(n>=20&&reportTextWidth(s,n,bold)>width)n--;if(n<20)throw Error('market_overview_cell_capacity');return text(s,x,y,n,bold,fg,anchor);};
 let s=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="${bg}"/><g font-family="Noto Sans"><image x="44" y="32" width="62" height="62" href="${PROFILE_DATA}"/>`+text('ENDEKS',122,61,28,true)+text('H A B E R',124,86,15,true,steel)+text('PİYASA ÖZETİ',1036,72,22,true,steel,'end');
 const clean=headline.replace(/^.*?—\s*/,'').trim();s+=cell(clean,44,151,992,44,true);
 const line=(y:number)=>`<path d="M44 ${y}H1036" stroke="${steel}"/>`;
 if(o.view==='first_moves'){
  o.panels.forEach((p,j)=>{if(p.rows.length>5)throw Error('market_overview_capacity');const y=220+j*350;s+=text(p.title,44,y,29,true,steel)+line(y+20);p.rows.forEach((r,i)=>{s+=text(String(i+1).padStart(2,'0'),44,y+75+i*48,21,false,steel)+cell('#'+r.label,110,y+75+i*48,430,32,true)+cell(compact(r.value),1036,y+75+i*48,420,30,false,'end');});});
  return s+'</g></svg>';
 }
 if(o.view==='opening'){
  s+=line(200)+text('BIST 100',44,341,38,true,steel)+cell(o.level,44,505,992,132,true)+text('ENDEKS SEVİYESİ',44,563,25,true,steel)+line(640);
  s+=cell(o.percent,44,818,992,112,true)+text(o.direction==='down'?'DÜŞÜŞ':'YÜKSELİŞ',44,883,36,true)+line(967)+text('PUAN FARKI',44,1041,25,true,steel)+cell(o.points,44,1152,992,76,true)+line(1230);return s+'</g></svg>';
 }
 s+=line(183)+text('BIST 100',44,227,25,true,steel)+cell(o.level,44,326,680,90,true)+text(o.percent+' '+(o.direction==='down'?'DÜŞÜŞ':'YÜKSELİŞ'),1036,240,29,true,fg,'end')+text(o.points+' puan',1036,291,28,false,fg,'end');

 s+=text('HACİM '+compact(o.volume),44,374,26,true)+text(o.low+' / '+o.high,1036,374,25,false,fg,'end')+text('GÜN İÇİ DÜŞÜK / YÜKSEK',1036,406,17,true,steel,'end')+line(425);
 s+=text('ENDEKSE KATKI · PUAN',44,463,25,true)+text('HACİM LİDERLERİ',760,463,23,true);
 s+=text('POZİTİF',44,501,18,true,steel)+text('NEGATİF',392,501,18,true,steel);
 for(const [key,x]of [['contribution_up',44],['contribution_down',392],['volume',760]]as const){const p=o.panels.find(p=>p.key===key);if(!p||p.rows.length>5)throw Error('market_overview_capacity');p.rows.forEach((r,i)=>{const y=542+i*43;s+=cell('#'+r.label,x,y,key==='volume'?140:150,24,true)+cell(compact(r.value).replace(' puan',''),key==='volume'?1036:x+308,y,key==='volume'?130:145,23,false,'end');});}
 s+=line(746)+text('Yükselen '+o.breadth.up+'   /   Nötr '+o.breadth.neutral+'   /   Düşen '+o.breadth.down,44,784,24)+line(806);
 for(const[b,j]of o.brokers.map((b,i)=>[b,i]as const)){const rows=b.rows.filter(r=>!/^Diğer\s*\(/u.test(r.name));if(rows.length!==5)throw Error('market_overview_capacity');const y=848+j*236;
 s+=text(b.side==='buy'?'NET ALICI KURUMLAR':'NET SATICI KURUMLAR',44,y,23,true)+text('NET HACİM',550,y,18,true,steel)+text('ORAN',800,y,18,true,steel)+text('TOPLAM TL',1036,y,18,true,steel,'end');
 rows.forEach((r,i)=>{const yy=y+38+i*35;s+=cell(r.name,44,yy,450,25,true)+cell(compact(r.net),695,yy,220,24,false,'end')+cell(r.share,864,yy,140,23,false,'end')+cell(compact(r.total).replace(/ TL$/,''),1036,yy,160,24,false,'end');});s+=line(y+208);
 }
 return s+'</g></svg>';
}
