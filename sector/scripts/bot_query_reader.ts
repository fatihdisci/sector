import {spawn} from 'node:child_process';
import {readFile,realpath,stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {botQuery,type BotQuery} from '../src/bot-query';
import {withMarketText} from '../src/market-input';
import {parseMovers} from '../src/market-movers';
import {withMarketTiming} from '../src/market-timing';
import {readImage,type ImageEvidence} from './image_reader';
import type {Document} from '../src/types';
const root=join(homedir(),'Library/Application Support/sector-haber/telegram-account');
export interface BotReply {bot:string;command:string;text:string;images:string[];message_ids:number[];received_at?:string;}
export async function fetchBotReply(query:BotQuery,key:string):Promise<BotReply>{
 try{await stat(join(root,'account.json'));}catch{throw Error('bot_account_not_connected');}
 return new Promise((resolve,reject)=>{
  const child=spawn(join(root,'venv/bin/python'),['scripts/telegram_account.py','query'],{stdio:['pipe','pipe','pipe']});let output='',diagnostic='';
  const timer=setTimeout(()=>child.kill('SIGKILL'),130_000);
  child.stdout.on('data',b=>{output+=b.toString();if(output.length>1_000_000)child.kill('SIGKILL');});
  child.stderr.on('data',b=>{if(diagnostic.length<5000)diagnostic+=b.toString();});
  child.on('error',()=>{clearTimeout(timer);reject(Error('bot_account_not_connected'));});
  child.on('close',code=>{
   clearTimeout(timer);
   if(code!==0){let reason='bot_query_failed';try{const v=JSON.parse(diagnostic);if(/^bot_(?:query|account)_[a-z_]+$/.test(v.error))reason=v.error;}catch{}reject(Error(reason));return;}
   try{const result=JSON.parse(output) as BotReply;if(result.bot!==query.bot||result.command!==query.command||typeof result.text!=='string'||result.text.length>100_000||!Array.isArray(result.images)||result.images.length>2||result.images.some(p=>typeof p!=='string'))throw Error('bot_query_reply_invalid');resolve(result);}catch{reject(Error('bot_query_reply_invalid'));}
  });
  child.stdin.end(JSON.stringify({bot:query.bot,command:query.command,key}));
 });
}
async function imageBytes(path:string):Promise<Uint8Array>{
 const base=await realpath(join(root,'responses')),target=await realpath(resolve(root,path));
 if(!target.startsWith(base+sep)||!(await stat(target)).isFile())throw Error('bot_query_path_invalid');
 if((await stat(target)).size>20_000_000)throw Error('bot_query_size_limit');
 return readFile(target);
}
const normalize=(s:string)=>s.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9]/g,'');
// BoPT sends the same ranked volumes as text and as an image. Complete text
// is the evidence for named institution queries. They never invoke image OCR.
export function completeInstitutionalText(doc:Document):boolean {
 const data=doc.market_data;if(data?.kind!=='institutional'||!data.broker)return false;
 const rows=data.rows??[];if(rows.length!==20)return false;
 for(const side of ['buy','sell'] as const){
  const group=rows.filter(r=>r.side===side);
  if(group.length!==10||new Set(group.map(r=>r.symbol)).size!==10||group.some((r,i)=>r.rank!==i+1))return false;
 }
 return ['Toplam İşlem','Alış Hacmi','Satış Hacmi','Net Hacim'].every(label=>new RegExp(label+':\\s*\\d+(?:,\\d+)? (?:milyon|milyar) TL','iu').test(doc.body));
}
function validateMarket(query:BotQuery,market:Document[]) {
 if(!market.length||market.some(d=>d.market_data!.kind!==query.kind))throw Error('bot_query_reply_invalid');
 if(query.ticker&&market.some(d=>d.market_data!.ticker!==query.ticker))throw Error('bot_query_ticker_mismatch');
 if(query.broker){
  const wanted=normalize(query.broker),aliases=['bofa','bankofamerica'];
  if(market.some(d=>{const actual=normalize(d.market_data!.broker??'');return !actual||!(actual.includes(wanted)||(aliases.includes(wanted)&&aliases.includes(actual)));}))throw Error('bot_query_broker_mismatch');
 }
}
export async function botDocuments(text:string,key:string,submittedAt?:number,fetchReply=fetchBotReply,extract=readImage,loadImage=imageBytes):Promise<Document[]>{
 const query=botQuery(text);if(!/^[0-9]{1,20}$/.test(key)||!query)throw Error('bot_query_invalid');
 const result=await fetchReply(query,key),docs:Document[]=[];
 if(result.bot!==query.bot||result.command!==query.command)throw Error('bot_query_reply_invalid');
 const base={source_id:'manual-input',source_name:'@'+query.bot,family:'telegram-'+query.bot,official:false,url:'https://t.me/'+query.bot+'#endeks-query-'+key,published_at:null,language:'tr'};
 if(query.kind==='movers'){if(!Array.isArray(result.message_ids)||result.message_ids.length!==1||!Number.isSafeInteger(result.message_ids[0])||result.message_ids[0]<=0)throw Error('bot_query_reply_invalid');const data=parseMovers(result.text,result.received_at);return [{...base,title:'Piyasa yükselen ve düşenler',body:result.text,passages:[{id:'bot_reply',text:result.text}],equity_codes:[...data.up,...data.down].map(r=>r.symbol),market_movers:data}];}
 if(result.text.trim())docs.push(withMarketText({...base,title:result.text.split('\n')[0].slice(0,180),body:result.text,passages:[{id:'bot_reply',text:result.text}]}));
 if(query.kind==='institutional'){
  if(docs.length!==1||!completeInstitutionalText(docs[0]))throw Error('bot_query_text_incomplete');
  validateMarket(query,docs);
 }
 for(const path of query.kind==='institutional'?[]:result.images){
  const bytes=await loadImage(path);let evidence:ImageEvidence;
  try{evidence=await extract(bytes);}catch(e){if(e instanceof Error&&e.message.startsWith('image_'))throw Error('bot_query_image_unreadable');throw e;}
  docs.push({...base,...evidence,title:evidence.market_data?.broker?evidence.market_data.broker+' kurum analizi':evidence.market_data?.ticker?evidence.market_data.ticker+' '+query.kind:'Kurum verileri',equity_codes:evidence.market_data?.tickers??(evidence.market_data?.ticker?[evidence.market_data.ticker]:[])});
 }
 const market=docs.filter(d=>d.market_data);
 validateMarket(query,market);
 const sourceText=docs.flatMap(d=>[d.body,...d.passages.map(p=>p.text)]).join('\n');
 return docs.map(d=>withMarketTiming(d,submittedAt,sourceText));
}
