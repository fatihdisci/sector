import {marketOverviewCard} from './market-overview-card';
import {moversCard} from './movers-card';
import {outputView} from './output-preferences';
import {reportCard} from './report-card';
import {marketCard} from './market-card';
import {type CardLayout} from './card-layout';
import {legacyTheme,type CardTheme} from './card-theme';
import {PROFILE_DATA,COLORS,MARK_PATH,BRAND_NAME} from './brand';
import {normalizeCardText} from './card-text';
export {COLORS} from './brand';
import type {Draft} from './types';
const esc=(s:string)=>normalizeCardText(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const measure=(s:string,size:number)=>[...s].reduce((n,c)=>n+(/[MW@%]/.test(c)?.94:/[ilıİ.,:;!' ]/.test(c)?.32:/[A-ZÇĞÖŞÜ0-9]/.test(c)?.69:.59),0)*size;
export function wrap(text:string,size:number,width:number):string[] {
 text=normalizeCardText(text);
 const words=text.trim().split(/\s+/).filter(Boolean);if(words.some(w=>measure(w,size)>width))throw new Error('card_word_overflow');
 // Balance all lines, not just the last one. Keep the original words and order.
 const greedy:string[]=[];let line='';
 for(const word of words){const next=line?line+' '+word:word;if(measure(next,size)>width&&line){greedy.push(line);line=word;}else line=next;}
 if(line)greedy.push(line);if(greedy.length<2||greedy.length>10)return greedy;
 const target=measure(words.join(' '),size)/greedy.length;
 const memo=new Map<string,{cost:number;lines:string[]}|null>();
 function solve(start:number,left:number):{cost:number;lines:string[]}|null {
  if(!left)return start===words.length?{cost:0,lines:[]}:null;
  const key=`${start}:${left}`;if(memo.has(key))return memo.get(key)!;
  let best:{cost:number;lines:string[]}|null=null;
  for(let end=start+1;end<=words.length-left+1;end++){
   const value=words.slice(start,end).join(' '),w=measure(value,size);if(w>width)break;
   const tail=solve(end,left-1);if(!tail)continue;
   const cost=(w-target)**2+(end-start===1&&words.length>greedy.length?width**2*.18:0)+tail.cost;
   if(!best||cost<best.cost)best={cost,lines:[value,...tail.lines]};
  }
  memo.set(key,best);return best;
 }
 return solve(0,greedy.length)?.lines??greedy;
}
export function draftCard(d:Draft,sources:string[]=[],date='',demo=false,theme?:CardTheme,layout:CardLayout='editorial'):string {return cardSvg({headline:d.card_headline,body:d.card_body,template:d.template,card_data:d.card_data,output_preferences:d.output_preferences},sources,date,demo,theme,layout);}
// Source access belongs to the Telegram button. Legacy arguments remain accepted.
export function cardSvg(d:Pick<Draft,'headline'|'body'|'template'|'card_data'|'output_preferences'>,_sources:string[]=[],_date='',_demo=false,theme?:CardTheme,layout:CardLayout='editorial'):string {
 d=outputView(d);
 if(!d.output_preferences?.show_time&&d.card_data?.as_of){d={...d,card_data:{...d.card_data}};delete d.card_data!.as_of;}
 if(d.card_data?.movers)return moversCard(d.card_data.movers);
 if(d.card_data?.overview)return marketOverviewCard(d.card_data.overview,d.headline,theme);
 if(d.card_data?.report)return reportCard(d);
 const headline=d.headline.replace(/^(?:\p{Extended_Pictographic}\uFE0F?\s*)+/u,'').trim();
 if(!headline||!d.body.trim())throw new Error('card_content_empty');
 if(['circuit','institutional','akd','volume','broker_flow','custody','theoretical'].includes(d.template))return marketCard({...d,headline},theme??legacyTheme(d.template),layout,fitText);
 const label=templateLabel(d.template),special=d.template==='breaking'||d.template==='circuit';
 const dark=(theme??legacyTheme(d.template))==='navy';
 const bg=dark?COLORS.navy:COLORS.paper,fg=dark?COLORS.paper:COLORS.navy;
 if(layout!=='editorial')return alternateCard(headline,d.body,special,bg,fg,layout,label);
 const bodySize=36,bodyLines=wrap(d.body,bodySize,848);
 if(bodyLines.length>6)throw new Error('card_content_overflow');
 const bodyHeight=Math.max(290,bodyLines.length*53+114),panelY=1350-bodyHeight;
 const top=special?310:270,bottom=panelY-90,available=bottom-top;
 const preferredLines=headline.length>80?5:headline.length>64?4:3;
 let size=108,lines:string[]=[];
 for(;size>=60;size-=2){
  try{lines=wrap(headline,size,920);}catch(e){if(size===60)throw e;continue;}
  if(lines.length<=(size===60?7:preferredLines)&&lines.length*size*1.14<=available)break;
 }
 if(size<60)throw new Error('card_content_overflow');
 const headlineY=top+Math.max(0,(available-lines.length*size*1.14)*.38)+size*.86;
 const text=(values:string[],x:number,y:number,fontSize:number,lineHeight:number,weight:number,color:string)=>values.map((v,i)=>`<text x="${x}" y="${Math.round(y+i*lineHeight)}" font-size="${fontSize}" font-weight="${weight}" fill="${color}">${esc(v)}</text>`).join('');
 // A geometric brand signature, never a chart or a fabricated illustration.
 const signature=`<path d="${MARK_PATH}" transform="translate(740 -40) scale(.85)" fill="${COLORS.steel}" opacity=".10"/>`;
 const panelBg=dark?COLORS.paper:COLORS.navy,panelFg=dark?COLORS.navy:COLORS.paper;
 return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-labelledby="card-title">
 <title id="card-title">${BRAND_NAME} — ${esc(headline)}</title>
 <rect width="1080" height="1350" fill="${bg}"/>
 ${signature}
 <image x="76" y="66" width="80" height="80" xlink:href="${PROFILE_DATA}"/>
 <g font-family="Noto Sans">
 <text x="178" y="107" fill="${fg}" font-size="38" font-weight="700" letter-spacing="1">ENDEKS</text>
 <text x="180" y="139" fill="${COLORS.steel}" font-size="22" font-weight="700" letter-spacing="7">HABER</text>
 <path d="M76 192 H1004" stroke="${COLORS.steel}" stroke-width="1" opacity=".45"/>
 <path d="M76 192 H156" stroke="${fg}" stroke-width="5"/>
 ${special?`<rect x="76" y="236" width="12" height="12" fill="${COLORS.steel}"/><text x="106" y="251" fill="${fg}" font-size="22" font-weight="700" letter-spacing="3">${esc(label)}</text>`:''}
 ${text(lines,76,headlineY,size,size*1.14,700,fg)}
 <rect y="${panelY}" width="1080" height="${bodyHeight}" fill="${panelBg}"/>
 <path d="M76 ${panelY} H192" stroke="${COLORS.steel}" stroke-width="8"/>
 <path d="M76 ${panelY+64} V${panelY+bodyHeight-64}" stroke="${COLORS.steel}" stroke-width="2"/>
 ${text(bodyLines,112,panelY+88,bodySize,53,400,panelFg)}
 </g></svg>`;
}

export function templateLabel(template:Draft['template']):string {return ({breaking:'SON DAKİKA',circuit:'DEVRE KESİCİ',kap:'KAP BİLDİRİMİ',company:'ŞİRKET HABERLERİ',market:'BIST / PİYASA',finance:'EKONOMİ / FİNANS',economic_data:'EKONOMİK VERİ',global:'KÜRESEL PİYASALAR',info:'BİLGİ / İSTATİSTİK',news:'HABER',institutional:'KURUM ALIM / SATIM',akd:'ARACI KURUM DAĞILIMI',volume:'İŞLEM HACMİ',broker_flow:'ARACI KURUM / NET İŞLEM',custody:'TAKAS / SAKLAMA',theoretical:'TEORİK EŞLEŞME'} as const)[template];}

type Box={x:number;y:number;width:number;height:number;size:number;min:number;weight:number;color:string;align?:'center'};
function fitText(value:string,b:Box):string {
 for(let size=b.size;size>=b.min;size-=2){
  let lines:string[];try{lines=wrap(value,size,b.width);}catch{continue;}
  const leading=size*1.2;if(lines.length*leading>b.height)continue;
  const x=b.align==='center'?b.x+b.width/2:b.x;
  return lines.map((line,i)=>`<text x="${x}" y="${Math.round(b.y+size*.95+i*leading)}" font-size="${size}" font-weight="${b.weight}" fill="${b.color}"${b.align==='center'?' text-anchor="middle"':''}>${esc(line)}</text>`).join('');
 }
 throw Error('card_content_overflow');
}
function alternateCard(headline:string,body:string,breaking:boolean,bg:string,fg:string,layout:Exclude<CardLayout,'editorial'>,label:string):string {
 const steel=COLORS.steel;
 const rect=(x:number,y:number,w:number,h:number,fill:string,stroke?:string)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${stroke?` stroke="${stroke}" stroke-width="2"`:''}/>`;
 const line=(x:number,y:number,x2:number,y2:number,color=steel,width=2)=>`<path d="M${x} ${y} H${x2}" transform="translate(0 0)" stroke="${color}" stroke-width="${width}"/>`;
 const logo=(x:number,y:number,color:string)=>`<image x="${x}" y="${y}" width="72" height="72" xlink:href="${PROFILE_DATA}"/><text x="${x+94}" y="${y+33}" fill="${color}" font-size="32" font-weight="700" letter-spacing="1">ENDEKS</text><text x="${x+96}" y="${y+61}" fill="${steel}" font-size="18" font-weight="700" letter-spacing="6">HABER</text>`;
 let decoration='',brand='',head:Box,detail:Box;
 switch(layout){
  case 'frame':
   decoration=rect(40,40,1000,1270,'none',steel)+rect(76,918,928,356,fg)+line(76,230,1004,230,fg,4);
   brand=logo(76,98,fg);
   head={x:88,y:breaking?340:306,width:904,height:550,size:104,min:56,weight:700,color:fg};
   detail={x:116,y:970,width:848,height:260,size:38,min:30,weight:400,color:bg};break;
  case 'rail':
   decoration=rect(0,0,70,1350,fg)+rect(70,0,10,1350,steel)+rect(126,958,90,7,fg)+line(126,1288,1000,1288);
   brand=logo(126,90,fg);
   head={x:126,y:breaking?344:300,width:870,height:580,size:102,min:54,weight:700,color:fg};
   detail={x:250,y:998,width:746,height:255,size:38,min:30,weight:400,color:fg};break;
  case 'masthead':
   decoration=rect(0,0,1080,824,fg)+rect(76,820,168,8,steel)+line(76,1178,1004,1178);
   brand=logo(76,1218,fg);
   head={x:76,y:breaking?218:160,width:928,height:590,size:108,min:56,weight:700,color:bg};
   detail={x:76,y:894,width:928,height:244,size:40,min:30,weight:400,color:fg};break;
  case 'center':
   decoration=line(76,220,1004,220)+line(430,926,650,926,fg,5)+line(76,1276,1004,1276);
   brand=logo(385,80,fg);
   head={x:88,y:breaking?358:310,width:904,height:545,size:102,min:54,weight:700,color:fg,align:'center'};
   detail={x:140,y:988,width:800,height:245,size:38,min:30,weight:400,color:fg,align:'center'};break;
  case 'brief':
   decoration=rect(0,0,1080,196,fg)+rect(0,930,260,420,steel)+rect(260,930,820,420,fg)+line(76,854,1004,854,steel,2);
   brand=logo(76,62,bg);
   head={x:76,y:breaking?340:286,width:928,height:510,size:106,min:54,weight:700,color:fg};
   detail={x:310,y:998,width:694,height:288,size:38,min:28,weight:400,color:bg};break;
 }
 const breakingY=layout==='masthead'?102:layout==='center'?286:260;
 const breakingColor=layout==='masthead'?bg:fg;
 const badge=breaking?`<text x="${layout==='rail'?126:76}" y="${breakingY}" font-size="22" font-weight="700" letter-spacing="3" fill="${breakingColor}">${esc(label)}</text>`:'';
 return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1350" viewBox="0 0 1080 1350" role="img"><title>${BRAND_NAME} — ${esc(headline)}</title>${rect(0,0,1080,1350,bg)}<g font-family="Noto Sans">${decoration}${brand}${badge}${fitText(headline,head)}${fitText(body,detail)}</g></svg>`;
}
