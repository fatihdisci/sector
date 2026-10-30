"""Budgeted Responses adapter; disabled until explicitly configured and selected."""
from dataclasses import dataclass
import hashlib,json,math,re,sqlite3,time,os
from usage_metrics import provider_usage,usage_metrics
from hermes_job import decode,run_checked_job
STAGES={'generate','audit','repair','vision','vision_audit','vision_repair'}
@dataclass(frozen=True)
class ApiConfig:
 shared_budget:dict|None=None
 enabled:bool=False
 budget_authorized:bool=False
 rate_table_model:str|None=None
 rate_table_valid_from:float|None=None
 rate_table_expires_at:float|None=None
 rate_table_source:str|None=None
 context_window_tokens:int|None=None
 model:str|None=None
 reasoning_effort:str|None=None
 approved_models:tuple=()
 hard_limit_micro_usd:int|None=None
 window_id:str|None=None
 expires_at:float|None=None
 input_token_ceiling:int|None=None
 max_output_tokens:int|None=None
 input_micro_usd_per_million:int|None=None
 cached_micro_usd_per_million:int|None=None
 output_micro_usd_per_million:int|None=None

def positive(v):return type(v)is int and v>0

def validate_config(c,now):
 if c.enabled is not True:raise RuntimeError('api_disabled')
 if c.budget_authorized is not True:raise RuntimeError('api_budget_not_authorized')
 if c.reasoning_effort not in('low','medium'):raise RuntimeError('api_reasoning_effort_not_approved')
 if not c.model or not re.fullmatch(r'[a-z0-9][a-z0-9._-]{1,80}',c.model)or c.model not in c.approved_models or c.model=='gpt-6-luna':raise RuntimeError('api_model_not_explicitly_approved')
 if not c.window_id or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',c.window_id)or not c.expires_at or not math.isfinite(c.expires_at)or now>=c.expires_at:raise RuntimeError('api_budget_window_missing_or_expired')
 if not all(positive(v)for v in(c.hard_limit_micro_usd,c.input_token_ceiling,c.max_output_tokens,c.input_micro_usd_per_million,c.cached_micro_usd_per_million,c.output_micro_usd_per_million)):raise RuntimeError('api_budget_or_verified_pricing_missing')
 if c.cached_micro_usd_per_million>c.input_micro_usd_per_million:raise RuntimeError('api_pricing_invalid')
 if c.rate_table_model!=c.model or not all(type(v)in(int,float) and math.isfinite(v)for v in(c.rate_table_valid_from,c.rate_table_expires_at))or not c.rate_table_valid_from<=now<c.rate_table_expires_at:raise RuntimeError('api_rate_table_invalid_or_expired')
 if not isinstance(c.rate_table_source,str)or not re.fullmatch(r'https://(?:developers|platform)\.openai\.com/[^\s]+',c.rate_table_source):raise RuntimeError('api_rate_table_source_missing')
 if not positive(c.context_window_tokens)or c.input_token_ceiling+c.max_output_tokens>c.context_window_tokens or c.max_output_tokens<16:raise RuntimeError('api_context_limit_invalid')

def cost(input_tokens,output_tokens,cached,c):
 # Cached input is a subset of input; reasoning is a subset of output.
 return ((input_tokens-cached)*c.input_micro_usd_per_million+cached*c.cached_micro_usd_per_million+output_tokens*c.output_micro_usd_per_million+999999)//1000000

