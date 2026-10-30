"""Explicit paid-risk text-only allowance; calendar days in Europe/Istanbul.

Unknown calls remain held on every following day until resolved. A request which
finishes after midnight counts on both its starting and completion days. This
deliberate overcount keeps concurrent work safe across the boundary.
"""
import datetime,re,time
from zoneinfo import ZoneInfo
from shared_api_budget import SharedBudget,integer,validate_shared,digest
import sqlite3,json

def extend_policy_expiry(path,old,new):
 """Explicit maintenance migration, retaining every call and immutable daily cap.

 Only the policy expiry may move, at most one year from the same owner consent.
 Model/rates/profiles/initial exposure/ledger identity cannot change here.
 """
 validate_shared(old,path);validate_shared(new,path)
 if old.get('mode')!='daily_bot'or {k:v for k,v in old.items()if k!='expires_at'}!={k:v for k,v in new.items()if k!='expires_at'}or not old['expires_at']<new['expires_at']<=old['consent']['approved_at']+366*86400:raise RuntimeError('daily_expiry_extension_invalid')
 db=sqlite3.connect(path,timeout=10)
 try:
  db.execute('BEGIN IMMEDIATE')
  if db.execute("SELECT 1 FROM shared_calls WHERE state='reserved' LIMIT 1").fetchone():raise RuntimeError('daily_expiry_extension_in_flight')
  terms=digest({k:v for k,v in old.items()if k!='plan_id'});next_terms=digest({k:v for k,v in new.items()if k!='plan_id'})
  if db.execute('SELECT terms FROM shared_windows WHERE id=?',(old['window_id'],)).fetchone()!=(terms,):raise RuntimeError('daily_expiry_extension_parent_mismatch')
  db.execute('CREATE TABLE IF NOT EXISTS daily_expiry_audit(old_terms TEXT PRIMARY KEY,new_terms TEXT,at REAL,old_expiry REAL,new_expiry REAL)')
  db.execute('INSERT INTO daily_expiry_audit VALUES(?,?,?,?,?)',(terms,next_terms,time.time(),old['expires_at'],new['expires_at']))
  db.execute('UPDATE shared_windows SET terms=? WHERE id=?',(next_terms,old['window_id']));db.commit()
 except Exception:db.rollback();raise
 finally:db.close()

def increase_daily_limit(path,old,new):
 """Explicit 2→3 USD migration; never resets or rewrites calls/reservations."""
 validate_shared(old,path);validate_shared(new,path)
 if old.get('mode')!='daily_bot' or old.get('limit_micro_usd')!=2000000 or new.get('limit_micro_usd')!=3000000 or {k:v for k,v in old.items() if k not in ('limit_micro_usd','consent')}!={k:v for k,v in new.items() if k not in ('limit_micro_usd','consent')}:raise RuntimeError('daily_limit_migration_invalid')
 a,b=old['consent'],new['consent']
 if b.get('paid_balance_risk_accepted') is not True or b.get('approved_at',0)<a['approved_at'] or b.get('id')==a['id']:raise RuntimeError('daily_limit_consent_invalid')
 db=sqlite3.connect(path,timeout=10)
 try:
  db.execute('BEGIN IMMEDIATE')
  if db.execute("SELECT 1 FROM shared_calls WHERE state='reserved' LIMIT 1").fetchone():raise RuntimeError('daily_limit_in_flight')
  before=digest({k:v for k,v in old.items() if k!='plan_id'});after=digest({k:v for k,v in new.items() if k!='plan_id'})
  if db.execute('SELECT terms FROM shared_windows WHERE id=?',(old['window_id'],)).fetchone()!=(before,):raise RuntimeError('daily_limit_parent_mismatch')
  db.execute('CREATE TABLE IF NOT EXISTS daily_limit_audit(old_terms TEXT PRIMARY KEY,new_terms TEXT,at REAL,old_limit INTEGER,new_limit INTEGER,calls_hash TEXT)')
  calls=digest([db.execute('SELECT * FROM shared_calls ORDER BY id').fetchall(),db.execute('SELECT * FROM daily_calls ORDER BY id').fetchall()])
  db.execute('INSERT INTO daily_limit_audit VALUES(?,?,?,?,?,?)',(before,after,time.time(),2000000,3000000,calls));db.execute('UPDATE shared_windows SET terms=? WHERE id=?',(after,old['window_id']));db.commit()
 except Exception:db.rollback();raise
 finally:db.close()

