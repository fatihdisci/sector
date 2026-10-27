import {COLORS,PROFILE_DATA} from './brand';import type {Movers} from './market-movers';
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function moversCard(data:Movers):string{
 const side=data.page;if(!side)throw Error('market_movers_page_missing');const rows=side==='up'?data.up:data.down;if(rows.length!==10)throw Error('market_movers_rows_invalid');
 const title=side==='up'?'EN ÇOK YÜKSELENLER':'EN ÇOK DÜŞENLER',accent=side==='up'?'#46C7A4':'#FF8585';
 let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><rect width="1080" height="1350" fill="${COLORS.navy}"/><g font-family="Noto Sans"><image href="${PROFILE_DATA}" x="64" y="52" width="64" height="64"/><text x="148" y="93" font-size="30" font-weight="700" fill="${COLORS.paper}">ENDEKS HABER</text><text x="64" y="205" font-size="50" font-weight="700" fill="${COLORS.paper}">${title}</text><text x="64" y="275" font-size="25" fill="${COLORS.steel}">HİSSE</text><text x="650" y="275" text-anchor="end" font-size="25" fill="${COLORS.steel}">FİYAT</text><text x="990" y="275" text-anchor="end" font-size="25" fill="${COLORS.steel}">DEĞİŞİM</text>`;
 rows.forEach((r,i)=>{if(!/^[A-Z][A-Z0-9]{3,4}$/.test(r.symbol)||r.price.length>18||r.change.length>12)throw Error('market_movers_row_invalid');const y=350+i*82;svg+=`<rect x="48" y="${y-50}" width="984" height="70" rx="8" fill="${COLORS.paper}" opacity="${i%2?'.06':'.11'}"/><text x="70" y="${y}" font-size="38" font-weight="700" fill="${COLORS.paper}">${i+1}. ${esc(r.symbol)}</text><text x="650" y="${y}" text-anchor="end" font-size="36" fill="${COLORS.paper}">${esc(r.price)}</text><text x="990" y="${y}" text-anchor="end" font-size="36" font-weight="700" fill="${accent}">${esc(r.change)}</text>`;});
 if(data.sourceTime)svg+=`<text x="64" y="1260" font-size="25" fill="${COLORS.steel}">Kaynak saati: ${esc(data.sourceTime)}</text>`;
 return svg+'</g></svg>';
}
