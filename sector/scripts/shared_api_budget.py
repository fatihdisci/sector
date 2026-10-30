"""One local ledger for text, vision and image calls. No account/credential lookup.
Promo evidence is an explicit external prerequisite, never a billing guarantee.
"""
import hashlib,json,math,os,pathlib,re,sqlite3,time

def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def integer(x):return type(x)is int and x>=0
def text_profile(c):
 return dict(model=c.model,reasoning_effort=c.reasoning_effort,max_input_tokens=c.input_token_ceiling,max_output_tokens=c.max_output_tokens,input_text_rate=c.input_micro_usd_per_million,input_image_rate=c.input_micro_usd_per_million,cached_text_rate=c.cached_micro_usd_per_million,cached_image_rate=c.cached_micro_usd_per_million,output_rate=c.output_micro_usd_per_million)
def visual_profile(p):return {k:p[k]for k in ('model','max_input_tokens','max_output_tokens','input_text_rate','input_image_rate','cached_text_rate','cached_image_rate','output_rate')}|({'reasoning_effort':p['reasoning_effort']}if'reasoning_effort'in p else{})
def validate_shared(s,path=None,now=None):
 now=time.time()if now is None else now
 if not isinstance(s,dict)or s.get('version')!=1 or s.get('authorized')is not True:raise RuntimeError('shared_budget_not_authorized')
 if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',str(s.get('window_id','')))or not integer(s.get('limit_micro_usd'))or s['limit_micro_usd']<=0:raise RuntimeError('shared_budget_window_invalid')
 if not isinstance(s.get('expires_at'),(int,float))or not math.isfinite(s['expires_at'])or now>=s['expires_at']:raise RuntimeError('shared_budget_expired')
 ledger=s.get('ledger_path')
 if not isinstance(ledger,str)or not pathlib.Path(ledger).is_absolute()or pathlib.Path(ledger).is_symlink()or str(pathlib.Path(ledger).resolve())!=ledger or path is not None and str(pathlib.Path(path).resolve())!=ledger:raise RuntimeError('shared_budget_path_mismatch')
 if s.get('mode')=='daily_bot':
  if s.get('families')!=['text']or s.get('timezone')!='Europe/Istanbul'or s['limit_micro_usd']!=2000000 or s.get('plan_id')is not None or 'promo'in s:raise RuntimeError('daily_budget_terms_invalid')
  consent=s.get('consent',{})
  if consent.get('paid_balance_risk_accepted')is not True or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',str(consent.get('id','')))or type(consent.get('approved_at'))not in(int,float)or not math.isfinite(consent['approved_at'])or consent['approved_at']>now:raise RuntimeError('daily_budget_consent_missing')
 elif 'mode'in s:raise RuntimeError('shared_budget_mode_invalid')
 else:
  e=s.get('promo',{})
  if not all(e.get(k)is True for k in ('verified','promo_only_verified','other_consumption_bounded'))or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',str(e.get('verification_id',''))):raise RuntimeError('promo_evidence_unverified')
  if not all(integer(e.get(k))for k in ('remaining_micro_usd','other_consumption_bound_micro_usd','safety_margin_micro_usd')):raise RuntimeError('promo_balance_unknown')
  if not all(isinstance(e.get(k),(int,float))and math.isfinite(e[k])for k in('observed_at','valid_until','grant_expires_at'))or not e['observed_at']<=now<min(e['valid_until'],e['grant_expires_at'])or e['valid_until']-e['observed_at']>900 or s['expires_at']>min(e['valid_until'],e['grant_expires_at']):raise RuntimeError('promo_evidence_stale_or_expired')
  if s['limit_micro_usd']>e['remaining_micro_usd']-e['other_consumption_bound_micro_usd']-e['safety_margin_micro_usd']:raise RuntimeError('promo_remaining_insufficient')
 families=s.get('families')
 if families is not None and families!=['text']:raise RuntimeError('shared_budget_families_invalid')
 if set(s.get('profiles',{}))!=({'text'}if families==['text']else{'text','vision','image'}):raise RuntimeError('shared_budget_profiles_missing')
 for family,p in s['profiles'].items():
  for k in ('max_input_tokens','max_output_tokens','input_text_rate','input_image_rate','cached_text_rate','cached_image_rate','output_rate'):
   if not integer(p.get(k))or k not in ('cached_text_rate','cached_image_rate')and p[k]==0:raise RuntimeError('shared_budget_profile_invalid')
  if not isinstance(p.get('model'),str)or family in('text','vision')and p.get('reasoning_effort')!='medium':raise RuntimeError('shared_budget_profile_not_approved')
 return s