def rollback_daily_limit(path,old,new):
 """Rollback only if no usage/reservation changed since migration; never restore a DB backup."""
 db=sqlite3.connect(path,timeout=10)
 try:
  db.execute('BEGIN IMMEDIATE');before=digest({k:v for k,v in old.items() if k!='plan_id'});after=digest({k:v for k,v in new.items() if k!='plan_id'})
  audit=db.execute('SELECT calls_hash FROM daily_limit_audit WHERE old_terms=? AND new_terms=?',(before,after)).fetchone()
  current=digest([db.execute('SELECT * FROM shared_calls ORDER BY id').fetchall(),db.execute('SELECT * FROM daily_calls ORDER BY id').fetchall()])
  if not audit or audit[0]!=current or db.execute('SELECT terms FROM shared_windows WHERE id=?',(old['window_id'],)).fetchone()!=(after,):raise RuntimeError('daily_limit_rollback_unsafe')
  db.execute('UPDATE shared_windows SET terms=? WHERE id=?',(before,old['window_id']));db.execute('DELETE FROM daily_limit_audit WHERE old_terms=?',(before,));db.commit()
 except Exception:db.rollback();raise
 finally:db.close()

def day_at(timestamp=None):
 return datetime.datetime.fromtimestamp(time.time()if timestamp is None else timestamp,ZoneInfo('Europe/Istanbul')).date().isoformat()

def adjust_owner_count_reservation(path,s,consent_id):
 """Release only the identified completed count hold, without inventing a charge."""
 if consent_id!='owner-2026-10-30-count-reservation-adjustment':raise RuntimeError('count_adjustment_consent_required')
 call='count:f07237b3-682b-4f1b-9b91-58285273e1d9';vision=call[6:]
 b=DailyBudget(path,s);db=b.db
 try:
  db.execute('BEGIN IMMEDIATE');b.check()
  if s['limit_micro_usd']!=3000000:raise RuntimeError('count_adjustment_limit_changed')
  row=db.execute('SELECT family,job_id,stage,request_hash,reserved,charged,state FROM shared_calls WHERE id=?',(call,)).fetchone()
  related=db.execute('SELECT family,request_hash,state FROM shared_calls WHERE id=?',(vision,)).fetchone()
  if not row or row[:3]!=('vision_count',vision,'count') or row[4:]!=(2100000,None,'usage_missing') or related!=('vision',row[3],'settled'):raise RuntimeError('count_adjustment_evidence_mismatch')
  if db.execute("SELECT 1 FROM shared_calls WHERE state='reserved' LIMIT 1").fetchone():raise RuntimeError('count_adjustment_in_flight')
  db.execute('INSERT INTO daily_reservation_adjustments VALUES(?,?,?,?,?,?)',(call,2100000,consent_id,time.time(),'completed count; unknown charge accepted by owner',row[3]));db.commit()
 except Exception:db.rollback();raise
 finally:db.close()

