import json,pathlib,sqlite3,sys,tempfile,time,unittest
from contextlib import closing
from dataclasses import asdict,replace
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
from responses_http import ResponsesHTTP,ApiTransportError
from api_candidate import ApiConfig,OfflineApiCandidate,JsonlTelemetry
import api_job

def run_main(*args,**kwargs):return api_job.main(*args,offline_test=True,**kwargs)

def settings():
    return ApiConfig(enabled=True,reasoning_effort='low',budget_authorized=True,model='approved-mock-model',approved_models=('approved-mock-model',),hard_limit_micro_usd=1000000,window_id='window',expires_at=time.time()+600,input_token_ceiling=20000,max_output_tokens=1000,input_micro_usd_per_million=1000000,cached_micro_usd_per_million=500000,output_micro_usd_per_million=2000000,rate_table_model='approved-mock-model',rate_table_valid_from=time.time()-60,rate_table_expires_at=time.time()+900,rate_table_source='https://developers.openai.com/api/docs/pricing',context_window_tokens=24000)
def job():
    return dict(id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',input_hash='a'*64,lease_token='lease',provider='openai-api',model='approved-mock-model',effort='low',allowed_tools=[],deadline=time.time()+600,documents=[],metric_stage='generate',prompt='editor',schema={},audit_prompt='audit')
def reply(text='{"headline":"test"}'):
    return dict(model='approved-mock-model',status='completed',output=[dict(type='message',role='assistant',content=[dict(type='output_text',text=text)])],usage=dict(input_tokens=100,output_tokens=20,input_tokens_details=dict(cached_tokens=40),output_tokens_details=dict(reasoning_tokens=10)))
class FakeHTTP:
    def __init__(self,responses):self.responses=iter(responses);self.requests=[];self.closed=0;self.connections=0
    def factory(self,host,**kwargs):
        owner=self;owner.connections+=1
        class Connection:
            sock=None
            def request(self,method,path,body,headers):owner.requests.append((host,kwargs,method,path,json.loads(body),headers))
            def getresponse(self):
                answer=next(owner.responses)
                if isinstance(answer,Exception):raise answer
                status,body=answer
                class Response:
                    def __init__(self):self.done=False;self.status=status
                    def read(self,n):
                        if self.done:return b''
                        self.done=True;return body if isinstance(body,bytes)else json.dumps(body).encode()
                return Response()
            def close(self):owner.closed+=1
        return Connection()
class ResponsesHTTPTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.path=pathlib.Path(self.temp.name)/'budget.sqlite';self.metrics=pathlib.Path(self.temp.name)/'usage.jsonl';self.c=settings();self.j=job()
    def adapter(self,fake,c=None):
        return OfflineApiCandidate(c or self.c,self.path,ResponsesHTTP('FAKE-SECRET-NEVER-LOG',deadline=self.j['deadline'],connection_factory=fake.factory),JsonlTelemetry(self.metrics,('approved-mock-model',)))
    def reserved(self):
        with closing(sqlite3.connect(self.path))as db:return db.execute('SELECT state,reserved,charged FROM api_reservations').fetchall()
    def test_official_https_json_headers_no_tools_and_cache_cost(self):
        fake=FakeHTTP([(200,reply())]);result=self.adapter(fake).call(self.j,'PRIVATE-PROMPT',{})
        self.assertEqual(result['headline'],'test');host,options,method,path,request,headers=fake.requests[0]
        self.assertEqual((host,method,path),('api.openai.com','POST','/v1/responses'));self.assertTrue(options['context'].check_hostname)
        self.assertEqual(headers['Authorization'],'Bearer FAKE-SECRET-NEVER-LOG');self.assertFalse(request['store']);self.assertFalse(request['stream']);self.assertFalse(request['background']);self.assertEqual(request['tools'],[]);self.assertEqual(request['tool_choice'],'none');self.assertEqual(request['service_tier'],'default')
        self.assertEqual(self.reserved()[0][2],120);self.assertEqual(fake.closed,1)
        self.assertNotIn('PRIVATE-PROMPT',self.metrics.read_text());self.assertNotIn('FAKE-SECRET',self.metrics.read_text())
    def test_http_failures_and_redirects_never_retry_or_release_unknown_cost(self):
        for status in (302,400,401,403,408,409,429,500,503):
            with self.subTest(status=status),tempfile.TemporaryDirectory()as temp:
                self.path=pathlib.Path(temp)/'b';fake=FakeHTTP([(status,{'error':{'message':'SECRET provider message'}})])
                with self.assertRaises(ApiTransportError)as error:self.adapter(fake).call(self.j,'private',{})
                self.assertNotIn('SECRET',str(error.exception));self.assertEqual(fake.connections,1);self.assertIsNone(self.reserved()[0][2])
                with self.assertRaisesRegex(RuntimeError,'no_replay'):self.adapter(fake).call(self.j,'private',{})
                self.assertEqual(fake.connections,1)
    def test_timeout_and_connection_uncertainty_keep_reservation(self):
        for failure in (TimeoutError('SECRET'),ConnectionResetError('SECRET')):
            with self.subTest(failure=type(failure).__name__),tempfile.TemporaryDirectory()as temp:
                self.path=pathlib.Path(temp)/'b';fake=FakeHTTP([failure])
                with self.assertRaises(ApiTransportError)as error:self.adapter(fake).call(self.j,'private',{})
                self.assertNotIn('SECRET',str(error.exception));self.assertIsNone(self.reserved()[0][2]);self.assertEqual(fake.connections,1);self.assertEqual(fake.closed,1)
    def test_incomplete_response_charges_known_usage_but_does_not_repair_or_retry(self):
        response=reply();response.update(status='incomplete',incomplete_details={'reason':'max_output_tokens'});fake=FakeHTTP([(200,response)])
        with self.assertRaisesRegex(RuntimeError,'not_completed'):self.adapter(fake).run_job(self.j)
        self.assertEqual(len(fake.requests),1);self.assertEqual(self.reserved()[0][2],120)
        with self.assertRaisesRegex(RuntimeError,'already_started'):self.adapter(fake).run_job(self.j)
    def test_missing_usage_stops_before_audit_and_keeps_full_budget(self):
        response=reply();del response['usage'];fake=FakeHTTP([(200,response)])
        with self.assertRaisesRegex(RuntimeError,'usage_missing'):self.adapter(fake).run_job(self.j)
        self.assertEqual(len(fake.requests),1);state,reserved,charged=self.reserved()[0];self.assertEqual(state,'usage_missing');self.assertEqual(reserved,22000);self.assertIsNone(charged)
        row=json.loads(self.metrics.read_text());self.assertIsNone(row['input_tokens']);self.assertIsNone(row['output_tokens'])
    def test_malformed_json_and_non_object_do_not_retry(self):
        for body in (b'not JSON SECRET',b'[]'):
            with self.subTest(body=body),tempfile.TemporaryDirectory()as temp:
                self.path=pathlib.Path(temp)/'b';fake=FakeHTTP([(200,body)])
                with self.assertRaisesRegex(ApiTransportError,'invalid_json'):self.adapter(fake).call(self.j,'x',{})
                self.assertIsNone(self.reserved()[0][2]);self.assertEqual(fake.connections,1)
    def test_http_error_with_usage_is_charged_without_logging_provider_body(self):
        response=reply();response['error']={'message':'PRIVATE provider body'};fake=FakeHTTP([(500,response)])
        with self.assertRaises(ApiTransportError):self.adapter(fake).call(self.j,'private',{})
        self.assertEqual(self.reserved()[0][2],120);self.assertNotIn('PRIVATE',self.metrics.read_text());self.assertEqual(json.loads(self.metrics.read_text())['input_tokens'],100);self.assertEqual(fake.connections,1)
    def test_expired_deadline_makes_no_connection(self):
        fake=FakeHTTP([]);self.j['deadline']=time.time()-1
        with self.assertRaises(RuntimeError):self.adapter(fake).call(self.j,'x',{})
        self.assertEqual(fake.connections,0)
    def test_invalid_rate_table_budget_context_model_and_key_fail_closed(self):
        for c in (replace(self.c,enabled=False),replace(self.c,budget_authorized=False),replace(self.c,rate_table_expires_at=time.time()-1),replace(self.c,rate_table_model='another'),replace(self.c,context_window_tokens=1000),replace(self.c,rate_table_source=None)):
            fake=FakeHTTP([])
            with self.assertRaises(RuntimeError):self.adapter(fake,c).call(self.j,'x',{})
            self.assertEqual(fake.connections,0)
        for key in ('','bad\nkey',None):
            with self.assertRaisesRegex(RuntimeError,'key_missing'):ResponsesHTTP(key,deadline=self.j['deadline'])
    def test_changed_rates_cannot_reuse_authorized_window(self):
        fake=FakeHTTP([(200,reply())]);self.adapter(fake).call(self.j,'x',{})
        with self.assertRaisesRegex(RuntimeError,'terms_changed'):self.adapter(fake,replace(self.c,input_micro_usd_per_million=1100000)).call(self.j|{'metric_stage':'audit'},'x',{})
        self.assertEqual(fake.connections,1)
    def test_unapproved_server_model_and_tool_output_never_become_draft(self):
        for bad in (reply()|{'model':'unapproved'},reply()|{'output':[{'type':'function_call'}]}):
            with tempfile.TemporaryDirectory()as temp:
                self.path=pathlib.Path(temp)/'b';fake=FakeHTTP([(200,bad)])
                with self.assertRaises(RuntimeError):self.adapter(fake).run_job(self.j)
                self.assertEqual(fake.connections,1)
    def test_entrypoint_uses_full_audit_repair_path_and_durable_no_replay(self):
        fake=FakeHTTP([(200,reply('{"headline":"first"}')),(200,reply('{"supported":false,"issues":["fix"]}')),(200,reply('{"headline":"fixed"}')),(200,reply('{"supported":true,"issues":[]}'))])
        envelope=dict(config=asdict(self.c),job=self.j,budget_path=str(self.path),telemetry_path=str(self.metrics))
        factory=lambda key,**kw:ResponsesHTTP(key,connection_factory=fake.factory,**kw)
        with patch('hermes_job.prepare_draft',side_effect=lambda d,docs:d),patch('hermes_job.presentation_issues',return_value=[]),patch('hermes_job.deterministic_issues',return_value=[]):
            result=run_main(envelope,environ={'SECTOR_OPENAI_API_ENABLED':'true','SECTOR_OPENAI_API_KEY':'FAKE'},transport_factory=factory)
            self.assertEqual(result['runtime']['calls'],4);self.assertEqual(result['runtime']['server_model'],'approved-mock-model');self.assertEqual(result['draft']['headline'],'fixed')
            with self.assertRaisesRegex(RuntimeError,'already_started'):run_main(envelope,environ={'SECTOR_OPENAI_API_ENABLED':'true','SECTOR_OPENAI_API_KEY':'FAKE'},transport_factory=factory)
        self.assertEqual(fake.connections,4)
    def test_invalid_usage_subset_halts_next_call(self):
        response=reply();response['usage']['output_tokens_details']['reasoning_tokens']=200
        fake=FakeHTTP([(200,response)])
        with self.assertRaisesRegex(RuntimeError,'halted'):self.adapter(fake).call(self.j,'x',{})
        with self.assertRaisesRegex(RuntimeError,'halted'):self.adapter(fake).call(self.j|{'metric_stage':'audit'},'x',{})
        self.assertEqual(fake.connections,1)
    def test_body_deadline_prevents_replay_and_preserves_unknown_cost(self):
        fake=FakeHTTP([(200,reply())]);times=iter([100,100,100,100,120])
        adapter=OfflineApiCandidate(self.c,self.path,ResponsesHTTP('FAKE',deadline=110,connection_factory=fake.factory))
        # Patch transport clock only, not budget/config clocks.
        class Clock:
            @staticmethod
            def time():return next(times)
        with patch('responses_http.time',Clock):
            with self.assertRaisesRegex(ApiTransportError,'timeout'):adapter.call(self.j,'x',{})
        self.assertEqual(fake.connections,1);self.assertIsNone(self.reserved()[0][2])
    def test_entrypoint_disabled_missing_key_and_lease_never_call_http(self):
        envelope=dict(config=asdict(self.c),job=self.j,budget_path=str(self.path),telemetry_path=str(self.metrics));calls=[]
        for variables in ({},{'SECTOR_OPENAI_API_ENABLED':'true'}):
            with self.assertRaises(RuntimeError):run_main(envelope,environ=variables,transport_factory=lambda *a,**k:calls.append(a))
        self.assertEqual(calls,[])
        fake=FakeHTTP([]);envelope['job']=self.j|{'lease_token':None}
        with self.assertRaisesRegex(RuntimeError,'lease_missing'):run_main(envelope,environ={'SECTOR_OPENAI_API_ENABLED':'true','SECTOR_OPENAI_API_KEY':'FAKE'},transport_factory=lambda key,**kw:ResponsesHTTP(key,connection_factory=fake.factory,**kw))
        self.assertEqual(fake.connections,0)
if __name__=='__main__':unittest.main()