class LegacyOfflineBudget:
 def __init__(self,path,c):
  self.db=sqlite3.connect(path,timeout=5);
  if str(path)!=':memory:':os.chmod(path,0o600)
  try:self._initialize(c)
  except Exception:self.db.close();raise
 def _initialize(self,c):
  self.db.execute('PRAGMA journal_mode=WAL')
  self.db.executescript('CREATE TABLE IF NOT EXISTS api_jobs(id TEXT PRIMARY KEY,input_hash TEXT,state TEXT);CREATE TABLE IF NOT EXISTS api_windows(id TEXT PRIMARY KEY,limit_micro INTEGER,expires REAL,halted INTEGER DEFAULT 0);CREATE TABLE IF NOT EXISTS api_reservations(id TEXT PRIMARY KEY,window_id TEXT,job_id TEXT,stage TEXT,request_hash TEXT,reserved INTEGER,charged INTEGER,state TEXT);')
  self.db.execute('INSERT OR IGNORE INTO api_windows(id,limit_micro,expires)VALUES(?,?,?)',(c.window_id,c.hard_limit_micro_usd,c.expires_at));self.db.commit()
  if 'terms_hash' not in [r[1]for r in self.db.execute('PRAGMA table_info(api_windows)')]:self.db.execute('ALTER TABLE api_windows ADD COLUMN terms_hash TEXT')
  terms=hashlib.sha256(json.dumps(c.__dict__,sort_keys=True).encode()).hexdigest()
  self.db.execute('UPDATE api_windows SET terms_hash=? WHERE id=? AND terms_hash IS NULL AND NOT EXISTS(SELECT 1 FROM api_reservations WHERE window_id=?)',(terms,c.window_id,c.window_id));self.db.commit()
  if self.db.execute('SELECT terms_hash FROM api_windows WHERE id=?',(c.window_id,)).fetchone()[0]!=terms:raise RuntimeError('api_budget_terms_changed')
  row=self.db.execute('SELECT limit_micro,expires FROM api_windows WHERE id=?',(c.window_id,)).fetchone()
  if row!=(c.hard_limit_micro_usd,c.expires_at):raise RuntimeError('api_budget_terms_changed')
 def begin_job(self,job):
  try:self.db.execute("INSERT INTO api_jobs VALUES(?,?,'started')",(job['id'],job['input_hash']));self.db.commit()
  except sqlite3.IntegrityError:raise RuntimeError('api_job_already_started_no_replay')
 def finish_job(self,job):self.db.execute("UPDATE api_jobs SET state='complete' WHERE id=?",(job['id'],));self.db.commit()
 def reserve(self,c,call_id,job_id,stage,request_hash):
  self.db.execute('BEGIN IMMEDIATE')
  try:
   w=self.db.execute('SELECT limit_micro,expires,halted FROM api_windows WHERE id=?',(c.window_id,)).fetchone()
   if not w or w[2]or time.time()>=w[1]:raise RuntimeError('api_budget_halted_or_expired')
   amount=cost(c.input_token_ceiling,c.max_output_tokens,0,c)
   used=self.db.execute('SELECT COALESCE(SUM(COALESCE(charged,reserved)),0)FROM api_reservations WHERE window_id=?',(c.window_id,)).fetchone()[0]
   if used+amount>w[0]:raise RuntimeError('api_budget_reservation_unavailable')
   if self.db.execute("SELECT 1 FROM api_reservations WHERE job_id=? AND stage=? AND state IN ('reserved','usage_missing')",(job_id,stage)).fetchone():raise RuntimeError('api_prior_call_unresolved_no_replay')
   if self.db.execute('SELECT 1 FROM api_reservations WHERE id=?',(call_id,)).fetchone():raise RuntimeError('api_call_already_reserved_no_replay')
   self.db.execute('INSERT INTO api_reservations VALUES(?,?,?,?,?,?,NULL,?)',(call_id,c.window_id,job_id,stage,request_hash,amount,'reserved'));self.db.commit();return amount
  except:self.db.rollback();raise
 def settle(self,call_id,c,response):
  usage=provider_usage(response)['usage'];i=usage['input_tokens'];o=usage['output_tokens'];cached=usage['input_tokens_details']['cached_tokens']
  if any(type(v)is not int or v<0 for v in(i,o)):
   self.db.execute("UPDATE api_reservations SET state='usage_missing' WHERE id=?",(call_id,));self.db.commit();return 'usage_missing_reserved'
  reasoning=usage['output_tokens_details']['reasoning_tokens']
  if reasoning is not None and (type(reasoning)is not int or not 0<=reasoning<=o):
   self.db.execute('UPDATE api_windows SET halted=1 WHERE id=?',(c.window_id,));self.db.commit();raise RuntimeError('api_usage_bound_exceeded_halted')
  cached=0 if cached is None else cached
  if type(cached)is not int or not 0<=cached<=i or i>c.input_token_ceiling or o>c.max_output_tokens:
   self.db.execute('UPDATE api_windows SET halted=1 WHERE id=?',(c.window_id,));self.db.commit();raise RuntimeError('api_usage_bound_exceeded_halted')
  amount=cost(i,o,cached,c);self.db.execute("UPDATE api_reservations SET charged=?,state='settled' WHERE id=? AND state='reserved'",(amount,call_id));self.db.commit();return 'settled'

