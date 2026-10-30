import pathlib,tempfile,time,unittest
from shared_api_fixture import bundle
from daily_api_budget import DailyBudget
from daily_vision_trial import vision_trial
class VisionTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);root=pathlib.Path(self.tmp.name).resolve();self.s=bundle(root)['text_config']['shared_budget'];self.s.pop('promo');self.s.update(mode='daily_bot',timezone='Europe/Istanbul',families=['text'],plan_id=None,limit_micro_usd=2000000,consent={'id':'owner-explicit-daily-2','approved_at':time.time()-1,'paid_balance_risk_accepted':True},initial_exposure=[]);self.s['profiles']={'text':self.s['profiles']['text']};self.s['ledger_path']=str(root/'budget.sqlite');self.id='12345678-1234-4234-8234-123456789abc';self.req={'model':'gpt-6.1-terra','reasoning':{'effort':'medium'},'tools':[],'tool_choice':'none','store':False,'max_output_tokens':1000,'input':[{'role':'user','content':[{'type':'input_text','text':'read'},{'type':'input_image','image_url':'data:image/png;base64,YWJj','detail':'high'}]}]}
 def call(self,send=lambda r:{'model':'gpt-6.1-terra','usage':{'input_tokens':2000,'output_tokens':100,'input_tokens_details':{'cached_tokens':200},'output_tokens_details':{'reasoning_tokens':60}}},**kw):return vision_trial(self.s['ledger_path'],self.s,self.req,self.id,lambda r:{'input_tokens':2000},send,**kw)
 def test_count_reserve_settle_same_ledger_and_no_double_count(self):
  x=self.call(counter_free_verified=True);self.assertGreater(x['reserved_micro_usd'],x['charged_micro_usd']);b=DailyBudget(self.s['ledger_path'],self.s);self.assertEqual(b.used(),x['charged_micro_usd']);b.db.close()
  with self.assertRaisesRegex(RuntimeError,'no_replay'):self.call(counter_free_verified=True)
 def test_uncertain_and_missing_usage_hold_reservation(self):
  for send in (lambda r:(_ for _ in ()).throw(TimeoutError()),lambda r:{}):
   self.setUp()
   with self.assertRaises(RuntimeError):self.call(send,counter_free_verified=True)
   b=DailyBudget(self.s['ledger_path'],self.s);self.assertGreater(b.used(),0);b.db.close()
 def test_unverified_count_pricing_blocks_before_network(self):
  with self.assertRaisesRegex(RuntimeError,'pricing_unverified'):self.call()
 def test_full_context_and_wrong_model_are_refused(self):
  with self.assertRaisesRegex(RuntimeError,'count_invalid'):vision_trial(self.s['ledger_path'],self.s,self.req,self.id,lambda r:{'input_tokens':1050000},lambda r:{},counter_free_verified=True)
  self.req['model']='another';
  with self.assertRaisesRegex(RuntimeError,'request_invalid'):self.call(counter_free_verified=True)

 def test_count_does_not_mutate_request_or_exceed_ledger(self):
  def mutate(r):r['model']='other';return {'input_tokens':2000}
  with self.assertRaisesRegex(RuntimeError,'request_changed'):vision_trial(self.s['ledger_path'],self.s,self.req,self.id,mutate,lambda r:{},counter_free_verified=True)
 def test_excess_usage_halts_all_families(self):
  def send(r):return {'model':'gpt-6.1-terra','usage':{'input_tokens':4000,'output_tokens':1}}
  with self.assertRaisesRegex(RuntimeError,'bound_exceeded'):self.call(send,counter_free_verified=True)
  b=DailyBudget(self.s['ledger_path'],self.s)
  try:
   with self.assertRaisesRegex(RuntimeError,'halted'):b.reserve('text-job','text','job','generate','0'*64)
  finally:b.db.close()
 def test_fixed_https_count_and_vision_response_with_image_bytes(self):
  import json
  from responses_http import ResponsesHTTP
  from daily_vision_trial import ResponsesVisionHTTP
  calls=[];answers=iter([{'input_tokens':2000},{'model':'gpt-6.1-terra','usage':{'input_tokens':2000,'output_tokens':100,'input_tokens_details':{'cached_tokens':0},'output_tokens_details':{'reasoning_tokens':50}}}])
  def factory(host,**kwargs):
   class Connection:
    sock=None
    def request(self,method,path,body,headers):calls.append((host,method,path,json.loads(body)))
    def getresponse(self):
     class Response:
      status=200;done=False
      def read(self,n):
       if self.done:return b''
       self.done=True;return json.dumps(next(answers)).encode()
     return Response()
    def close(self):pass
   return Connection()
  http=ResponsesVisionHTTP('test-only-key',deadline=time.time()+30,connection_factory=factory)
  result=vision_trial(self.s['ledger_path'],self.s,self.req,self.id,http.count,http.send,counter_free_verified=True)
  self.assertEqual([r[2] for r in calls],['/v1/responses/input_tokens','/v1/responses']);self.assertTrue(all(r[0]=='api.openai.com' for r in calls));self.assertEqual(calls[0][3]['input'],calls[1][3]['input']);self.assertEqual(result['response']['model'],'gpt-6.1-terra')

 def test_count_unknown_cost_has_separate_conservative_hold(self):
  from shared_api_budget import digest
  self.s['limit_micro_usd']=3000000;self.s['profiles']['text']['input_text_rate']=1000000;self.s['profiles']['text']['input_image_rate']=1000000
  result=self.call(counter_uncertain_approved=True);b=DailyBudget(self.s['ledger_path'],self.s)
  self.assertEqual(b.used(),2100000+result['charged_micro_usd']);self.assertEqual(b.db.execute("SELECT state FROM shared_calls WHERE id=?",('count:'+self.id,)).fetchone()[0],'usage_missing');b.db.close()
  with self.assertRaisesRegex(RuntimeError,'no_replay'):self.call(counter_uncertain_approved=True)
 def test_counter_failure_holds_count_without_calling_vision(self):
  self.s['limit_micro_usd']=3000000;self.s['profiles']['text']['input_text_rate']=1000000;self.s['profiles']['text']['input_image_rate']=1000000;calls=[]
  def fail(r):raise TimeoutError()
  with self.assertRaisesRegex(RuntimeError,'count_uncertain'):vision_trial(self.s['ledger_path'],self.s,self.req,self.id,fail,lambda r:calls.append(1),counter_uncertain_approved=True)
  self.assertEqual(calls,[]);b=DailyBudget(self.s['ledger_path'],self.s);self.assertEqual(b.used(),2100000);b.db.close()
