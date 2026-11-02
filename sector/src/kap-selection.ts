import {telegram} from './telegram';import type {Env} from './types';
async function record(env:Env,context:Record<string,unknown>){
 const value=JSON.stringify({update_id:env.TELEGRAM_UPDATE_ID,at:Date.now(),...context}),failed=!['selected','already_selected'].includes(String(context.outcome))||context.acknowledgement==='failed';
 for(const key of ['kap_prepare_last_result',...(failed?['kap_prepare_last_failure']:[])])await env.DB.prepare('INSERT INTO system_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value).run().catch(()=>{});
}
export async function rejectKapPrepareOwner(env:Env,id:string,messageId:number,ownerMatches:boolean,chatMatches:boolean,privateChat:boolean){await record(env,{preview_id:id,requested_message:messageId,outcome:'owner_or_chat_mismatch',owner_matches:ownerMatches,chat_matches:chatMatches,private_chat:privateChat});}
export async function prepareKapPreview(env:Env,id:string,messageId:number,callbackId:string){
 let outcome='storage_failed',text='Hazırlama isteğinin durumu doğrulanamadı. Aynı düğmeyle kontrol edebilirsin.',context:Record<string,unknown>={preview_id:id,requested_message:messageId};
 try{
  const changed=await env.DB.prepare("UPDATE kap_previews SET state='selected',selected_at=? WHERE id=? AND message_id=? AND state='sent'").bind(Date.now(),id,messageId).run();
  context={...context,selection_changed:!!changed.meta.changes};
  const prior=await env.DB.prepare('SELECT queue_id,state,message_id FROM kap_previews WHERE id=?').bind(id).first<{queue_id:string;state:string;message_id:number}>();
  context={...context,queue_id:prior?.queue_id??null,actual_message:prior?.message_id??null,preview_state:prior?.state??null};
  outcome=changed.meta.changes?'selected':!prior?'preview_missing':prior.message_id!==messageId?'message_mismatch':prior.state==='selected'?'already_selected':prior.state==='uncertain'||prior.state==='sending'?'delivery_uncertain':'state_unavailable';
  text=outcome==='selected'?'Hazırlama isteği alındı.':outcome==='already_selected'?'Hazırlama isteğin zaten kayıtlı; tekrar iş oluşturulmadı.':outcome==='delivery_uncertain'?'Önizleme teslimi doğrulanamadı; tekrar içerik oluşturulmadı.':'Bu düğme güncel önizlemeyle eşleşmiyor. Güncel kartı kullan.';
 }catch{
  await record(env,{...context,outcome});
  await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:callbackId,text,show_alert:'true'})).catch(()=>{});
  throw Error('kap_prepare_storage_failed');
 }
 await record(env,{...context,outcome});
 try{await telegram(env,'answerCallbackQuery',new URLSearchParams({callback_query_id:callbackId,text,show_alert:String(!['selected','already_selected'].includes(outcome))}));}
 catch{await record(env,{...context,outcome,acknowledgement:'failed'});}
}
