import importlib.util,time,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('sector_job',Path(__file__).parents[1]/'scripts/hermes_job.py')
job_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(job_module)

class HermesJobContract(unittest.TestCase):
    def setUp(self):
        self.preflight=patch.object(job_module,'deterministic_issues',return_value=[])
        self.preflight.start();self.addCleanup(self.preflight.stop)
        self.normalize=patch.object(job_module,'prepare_draft',side_effect=lambda d,docs:job_module.ensure_headline_emoji(d))
        self.normalize.start();self.addCleanup(self.normalize.stop)
    def test_deterministic_numeric_failure_is_repaired_in_existing_bounded_round(self):
        with patch.object(job_module,'deterministic_issues',side_effect=[['card_body: exact amount required'],[]]),patch.object(job_module,'call',side_effect=[{'headline':'first'},{'supported':True,'issues':[]},{'headline':'fixed'},{'supported':True,'issues':[]}]) as call:
            result=job_module.main(self.job())
            self.assertEqual(call.call_count,4)
            self.assertIn('card_body: exact amount required',call.call_args_list[2].args[2]['required_corrections'])
            self.assertTrue(result['audit']['supported'])

    def test_locator_preparation_precedes_each_semantic_audit_and_retry_feedback_is_preserved(self):
        fixed={'headline':'Doğrulanmış başlık','claims':[]}
        with patch.object(job_module,'prepare_draft',return_value=fixed) as prepare,patch.object(job_module,'call',side_effect=[{}, {'supported':False,'issues':['repair']},{}, {'supported':True,'issues':[]}]) as call:
            result=job_module.main(self.job()|{'previous_validation_issues':['previous failure']})
            self.assertEqual(prepare.call_count,2)
            self.assertEqual(call.call_args_list[1].args[2]['draft'],fixed)
            self.assertEqual(call.call_args_list[3].args[2]['draft'],fixed)
            self.assertEqual(call.call_args_list[0].args[2]['previous_validation_issues'],['previous failure'])
            self.assertEqual(result['draft'],fixed)

    def job(self):return {'id':'test','provider':'openai-codex','model':'gpt-6.1-terra','effort':'low','allowed_tools':[],'deadline':time.time()+600,'prompt':'Grounded editor','schema':{},'documents':[],'audit_prompt':'Check facts'}
    def test_no_paid_provider_or_tools_can_run(self):
        for change in [{'provider':'openai-api'},{'allowed_tools':['terminal']},{'effort':'medium'},{'effort':'high'},{'model':'gpt-5.6-terra'},{'model':'gpt-6.1-sol'}]:
            with patch.object(job_module,'call') as call:
                with self.assertRaises(RuntimeError):job_module.main(self.job()|change)
                call.assert_not_called()
    def test_verified_draft_uses_two_subscription_turns(self):
        with patch.object(job_module,'call',side_effect=[{'headline':'source'}, {'supported':True,'issues':[]}]) as call:
            result=job_module.main(self.job());self.assertEqual(call.call_count,2);self.assertEqual(result['runtime']['calls'],2)
            self.assertEqual(result['runtime']['model'],'gpt-6.1-terra');self.assertEqual(result['runtime']['effort'],'low')
    def test_agent_receives_requested_model_and_medium_effort(self):
        captured={}
        class Agent:
            def __init__(self,**kwargs):
                captured.update(kwargs);self.model=kwargs['model'];self.provider=kwargs['provider'];self.tools=[];self.compression_enabled=False;self.client=object()
            def run_conversation(self,**kwargs):return {'completed':True,'api_calls':1,'final_response':'{"ok":true}'}
        credentials={'api_key':'test-only','base_url':'https://chatgpt.com/backend-api/codex'}
        with patch.object(job_module,'runtime',return_value=(Agent,credentials)):
            self.assertEqual(job_module.call(self.job()|{'profile':'test'},'Return JSON',{}),{'ok':True})
        self.assertEqual(captured['model'],'gpt-6.1-terra');self.assertEqual(captured['reasoning_config'],{'effort':'low'})
        self.assertEqual(captured['provider'],'openai-codex');self.assertEqual(captured['fallback_model'],[])
    def test_semantic_failure_has_one_bounded_repair(self):
        with patch.object(job_module,'call',side_effect=[{'headline':'bad'},{'supported':False,'issues':['condition lost']},{'headline':'fixed'},{'supported':True,'issues':[]}]) as call:
            result=job_module.main(self.job());self.assertEqual(call.call_count,4);self.assertEqual(result['draft']['headline'],'📢 fixed')
    def test_persistent_failure_never_loops_or_changes_provider(self):
        with patch.object(job_module,'call',side_effect=[{}, {'supported':False,'issues':['unsupported']},{}, {'supported':False,'issues':['unsupported']}]) as call:
            result=job_module.main(self.job());self.assertEqual(call.call_count,4);self.assertFalse(result['audit']['supported']);self.assertEqual(result['runtime']['fallback_count'],0)
    def test_expired_job_does_not_spend_a_turn(self):
        with patch.object(job_module,'call') as call:
            with self.assertRaises(RuntimeError):job_module.main(self.job()|{'deadline':0})
            call.assert_not_called()
    def test_caption_overflow_is_rewritten_and_reaudited_without_truncation(self):
        long={'headline':'Başlık','body':'Uzun içerik '*120,'hashtags':['#Ekonomi','#Finans']}
        short={'headline':'Başlık','body':'Önemli bilgi korunmuş kısa metin.','hashtags':['#Ekonomi','#Finans']}
        with patch.object(job_module,'call',side_effect=[long,{'supported':True,'issues':[]},short,{'supported':True,'issues':[]}]) as call:
            result=job_module.main(self.job());self.assertEqual(call.call_count,4);self.assertEqual(result['draft'],{**short,'headline':'📢 Başlık'})
        self.assertTrue(job_module.presentation_issues({'headline':'🌍'*510,'body':'Açıklama','hashtags':['#Ekonomi','#Finans']}))

    def test_publisher_attribution_and_market_tags_trigger_bounded_repair(self):
        policy={'publisher_names':['CNBC-e'],'required_hashtags':['#Borsa','#BIST','#THYAO']}
        bad={'headline':'Şirket yeni sözleşmesini duyurdu','body':'CNBC-e’nin haberine göre sözleşme imzalandı.','hashtags':['#Şirket','#Yatırım']}
        good={**bad,'body':'Şirket yeni sözleşmenin onaya bağlı olduğunu açıkladı.','hashtags':policy['required_hashtags']}
        self.assertEqual(len(job_module.presentation_issues(bad,policy)),2)
        self.assertEqual(job_module.presentation_issues(good,policy),[])
        with patch.object(job_module,'call',side_effect=[bad,{'supported':True,'issues':[]},good,{'supported':True,'issues':[]}]) as call:
            result=job_module.main(self.job()|{'editorial_policy':policy})
            self.assertEqual(call.call_count,4);self.assertEqual(result['draft'],{**good,'headline':'📢 '+good['headline']})
            self.assertEqual(call.call_args_list[0].args[2]['editorial_policy'],policy)

    def test_single_headline_emoji_and_no_body_or_card_emoji(self):
        d={'headline':'Şirket yeni yatırımını duyurdu','body':'İzin süreci sürüyor.','card_headline':'Yeni yatırım','card_body':'İzin süreci sürüyor.','hashtags':['#Borsa','#BIST']}
        good=job_module.ensure_headline_emoji(d)
        self.assertEqual(good['headline'],'📢 '+d['headline'])
        self.assertEqual(job_module.ensure_headline_emoji(good),good)
        self.assertEqual(job_module.presentation_issues(good),[])
        for changes in [{'headline':'📢🚨 Açıklama'},{'headline':'Açıklama 📢'},{'body':'İzin süreci sürüyor. 📊'},{'card_body':'🏢 Yatırım planlanıyor'},{'headline':'🇹🇷 Açıklama'}]:
            self.assertTrue(job_module.presentation_issues(good|changes))

    def test_json_fence_handling_does_not_accept_prose(self):
        self.assertEqual(job_module.decode('```json\n{"başlık":"Haber"}\n```'),{'başlık':'Haber'})
        with self.assertRaises(ValueError):job_module.decode('Result is not a JSON object')

if __name__=='__main__':unittest.main()
