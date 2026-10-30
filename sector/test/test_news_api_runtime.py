import json,pathlib,tempfile,unittest,sys,copy
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
from news_api_preflight import preflight
from shared_api_fixture import bundle
from shared_api_budget import validate_shared,SharedBudget
class NewsAPIStartup(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=pathlib.Path(self.tmp.name).resolve();self.c=bundle(str(self.root))['text_config'];s=self.c['shared_budget'];s['families']=['text'];s['profiles']={'text':s['profiles']['text']};s['ledger_path']=str(self.root/'news-api-budget.sqlite');s['plan_id']=None
  self.write('news-api-provider.json',{'version':1,'provider':'openai-api','enabled':True,'purpose':'news_text_only'});self.write('news-api-config.json',self.c)
 def write(self,name,value):
  p=self.root/name;p.write_text(json.dumps(value));p.chmod(0o600)
 def test_text_only_ledger_and_model_are_validated_without_credentials(self):
  self.assertEqual(preflight(self.root).model,'gpt-6.1-terra');self.assertEqual(preflight(self.root).reasoning_effort,'medium');self.assertEqual(set(self.c['shared_budget']['profiles']),{'text'})
  b=SharedBudget(self.root/'news-api-budget.sqlite',self.c['shared_budget'])
  try:
   with self.assertRaises(KeyError):b.amount('vision')
  finally:b.db.close()
 def test_old_promo_evidence_or_visual_profiles_cannot_activate_text_service(self):
  self.c['shared_budget']['promo']['valid_until']=1;self.write('news-api-config.json',self.c)
  with self.assertRaisesRegex(RuntimeError,'promo_evidence_stale'):preflight(self.root)
 def test_permissive_files_and_nonmedium_model_fail_closed(self):
  (self.root/'news-api-config.json').chmod(0o644)
  with self.assertRaisesRegex(RuntimeError,'private_file'):preflight(self.root)
  self.c['reasoning_effort']='low';self.write('news-api-config.json',self.c)
  with self.assertRaisesRegex(RuntimeError,'model_not_approved'):preflight(self.root)
 def test_shared_profiles_stay_three_family_by_default(self):
  s=copy.deepcopy(self.c['shared_budget']);del s['families']
  with self.assertRaisesRegex(RuntimeError,'profiles_missing'):validate_shared(s)
 def test_single_text_smoke_is_exactly_one_call_and_cannot_replay(self):
  from news_api_smoke import run
  from shared_api_fixture import response
  calls=[]
  def transport(key,**kw):
   self.assertEqual(key,'OFFLINE-FAKE-SECRET')
   def send(request):
    calls.append(request);self.assertEqual(request['tools'],[]);self.assertEqual(request['model'],'gpt-6.1-terra');return response({'ok':True},'gpt-6.1-terra')
   return send
  r=run(self.root,credential=lambda:'OFFLINE-FAKE-SECRET',transport_factory=transport);self.assertEqual(r['state'],'completed');self.assertEqual(len(calls),1);self.assertNotIn('OFFLINE-FAKE-SECRET',json.dumps(r));self.assertIsNotNone(r['actual_cost_micro_usd'])
  with self.assertRaises(FileExistsError):run(self.root,credential=lambda:self.fail('must not read again'),transport_factory=transport)
 def test_unknown_smoke_retains_reservation_and_sanitizes_error(self):
  from news_api_smoke import run
  def transport(*a,**k):
   def send(request):raise RuntimeError('RAW-SECRET-FAILURE')
   return send
  r=run(self.root,credential=lambda:'OFFLINE-FAKE-SECRET',transport_factory=transport);self.assertEqual(r['state'],'failed_no_retry');self.assertNotIn('RAW-SECRET',json.dumps(r))
  import sqlite3
  db=sqlite3.connect(self.root/'news-api-budget.sqlite')
  try:self.assertEqual(db.execute('SELECT state FROM shared_calls').fetchone()[0],'reserved')
  finally:db.close()

 def test_http_failure_without_usage_preserves_safe_category_and_budget(self):
  from news_api_smoke import run
  from responses_http import ApiTransportError
  def transport(*a,**k):
   def send(request):raise ApiTransportError('api_http_auth_no_retry',{'error':{'message':'PRIVATE'}})
   return send
  r=run(self.root,credential=lambda:'OFFLINE-FAKE-SECRET',transport_factory=transport)
  self.assertEqual(r['error'],'api_http_auth_no_retry');self.assertNotIn('PRIVATE',json.dumps(r))
  import sqlite3
  db=sqlite3.connect(self.root/'news-api-budget.sqlite')
  try:self.assertEqual(db.execute('SELECT state FROM shared_calls').fetchone()[0],'usage_missing')
  finally:db.close()
