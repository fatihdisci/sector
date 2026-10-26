import{spawn}from'node:child_process';import{homedir}from'node:os';import{join}from'node:path';import type{ChannelTransport}from'../src/telegram-channel';
export const channelTransport:ChannelTransport=(mode,value)=>new Promise((resolve,reject)=>{
 const root=join(homedir(),'Library/Application Support/sector-haber/telegram-account');
 const child=spawn(join(root,'venv/bin/python'),['scripts/telegram_account.py',mode],{stdio:['pipe','pipe','pipe']});let output='',error='',failed=false;
 const timer=setTimeout(()=>{failed=true;child.kill('SIGKILL');},90000);
 child.stdout.on('data',b=>{output+=b.toString();if(output.length>60_000_000){failed=true;child.kill('SIGKILL');}});child.stderr.on('data',b=>{if(error.length<5000)error+=b.toString();});
 child.on('error',()=>{clearTimeout(timer);reject(Error('channel_account_unavailable'));});child.on('close',code=>{clearTimeout(timer);if(code||failed){let reason='channel_read_failed';try{const e=JSON.parse(error);if(/^(?:channel|bot_account|bot_query)_[a-z_]+$/.test(e.error))reason=e.error;}catch{}reject(Error(reason));return;}try{resolve(JSON.parse(output));}catch{reject(Error('channel_reply_invalid'));}});child.stdin.end(JSON.stringify(value));
});
