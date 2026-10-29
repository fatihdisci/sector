import copy,pathlib,sqlite3,sys,tempfile,time,unittest,concurrent.futures,contextlib,io
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
from shared_api_budget import SharedBudget,validate_shared,require_shared
from shared_api_fixture import bundle,response
from api_launcher import launch,preflight,SERVICE,ACCOUNT
from api_candidate import ApiConfig,Budget
from visual_api import VisualBudget
class SharedTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.b=bundle(self.temp.name);self.s=self.b['text_config']['shared_budget'];self.path=self.b['budget_path']
 def budget(self,s=None):
  b=SharedBudget(self.path,s or self.s);self.addCleanup(b.db.close);return b
 def test_three_families_share_one_limit_and_atomic_full_plan(self):
  b=self.budget();b.reserve_plan('plan',['text']*4+['vision']*4+['image']);self.assertEqual(b.used(),9*b.amount('text'));self.assertEqual(b.db.execute('SELECT COUNT(*)FROM shared_windows').fetchone()[0],1)
  other=self.budget();self.assertEqual(other.used(),b.used());self.assertEqual(other.db.execute('SELECT DISTINCT family FROM shared_calls ORDER BY family').fetchall(),[('image',),('text',),('vision',)])
 def test_total_preallocation_exhausts_before_any_partial_plan(self):
  s=copy.deepcopy(self.s);s['limit_micro_usd']=1000;b=self.budget(s)
  with self.assertRaisesRegex(RuntimeError,'exhausted'):b.reserve_plan('plan',['text','vision','image'])
  self.assertEqual(b.used(),0)
 def test_stage_consumption_cannot_replay_even_after_known_settlement(self):
  b=self.budget();b.reserve_plan(self.s['plan_id'],['vision']);b.reserve('call','vision');b.settle('call','vision',response({},'mock'))
  with self.assertRaisesRegex(RuntimeError,'no_replay'):b.reserve('call','vision')
  with self.assertRaisesRegex(RuntimeError,'no_replay'):b.settle('call','vision',response({},'mock'))
 def test_missing_usage_holds_and_unknown_call_cannot_reserve_again(self):
  b=self.budget();b.reserve_plan(self.s['plan_id'],['text','vision']);initial=b.used();b.reserve('unknown','text')
  with self.assertRaisesRegex(RuntimeError,'missing_reserved'):b.settle('unknown','text',{})
  self.assertEqual(b.used(),initial)
  with self.assertRaisesRegex(RuntimeError,'no_replay'):b.reserve('unknown','text')
  b.close_unused_plan();self.assertEqual(b.used(),b.amount('text'))
 def test_expiry_and_unverified_remaining_fail_closed(self):
  for change in ({'verified':False},{'promo_only_verified':False},{'remaining_micro_usd':None},{'other_consumption_bounded':False},{'grant_expires_at':1},{'observed_at':1},{'valid_until':1},{'remaining_micro_usd':1}):
   s=copy.deepcopy(self.s);s['promo'].update(change)
   with self.assertRaises(RuntimeError):validate_shared(s)
 def test_expiry_during_transport_keeps_reservation_and_stops_new_calls(self):
  b=self.budget();b.reserve_plan(self.s['plan_id'],['image']);b.reserve('timeout','image')
  with patch('shared_api_budget.time.time',return_value=self.s['expires_at']+1):
   with self.assertRaisesRegex(RuntimeError,'expired'):b.settle('timeout','image',{})
   with self.assertRaisesRegex(RuntimeError,'expired'):b.reserve('new','image')
  self.assertEqual(b.db.execute("SELECT state,charged FROM shared_calls WHERE id='timeout'").fetchone(),('reserved',None))
 def test_usage_bound_halts_entire_shared_window(self):
  b=self.budget();b.reserve_plan(self.s['plan_id'],['vision','image']);b.reserve('bad','vision');r=response({},'mock');r['usage']['output_tokens']=9999999
  with self.assertRaisesRegex(RuntimeError,'halted'):b.settle('bad','vision',r)
  with self.assertRaisesRegex(RuntimeError,'halted'):b.reserve('later','image')
 def test_cached_input_reasoning_subset_not_double_counted(self):
  b=self.budget();b.reserve_plan(self.s['plan_id'],['text']);b.reserve('call','text');r=response({},'mock');r['usage']['input_tokens_details']['cached_tokens']=40;b.settle('call','text',r);self.assertEqual(b.used(),130)
 def test_plan_concurrency_cannot_overspend_or_partially_allocate(self):
  s=copy.deepcopy(self.s);s['limit_micro_usd']=220000;s['plan_id']=None
  path=str(pathlib.Path(self.temp.name).resolve()/'race-budget.sqlite');s['ledger_path']=path;b=SharedBudget(path,s);b.db.close()
  def reserve(i):
   try:
    x=SharedBudget(path,s)
    try:x.reserve_plan('p'+str(i),['text']);return True
    finally:x.db.close()
   except RuntimeError:return False
  with concurrent.futures.ThreadPoolExecutor(max_workers=6)as pool:results=list(pool.map(reserve,range(10)))
  self.assertEqual(sum(results),2);x=SharedBudget(path,s);self.addCleanup(x.db.close);self.assertLessEqual(x.used(),s['limit_micro_usd'])
 def test_different_path_profile_or_window_is_rejected(self):
  c=ApiConfig(**self.b['text_config'])
  with self.assertRaisesRegex(RuntimeError,'path_mismatch'):require_shared(c,self.path+'-copy','text')
  bad=self.b['visual_config']|{'vision':self.b['visual_config']['vision']|{'max_output_tokens':123}}
  with self.assertRaisesRegex(RuntimeError,'profile_mismatch'):require_shared(bad,self.path,'visual')
  b=self.budget();s=copy.deepcopy(self.s);s['window_id']='different'
  with self.assertRaisesRegex(RuntimeError,'replacement_forbidden'):SharedBudget(self.path,s)
 def test_text_and_visual_wrappers_use_only_the_same_tables(self):
  t=Budget(self.path,ApiConfig(**self.b['text_config']));v=VisualBudget(self.path,self.b['visual_config']);self.addCleanup(t.db.close);self.addCleanup(v.db.close)
  self.assertEqual(t.db.execute('SELECT name FROM sqlite_master WHERE type="table"ORDER BY name').fetchall(),v.db.execute('SELECT name FROM sqlite_master WHERE type="table"ORDER BY name').fetchall());self.assertFalse(t.db.execute("SELECT 1 FROM sqlite_master WHERE name IN('api_reservations','visual_calls')").fetchone())
