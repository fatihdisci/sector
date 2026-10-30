import copy,json,pathlib,tempfile,time,unittest
from shared_api_fixture import bundle
from daily_api_budget import DailyBudget,increase_daily_limit
from daily_limit_transition import apply,recover,rollback,atomic
class TransitionTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=pathlib.Path(self.temp.name).resolve();self.cfg=json.loads(json.dumps(bundle(self.root)['text_config']));s=self.cfg['shared_budget'];s.pop('promo');s.update(mode='daily_bot',timezone='Europe/Istanbul',families=['text'],plan_id=None,limit_micro_usd=2000000,consent={'id':'old-consent','approved_at':time.time()-1,'paid_balance_risk_accepted':True},initial_exposure=[]);s['profiles']={'text':s['profiles']['text']};s['ledger_path']=str(self.root/'news-api-budget.sqlite');self.cfg['hard_limit_micro_usd']=2000000;atomic(self.root/'news-api-config.json',self.cfg);b=DailyBudget(s['ledger_path'],s);b.reserve('x','text','x','generate','0'*64);b.settle('x','text',{'usage':{'input_tokens':100,'output_tokens':10}});self.used=b.used();b.db.close()
 def test_apply_and_rollback(self):
  old,new=apply(self.root,'owner-daily-3');b=DailyBudget(new['shared_budget']['ledger_path'],new['shared_budget']);self.assertEqual(b.used(),self.used);b.db.close();rollback(self.root,old,new);self.assertEqual(json.loads((self.root/'news-api-config.json').read_text()),old)
 def test_recovery_after_ledger_before_config(self):
  old=copy.deepcopy(self.cfg);new=copy.deepcopy(old);new['hard_limit_micro_usd']=3000000;new['shared_budget']['limit_micro_usd']=3000000;new['shared_budget']['consent']={'id':'owner-daily-3','approved_at':time.time(),'paid_balance_risk_accepted':True};atomic(self.root/'news-api-limit-transition.json',{'old':old,'new':new});increase_daily_limit(self.root/'news-api-budget.sqlite',old['shared_budget'],new['shared_budget']);recover(self.root);self.assertEqual(json.loads((self.root/'news-api-config.json').read_text()),new)
