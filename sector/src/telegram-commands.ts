import {botWorkflow} from './bot-workflow';
import {telegram} from './telegram';
import type {Env} from './types';

/** Telegram slash-menu entries for commands handled by the owner bot. */
export const TELEGRAM_COMMANDS = [
 {command:'start',description:'Botu kullanmaya başla'},
 {command:'help',description:'Yardım ve kullanım bilgisi'},
 {command:'devrekesici',description:'Günün devre kesici raporu'},
 {command:'gerialim',description:'Günün ilk 10 pay geri alımı'},
 {command:'genelgerialim',description:'Tüm pay geri alımlarını tablo yap'},
 {command:'kurum',description:'Kurum özeti veya kurum adıyla analiz'},
 {command:'akd',description:'Hisse aracı kurum dağılımı: /akd ASELS'},
 {command:'takas',description:'Hisse takas dağılımı: /takas THYAO'},
 {command:'piyasayd',description:'En çok yükselen ve düşen hisseler'},
 {command:'sorgular',description:'Kurum, AKD ve takas komutlarını açıkla'},
 {command:'yayinlar',description:'Yayın sayacı, bütçe ve son paylaşım'},
 {command:'durum',description:'Kaynak, üretim ve teslimat durumu'},
 {command:'secki',description:'Acil olmayan haber seçkisi'},
 {command:'arsiv',description:'Yedi günlük RSS metaverisinde ara'},
 {command:'haberfiltre',description:'Gölge filtre ayarlarını ve rotaları göster'},
 {command:'golgerapor',description:'Filtre karşılaştırma ve inceleme özeti'},
] as const;

export function telegramCommands(env:Env){return botWorkflow(env)==='news_only'?[...TELEGRAM_COMMANDS.filter(c=>!['kurum','akd','takas','piyasayd','sorgular'].includes(c.command)),{command:'hazir',description:'Hazır tweet ve PNG paketini onay kartına al'}]:TELEGRAM_COMMANDS;}

export async function registerTelegramCommands(env:Env,fetcher:typeof fetch=fetch):Promise<{count:number}>{
 const commands=telegramCommands(env),scope=JSON.stringify({type:'all_private_chats'});
 for(const language_code of ['', 'tr']){
  await telegram(env,'setMyCommands',new URLSearchParams({commands:JSON.stringify(commands),scope,language_code}),fetcher);
  const saved=await telegram(env,'getMyCommands',new URLSearchParams({scope,language_code}),fetcher);
  if(JSON.stringify(saved)!==JSON.stringify(commands))throw Error('telegram_commands_readback_mismatch');
 }
 return{count:commands.length};
}
