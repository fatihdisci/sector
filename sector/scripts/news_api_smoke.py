"""One explicitly approved text-only API check. No live DB, Telegram, X or visual calls."""
import hashlib,json,os,pathlib,subprocess,sys,time,uuid
from news_api_preflight import preflight
from api_candidate import OfflineApiCandidate,JsonlTelemetry
from responses_http import ResponsesHTTP,ApiTransportError

def run(root,*,credential=None,transport_factory=ResponsesHTTP):
 root=pathlib.Path(root);c=preflight(root)
 # A permanent attempt marker prevents replay after an unknown process/network outcome.
 marker=root/'news-api-smoke-result.json'
 fd=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 job_id=str(uuid.uuid4());os.write(fd,json.dumps({'state':'started','job_id':job_id}).encode());os.close(fd)
 attempted=False;transport=None
 try:
  def load():
   try:
    r=subprocess.run(['/usr/bin/security','find-generic-password','-s','sectorhaber-openai-api','-a','sectorhaber-news','-w'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15,check=True)
    return r.stdout.decode().rstrip('\r\n')
   except Exception:raise RuntimeError('news_api_keychain_unavailable')from None
  key=(credential or load)()
  if not isinstance(key,str)or not key.strip()or len(key)>8192 or any(x in key for x in '\r\n\0'):raise RuntimeError('news_api_keychain_invalid')
  job={'id':job_id,'input_hash':hashlib.sha256(b'text-only-approved-connection-check').hexdigest(),'lease_token':str(uuid.uuid4()),'model':c.model,'effort':c.reasoning_effort,'provider':'openai-api','allowed_tools':[],'documents':[],'metric_stage':'generate','deadline':min(time.time()+90,c.expires_at)}
  transport=transport_factory(key,deadline=job['deadline']);key=None
  api=OfflineApiCandidate(c,str(root/'news-api-budget.sqlite'),transport,JsonlTelemetry(str(root/'news-api-usage.jsonl'),c.approved_models))
  attempted=True;result=api.call(job,'Return only the JSON object {"ok":true}. This is a connection check; do not use tools.',{'check':'news text API connection'})
  if result!={'ok':True}:raise RuntimeError('news_api_smoke_output_invalid')
  import sqlite3
  db=sqlite3.connect(root/'news-api-budget.sqlite');row=db.execute('SELECT reserved,charged,state FROM shared_calls WHERE job_id=?',(job_id,)).fetchone();db.close()
  receipt={'state':'completed','network_attempted':True,'job_id':job_id,'model':api.server_model,'effort':c.reasoning_effort,'reserved_micro_usd':row[0],'actual_cost_micro_usd':row[1],'ledger_state':row[2]}
  usage=json.loads((root/'news-api-usage.jsonl').read_text().splitlines()[-1]);receipt['usage']={k:usage.get(k)for k in ['input_tokens','output_tokens','cached_tokens','reasoning_tokens']}
 except Exception as e:
  allowed={'news_api_keychain_unavailable','news_api_keychain_invalid','api_http_auth_no_retry','api_http_rate_limited_no_retry','api_http_error_no_retry','api_http_timeout_no_retry','api_http_transport_uncertain_no_retry','api_server_model_unapproved','api_response_not_completed','news_api_smoke_output_invalid','shared_budget_expired','promo_evidence_stale_or_expired'}
  code=str(e)if str(e)in allowed else'news_api_smoke_failed_no_retry'
  receipt={'state':'failed_no_retry','job_id':job_id,'network_attempted':attempted,'error':code}
 safe=getattr(transport,'safe_receipt',{})
 if isinstance(safe,dict):
  if type(safe.get('http_status'))is int and 100<=safe['http_status']<=599:receipt['http_status']=safe['http_status']
  if type(safe.get('response_json_received'))is bool:receipt['response_json_received']=safe['response_json_received']
  allowed={'invalid_api_key','insufficient_quota','model_not_found','model_not_available','unsupported_parameter','invalid_request_error','rate_limit_exceeded','permission_denied','invalid_project','project_not_found','billing_hard_limit_reached','unsupported_value','organization_restricted','other'}
  if isinstance(safe.get('provider_error_class'),str)and safe['provider_error_class']in allowed:receipt['provider_error_class']=safe['provider_error_class']
  params={'model','input','instructions','max_output_tokens','reasoning','reasoning.effort','text','text.format','text.format.type','service_tier','tool_choice','tools','store','background','truncation','stream','other'}
  if isinstance(safe.get('provider_error_param'),str)and safe['provider_error_param']in params:receipt['provider_error_param']=safe['provider_error_param']
  reasons={'unclassified','json_input_instruction_required','service_tier_not_allowed','unsupported_parameter_or_value','model_access_not_allowed'}
  if isinstance(safe.get('provider_error_reason'),str)and safe['provider_error_reason']in reasons:receipt['provider_error_reason']=safe['provider_error_reason']
 marker.write_text(json.dumps(receipt));return receipt

if __name__=='__main__':
 try:
  if len(sys.argv)!=3 or sys.argv[1]!='--approved-single-text-check':raise RuntimeError()
  result=run(sys.argv[2]);print(json.dumps(result));sys.exit(0 if result['state']=='completed'else 1)
 except Exception:
  print('{"state":"blocked","error":"news_api_preflight_or_prior_attempt"}');sys.exit(1)