class DailyBudget(SharedBudget):
 def __init__(self,path,s):
  if s.get('mode')!='daily_bot':raise RuntimeError('daily_budget_mode_required')
  super().__init__(path,s)
  try:
   self.db.execute('CREATE TABLE IF NOT EXISTS daily_calls(id TEXT PRIMARY KEY,day TEXT NOT NULL,settled_day TEXT)')
   self.db.execute('CREATE TABLE IF NOT EXISTS daily_reservation_adjustments(id TEXT PRIMARY KEY,amount INTEGER NOT NULL,consent_id TEXT NOT NULL,at REAL NOT NULL,reason TEXT NOT NULL,request_hash TEXT NOT NULL)')
   self.db.execute('BEGIN IMMEDIATE')
   for row in s.get('initial_exposure',[]):
    if set(row)!={'id','day','reserved','charged','state','evidence_sha256'}or not re.fullmatch(r'[a-f0-9]{64}',str(row['evidence_sha256']))or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',str(row['day']))or not integer(row['reserved'])or row['reserved']==0 or row['state']not in('settled','usage_missing')or (row['state']=='settled'and(not integer(row['charged'])or row['charged']>row['reserved']))or (row['state']=='usage_missing'and row['charged']is not None):raise RuntimeError('daily_initial_exposure_invalid')
    datetime.date.fromisoformat(row['day'])
    if not isinstance(row['id'],str)or not re.fullmatch(r'import:[a-f0-9-]{36}',row['id']):raise RuntimeError('daily_initial_exposure_invalid')
    self.db.execute('INSERT OR IGNORE INTO shared_calls VALUES(?,?,?,?,?,?,?,?,?,NULL)',(row['id'],s['window_id'],'text',row['id'],'import',row['evidence_sha256'],row['reserved'],row['charged'],row['state']))
    expected=(row['reserved'],row['charged'],row['state'],row['evidence_sha256'])
    if self.db.execute('SELECT reserved,charged,state,request_hash FROM shared_calls WHERE id=?',(row['id'],)).fetchone()!=expected:raise RuntimeError('daily_initial_exposure_changed')
    self.db.execute('INSERT OR IGNORE INTO daily_calls VALUES(?,?,?)',(row['id'],row['day'],row['day']if row['state']=='settled'else None))
   self.db.commit()
   if self.db.execute('SELECT 1 FROM shared_calls c LEFT JOIN daily_calls d ON d.id=c.id WHERE d.id IS NULL LIMIT 1').fetchone():raise RuntimeError('daily_call_day_missing')
  except Exception:self.db.rollback();self.db.close();raise

 def used(self,day=None):
  day=day or day_at()
  return self.db.execute("SELECT COALESCE(SUM(COALESCE(c.charged,c.reserved)-COALESCE(a.amount,0)),0) FROM shared_calls c JOIN daily_calls d ON d.id=c.id LEFT JOIN daily_reservation_adjustments a ON a.id=c.id AND c.family='vision_count' AND c.state='usage_missing' AND c.charged IS NULL AND a.amount=c.reserved AND a.request_hash=c.request_hash WHERE d.day=? OR d.settled_day=? OR c.charged IS NULL",(day,day)).fetchone()[0]

 def reserve_plan(self,*args):raise RuntimeError('daily_budget_plans_forbidden')

 def begin_job(self,job):
  try:return super().begin_job(job)
  except Exception:self.db.rollback();raise

 def reserve(self,id,family,job_id='',stage='',request_hash=''):
  if family!='text':raise RuntimeError('daily_budget_text_only')
  self.db.execute('BEGIN IMMEDIATE')
  try:
   self.check()
   if self.db.execute('SELECT 1 FROM shared_calls WHERE id=? OR (job_id=? AND stage=?)',(id,job_id,stage)).fetchone():raise RuntimeError('shared_call_no_replay')
   amount=self.amount(family);day=day_at()
   if self.used(day)+amount>self.s['limit_micro_usd']:raise RuntimeError('shared_budget_exhausted')
   self.db.execute("INSERT INTO shared_calls VALUES(?,?,?,?,?,?,?,NULL,'reserved',NULL)",(id,self.s['window_id'],family,job_id,stage,request_hash,amount))
   self.db.execute('INSERT INTO daily_calls VALUES(?,?,NULL)',(id,day))
   if day_at()!=day:raise RuntimeError('daily_budget_day_changed')
   self.db.commit();return amount
  except Exception:self.db.rollback();raise

 def settle(self,id,family,response):
  self.db.execute('BEGIN IMMEDIATE')
  try:
   self.check()
   row=self.db.execute('SELECT reserved,state FROM shared_calls WHERE id=? AND family=?',(id,family)).fetchone()
   if family!='text'or not row or row[1]!='reserved':raise RuntimeError('shared_settlement_no_replay')
   u=response.get('usage')if isinstance(response,dict)else None;p=self.s['profiles']['text']
   if not isinstance(u,dict)or not all(integer(u.get(k))for k in('input_tokens','output_tokens')):
    self.db.execute("UPDATE shared_calls SET state='usage_missing' WHERE id=?",(id,));self.db.commit();raise RuntimeError('shared_usage_missing_reserved')
   i,o=u['input_tokens'],u['output_tokens'];d=u.get('input_tokens_details')or{};rd=u.get('output_tokens_details')or{}
   if not isinstance(d,dict)or not isinstance(rd,dict):raise RuntimeError('shared_usage_missing_reserved')
   cached=d.get('cached_tokens',0);reasoning=rd.get('reasoning_tokens',0)
   if i>p['max_input_tokens']or o>p['max_output_tokens']or not integer(cached)or cached>i or not integer(reasoning)or reasoning>o:
    self.db.execute('UPDATE shared_windows SET halted=1 WHERE id=?',(self.s['window_id'],));self.db.commit();raise RuntimeError('shared_usage_bound_exceeded_halted')
   cost=((i-cached)*p['input_text_rate']+cached*p['cached_text_rate']+o*p['output_rate']+999999)//1000000
   if cost>row[0]:raise RuntimeError('shared_usage_bound_exceeded_halted')
   self.db.execute("UPDATE shared_calls SET charged=?,state='settled' WHERE id=?",(cost,id))
   self.db.execute('UPDATE daily_calls SET settled_day=? WHERE id=?',(day_at(),id))
   self.db.commit();return u
  except Exception:self.db.rollback();raise
