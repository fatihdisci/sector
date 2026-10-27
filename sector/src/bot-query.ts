export interface BotQuery {bot:'b0pt_bot'|'ucretsizderinlikbot';command:string;kind:'institutional'|'broker_flow'|'akd'|'custody'|'movers';ticker?:string;broker?:string;}
// Only explicit owner commands are routable. Bot replies never become commands.
export function botQuery(text:string):BotQuery|null {
 if(/^\/piyasayd(?:@[a-zA-Z0-9_]+)?$/iu.test(text.trim()))return {bot:'b0pt_bot',command:'/piyasayd',kind:'movers'};
 const match=/^\/(kurum|akd|takas)(?:@[a-zA-Z0-9_]+)?(?:[ \t]+([^\r\n]+))?$/iu.exec(text.trim());
 if(!match)return null;
 const verb=match[1].toLowerCase(),arg=match[2]?.trim()??'';
 if(verb==='kurum'){
  if(!arg)return {bot:'ucretsizderinlikbot',command:'/kurum',kind:'broker_flow'};
  if(arg.length>80||! /^[\p{L}\p{N} .&’'()_-]+$/u.test(arg))throw Error('bot_query_invalid');
  return {bot:'b0pt_bot',command:'/kurum '+arg,kind:'institutional',broker:arg};
 }
 const ticker=arg.toUpperCase().replace(/\.E$/,'');
 if(!/^[A-Z][A-Z0-9]{3,4}$/.test(ticker))throw Error('bot_query_invalid');
 return {bot:'ucretsizderinlikbot',command:'/'+verb+' '+ticker,kind:verb==='akd'?'akd':'custody',ticker};
}
export const BOT_QUERY_HELP='Sorgular:\n/kurum → Aracı kurum işlem özeti\n/kurum bank of america → Yazdığın kurum üzerinden alım/satım\n/kurum ak yatırım → Yazdığın kurum analizi\n/akd KTLEV → Hisse aracı kurum dağılımı\n/takas THYAO → Hisse takas dağılımı\n/piyasayd → En çok yükselen ve düşen hisseler\n\n/piyasayd ve isimli kurum sorguları @b0pt_bot, diğer sorgular @ucretsizderinlikbot üzerinden alınır. Ayrı Telegram hesap bağlantısı gerekir.';
