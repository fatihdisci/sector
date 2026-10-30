"""Crash-recoverable daily cap transition; only the current ledger is updated."""
import json,os,pathlib,sqlite3,stat,time
from daily_api_budget import increase_daily_limit,rollback_daily_limit
from shared_api_budget import digest

def atomic(path,value):
 tmp=path.with_name(path.name+'.next');fd=os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 try:
  with os.fdopen(fd,'w') as f:json.dump(value,f,separators=(',',':'));f.flush();os.fsync(f.fileno())
  os.replace(tmp,path);df=os.open(path.parent,os.O_RDONLY);os.fsync(df);os.close(df)
 except BaseException:
  if tmp.exists():tmp.unlink()
  raise

def private(path):
 if path.is_symlink() or not path.is_file() or path.stat().st_uid!=os.getuid() or stat.S_IMODE(path.stat().st_mode)&0o077:raise RuntimeError('daily_transition_file_invalid')
 return json.loads(path.read_text())

def recover(root):
 root=pathlib.Path(root);marker=root/'news-api-limit-transition.json'
 if not marker.exists():return
 m=private(marker);old,new=m['old'],m['new'];ledger=root/'news-api-budget.sqlite';db=sqlite3.connect(ledger.resolve().as_uri()+'?mode=ro',uri=True)
 try:row=db.execute('SELECT terms FROM shared_windows WHERE id=?',(old['shared_budget']['window_id'],)).fetchone()
 finally:db.close()
 def h(v):return digest({k:x for k,x in v['shared_budget'].items() if k!='plan_id'})
 chosen=new if row==(h(new),) else old if row==(h(old),) else None
 if chosen is None:raise RuntimeError('daily_transition_ledger_mismatch')
 path=root/'news-api-config.json';actual=private(path)
 if actual not in (old,new):raise RuntimeError('daily_transition_config_mismatch')
 if actual!=chosen:atomic(path,chosen)
 marker.unlink()

def apply(root,consent_id):
 root=pathlib.Path(root);recover(root);path=root/'news-api-config.json';old=private(path);new=json.loads(json.dumps(old));new['hard_limit_micro_usd']=3000000;new['shared_budget']['limit_micro_usd']=3000000;new['shared_budget']['consent']={'id':consent_id,'approved_at':time.time(),'paid_balance_risk_accepted':True}
 marker=root/'news-api-limit-transition.json';atomic(marker,{'old':old,'new':new});increase_daily_limit(root/'news-api-budget.sqlite',old['shared_budget'],new['shared_budget']);atomic(path,new);marker.unlink();return old,new

def rollback(root,old,new):
 root=pathlib.Path(root);recover(root);path=root/'news-api-config.json';actual=private(path)
 if actual!=new:raise RuntimeError('daily_transition_rollback_mismatch')
 marker=root/'news-api-limit-transition.json';atomic(marker,{'old':old,'new':new});rollback_daily_limit(root/'news-api-budget.sqlite',old['shared_budget'],new['shared_budget']);atomic(path,old);marker.unlink()
