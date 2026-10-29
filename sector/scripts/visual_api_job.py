"""Explicit, disabled-by-default CLI. No secret read or I/O on import."""
import contextlib,io,json,os,sys,time
from visual_api import VisualAPI,config_ok,ImagesEditHTTP
from responses_http import ResponsesHTTP

def main(value,*,environ=None,factory=None,offline_test=False):
 env=os.environ if environ is None else environ
 if env.get('SECTOR_OWNER_VISUAL_ENABLED')!='true':raise RuntimeError('owner_visual_api_disabled')
 paths=[value.get('budget_path'),value.get('usage_path')]
 if not all(isinstance(p,str)and os.path.isabs(p)for p in paths)or len(set(paths))!=2:raise RuntimeError('visual_api_explicit_paths_required')
 c=value['config'];config_ok(c)
 if not offline_test:
  from shared_api_budget import require_shared
  require_shared(c,value['budget_path'],'visual')
 key=env.get('SECTOR_OPENAI_API_KEY')
 if not isinstance(key,str)or not key.strip()or '\n'in key or '\r'in key:raise RuntimeError('visual_api_key_missing')
 deadline=min(value['deadline'],c['expires_at'],c['vision']['rate_expires_at'],c['image']['rate_expires_at'])
 if deadline<=time.time():raise RuntimeError('owner_visual_deadline_expired')
 make=factory or (lambda family: (ResponsesHTTP if family=='vision'else ImagesEditHTTP)(key,deadline=deadline))
 # Usage sink deliberately excludes exception bodies, prompts, keys and images.
 def telemetry(row):
  path=value['usage_path'];safe={k:row.get(k)for k in('job_id','stage','provider','model','outcome','duration_ms','input_tokens','output_tokens')}
  fd=os.open(path,os.O_WRONLY|os.O_APPEND|os.O_CREAT|getattr(os,'O_NOFOLLOW',0),0o600)
  try:os.write(fd,(json.dumps(safe,separators=(',',':'))+'\n').encode())
  finally:os.close(fd)
 api=VisualAPI(c,value['budget_path'],make('vision'),make('image'),telemetry)
 try:
  if value['operation']=='analyze':return api.analyze(value['request'],value['assets'])
  if value['operation']=='render':return api.render(value['request'],value['assets'],value['job'],value['draft'],value['spec'],value['references'])
  raise RuntimeError('owner_visual_operation_invalid')
 finally:api.budget.db.close()
if __name__=='__main__':
 try:
  raw=sys.stdin.read(52_000_001)
  if len(raw)>52_000_000:raise RuntimeError('owner_visual_input_limit')
  with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):result=main(json.loads(raw))
  print(json.dumps(result,ensure_ascii=False,separators=(',',':')))
 except Exception:
  print(json.dumps({'error':'owner_visual_failed_no_retry'}),file=sys.stderr);sys.exit(1)
