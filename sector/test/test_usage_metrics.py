import pathlib,sys,time,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from usage_metrics import usage_metrics

class UsageTests(unittest.TestCase):
 def test_missing_and_untrusted_values_remain_unknown(self):
  row=usage_metrics({'usage':{'input_tokens':-1,'output_tokens':True,'secret':'do-not-store'}},job_id='job',stage='audit',model='gpt-6-luna',started_at=time.monotonic(),outcome='ok')
  self.assertIsNone(row['input_tokens']);self.assertIsNone(row['output_tokens']);self.assertIsNone(row['cached_tokens']);self.assertIsNone(row['reasoning_tokens']);self.assertNotIn('secret',str(row))
 def test_provider_numbers_are_preserved(self):
  row=usage_metrics({'usage':{'input_tokens':100,'output_tokens':20,'input_tokens_details':{'cached_tokens':10},'output_tokens_details':{'reasoning_tokens':5}}},job_id='job',stage='generate',model='gpt-6-luna',started_at=time.monotonic(),outcome='ok')
  self.assertEqual([row[k] for k in ('input_tokens','output_tokens','cached_tokens','reasoning_tokens')],[100,20,10,5])

class CallIntegrationTests(unittest.TestCase):
 def test_real_call_path_records_safe_provider_usage_and_failure(self):
  import json, os, tempfile
  from types import SimpleNamespace
  from unittest.mock import patch
  import hermes_job
  class FakeAgent:
   def __init__(self, **kw):
    self.model=kw['model'];self.provider=kw['provider'];self.tools=[];self._fallback_chain=[];self._credential_pool=None;self.compression_enabled=False
    self.client=SimpleNamespace();self.fail=False
   def _interruptible_api_call(self, kwargs):
    if self.fail: raise RuntimeError('secret-error')
    return SimpleNamespace(usage=SimpleNamespace(input_tokens=12,output_tokens=4,input_tokens_details=SimpleNamespace(cached_tokens=3),output_tokens_details=SimpleNamespace(reasoning_tokens=2)),secret='secret-response')
   def run_conversation(self, **kwargs):
    self._interruptible_api_call({'prompt':'secret-prompt'})
    return {'final_response':'{"ok":true}', 'api_calls':1}
  with tempfile.TemporaryDirectory() as home, patch.dict(os.environ, {'HOME':home,'SECTOR_USAGE_DIR':'metrics'}, clear=False), patch.object(hermes_job,'runtime',return_value=(FakeAgent,{'api_key':'secret-key','base_url':'unused'})):
   job={'id':'a'*64,'model':'gpt-6.1-terra','effort':'low','profile':'unused','documents':[],'metric_stage':'generate'}
   self.assertEqual(hermes_job.call(job,'secret-instructions',{'secret':'secret-payload'}),{'ok':True})
   path=pathlib.Path(home)/'Library/Application Support/sector-haber/metrics/model-calls.jsonl'
   raw=path.read_text();row=json.loads(raw)
   self.assertNotIn('secret',raw)
   self.assertEqual([row[k] for k in ('input_tokens','output_tokens','cached_tokens','reasoning_tokens')],[12,4,3,2])
   self.assertEqual((row['job_id'],row['stage'],row['success'],row['model']),('a'*64,'generate',True,'gpt-6.1-terra'))
   agent=FakeAgent(model='gpt-6.1-terra',provider='openai-codex');agent.fail=True
   from usage_metrics import instrument_agent
   instrument_agent(agent,job)
   with self.assertRaises(RuntimeError):agent._interruptible_api_call({})
   rows=[json.loads(line) for line in path.read_text().splitlines()]
   self.assertEqual(len(rows),2);self.assertFalse(rows[1]['success']);self.assertIsNone(rows[1]['input_tokens'])
   self.assertNotIn('secret',path.read_text())
 def test_logging_failure_does_not_break_transport(self):
  from unittest.mock import patch
  from usage_metrics import instrument_agent
  class Agent:
   def _interruptible_api_call(self, kwargs):return {'usage':{}}
  agent=Agent();instrument_agent(agent,{'id':'b'*64,'model':'gpt-6-luna','metric_stage':'audit'})
  with patch('os.open',side_effect=OSError('private')):
   self.assertEqual(agent._interruptible_api_call({}),{'usage':{}})
