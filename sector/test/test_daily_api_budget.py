import copy,datetime,pathlib,tempfile,time,unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from shared_api_fixture import bundle
from shared_api_budget import validate_shared
from daily_api_budget import DailyBudget,day_at
from news_api_preflight import preflight
import json

class DailyBudgetTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name).resolve()
  self.c=bundle(self.root)['text_config'];s=self.c['shared_budget'];s.pop('promo');s.update(mode='daily_bot',timezone='Europe/Istanbul',families=['text'],plan_id=None,limit_micro_usd=2000000,consent={'id':'owner-explicit-daily-2','approved_at':time.time()-1,'paid_balance_risk_accepted':True},initial_exposure=[])
  s['profiles']={'text':s['profiles']['text']};s['ledger_path']=str(self.root/'news-api-budget.sqlite');self.c['hard_limit_micro_usd']=2000000;self.s=s
 def open(self):return DailyBudget(self.s['ledger_path'],self.s)
 def reserve(self,b,id):return b.reserve(id,'text',id,'generate','0'*64)
 def response(self,i=100,o=50,cached=0,reasoning=0):return {'usage':{'input_tokens':i,'output_tokens':o,'input_tokens_details':{'cached_tokens':cached},'output_tokens_details':{'reasoning_tokens':reasoning}}}
 def test_daily_mode_is_explicit_and_old_promo_rules_still_apply(self):
  validate_shared(self.s)
  for change in ({'mode':'bypass'},{'timezone':'UTC'},{'limit_micro_usd':4000000},{'consent':{}},{'families':['text','vision']}):
   with self.assertRaises(RuntimeError):validate_shared(self.s|change)
  s=copy.deepcopy(self.s);s.pop('mode')
  with self.assertRaisesRegex(RuntimeError,'promo_evidence'):validate_shared(s)
 def test_private_startup_accepts_only_explicit_daily_consent(self):
  for name,value in [('news-api-config.json',self.c),('news-api-provider.json',{'version':1,'provider':'openai-api','enabled':True,'purpose':'news_text_only'})]:
   p=self.root/name;p.write_text(json.dumps(value));p.chmod(0o600)
  self.assertEqual(preflight(self.root).model,'gpt-6.1-terra')
 def test_atomic_concurrent_reservations_cannot_exceed_cap(self):
  b=self.open();amount=b.amount('text');b.db.close()
  def reserve(n):
   b=self.open()
   try:self.reserve(b,str(n));return True
   except RuntimeError as e:self.assertEqual(str(e),'shared_budget_exhausted');return False
   finally:b.db.close()
  with ThreadPoolExecutor(max_workers=8)as pool:success=list(pool.map(reserve,range(30)))
  self.assertEqual(sum(success),2000000//amount)
  b=self.open();self.assertEqual(b.used(),sum(success)*amount);b.db.close()
 def test_midnight_is_turkey_day_and_unknowns_carry_forward(self):
  midnight=datetime.datetime(2026,10,31,tzinfo=datetime.timezone(datetime.timedelta(hours=3))).timestamp()
  self.s['expires_at']=midnight+86400;self.s['consent']['approved_at']=midnight-100
  self.assertEqual(day_at(midnight-1),'2026-10-30');self.assertEqual(day_at(midnight),'2026-10-31')
  with patch('shared_api_budget.time.time',return_value=midnight-1):
   b=self.open();amount=self.reserve(b,'old');self.reserve(b,'unknown')
   with self.assertRaisesRegex(RuntimeError,'usage_missing'):b.settle('unknown','text',{})
  with patch('shared_api_budget.time.time',return_value=midnight+1):
   self.assertEqual(b.used(),amount*2);b.settle('old','text',self.response());self.assertEqual(b.used(),amount+150)
   with self.assertRaisesRegex(RuntimeError,'no_replay'):self.reserve(b,'old')
  with patch('shared_api_budget.time.time',return_value=midnight+86400):
   # Expiry is independent of calendar rollover.
   with self.assertRaisesRegex(RuntimeError,'expired'):self.reserve(b,'expired')
  b.db.close()
 def test_completed_prior_day_releases_only_known_cost_next_day(self):
  with patch('daily_api_budget.day_at',return_value='2026-10-30'):
   b=self.open();self.reserve(b,'settled');b.settle('settled','text',self.response(cached=20,reasoning=10));self.assertEqual(b.used(),140)
  with patch('daily_api_budget.day_at',return_value='2026-10-31'):self.assertEqual(b.used(),0)
  b.db.close()
 def test_immutable_imports_count_once_and_missing_usage_never_resets(self):
  self.s['initial_exposure']=[{'id':'import:00000000-0000-4000-8000-000000000001','day':day_at(),'reserved':4608,'charged':None,'state':'usage_missing','evidence_sha256':'a'*64},{'id':'import:00000000-0000-4000-8000-000000000002','day':day_at(),'reserved':4608,'charged':103,'state':'settled','evidence_sha256':'b'*64}]
  for _ in range(2):
   b=self.open();self.assertEqual(b.used(),4711);b.db.close()
  with patch('daily_api_budget.day_at',return_value='2099-01-01'):
   b=self.open();self.assertEqual(b.used(),4608);b.db.close()
  s=copy.deepcopy(self.s);s['initial_exposure'][0]['reserved']=1
  with self.assertRaisesRegex(RuntimeError,'terms_changed'):DailyBudget(self.s['ledger_path'],s)
 def test_restart_replay_and_overbound_usage_halt(self):
  b=self.open();job={'id':'job','input_hash':'x'};b.begin_job(job);self.reserve(b,'same');b.db.close();b=self.open()
  with self.assertRaisesRegex(RuntimeError,'no_replay'):b.begin_job(job)
  with self.assertRaisesRegex(RuntimeError,'no_replay'):self.reserve(b,'same')
  with self.assertRaisesRegex(RuntimeError,'halted'):b.settle('same','text',self.response(i=999999))
  with self.assertRaisesRegex(RuntimeError,'halted'):self.reserve(b,'after-halt')
  self.assertGreater(b.used(),0);b.db.close()

 def test_explicit_policy_extension_keeps_daily_usage_and_rejects_cap_or_inflight_changes(self):
  from daily_api_budget import extend_policy_expiry
  b=self.open();self.reserve(b,'done');b.settle('done','text',self.response());b.db.close()
  new=copy.deepcopy(self.s);new['expires_at']+=86400
  bad=copy.deepcopy(new);bad['limit_micro_usd']=3000000
  with self.assertRaises(RuntimeError):extend_policy_expiry(self.s['ledger_path'],self.s,bad)
  extend_policy_expiry(self.s['ledger_path'],self.s,new);b=DailyBudget(new['ledger_path'],new);self.assertEqual(b.used(),150);self.reserve(b,'pending');b.db.close()
  again=copy.deepcopy(new);again['expires_at']+=86400
  with self.assertRaisesRegex(RuntimeError,'in_flight'):extend_policy_expiry(new['ledger_path'],new,again)
  with self.assertRaisesRegex(RuntimeError,'terms_changed'):DailyBudget(self.s['ledger_path'],self.s)

class DailyLimitMigrationTests(DailyBudgetTests):
 def test_increase_preserves_settled_unknown_and_rejects_active(self):
  from daily_api_budget import increase_daily_limit
  b=self.open();self.reserve(b,'done');b.settle('done','text',self.response());self.reserve(b,'unknown')
  with self.assertRaisesRegex(RuntimeError,'usage_missing'):b.settle('unknown','text',{})
  prior=b.used();b.db.close();n=copy.deepcopy(self.s);n['limit_micro_usd']=3000000;n['consent']={'id':'owner-explicit-daily-3','approved_at':time.time(),'paid_balance_risk_accepted':True}
  increase_daily_limit(n['ledger_path'],self.s,n);b=DailyBudget(n['ledger_path'],n);self.assertEqual(b.used(),prior);self.assertEqual(b.s['limit_micro_usd'],3000000);b.db.close()
