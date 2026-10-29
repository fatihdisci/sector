import sys,pathlib,tempfile,time,unittest,json,sqlite3
from dataclasses import replace
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
from api_candidate import ApiConfig,OfflineApiCandidate,Budget,cost,JsonlTelemetry
class ApiCandidateTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.path=pathlib.Path(self.temp.name)/'budget.sqlite';self.config=ApiConfig(enabled=True,reasoning_effort='low',budget_authorized=True,rate_table_model='approved-test-model',rate_table_valid_from=time.time()-60,rate_table_expires_at=time.time()+1200,rate_table_source='https://developers.openai.com/api/docs/pricing',context_window_tokens=25000,model='approved-test-model',approved_models=('approved-test-model',),hard_limit_micro_usd=100000,window_id='test-window',expires_at=time.time()+600,input_token_ceiling=20000,max_output_tokens=1000,input_micro_usd_per_million=1000000,cached_micro_usd_per_million=500000,output_micro_usd_per_million=2000000);self.job={'id':'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','input_hash':'a'*64,'lease_token':'fake-lease','provider':'openai-api','model':'approved-test-model','effort':'low','allowed_tools':[],'deadline':time.time()+600,'documents':[],'metric_stage':'generate','prompt':'editor','schema':{},'audit_prompt':'audit'}
 def response(self,text='{"headline":"test"}',usage=True):
  r={'model':'approved-test-model','status':'completed','output':[{'type':'message','role':'assistant','content':[{'type':'output_text','text':text}]}]}
  if usage:r['usage']={'input_tokens':100,'output_tokens':20,'input_tokens_details':{'cached_tokens':40},'output_tokens_details':{'reasoning_tokens':10}}
  return r
 def test_disabled_missing_model_budget_and_expiry_never_invoke_transport(self):
  for c in (ApiConfig(),replace(self.config,model=None),replace(self.config,model='gpt-6.1-terra'),replace(self.config,hard_limit_micro_usd=None),replace(self.config,expires_at=time.time()-1),replace(self.config,approved_models=())):
   calls=[]
   with self.assertRaises(RuntimeError):OfflineApiCandidate(c,self.path,lambda p:calls.append(p)).call(self.job,'secret prompt',{})
   self.assertEqual(calls,[])
 def test_atomic_budget_reserves_before_call_and_no_fallback_on_missing_usage(self):
  calls=[];c=replace(self.config,hard_limit_micro_usd=22000)
  adapter=OfflineApiCandidate(c,self.path,lambda p:(calls.append(p),self.response(usage=False))[1])
  with self.assertRaisesRegex(RuntimeError,'usage_missing_reserved'):adapter.call(self.job,'test',{})
  with self.assertRaisesRegex(RuntimeError,'reservation_unavailable'):adapter.call(self.job|{'metric_stage':'audit'},'audit',{})
  self.assertEqual(len(calls),1)
 def test_usage_cache_and_reasoning_are_not_double_counted_and_telemetry_has_no_content(self):
  metrics=[];requests=[]
  adapter=OfflineApiCandidate(self.config,self.path,lambda p:(requests.append(p),self.response())[1],metrics.append);adapter.call(self.job,'NEVER_LOG_THIS',{'secret':'secret-value'})
  row=sqlite3.connect(self.path).execute('select charged from api_reservations').fetchone();self.assertEqual(row[0],120)
  self.assertEqual(metrics[0]['input_tokens'],100);self.assertEqual(metrics[0]['output_tokens'],20);self.assertEqual(metrics[0]['reasoning_tokens'],10);self.assertNotIn('secret',json.dumps(metrics));self.assertNotIn('NEVER_LOG',json.dumps(metrics));self.assertEqual(metrics[0]['provider'],'openai-api')
  self.assertEqual(requests[0]['tools'],[]);self.assertEqual(requests[0]['tool_choice'],'none');self.assertFalse(requests[0]['store']);self.assertEqual(requests[0]['reasoning'],{'effort':'low'})
 def test_timeout_keeps_full_reservation_and_same_call_cannot_replay(self):
  def timeout(p):raise TimeoutError('do not log credential/prompt')
  with self.assertRaises(TimeoutError):OfflineApiCandidate(self.config,self.path,timeout).call(self.job,'text',{})
  calls=[]
  with self.assertRaisesRegex(RuntimeError,'no_replay'):OfflineApiCandidate(self.config,self.path,lambda p:calls.append(p)).call(self.job,'text',{})
  self.assertEqual(calls,[]);self.assertIsNone(sqlite3.connect(self.path).execute('select charged from api_reservations').fetchone()[0])
 def test_no_transport_no_tools_and_images_are_fail_closed(self):
  with self.assertRaisesRegex(RuntimeError,'offline_only'):OfflineApiCandidate(self.config,self.path).call(self.job,'x',{})
  calls=[];a=OfflineApiCandidate(self.config,self.path,lambda p:calls.append(p))
  for j in (self.job|{'allowed_tools':['browser']},self.job|{'lease_token':None},self.job|{'documents':[{'images':['do-not-read.png']}]}):
   with self.assertRaises(RuntimeError):a.call(j,'x',{})
  self.assertEqual(calls,[])
 def test_incomplete_tool_and_refusal_responses_are_rejected(self):
  for response in ({'status':'incomplete'}, {'status':'completed','output':[{'type':'function_call'}]}, {'status':'completed','output':[{'type':'message','role':'assistant','content':[{'type':'refusal','refusal':'no'}]}]}):
   with tempfile.TemporaryDirectory()as d:
    with self.assertRaises(RuntimeError):OfflineApiCandidate(self.config,pathlib.Path(d)/'b',lambda p:response).call(self.job,'x',{})
 def test_bounded_generate_audit_repair_and_durable_job_idempotency(self):
  answers=iter([self.response('{"headline":"first"}'),self.response('{"supported":false,"issues":["fix"]}'),self.response('{"headline":"fixed"}'),self.response('{"supported":true,"issues":[]}')]);calls=[]
  adapter=OfflineApiCandidate(self.config,self.path,lambda p:(calls.append(p),next(answers))[1])
  with patch('hermes_job.prepare_draft',side_effect=lambda d,docs:d),patch('hermes_job.presentation_issues',return_value=[]),patch('hermes_job.deterministic_issues',return_value=[]):
   result=adapter.run_job(self.job);self.assertEqual(result['runtime']['calls'],4);self.assertEqual(result['runtime']['provider'],'openai-api');self.assertEqual(result['draft']['headline'],'fixed')
   with self.assertRaisesRegex(RuntimeError,'already_started'):adapter.run_job(self.job)
  self.assertEqual(len(calls),4)
 def test_excess_usage_halts_budget_and_expired_window_cannot_reserve(self):
  r=self.response();r['usage']['input_tokens']=30000;a=OfflineApiCandidate(self.config,self.path,lambda p:r)
  with self.assertRaisesRegex(RuntimeError,'halted'):a.call(self.job,'x',{})
  with self.assertRaisesRegex(RuntimeError,'halted'):a.call(self.job|{'metric_stage':'audit'},'x',{})
 def test_reasoning_metadata_is_not_tool_output_and_local_sink_strips_extra_fields(self):
  r=self.response();r['output'].insert(0,{'type':'reasoning','summary':[]});path=pathlib.Path(self.temp.name)/'metrics.jsonl';sink=JsonlTelemetry(path);rows=[]
  a=OfflineApiCandidate(self.config,self.path,lambda p:r,lambda row:(rows.append(row),sink(row|{'secret':'NEVER','prompt':'NEVER'})))
  self.assertEqual(a.call(self.job,'x',{})['headline'],'test');raw=path.read_text();self.assertNotIn('NEVER',raw);self.assertNotIn('prompt',raw);self.assertEqual(json.loads(raw)['provider'],'openai-api')
 def test_independent_adapters_cannot_overreserve_a_shared_window(self):
  import concurrent.futures
  c=replace(self.config,hard_limit_micro_usd=22000)
  # Initialize schema before concurrent reservation transactions.
  b=Budget(self.path,c);b.db.close()
  def run(n):
   j=self.job|{'id':f'aaaaaaaa-aaaa-4aaa-aaaa-{n:012d}'}
   try:OfflineApiCandidate(c,self.path,lambda p:self.response(usage=False)).call(j,'x',{});return True
   except RuntimeError as error:return str(error)=='api_usage_missing_reserved_no_retry'
  with concurrent.futures.ThreadPoolExecutor(max_workers=2)as ex:results=list(ex.map(run,[1,2]))
  self.assertEqual(sum(results),1)
 def test_medium_is_explicit_and_request_cannot_downgrade_to_low(self):
  from dataclasses import replace
  c=replace(self.config,reasoning_effort='medium');requests=[]
  # Use existing completed-response fixture through its transport shape.
  response={'model':c.model,'status':'completed','output':[{'type':'message','role':'assistant','content':[{'type':'output_text','text':'{"headline":"test"}'}]}],'usage':{'input_tokens':100,'output_tokens':20,'input_tokens_details':{'cached_tokens':0},'output_tokens_details':{'reasoning_tokens':10}}}
  def send(request):requests.append(request);return response
  adapter=OfflineApiCandidate(c,self.path,send)
  with self.assertRaisesRegex(RuntimeError,'route_invalid'):adapter.call(self.job,'x',{})
  adapter.call(self.job|{'effort':'medium'},'x',{});self.assertEqual(requests[0]['reasoning'],{'effort':'medium'})
  for effort in ('high',None):
   with self.assertRaisesRegex(RuntimeError,'effort_not_approved'):OfflineApiCandidate(replace(c,reasoning_effort=effort),self.path,send).call(self.job,'x',{})
if __name__=='__main__':unittest.main()
