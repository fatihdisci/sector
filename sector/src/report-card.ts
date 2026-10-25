import {reportTextWidth} from './report-text-metrics';
import {buybackCard} from './buyback-card';
import {COLORS,PROFILE_DATA} from './brand';
import type {Draft} from './types';
import {normalizeCardText} from './card-text';
import {circuitOmissionNote} from './circuit-selection';
const esc=(s:string)=>normalizeCardText(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function reportCard(d:Pick<Draft,'headline'|'body'|'card_data'|'output_preferences'>):string{
 if(d.card_data!.report!.kind==='range')return rangeCard(d);
 if(d.card_data!.report!.buyback)return buybackCard(d.card_data!.report!.buyback!);
 if(d.card_data!.report!.general)return generalCard(d.card_data!.report!.general!,d.output_preferences?.show_time===true,d.output_preferences?.show_footer!==false);
 const data=d.card_data!.report!,rows=data.rows,cols=1,height=55;
 if(rows.length>15)throw Error('report_card_capacity_exceeded');
 const text=(s:string,x:number,y:number,size:number,color=COLORS.paper)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${esc(s)}</text>`;
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="${COLORS.navy}"/><g font-family="Noto Sans, sans-serif"><image href="${PROFILE_DATA}" x="64" y="52" width="64" height="64"/>`+text('ENDEKS HABER',148,94,30)+text(d.headline.replace(/^📢\s*/,''),64,210,40)+text(d.body,64,263,26,COLORS.steel);
 for(let c=0;c<cols;c++){const x=64+c*500;svg+=text('HİSSE',x,310,20,COLORS.steel)+text(d.headline.includes('Devre')?'BİLDİRİM / ENDEKS':'ALIM MİKTARI',x+300,310,20,COLORS.steel);}
 rows.forEach((r,i)=>{const x=64,y=350+i*height;if(reportTextWidth(r.label,30,true)>280||reportTextWidth(r.value,28)>670)throw Error('report_cell_capacity_exceeded');svg+=`<g data-report-row="${i}">`+text(r.label,x,y,30)+text(r.value,x+300,y,28)+'</g>';});
 if(!rows.length)svg+=text('Doğrulanmış günlük işlem satırı yok.',64,380,32);

 const omission=data.circuit?circuitOmissionNote(data.circuit):'';
 const words=(omission||data.footer).split(' '),lines:string[]=[];let line='';for(const w of words){if((line+' '+w).length>73){lines.push(line);line=w;}else line+=(line?' ':'')+w;}if(line)lines.push(line);
 if(omission||d.output_preferences?.show_footer===true||d.output_preferences?.show_footer!==false&&/Pay geri alım/i.test(d.headline)){if(lines.length>2)throw Error('report_footer_capacity_exceeded');lines.forEach((s,i)=>svg+=text(s,64,1260+i*30,26,COLORS.steel));}return svg+'</g></svg>';
}

function generalCard(g:NonNullable<NonNullable<import('./types').CardData['report']>['general']>,showTime=false,showFooter=true):string{
 // The header scales with canvas width; only table density changes with count.
 const cols=g.rows.length>45?3:g.rows.length>15?2:1,per=Math.ceil(g.rows.length/cols),width=cols*1060+120,scale=width/2200;
 const rowHeight=g.rows.length>100?52:g.rows.length>45?58:64,headerHeight=420*scale,top=headerHeight+105,height=Math.ceil(Math.max(1100,top+per*rowHeight+150));
 const t=(s:string,x:number,y:number,size:number,color=COLORS.navy,anchor='start')=>`<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" fill="${color}">${esc(s)}</text>`;
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#FFFFFF"/><g font-family="Noto Sans, sans-serif"><g transform="scale(${scale})"><image href="${PROFILE_DATA}" x="60" y="42" width="100" height="100"/><g font-weight="700">`+t('ENDEKS HABER',190,116,58)+t('PAY GERİ ALIMLARI',60,260,96)+'</g>'+t(g.day+(showTime?' • '+g.time+' itibarıyla':''),60,314,34);
 if(width*height>48_000_000||width>16384||height>16384)throw Error('general_card_capacity_exceeded');
 const metrics=[['HİSSE'+(g.partial?' (KISMİ)':''),String(g.companies)],['TOPLAM LOT'+(g.partial?' (KISMİ)':''),g.lots],['TOPLAM TUTAR'+(g.missing||g.partial?' (KISMİ)':''),g.amount+' TL']];
 metrics.forEach(([label,value],i)=>{const x=60+i*2080/3;svg+=t(label,x,375,25)+t(value,x,426,40);});
 svg+='</g>';
 const font=g.rows.length>100?26:28;
 for(let c=0;c<cols;c++){const x=60+c*1060,y=headerHeight+55;svg+=`<g font-weight="700">`+t('HİSSE',x,y,24)+t('LOT',x+420,y,24,COLORS.navy,'end')+t('ORT. FİYAT (TL)',x+690,y,24,COLORS.navy,'end')+t('TUTAR (TL)',x+1000,y,24,COLORS.navy,'end')+'</g>';}
 g.rows.forEach((r,i)=>{if(reportTextWidth('#'+r.ticker,font+2)>200||reportTextWidth(r.lots,font)>220||reportTextWidth(r.price,font)>250||reportTextWidth(r.amount,font)>290)throw Error('general_cell_capacity_exceeded');const c=Math.floor(i/Math.max(1,per)),line=i%Math.max(1,per),x=60+c*1060,y=top+line*rowHeight;svg+=`<rect x="${x-12}" y="${y-35}" width="1030" height="${rowHeight-4}" fill="${COLORS.navy}" opacity="${line%2?'.025':'.065'}"/>`+t('#'+r.ticker,x,y,font+2)+t(r.lots,x+420,y,font,COLORS.navy,'end')+t(r.price,x+690,y,font,COLORS.navy,'end')+t(r.amount,x+1000,y,font,COLORS.navy,'end');});
 if(!g.rows.length)svg+=t('Doğrulanmış günlük işlem satırı yok.',60,top,32);
 if(showFooter)svg+=t('Yalnız KAP pay geri alımı bildirimleri esas alınmıştır. Farklılık gösterebilir.',60,height-82,24)+t(g.partial?'Toplayıcı kapsamı kısmi; yalnız kayıtlı işlemler gösterilir.':g.missing?'Eksik fiyatlar — ile gösterilir. Toplam tutar kısmi olabilir.':'Ortalama fiyat lot ağırlıklıdır. Tutar işlem satırlarından hesaplanmıştır.',60,height-40,24);
 return svg+'</g></svg>';
}

function rangeCard(d:Pick<Draft,'headline'|'body'|'card_data'|'output_preferences'>){
 const rows=d.card_data!.report!.rows;if(rows.length>15)throw Error('report_card_capacity_exceeded');
 const t=(s:string,x:number,y:number,size:number,color=COLORS.paper)=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}">${esc(s)}</text>`;
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="${COLORS.navy}"/><g font-family="Noto Sans, sans-serif"><image href="${PROFILE_DATA}" x="64" y="52" width="64" height="64"/>`+t('ENDEKS HABER',148,94,30)+t('BIST 30 • 100 GÜNLÜK DİP–ZİRVE',64,210,38);
 const xs=[64,240,420,600,810];['HİSSE','DİP (TL)','ZİRVE (TL)','DİBE UZAKLIK','ZİRVEYE UZAKLIK'].forEach((s,i)=>svg+=t(s,xs[i],310,21,COLORS.steel));
 rows.forEach((r,i)=>{const cells=[r.label,...r.value.split('|')];if(cells.length!==5)throw Error('gallery_cell_missing');cells.forEach((v,j)=>{const text=j>2?'%'+v:v;if(reportTextWidth(text,27)>[160,160,160,190,205][j])throw Error('report_cell_capacity_exceeded');svg+=t(text,xs[j],365+i*55,27);});});return svg+'</g></svg>';
}