class LauncherTests(unittest.TestCase):
 setUp=SharedTests.setUp
 def test_disabled_never_calls_loader_verifier_or_child(self):
  with patch('api_launcher.keychain_credential_loader',side_effect=AssertionError('no lookup')):
   self.assertEqual(launch({}),{'state':'dry_run','network':False,'credential_lookup':False})
 def test_all_preflights_happen_before_credential_loader(self):
  variants=[]
  for mutate in [lambda b:b['approval'].update(approved=False),lambda b:b['approval'].update(keychain_read_approved=False),lambda b:b['text_config'].update(enabled=False),lambda b:b['visual_config']['vision'].update(reasoning_effort='low'),lambda b:b['text_config']['shared_budget']['promo'].update(verified=False),lambda b:b.update(media_path='/tmp/unrelated'),lambda b:b['visual_config']['image'].update(model='not-approved')]:
   x=copy.deepcopy(self.b);mutate(x);variants.append(x)
  for b in variants:
   calls=[]
   with self.assertRaises(RuntimeError):launch(b,credential_loader=lambda:calls.append('secret'),promo_verifier=lambda e:e)
   self.assertEqual(calls,[])
 def test_no_external_promo_verifier_means_no_lookup(self):
  calls=[]
  with self.assertRaisesRegex(RuntimeError,'external_promo'):launch(self.b,credential_loader=lambda:calls.append(1))
  self.assertEqual(calls,[])
 def test_full_plan_is_reserved_before_fake_key_is_loaded_and_not_leaked(self):
  calls=[]
  def loader():
   with contextlib.closing(sqlite3.connect(self.path))as db:self.assertEqual(db.execute('SELECT COUNT(*)FROM shared_calls WHERE state="planned"').fetchone()[0],9)
   calls.append('lookup');return 'FAKE-PRIVATE-MEMORY'
  def child(b,env):
   self.assertEqual(env['SECTOR_OPENAI_API_KEY'],'FAKE-PRIVATE-MEMORY');self.assertNotIn('HERMES_HOME',env);calls.append('child');return {'state':'completed','unsafe':'FAKE-PRIVATE-MEMORY'}
  out=io.StringIO()
  with contextlib.redirect_stdout(out):r=launch(self.b,credential_loader=loader,promo_verifier=lambda e:e,child=child)
  self.assertEqual(calls,['lookup','child']);self.assertNotIn('FAKE-PRIVATE-MEMORY',json_dumps(r)+out.getvalue())
 def test_insufficient_full_plan_never_loads_key(self):
  b=copy.deepcopy(self.b);s=b['text_config']['shared_budget'];s['limit_micro_usd']=1000;b['visual_config']['shared_budget']=s;b['text_config']['hard_limit_micro_usd']=1000;b['visual_config']['budget_micro_usd']=1000;calls=[]
  with self.assertRaisesRegex(RuntimeError,'exhausted'):launch(b,credential_loader=lambda:calls.append(1),promo_verifier=lambda e:e)
  self.assertEqual(calls,[])
 def test_raw_credential_error_does_not_escape(self):
  def fail():raise RuntimeError('FAKE-PRIVATE-MEMORY')
  with self.assertRaisesRegex(RuntimeError,'^launcher_credential_unavailable$'):launch(self.b,credential_loader=fail,promo_verifier=lambda e:e)
