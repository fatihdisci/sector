"""Single internal service check; credential is already held by the live worker."""
import json,os,sys
from news_api_smoke import run
if __name__=='__main__':
 try:
  if len(sys.argv)!=2 or os.environ.get('SECTOR_OPENAI_API_ENABLED')!='true':raise RuntimeError()
  print(json.dumps(run(sys.argv[1],credential=lambda:os.environ.get('SECTOR_OPENAI_API_KEY'))))
 except Exception:
  print('{"state":"failed_no_retry","error":"api_canary_failed_no_retry"}')
