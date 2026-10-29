import {OUTPUT_LIMIT_MESSAGE,outputPreferences} from './output-preferences';
import {splitManualText} from './manual-instructions';
import {botQuery,BOT_QUERY_HELP} from './bot-query';
import {ensureManualStatus} from './manual-status';
import {isOwner,telegram} from './telegram';
import {marketInput,marketSelection} from './market-input';
import type {Env} from './types';
export interface InputMessage {media_group_id?:string;message_id:number;date?:number;text?:string;caption?:string;photo?:{file_id:string;file_size?:number;width:number;height:number}[];document?:{file_id:string;file_size?:number;file_name?:string;mime_type?:string};forward_origin?:{type:string;sender_user?:{is_bot?:boolean;username?:string}};from?:{id:number};chat?:{id:number;type:string};reply_to_message?:InputMessage;}
export async function queueManual(env:Env,updateId:number,m:InputMessage):Promise<boolean> {
 if(!m.from||!m.chat||!isOwner(env,String(m.from.id),String(m.chat.id),m.chat.type)||!Number.isSafeInteger(m.message_id)||!Number.isSafeInteger(updateId))return false;
 let text=(m.text??m.caption??'').trim();const focus=marketSelection(text);
 if(/^\/(devrekesici|genelgerial[ıi]m|gerial[ıi]m)(?:@[a-zA-Z0-9_]+)?(?:\s+.+)?$/iu.test(text)&&!m.forward_origin){
  let preferences;try{preferences=outputPreferences(text);}catch(e){if(!(e instanceof Error)||e.message!=='unsupported_output_limit')throw e;if(env.MODE==='telegram_review')await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:OUTPUT_LIMIT_MESSAGE}));return true;}
  const input=JSON.stringify({report:text.toLocaleLowerCase('tr-TR').startsWith('/devre')?'circuit':text.toLocaleLowerCase('tr-TR').startsWith('/genel')?'general_buyback':'buyback',at:(m.date??Math.floor(Date.now()/1000))*1000,text:'',preferences});
  const r=await env.DB.prepare('INSERT OR IGNORE INTO manual_requests(update_id,message_id,kind,input,created_at) VALUES(?,?,?,?,?)').bind(updateId,m.message_id,'kap_report',input,Math.floor(Date.now()/1000)).run();
  if(r.meta.changes)await ensureManualStatus(env,updateId,m.message_id,'Komut saatine kadar kaydedilmiş KAP bildirimlerini sayıp raporunu hazırlıyorum.');
  return true;
 }

 if(text==='/sorgular'||/^\/(?:kurum|akd|takas|piyasayd)(?:@[a-zA-Z0-9_]+)?(?:\s|$)/iu.test(text)){
  // Forwarded commands are source material, never authority to query a bot.
  if(m.forward_origin)return false;
  let query;try{query=botQuery(splitManualText(text).text);}catch{}
  if(!query){if(env.MODE==='telegram_review')await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:BOT_QUERY_HELP}));return true;}
  const input=JSON.stringify({text:splitManualText(text).text,...(splitManualText(text).editor_request?{editor_request:splitManualText(text).editor_request}:{}),query_key:String(updateId),submitted_at:m.date??Math.floor(Date.now()/1000)});
  const inserted=await env.DB.prepare('INSERT OR IGNORE INTO manual_requests(update_id,message_id,kind,input,created_at) VALUES(?,?,?,?,?)').bind(updateId,m.message_id,'bot_query',input,Math.floor(Date.now()/1000)).run();
  if(inserted.meta.changes)await ensureManualStatus(env,updateId,m.message_id,'Sorgunu aldım. İlgili bottan verileri alıp tweet ve görselini hazırlıyorum. Sonuç bu mesajda görünecek.');
  return true;
 }
 const ownerInstruction=!m.forward_origin?splitManualText(text).editor_request:'';
 const reply=focus||ownerInstruction?m.reply_to_message:undefined;
 const draft=reply?await env.DB.prepare('SELECT id,documents FROM drafts WHERE message_id=?').bind(reply.message_id).first<{id:string;documents:string}>():null;
 const reuse=draft&&(ownerInstruction||JSON.parse(draft.documents).some((d:{market_data?:unknown;body?:string})=>d.market_data||marketInput(d.body??'')))?draft:null;
 let sourceMessageId=reply?.message_id;
 if(reuse)try{
  const original=JSON.parse(reuse.documents)[0],start=new URL(original.url).searchParams.get('start')?.match(/^source_(\d+)$/);
  if(start){const id=Number(start[1]),row=await env.DB.prepare('SELECT input FROM manual_requests WHERE message_id=?').bind(id).first<{input:string}>();const target=row?JSON.parse(row.input).source_message_id??id:id;if(Number.isSafeInteger(target)&&target>0)sourceMessageId=target;}
 }catch{}
 const source=reply&&!reuse?reply:m;
 if(reply&&!reuse)text=(reply.text??reply.caption??'').trim();
 if(text.startsWith('/start')||text==='/help'){
  if(env.MODE!=='telegram_review')return true;
  const source=text.match(/^\/start source_(\d+)$/);
  if(source){const id=Number(source[1]),row=await env.DB.prepare('SELECT message_id,input FROM manual_requests WHERE message_id=?').bind(id).first<{message_id:number;input:string}>();
   if(row){const target=JSON.parse(row.input).source_message_id??id;if(!Number.isSafeInteger(target)||target<=0)throw Error('manual_source_invalid');await telegram(env,'copyMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,from_chat_id:env.TELEGRAM_CHAT_ID!,message_id:String(target)}));}
  }else await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:'Haber veya KAP bağlantısını, PDF dosyasını, metni ya da görseli buraya gönder. Günlük KAP raporları: /devrekesici ve /gerialım. Otomatik bot sorgularını görmek için /sorgular yaz. Diğer botun /kurum, /akd ve /takas yanıtlarını da iletebilirsin. BoPT kurum analizini de iletebilirsin. Kaynak mesaja veya oluşan karta “Sadece alınanlar” / “Sadece satılanlar” diye yanıt vererek ayrı içerik isteyebilirsin. Kaynağı okuyup ENDEKS HABER tarzında tweet ve kart hazırlayacağım. Veri tarihini tahmin etmem; okunamayan sayıdan içerik üretmem.'}));
  return true;
 }
 if(focus&&!reply&&!m.photo?.length&&!m.document&&!/https:\/\//.test(text)&&text.length<240){
  if(env.MODE==='telegram_review')await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:'İlgili kaynak mesaja veya hazırlanmış karta yanıt vererek “Sadece alınanlar”, “Sadece satılanlar” ya da “İkisini de göster” yaz. Böylece doğru analizi ayıracağım.'}));
  return true;
 }
 const ownerTextOriginal=source.forward_origin?'':(source.text??source.caption??'');
 const separated=splitManualText(text,!!source.forward_origin);
 let editorRequest=reply&&ownerInstruction?ownerInstruction:separated.editor_request;
 text=separated.text;
 const url=text.match(/https:\/\/[^\s<>]+/)?.[0]?.replace(/[),.;]+$/,'');
 const photo=Array.isArray(source.photo)?source.photo.filter(p=>p&&typeof p.file_id==='string'&&Number.isSafeInteger(p.width)&&p.width>0&&Number.isSafeInteger(p.height)&&p.height>0).sort((a,b)=>b.width*b.height-a.width*a.height)[0]:undefined;
 const imageDocument=source.document&&(/^image\/(?:jpeg|png|webp)$/.test(source.document.mime_type??'')||/\.(?:jpe?g|png|webp)$/i.test(source.document.file_name??''))?source.document:undefined;
 const image=photo??imageDocument;
 if((image||source.document)&&!source.forward_origin&&!editorRequest&&text&&!marketInput(text)&&/tweet|görsel|başlık|içerik|sadece|yalnızca/iu.test(text)){editorRequest=text;text='';}
 const kind=reuse?(ownerInstruction?'source_reuse':'market_reuse'):image?'image':source.document?'pdf':marketInput(text)?'text':url?'url':text.length>=20&&!text.startsWith('/')?'text':null;
 if(!kind){if(text&&!text.startsWith('/')&&env.MODE==='telegram_review')await telegram(env,'sendMessage',new URLSearchParams({chat_id:env.TELEGRAM_CHAT_ID!,text:'İçerik için olayın veya verinin kendisini de gönder. İsteğini ayrı bir satırda Talimat: ile yazabilirsin.'}));return false;}
 const username=source.forward_origin?.type==='user'&&source.forward_origin.sender_user?.is_bot?source.forward_origin.sender_user.username:undefined;
 const input=JSON.stringify({url,text,editor_request:editorRequest,owner_text_original:ownerTextOriginal,owner_message_text:(m.forward_origin?'':m.text??m.caption??''),source_caption_original:(source.text??source.caption??''),...(source.media_group_id?{owner_album:source.media_group_id,received_at_ms:Date.now()}:{}),...(Number.isSafeInteger(source.date)&&source.date!>0?{submitted_at:source.date}:{}),document:source.document??null,image:image??null,...(focus?{focus}:{}),...(reuse?{draft_id:reuse.id}:{}),...(sourceMessageId?{source_message_id:sourceMessageId}:{}),...(username&&/^[a-zA-Z0-9_]{5,32}$/.test(username)?{origin_bot:username}:{})});if(input.length>150_000)throw Error('manual_input_limit');
 const inserted=await env.DB.prepare('INSERT OR IGNORE INTO manual_requests(update_id,message_id,kind,input,created_at) VALUES(?,?,?,?,?)').bind(updateId,m.message_id,kind,input,Math.floor(Date.now()/1000)).run();
 if(inserted.meta.changes)await ensureManualStatus(env,updateId,m.message_id);
 return true;
}