def json_dumps(v):return __import__('json').dumps(v)

class ProductionGateTests(unittest.TestCase):
 def test_cli_refuses_nonshared_config_before_even_reading_injected_key(self):
  from api_job import main as text_main
  from visual_api_job import main as visual_main
  class Env(dict):
   def get(self,k,*a):
    if k=='SECTOR_OPENAI_API_KEY':raise AssertionError('must not read key')
    return super().get(k,*a)
  with tempfile.TemporaryDirectory()as root:
   b=bundle(root);t=copy.deepcopy(b['text_config']);t.pop('shared_budget');v=copy.deepcopy(b['visual_config']);v.pop('shared_budget')
   with self.assertRaisesRegex(RuntimeError,'shared_budget_not_authorized'):text_main({'config':t,'budget_path':b['budget_path']},environ=Env(SECTOR_OPENAI_API_ENABLED='true'))
   with self.assertRaisesRegex(RuntimeError,'shared_budget_not_authorized'):visual_main({'config':v,'budget_path':b['budget_path'],'usage_path':str(pathlib.Path(root)/'usage.jsonl')},environ=Env(SECTOR_OWNER_VISUAL_ENABLED='true'))
 def test_keychain_loader_fixed_target_never_puts_key_in_argv_or_output(self):
  from api_launcher import keychain_credential_loader
  from types import SimpleNamespace
  with patch('api_launcher.subprocess.run',return_value=SimpleNamespace(stdout=b'OFFLINE-FAKE-SECRET\n'))as run,contextlib.redirect_stdout(io.StringIO())as output:
   value=keychain_credential_loader();self.assertEqual(value,'OFFLINE-FAKE-SECRET');self.assertNotIn(value,str(run.call_args));self.assertEqual(output.getvalue(),'');self.assertEqual(run.call_args.args[0],['/usr/bin/security','find-generic-password','-s',SERVICE,'-a',ACCOUNT,'-w'])


class SharedTransportTests(unittest.TestCase):
 def test_timeout_never_replays_shared_vision_http_or_releases_held_funds(self):
  from visual_api import VisualAPI
  from responses_http import ApiTransportError
  with tempfile.TemporaryDirectory()as root:
   b=bundle(root);s=b['visual_config']['shared_budget'];ledger=SharedBudget(b['budget_path'],s);ledger.reserve_plan(s['plan_id'],['vision']*4+['text']*4+['image']);before=ledger.used();calls=[]
   def timeout(r):calls.append(r);raise ApiTransportError('api_http_timeout_no_retry')
   api=VisualAPI(b['visual_config'],b['budget_path'],timeout,timeout)
   try:
    with self.assertRaises(ApiTransportError):api.vision_call('same','source_read','x',{},[])
    with self.assertRaisesRegex(RuntimeError,'no_replay'):api.vision_call('same','source_read','x',{},[])
    self.assertEqual(len(calls),1);self.assertEqual(ledger.used(),before);self.assertEqual(ledger.db.execute("SELECT state,charged FROM shared_calls WHERE id='vision:same:source_read'").fetchone(),('reserved',None))
   finally:api.budget.db.close();ledger.db.close()
 def test_freshness_expiring_in_verifier_stops_before_credential_lookup(self):
  with tempfile.TemporaryDirectory()as root:
   b=bundle(root);calls=[]
   def verified(e):b['text_config']['rate_table_expires_at']=1;return e
   with self.assertRaisesRegex(RuntimeError,'rate_table'):launch(b,credential_loader=lambda:calls.append(1),promo_verifier=verified)
   self.assertEqual(calls,[])
if __name__=='__main__':unittest.main()
