"""Offline-only fixtures for shared-ledger/launcher/trial integration tests."""
import base64,copy,json,pathlib,struct,time,zlib,shutil
from api_candidate import ApiConfig,OfflineApiCandidate
from shared_api_budget import text_profile,visual_profile,SharedBudget
from visual_api import VisualAPI

def png(w,h):
 def chunk(k,v):return struct.pack('>I',len(v))+k+v+struct.pack('>I',zlib.crc32(k+v)&0xffffffff)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\x08\x09\x08'*w)*h))+chunk(b'IEND',b'')
def bundle(root):
 root=pathlib.Path(root).resolve();(root/'media').mkdir(exist_ok=True);(root/'source.png').write_bytes(png(16,16));now=time.time();expiry=now+600
 rates=dict(input_text_rate=1000000,input_image_rate=1000000,cached_text_rate=500000,cached_image_rate=500000,output_rate=1000000,max_input_tokens=100000,max_output_tokens=10000,image_token_ceiling=1000,context_window_tokens=120000,rate_valid_from=now-60,rate_expires_at=expiry,rate_source='https://developers.openai.com/api/docs/pricing')
 t=ApiConfig(enabled=True,budget_authorized=True,model='gpt-6.1-terra',reasoning_effort='medium',approved_models=('gpt-6.1-terra',),hard_limit_micro_usd=10000000,window_id='offline-test',expires_at=expiry,input_token_ceiling=100000,max_output_tokens=10000,context_window_tokens=120000,input_micro_usd_per_million=1000000,cached_micro_usd_per_million=500000,output_micro_usd_per_million=1000000,rate_table_model='gpt-6.1-terra',rate_table_valid_from=now-60,rate_table_expires_at=expiry,rate_table_source='https://developers.openai.com/api/docs/pricing')
 v=dict(enabled=True,budget_authorized=True,budget_micro_usd=10000000,window_id=t.window_id,expires_at=expiry,quality='medium',template_version='bc-typographic-v1',rows_per_image=12,allowed_sizes=['1536x864','1024x1712'],approved_models=['gpt-6.1-terra','gpt-image-2.5-sunburst-2026-09-08'],vision=rates|dict(model='gpt-6.1-terra',rate_model='gpt-6.1-terra',reasoning_effort='medium'),image=rates|dict(model='gpt-image-2.5-sunburst-2026-09-08',rate_model='gpt-image-2.5-sunburst-2026-09-08'))
 s=dict(version=1,authorized=True,window_id=t.window_id,ledger_path=str(root/'shared-budget.sqlite'),limit_micro_usd=t.hard_limit_micro_usd,expires_at=expiry,plan_id='offline-plan',promo=dict(verified=True,promo_only_verified=True,other_consumption_bounded=True,verification_id='FAKE-offline-evidence',remaining_micro_usd=11000000,other_consumption_bound_micro_usd=0,safety_margin_micro_usd=1000000,observed_at=now-1,valid_until=expiry,grant_expires_at=expiry),profiles=dict(text=text_profile(t),vision=visual_profile(v['vision']),image=visual_profile(v['image'])))
 text=t.__dict__|{'shared_budget':s};v['shared_budget']=s
 return dict(enabled=True,trial_root=str(root),media_path=str(root/'media'),source_path=str(root/'source.png'),media_backend='local',budget_path=s['ledger_path'],text_config=text,visual_config=v,approval=dict(approved=True,action='isolated-owner-visual-trial',keychain_read_approved=True,service='sectorhaber-openai-api',account='sectorhaber-news',expires_at=expiry),submitted_at=int(now),python_path=__import__('sys').executable,node_path=str(pathlib.Path(shutil.which('node')).resolve()),owner_text='',source_text='',caption='Offline fixture',instructions='')
def response(value,model):return dict(model=model,status='completed',output=[dict(type='message',role='assistant',content=[dict(type='output_text',text=json.dumps(value))])],usage=dict(input_tokens=100,output_tokens=50,input_tokens_details=dict(cached_tokens=0),output_tokens_details=dict(reasoning_tokens=10)))
def invoke(value):
 op=value['operation']
 if op=='setup':
  b=bundle(value['root']);s=b['text_config']['shared_budget'];budget=SharedBudget(b['budget_path'],s);budget.reserve_plan(s['plan_id'],['text']*4+['vision']*4+['image']);budget.db.close();return b
 if op=='finish':
  b=value['bundle'];budget=SharedBudget(b['budget_path'],b['text_config']['shared_budget']);budget.close_unused_plan();budget.db.close();return dict(ok=True)
 if op=='text':
  j=value['job'];c=ApiConfig(**value['config'])
  d=dict(headline='📊 ASELS için pay miktarı açıklandı',body='ASELS pay miktarı 100 lot olarak açıklandı.',card_headline='ASELS pay miktarı',card_body='Açıklanan miktar 100 lot oldu.',hashtags=['#Borsa','#ASELS'],entities=['ASELS'],event_key='isolated-api-test',category='bist',importance=80,template='info',claims=[dict(text='ASELS: 100 lot',evidence=[dict(document=0,passage='visual_source',quote='Kaynakta okunan değerler: ASELS: 100 lot')])],uncertainties=[])
  def http(r):return response(dict(supported=True,issues=[])if'draft'in json.loads(r['input'])else d,c.model)
  return OfflineApiCandidate(c,value['budget_path'],http).run_job(j)
 r=value['request'];bind=r['binding'];audit=dict(supported=True,issues=[],all_instructions_covered=True,binding=bind)
 def vision(request):
  payload=json.loads(request['input'][0]['content'][0]['text'])
  if'expected_spec'in payload:return response(audit|{'observed_spec':{k:payload['expected_spec'][k]for k in('title','body','rows','date','time')}},value['config']['vision']['model'])
  if'draft'in payload or'analysis'in payload:return response(audit,value['config']['vision']['model'])
  return response(dict(complete=True,binding=bind,facts=[dict(id='f1',kind='row',label='ASELS',value='100 lot',source_sha256=r['assets'][0]['sha256'])],operations=[],instruction_units=[],uncertainties=[]),value['config']['vision']['model'])
 def image(request):
  w,h=map(int,request['size'].split('x'));return dict(data=[dict(b64_json=base64.b64encode(png(w,h)).decode())],usage=dict(input_tokens=100,input_tokens_details=dict(text_tokens=40,image_tokens=60),output_tokens=50))
 api=VisualAPI(value['config'],value['budget_path'],vision,image)
 try:
  if op=='analyze':return api.analyze(r,value['assets'])
  if op=='render':return api.render(r,value['assets'],value['job'],value['draft'],value['spec'],value['references'])
  raise RuntimeError('offline_fixture_operation')
 finally:api.budget.db.close()
if __name__=='__main__':
 import sys
 print(json.dumps(invoke(json.load(sys.stdin)),ensure_ascii=False))