class Budget(LegacyOfflineBudget):
 def __init__(self,path,c):
  self.shared=None
  if c.shared_budget:
   from shared_api_budget import SharedBudget,require_shared
   s=require_shared(c,path,'text')
   if s.get('mode')=='daily_bot':
    from daily_api_budget import DailyBudget
    self.shared=DailyBudget(path,s)
   else:self.shared=SharedBudget(path,s)
   self.db=self.shared.db
  else:super().__init__(path,c)
 def begin_job(self,job):return self.shared.begin_job(job)if self.shared else super().begin_job(job)
 def finish_job(self,job):return self.shared.finish_job(job)if self.shared else super().finish_job(job)
 def reserve(self,c,call_id,job_id,stage,request_hash):return self.shared.reserve('text:'+call_id,'text',job_id,stage,request_hash)if self.shared else super().reserve(c,call_id,job_id,stage,request_hash)
 def settle(self,call_id,c,response):
  if not self.shared:return super().settle(call_id,c,response)
  self.shared.settle('text:'+call_id,'text',response);return 'settled'

def response_object(response):
 if not isinstance(response,dict):raise RuntimeError('api_invalid_response')
 if response.get('status')!='completed' or response.get('error') or response.get('incomplete_details'):raise RuntimeError('api_response_not_completed')
 parts=[]
 for item in response.get('output',[]):
  if item.get('type')=='reasoning':continue
  if item.get('type')!='message' or item.get('role')!='assistant':raise RuntimeError('api_tool_or_unexpected_output')
  for content in item.get('content',[]):
   if content.get('type')!='output_text' or not isinstance(content.get('text'),str):raise RuntimeError('api_refusal_or_unexpected_output')
   parts.append(content['text'])
 if not parts:raise RuntimeError('api_empty_response')
 return decode(''.join(parts))

def compact_kap_payload(payload):
 """Retain every evidence passage; omit only its identical duplicate body."""
 if not isinstance(payload,dict) or not isinstance(payload.get('documents'),list):return payload
 docs=[]
 for d in payload['documents']:
  passages=d.get('passages') if isinstance(d,dict) else None
  if isinstance(d,dict) and d.get('source_id')=='kap' and d.get('official') is True and re.fullmatch(r'https://www\.kap\.org\.tr/tr/Bildirim/\d+',d.get('url','')) and isinstance(passages,list) and passages and all(isinstance(p,dict) and isinstance(p.get('text'),str) for p in passages) and d.get('body')=='\n\n'.join(p['text'] for p in passages):
   docs.append({**d,'body':passages[0]['text']})
  else:docs.append(d)
 return {**payload,'documents':docs}

