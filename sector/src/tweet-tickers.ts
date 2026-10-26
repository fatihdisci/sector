// Presentation only: callers supply known ticker metadata, never guessed acronyms.
const unique=(codes:string[])=>[...new Set(codes.filter(c=>/^[A-Z][A-Z0-9]{2,4}$/.test(c)))];
const outsideUrls=(s:string,fn:(s:string)=>string)=>s.split(/(https?:\/\/[^\s]+)/u).map(p=>/^https?:\/\//u.test(p)?p:fn(p)).join('');
export function hashtagTickers(text:string,codes:string[]):string{
 const values=unique(codes);if(!values.length)return text;
 const pattern=new RegExp(`(?<![\\p{L}\\p{N}_#])(${values.join('|')})(?:\\.E)?(?![\\p{L}\\p{N}_])`,'giu');
 return outsideUrls(text,s=>s.replace(pattern,(match,code:string,offset:number)=>{
  // EKIM is also an equity code. A day + Ekim + locative suffix is a
  // calendar expression; bare EKIM and explicit #EKIM remain equity mentions.
  if(code.toUpperCase()==='EKIM'&&/(?<!\d)(?:0?[1-9]|[12]\d|3[01])\s+$/u.test(s.slice(0,offset))&&/^[’']de\b/iu.test(s.slice(offset+match.length)))return match;
  return '#'+code.toUpperCase();
 }));
}
export function circuitWithoutRepeatedTickers(text:string,codes:string[]):string{
 const values=unique(codes);if(!values.length)return text;
 const atom=`#?(?:${values.join('|')})(?:\\.E)?(?:['’](?:de|da|te|ta|nin|nın|nun|nün|in|ın|un|ün))?`;
 const group=new RegExp(`(?<![\\p{L}\\p{N}_])${atom}(?:(?:\\s*[,;/]\\s*|\\s+(?:ve|ile)\\s+|\\s+)${atom})*(?![\\p{L}\\p{N}_])`,'gu');
 return outsideUrls(text,part=>part.split('\n').map(line=>{
  const matches=[...line.matchAll(group)];if(!matches.length)return line;
  // Different per-ticker facts cannot safely be collapsed into a group claim.
  if(matches.length>1)throw Error('circuit_ticker_context_requires_edit');
  const match=matches[0],mentioned=values.filter(c=>new RegExp(`(?<![A-Z0-9])${c}(?![A-Z0-9])`).test(match[0]));
  if(mentioned.length!==values.length)throw Error('circuit_ticker_context_requires_edit');
  const before=line.slice(0,match.index).trim(),after=line.slice(match.index!+match[0].length).trim();
  if(/^(?:hisseler|hisse kodları|kodlar|devre kesici uygulanan hisseler)\s*:?$/iu.test(before)&&!after.replace(/[.!]/g,'').trim())return '';
  if(before)throw Error('circuit_ticker_context_requires_edit');
  return after.replace(/^(?:paylarında da|paylarında|hisselerinde de|hisselerinde|için)\s+/iu,'').replace(/^[,:;–—-]\s*/u,'').replace(/^./u,c=>c.toLocaleUpperCase('tr-TR'));
 }).join('\n')).replace(/\n{3,}/g,'\n\n').trim();
}
