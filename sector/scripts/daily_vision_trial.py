"""Isolated counted vision: shared daily ledger, injected transports, no key lookup."""
import hashlib,json,re
from daily_api_budget import DailyBudget,day_at
from shared_api_budget import integer

def vision_trial(ledger,terms,request,call_id,counter,send,*,counter_free_verified=False):
 if not counter_free_verified:raise RuntimeError('vision_count_pricing_unverified')
 if not re.fullmatch(r'[a-f0-9-]{36}',call_id):raise RuntimeError('vision_call_id_invalid')
 if set(request)!={'model','reasoning','tools','tool_choice','store','max_output_tokens','input'}:raise RuntimeError('vision_request_invalid')
 if request.get('model')!='gpt-6.1-terra' or request.get('reasoning')!={'effort':'medium'} or request.get('tools')!=[] or request.get('tool_choice')!='none' or request.get('store') is not False:raise RuntimeError('vision_request_invalid')
 cap=request.get('max_output_tokens');items=request.get('input');
 if not integer(cap) or not 1<=cap<=4096 or not isinstance(items,list) or len(items)!=1:raise RuntimeError('vision_request_invalid')
 content=items[0].get('content') if isinstance(items[0],dict) else None
 if items[0].get('role')!='user' or not isinstance(content,list) or len(content)!=2:raise RuntimeError('vision_request_invalid')
 t,img=content
 if t.get('type')!='input_text' or not isinstance(t.get('text'),str) or len(t['text'])>8000 or img.get('type')!='input_image' or img.get('detail')!='high' or not re.fullmatch(r'data:image/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}',img.get('image_url','')) or len(img['image_url'])>8_000_000:raise RuntimeError('vision_request_invalid')
 digest=hashlib.sha256(json.dumps(request,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 count=counter(request)
 if hashlib.sha256(json.dumps(request,sort_keys=True,separators=(',',':')).encode()).hexdigest()!=digest:raise RuntimeError('vision_request_changed')
 if not isinstance(count,dict) or not integer(count.get('input_tokens')) or not 1<=count['input_tokens']<=271000:raise RuntimeError('vision_input_count_invalid')
 max_input=count['input_tokens']+1000
 b=DailyBudget(ledger,terms);p=terms['profiles']['text'];db=b.db
 if p['model']!='gpt-6.1-terra' or p['reasoning_effort']!='medium' or p['input_text_rate']!=p['input_image_rate'] or p['cached_text_rate']!=p['cached_image_rate']:db.close();raise RuntimeError('vision_rate_unverified')
 db.execute('CREATE TABLE IF NOT EXISTS daily_vision_bounds(id TEXT PRIMARY KEY,input_limit INTEGER,output_limit INTEGER,request_hash TEXT)')
 amount=(max_input*p['input_text_rate']+cap*p['output_rate']+999999)//1000000;day=day_at();db.execute('BEGIN IMMEDIATE')
 try:
  b.check()
  if db.execute('SELECT 1 FROM shared_calls WHERE id=?',(call_id,)).fetchone():raise RuntimeError('shared_call_no_replay')
  if b.used(day)+amount>terms['limit_micro_usd']:raise RuntimeError('shared_budget_exhausted')
  db.execute("INSERT INTO shared_calls VALUES(?,?,? ,?,?,?, ?,NULL,'reserved',NULL)",(call_id,terms['window_id'],'vision',call_id,'vision',digest,amount));db.execute('INSERT INTO daily_calls VALUES(?,?,NULL)',(call_id,day));db.execute('INSERT INTO daily_vision_bounds VALUES(?,?,?,?)',(call_id,max_input,cap,digest))
  if day_at()!=day:raise RuntimeError('daily_budget_day_changed')
  db.commit()
 except Exception:db.rollback();db.close();raise
 try:response=send(request)
 except Exception:db.close();raise RuntimeError('vision_result_uncertain_no_retry') from None
 db.execute('BEGIN IMMEDIATE')
 try:
  b.check();u=response.get('usage') if isinstance(response,dict) else None
  if not isinstance(u,dict) or not all(integer(u.get(k)) for k in ('input_tokens','output_tokens')):
   db.execute("UPDATE shared_calls SET state='usage_missing' WHERE id=?",(call_id,));db.commit();raise RuntimeError('vision_usage_missing_reserved')
  i,o=u['input_tokens'],u['output_tokens'];it=u.get('input_tokens_details') or {};ot=u.get('output_tokens_details') or {};cached=it.get('cached_tokens',0);reason=ot.get('reasoning_tokens',0)
  if not integer(cached) or cached>i or not integer(reason) or reason>o or i>max_input or o>cap:
   db.execute('UPDATE shared_windows SET halted=1 WHERE id=?',(terms['window_id'],));db.commit();raise RuntimeError('vision_usage_bound_exceeded_halted')
  charge=((i-cached)*p['input_text_rate']+cached*p['cached_text_rate']+o*p['output_rate']+999999)//1000000
  if charge>amount:db.execute('UPDATE shared_windows SET halted=1 WHERE id=?',(terms['window_id'],));db.commit();raise RuntimeError('vision_usage_bound_exceeded_halted')
  db.execute("UPDATE shared_calls SET charged=?,state='settled' WHERE id=? AND state='reserved'",(charge,call_id));db.execute('UPDATE daily_calls SET settled_day=? WHERE id=?',(day_at(),call_id));db.commit()
  if response.get('model')!='gpt-6.1-terra':raise RuntimeError('vision_model_mismatch_no_retry')
  return {'response':response,'reserved_micro_usd':amount,'charged_micro_usd':charge,'input_limit':max_input}
 except Exception:db.rollback();raise
 finally:db.close()