class OfflineApiCandidate:
 def __init__(self,config,budget_path,transport=None,telemetry=None):
  # No key/environment lookup and no default HTTP transport. Tests inject fakes.
  self.config=config;self.path=budget_path;self.transport=transport;self.telemetry=telemetry;self.calls={};self.server_model=None
 def call(self,job,instructions,payload):
  c=self.config;validate_config(c,time.time())
  if self.transport is None:raise RuntimeError('api_transport_not_configured_offline_only')
  if type(job.get('deadline'))not in(int,float)or not math.isfinite(job['deadline']):raise RuntimeError('api_job_route_invalid')
  if job.get('provider')!='openai-api' or job.get('model')!=c.model or job.get('effort')!=c.reasoning_effort or job.get('allowed_tools')!=[]or job.get('deadline',0)<=time.time():raise RuntimeError('api_job_route_invalid')
  jid=job.get('id');stage=job.get('metric_stage')
  if not isinstance(jid,str)or not re.fullmatch(r'[a-f0-9-]{36}|[a-f0-9]{64}',jid)or stage not in STAGES:raise RuntimeError('api_job_identity_or_stage_invalid')
  if not re.fullmatch(r'[a-f0-9]{64}',str(job.get('input_hash','')))or not job.get('lease_token'):raise RuntimeError('api_job_lease_missing')
  text=json.dumps(compact_kap_payload(payload),ensure_ascii=False);instructions=str(instructions)
  # This conservative text bound is local-only. Real image activation additionally
  # requires a verified model context ceiling; no image/file/path is read here.
  if len((instructions+text).encode())+1024>c.input_token_ceiling:raise RuntimeError('api_input_bound_exceeded')
  if any(d.get('images')for d in job.get('documents',[])):raise RuntimeError('api_image_context_budget_not_configured')
  request={'model':c.model,'instructions':instructions,'input':[{'role':'user','content':[{'type':'input_text','text':'Return JSON.\n'+text}]}],'reasoning':{'effort':c.reasoning_effort},'max_output_tokens':c.max_output_tokens,'tools':[],'tool_choice':'none','store':False,'background':False,'stream':False,'service_tier':'default','truncation':'disabled','text':{'format':{'type':'json_object'}}}
  key=(jid,stage);attempt=self.calls.get(key,0);call_id=f'{jid}:{stage}:{attempt}';self.calls[key]=attempt+1
  if attempt and not(stage=='audit' and attempt==1):raise RuntimeError('api_stage_call_limit')
  digest=hashlib.sha256(json.dumps(request,sort_keys=True).encode()).hexdigest();budget=Budget(self.path,c)
  try:budget.reserve(c,call_id,jid,stage if not attempt else 'audit_after_repair',digest)
  except Exception:budget.db.close();raise
  started=time.monotonic();response=None;success=False
  try:
   try:response=self.transport(request)
   except Exception as error:
    if isinstance(getattr(error,'response',None),dict):
     response=error.response
     try:budget.settle(call_id,c,response)
     except RuntimeError as settlement:
      # Preserve the original safe transport category; the reservation stays held.
      if str(settlement)!='shared_usage_missing_reserved':raise
    raise
   if budget.settle(call_id,c,response)!='settled':raise RuntimeError('api_usage_missing_reserved_no_retry')
   if time.time()>=job['deadline']:raise RuntimeError('api_job_expired_no_retry')
   if isinstance(response,dict)and response.get('model')!=c.model:raise RuntimeError('api_server_model_unapproved')
   result=response_object(response);self.server_model=response['model'];success=True;return result
  finally:
   if self.telemetry:
    row=usage_metrics(provider_usage(response),job_id=jid,stage=stage,model=c.model,started_at=started,outcome='ok'if success else'error');row['provider']='openai-api'
    try:self.telemetry(row)
    except Exception:pass
   budget.db.close()
 def run_job(self,job):
  validate_config(self.config,time.time())
  if type(job.get('deadline'))not in(int,float)or not math.isfinite(job['deadline']):raise RuntimeError('api_job_route_invalid')
  if job.get('provider')!='openai-api' or job.get('model')!=self.config.model or job.get('effort')!=self.config.reasoning_effort or job.get('allowed_tools')!=[]or job.get('deadline',0)<=time.time():raise RuntimeError('api_job_route_invalid')
  if not isinstance(job.get('id'),str)or not re.fullmatch(r'[a-f0-9-]{36}|[a-f0-9]{64}',job['id']):raise RuntimeError('api_job_identity_invalid')
  if not job.get('lease_token')or not re.fullmatch(r'[a-f0-9]{64}',str(job.get('input_hash',''))):raise RuntimeError('api_job_lease_missing')
  budget=Budget(self.path,self.config)
  try:
   budget.begin_job(job);result=run_checked_job(job,self.call);result['runtime']['server_model']=self.server_model;budget.finish_job(job);return result
  finally:budget.db.close()

class JsonlTelemetry:
 """Explicit local sink. Whitelist only IDs, provider/stage and numeric usage."""
 def __init__(self,path,approved_models=()):self.path=path;self.models=approved_models
 def __call__(self,row):
  import datetime,pathlib,stat
  path=pathlib.Path(self.path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  allowed=('job_id','stage','model','provider','outcome','duration_ms','input_tokens','output_tokens','cached_tokens','reasoning_tokens')
  safe={k:row.get(k)for k in allowed}
  if not isinstance(safe['job_id'],str)or not re.fullmatch(r'[a-f0-9-]{36}|[a-f0-9]{64}',safe['job_id']):safe['job_id']=None
  if safe['stage']not in STAGES:safe['stage']=None
  if safe['model']not in self.models:safe['model']=None
  if safe['provider']!='openai-api':safe['provider']=None
  if safe['outcome']not in('ok','error'):safe['outcome']=None
  for key in('duration_ms','input_tokens','output_tokens','cached_tokens','reasoning_tokens'):
   if type(safe[key])is not int or safe[key]<0:safe[key]=None
  safe['timestamp']=datetime.datetime.now(datetime.timezone.utc).isoformat()
  fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_APPEND|getattr(os,'O_NOFOLLOW',0),0o600)
  try:
   if not stat.S_ISREG(os.fstat(fd).st_mode):raise RuntimeError('api_telemetry_not_regular_file')
   os.write(fd,(json.dumps(safe,separators=(',',':'))+'\n').encode())
  finally:os.close(fd)
