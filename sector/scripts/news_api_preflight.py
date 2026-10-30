"""Text-only startup gate. No credential lookup or HTTP; CLI emits a fixed receipt."""
import json,os,pathlib,stat,sys,time
from api_candidate import ApiConfig,validate_config
from shared_api_budget import require_shared,SharedBudget

def private_file(path):
 p=pathlib.Path(path)
 if not p.is_absolute()or p.is_symlink()or not p.is_file()or p.stat().st_uid!=os.getuid()or stat.S_IMODE(p.stat().st_mode)&0o077:raise RuntimeError('news_api_private_file_required')
 return p

def preflight(root,*,require_available=True):
 root=pathlib.Path(root)
 if not root.is_absolute()or root.is_symlink()or root.resolve()!=root:raise RuntimeError('news_api_root_invalid')
 from daily_limit_transition import recover
 recover(root)
 control=json.loads(private_file(root/'news-api-provider.json').read_text())
 if control!={'version':1,'provider':'openai-api','enabled':True,'purpose':'news_text_only'}:raise RuntimeError('news_api_provider_not_approved')
 c=ApiConfig(**json.loads(private_file(root/'news-api-config.json').read_text()));validate_config(c,time.time())
 if c.model!='gpt-6.1-terra'or c.reasoning_effort!='medium':raise RuntimeError('news_api_model_not_approved')
 ledger=root/'news-api-budget.sqlite';s=require_shared(c,str(ledger),'text')
 if s.get('families')!=['text']:raise RuntimeError('news_api_text_only_required')
 for p in [ledger,root/'news-api-usage.jsonl']:
  if p.exists()or p.is_symlink():private_file(p)
 if s.get('mode')=='daily_bot':
  from daily_api_budget import DailyBudget
  b=DailyBudget(str(ledger),s)
 else:b=SharedBudget(str(ledger),s)
 try:
  b.check()
  if require_available and b.used()+b.amount('text')>s['limit_micro_usd']:raise RuntimeError('shared_budget_exhausted')
 finally:b.db.close()
 return c

if __name__=='__main__':
 try:
  if len(sys.argv) not in (2,3) or len(sys.argv)==3 and sys.argv[2]!='--startup':raise RuntimeError('news_api_root_required')
  preflight(sys.argv[1],require_available=len(sys.argv)==2);print('{"ready":true,"purpose":"news_text_only"}')
 except Exception:
  print('{"error":"news_api_preflight_failed"}',file=sys.stderr);sys.exit(1)