def require_shared(c,path,family):
 s=c.get('shared_budget')if isinstance(c,dict)else c.shared_budget
 validate_shared(s,path)
 window=c['window_id']if isinstance(c,dict)else c.window_id;limit=c['budget_micro_usd']if isinstance(c,dict)else c.hard_limit_micro_usd;expires=c['expires_at']if isinstance(c,dict)else c.expires_at
 if (window,limit,expires)!=(s['window_id'],s['limit_micro_usd'],s['expires_at']):raise RuntimeError('shared_budget_terms_mismatch')
 for f in (('vision','image')if family=='visual'else('text',)):
  profile=visual_profile(c[f])if family=='visual'else text_profile(c)
  if profile!=s['profiles'][f]:raise RuntimeError('shared_budget_profile_mismatch')
 return s

class SharedBudget:
 def __init__(self,path,s):
  validate_shared(s,path);self.s=s;self.plan_id=s.get('plan_id');self.db=sqlite3.connect(path,timeout=10);os.chmod(path,0o600)
  try:
   self.db.execute('PRAGMA journal_mode=WAL');self.db.executescript("CREATE TABLE IF NOT EXISTS shared_windows(id TEXT PRIMARY KEY,terms TEXT,halted INTEGER DEFAULT 0);CREATE TABLE IF NOT EXISTS shared_calls(id TEXT PRIMARY KEY,window_id TEXT,family TEXT,job_id TEXT,stage TEXT,request_hash TEXT,reserved INTEGER,charged INTEGER,state TEXT,plan_id TEXT);CREATE TABLE IF NOT EXISTS shared_jobs(id TEXT PRIMARY KEY,input_hash TEXT,state TEXT);CREATE TABLE IF NOT EXISTS shared_results(id TEXT PRIMARY KEY,value TEXT);")
   terms=digest({k:v for k,v in s.items()if k!='plan_id'});self.db.execute('BEGIN IMMEDIATE')
   if self.db.execute('SELECT 1 FROM shared_windows WHERE id!=?',(s['window_id'],)).fetchone():raise RuntimeError('shared_budget_window_replacement_forbidden')
   self.db.execute('INSERT OR IGNORE INTO shared_windows(id,terms)VALUES(?,?)',(s['window_id'],terms))
   if self.db.execute('SELECT terms FROM shared_windows WHERE id=?',(s['window_id'],)).fetchone()[0]!=terms:raise RuntimeError('shared_budget_terms_changed')
   self.db.commit()
  except Exception:self.db.rollback();self.db.close();raise
 def amount(self,family):
  p=self.s['profiles'][family];return (p['max_input_tokens']*max(p['input_text_rate'],p['input_image_rate'])+p['max_output_tokens']*p['output_rate']+999999)//1000000
 def used(self):return self.db.execute('SELECT COALESCE(SUM(COALESCE(charged,reserved)),0)FROM shared_calls WHERE window_id=?',(self.s['window_id'],)).fetchone()[0]
 def check(self):
  validate_shared(self.s)
  if self.db.execute('SELECT halted FROM shared_windows WHERE id=?',(self.s['window_id'],)).fetchone()[0]:raise RuntimeError('shared_budget_halted')
 def reserve_plan(self,plan_id,families):
  if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',plan_id)or not families or any(f not in self.s['profiles']for f in families):raise RuntimeError('shared_plan_invalid')
  self.db.execute('BEGIN IMMEDIATE')
  try:
   self.check()
   if self.db.execute('SELECT 1 FROM shared_calls WHERE plan_id=?',(plan_id,)).fetchone():raise RuntimeError('shared_plan_no_replay')
   if self.used()+sum(self.amount(f)for f in families)>self.s['limit_micro_usd']:raise RuntimeError('shared_budget_exhausted')
   for i,f in enumerate(families):self.db.execute("INSERT INTO shared_calls VALUES(?,?,?,NULL,NULL,NULL,?,NULL,'planned',?)",('plan:'+plan_id+':'+str(i),self.s['window_id'],f,self.amount(f),plan_id))
   self.db.commit()
  except Exception:self.db.rollback();raise
 def reserve(self,id,family,job_id='',stage='',request_hash=''):
  self.db.execute('BEGIN IMMEDIATE')
  try:
   self.check()
   if self.db.execute('SELECT 1 FROM shared_calls WHERE id=?',(id,)).fetchone():raise RuntimeError('shared_call_no_replay')
   if self.plan_id:
    slot=self.db.execute("SELECT id FROM shared_calls WHERE plan_id=? AND family=? AND state='planned' ORDER BY id LIMIT 1",(self.plan_id,family)).fetchone()
    if not slot:raise RuntimeError('shared_plan_capacity_exhausted')
    self.db.execute("UPDATE shared_calls SET id=?,job_id=?,stage=?,request_hash=?,state='reserved' WHERE id=?",(id,job_id,stage,request_hash,slot[0]))
   else:
    if self.used()+self.amount(family)>self.s['limit_micro_usd']:raise RuntimeError('shared_budget_exhausted')
    self.db.execute("INSERT INTO shared_calls VALUES(?,?,?,?,?,?,?,NULL,'reserved',NULL)",(id,self.s['window_id'],family,job_id,stage,request_hash,self.amount(family)))
   self.db.commit();return self.amount(family)
  except Exception:self.db.rollback();raise
 def settle(self,id,family,response):
  self.check();u=response.get('usage')if isinstance(response,dict)else None;p=self.s['profiles'][family]
  if not isinstance(u,dict)or not all(integer(u.get(k))for k in('input_tokens','output_tokens')):
   self.db.execute("UPDATE shared_calls SET state='usage_missing' WHERE id=? AND state='reserved'",(id,));self.db.commit();raise RuntimeError('shared_usage_missing_reserved')
  i,o=u['input_tokens'],u['output_tokens'];d=u.get('input_tokens_details')or{};cached=d.get('cached_tokens',0);reasoning=(u.get('output_tokens_details')or{}).get('reasoning_tokens',0)
  if i>p['max_input_tokens']or o>p['max_output_tokens']or not integer(cached)or cached>i or not integer(reasoning)or reasoning>o:
   self.db.execute('UPDATE shared_windows SET halted=1 WHERE id=?',(self.s['window_id'],));self.db.commit();raise RuntimeError('shared_usage_bound_exceeded_halted')
  if family=='image':
   it,ii=d.get('text_tokens'),d.get('image_tokens')
   if not integer(it)or not integer(ii)or it+ii!=i:raise RuntimeError('shared_image_usage_missing_reserved')
   cost=it*p['input_text_rate']+ii*p['input_image_rate']+o*p['output_rate']
  else:cost=(i-cached)*max(p['input_text_rate'],p['input_image_rate'])+cached*max(p['cached_text_rate'],p['cached_image_rate'])+o*p['output_rate']
  amount=(cost+999999)//1000000
  result=self.db.execute("UPDATE shared_calls SET charged=?,state='settled' WHERE id=? AND family=? AND state='reserved'",(amount,id,family))
  self.db.commit()
  if result.rowcount!=1:raise RuntimeError('shared_settlement_no_replay')
  return u
 def begin_job(self,job):
  try:self.db.execute("INSERT INTO shared_jobs VALUES(?,?,'started')",(job['id'],job['input_hash']));self.db.commit()
  except sqlite3.IntegrityError:raise RuntimeError('shared_job_no_replay')
 def finish_job(self,job):self.db.execute("UPDATE shared_jobs SET state='complete'WHERE id=?",(job['id'],));self.db.commit()
 def cached(self,id):
  r=self.db.execute('SELECT value FROM shared_results WHERE id=?',(id,)).fetchone();return json.loads(r[0])if r else None
 def save(self,id,value):self.db.execute('INSERT OR IGNORE INTO shared_results VALUES(?,?)',(id,json.dumps(value,ensure_ascii=False)));self.db.commit()
 def close_unused_plan(self):
  # Explicit success-only cleanup; uncertain calls are never released.
  if self.plan_id:self.db.execute("UPDATE shared_calls SET charged=0,state='unused'WHERE plan_id=? AND state='planned'",(self.plan_id,));self.db.commit()
