import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {registerTelegramCommands,TELEGRAM_COMMANDS} from '../src/telegram-commands';
import type {Env} from '../src/types';

test('owner bot registers the active Turkish slash menu for private chats',async()=>{
 let request:RequestInit|undefined;
 const env={TELEGRAM_BOT_TOKEN:'123:fixture',TELEGRAM_VERIFIED_BOT_ID:'123'} as Env;
 await registerTelegramCommands(env,async(_url,init)=>{request=init;return new Response(JSON.stringify({ok:true,result:true}),{status:200});});
 const body=request!.body as URLSearchParams;
 assert.equal(body.get('language_code'),'tr');
 assert.deepEqual(JSON.parse(body.get('scope')!),{type:'all_private_chats'});
 assert.deepEqual(JSON.parse(body.get('commands')!),TELEGRAM_COMMANDS);
 assert(TELEGRAM_COMMANDS.every(c=>c.command.length<=32&&c.description.length<=256));
 assert.deepEqual(TELEGRAM_COMMANDS.map(c=>c.command),['start','help','devrekesici','gerialim','genelgerialim','kurum','akd','takas','piyasayd','sorgular','yayinlar','durum','secki','arsiv','haberfiltre','golgerapor']);
});
