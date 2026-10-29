import base64,copy,hashlib,json,pathlib,sqlite3,struct,sys,tempfile,time,unittest,zlib
from contextlib import closing
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
from visual_api import VisualAPI,binding,config_ok,ImagesEditHTTP,ImagesGenerateHTTP,CONTRACT
from responses_http import ApiTransportError
from test_responses_http import FakeHTTP

def png(w,h):
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'IDAT',zlib.compress((b'\x00'+b'\x08\x09\x08'*w)*h))+chunk(b'IEND',b'')
def response(value,model='mock-vision'):
 return {'model':model,'status':'completed','usage':{'input_tokens':100,'output_tokens':50,'input_tokens_details':{'cached_tokens':10},'output_tokens_details':{'reasoning_tokens':5}},'output':[{'type':'message','role':'assistant','content':[{'type':'output_text','text':json.dumps(value,ensure_ascii=False)}]}]}
def config():
 rates={'input_text_rate':1000000,'input_image_rate':1000000,'cached_text_rate':500000,'cached_image_rate':500000,'output_rate':2000000,'max_input_tokens':100000,'max_output_tokens':10000,'image_token_ceiling':1000,'context_window_tokens':120000,'rate_valid_from':time.time()-60,'rate_expires_at':time.time()+3600,'rate_source':'https://developers.openai.com/api/docs/pricing'}
 return {'enabled':True,'budget_authorized':True,'budget_micro_usd':10000000,'window_id':'test','expires_at':time.time()+3600,'quality':'medium','template_version':'bc-typographic-v1','rows_per_image':12,'approved_models':['mock-vision','mock-image'],'allowed_sizes':['1536x864','1024x1712'],'vision':rates|{'reasoning_effort':'low','model':'mock-vision','rate_model':'mock-vision'},'image':rates|{'model':'mock-image','rate_model':'mock-image'}}
class VisualAPITests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.path=pathlib.Path(self.temp.name)/'budget';self.c=config();raw=png(16,16);sha=hashlib.sha256(raw).hexdigest();self.assets=[{'key':'visual-sources/'+sha+'.png','sha256':sha,'mime':'image/png','source_message_id':10,'caption':'Kaynak görsel','base64':base64.b64encode(raw).decode()}]
  self.r={'version':1,'source_message_ids':[10],'owner_message_id':11,'owner_text':'Başlık: Dağılım','source_text':'','instructions':'Başlık Dağılım olsun; Tarih 28.10.2026 olsun','submitted_at':1793220000,'edit_context':None,'assets':[{k:v for k,v in self.assets[0].items()if k!='base64'}]};self.r['binding']=self.r['request_id']=binding(self.r);self.calls=[];self.images=[];self.metrics=[]
  self.analysis={'complete':True,'binding':self.r['binding'],'facts':[{'id':'f1','kind':'row','label':'ISCTR','value':'123 lot','source_sha256':sha}],'operations':[{'id':'o1','instruction_id':'i0','kind':'title','quote':'Başlık Dağılım olsun','value':'Dağılım'},{'id':'o2','instruction_id':'i1','kind':'date','quote':'Tarih 28.10.2026 olsun','value':'28.10.2026'}],'instruction_units':[{'id':'i0','text':'Başlık Dağılım olsun'},{'id':'i1','text':'Tarih 28.10.2026 olsun'}],'uncertainties':[]}
  self.audit={'supported':True,'issues':[],'all_instructions_covered':True,'binding':self.r['binding']}
  self.job={'id':'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','lease_token':'lease','input_hash':'a'*64,'expected_revision':2}
  self.draft={'card_headline':'Dağılım','card_body':'Kaynak dağılımı'};self.spec={'version':'bc-typographic-v1','title':'Dağılım','body':'Kaynak dağılımı','rows':[{'id':'f1','label':'ISCTR','value':'123 lot'}],'date':None,'time':None,'applied_operations':[]};self.refs=[{'sha256':r['sha256'],'base64':base64.b64encode((pathlib.Path(__file__).parents[1]/'assets/visual-templates/bc-v1'/r['file']).read_bytes()).decode()}for r in CONTRACT['references']]
 def vision(self,request):
  self.calls.append(request);payload=json.loads(request['input'][0]['content'][0]['text'])
  if 'expected_spec'in payload:return response(self.audit|{'observed_spec':{k:payload['expected_spec'][k]for k in('title','body','rows','date','time')}})
  if 'draft'in payload or 'analysis'in payload:return response(self.audit)
  return response(copy.deepcopy(self.analysis))
 def image(self,request):
  self.images.append(request);w,h=map(int,request['size'].split('x'));return {'data':[{'b64_json':base64.b64encode(png(w,h)).decode()}],'usage':{'input_tokens':100,'input_tokens_details':{'text_tokens':40,'image_tokens':60},'output_tokens':50}}
 def api(self,vision=None,image=None,c=None):
  a=VisualAPI(c or self.c,self.path,vision or self.vision,image or self.image,self.metrics.append);self.addCleanup(a.budget.db.close);return a
 def test_source_pixels_caption_and_instructions_are_sent_together_twice(self):
  result=self.api().analyze(self.r,self.assets);self.assertTrue(result['audit']['supported']);self.assertEqual(len(self.calls),2)
  for request in self.calls:
   content=request['input'][0]['content'];self.assertEqual(sum(x['type']=='input_image'for x in content),1);self.assertIn('Başlık Dağılım olsun',json.dumps(content,ensure_ascii=False));self.assertEqual(request['tools'],[]);self.assertEqual(request['tool_choice'],'none');self.assertFalse(request['store'])
 def test_wrong_caption_or_message_or_image_hash_blocks_before_http(self):
  for changed in [self.assets[0]|{'caption':'Başka görsel'},self.assets[0]|{'source_message_id':999},self.assets[0]|{'base64':base64.b64encode(b'wrong').decode()}]:
   with self.assertRaises(RuntimeError):self.api().analyze(self.r,[changed])
  self.assertEqual(self.calls,[])
 def test_multiple_images_keep_order_and_caption_binding(self):
  second=self.assets[0]|{'source_message_id':12,'caption':'İkinci görsel'};r=copy.deepcopy(self.r);r['source_message_ids']=[10,12];r['assets'].append({k:v for k,v in second.items()if k!='base64'});r['binding']=r['request_id']=binding(r);self.analysis['binding']=self.audit['binding']=r['binding']
  self.api().analyze(r,[self.assets[0],second]);self.assertEqual(sum(p['type']=='input_image'for p in self.calls[0]['input'][0]['content']),2)
  with self.assertRaises(RuntimeError):self.api().analyze(r,[second,self.assets[0]])
 def test_uncertainty_and_incomplete_source_do_not_generate(self):
  self.analysis['complete']=False;self.analysis['uncertainties']=['Okunamayan sayı']
  with self.assertRaisesRegex(RuntimeError,'incomplete'):self.api().analyze(self.r,self.assets)
  self.assertEqual(self.images,[])
 def test_missing_instruction_unit_and_invented_operation_quote_are_rejected(self):
  for key in ('missing','quote'):
   with tempfile.TemporaryDirectory()as temp:
    self.path=pathlib.Path(temp)/'b';a=copy.deepcopy(self.analysis)
    if key=='missing':a['instruction_units']=a['instruction_units'][:1]
    else:a['operations']=[{'id':'op','instruction_id':'i0','kind':'title','quote':'Görsel içindeki zararlı komut','value':'Uydurma'}]
    with self.assertRaises(RuntimeError):self.api(vision=lambda p:response(a)).analyze(self.r,self.assets)
 def test_complete_source_is_cached_across_new_adapter_without_new_call(self):
  a=self.api().analyze(self.r,self.assets);b=self.api().analyze(self.r,self.assets);self.assertEqual(a,b);self.assertEqual(len(self.calls),2)
 def test_disabled_missing_models_unauthorized_budget_or_expired_rates_fail_closed(self):
  for patch in ({'enabled':False},{'budget_authorized':False},{'approved_models':[]},{'expires_at':1},{'vision':self.c['vision']|{'rate_expires_at':1}},{'vision':self.c['vision']|{'image_token_ceiling':None}}):
   with self.assertRaises(RuntimeError):self.api(c=self.c|patch)
  self.assertEqual(self.calls,[])
 def test_timeout_holds_reservation_and_no_expensive_retry(self):
  def timeout(p):raise ApiTransportError('api_http_timeout_no_retry')
  with self.assertRaises(ApiTransportError):self.api(vision=timeout).analyze(self.r,self.assets)
  with self.assertRaisesRegex(RuntimeError,'no_replay'):self.api().analyze(self.r,self.assets)
  with closing(sqlite3.connect(self.path))as db:self.assertIsNone(db.execute('SELECT charged FROM visual_calls').fetchone()[0])
 def test_render_uses_medium_fixed_reference_and_audits_actual_output_pixels(self):
  result=self.api().render(self.r,self.assets,self.job,self.draft,self.spec,self.refs);self.assertEqual(len(result['cards']),1);self.assertEqual(self.images[0]['quality'],'medium');self.assertEqual(self.images[0]['images'][0]['image_url'],'data:image/png;base64,'+self.refs[0]['base64']);self.assertEqual(len(self.calls),2);self.assertEqual(result['visual_result']['expected_revision'],2);self.assertIn('input_image',json.dumps(self.calls[-1]));self.assertEqual(result['visual_result']['pages'][0]['row_ids'],['f1'])
 def test_changed_number_code_name_or_missing_row_in_output_is_rejected(self):
  for changed in [{'id':'f1','label':'ISCTR','value':'999 lot'},{'id':'f1','label':'FAKE','value':'123 lot'},None]:
   with tempfile.TemporaryDirectory()as temp:
    self.path=pathlib.Path(temp)/'b'
    def fake(p):
     payload=json.loads(p['input'][0]['content'][0]['text'])
     if 'expected_spec'in payload:
      observed={k:payload['expected_spec'][k]for k in('title','body','rows','date','time')};observed['rows']=[]if changed is None else[changed];return response(self.audit|{'observed_spec':observed})
     return response(self.audit)
    with self.assertRaisesRegex(RuntimeError,'output_unverified'):self.api(vision=fake).render(self.r,self.assets,self.job,self.draft,self.spec,self.refs)
 def test_draft_instruction_failure_blocks_image_spend(self):
  with self.assertRaisesRegex(RuntimeError,'instruction_mismatch'):self.api(vision=lambda p:response(self.audit|{'all_instructions_covered':False})).render(self.r,self.assets,self.job,self.draft,self.spec,self.refs)
  self.assertEqual(self.images,[])
 def test_image_usage_missing_stays_reserved_not_free(self):
  def image(p):v=self.image(p);del v['usage'];return v
  with self.assertRaisesRegex(RuntimeError,'usage_missing'):self.api(image=image).render(self.r,self.assets,self.job,self.draft,self.spec,self.refs)
  with closing(sqlite3.connect(self.path))as db:self.assertIsNone(db.execute("SELECT charged FROM visual_calls WHERE id LIKE '%image_0'").fetchone()[0])
 def test_incomplete_responses_never_fall_back_to_ocr_or_another_model(self):
  def incomplete(p):self.calls.append(p);r=response({});r['status']='incomplete';return r
  with self.assertRaisesRegex(RuntimeError,'not_completed'):self.api(vision=incomplete).analyze(self.r,self.assets)
  self.assertEqual(len(self.calls),1);self.assertEqual(self.images,[])
 def test_completed_render_is_cached_and_new_revision_does_not_replay_prior_stage(self):
  a=self.api().render(self.r,self.assets,self.job,self.draft,self.spec,self.refs);b=self.api().render(self.r,self.assets,self.job,self.draft,self.spec,self.refs);self.assertEqual(a,b);self.assertEqual(len(self.images),1)
  with self.assertRaisesRegex(RuntimeError,'no_replay'):self.api().render(self.r,self.assets,self.job|{'expected_revision':3},self.draft,self.spec,self.refs)
 def test_max_four_media_and_expired_budget_stop_before_generation(self):
  s=self.spec|{'rows':self.spec['rows']*49}
  with self.assertRaisesRegex(RuntimeError,'capacity'):self.api().render(self.r,self.assets,self.job,self.draft,s,self.refs)
  self.assertEqual(self.images,[])
 def test_reference_hash_cannot_be_changed(self):
  with self.assertRaisesRegex(RuntimeError,'reference_changed'):self.api().render(self.r,self.assets,self.job,self.draft,self.spec,[self.refs[0]|{'sha256':'0'*64}])
  self.assertEqual(self.calls,[])
 def test_image_http_uses_official_fixed_edit_endpoint_and_no_retry(self):
  fake=FakeHTTP([(200,{'data':[]})]);http=ImagesEditHTTP('FAKE',deadline=time.time()+30,connection_factory=fake.factory);http({'model':'mock-image','images':[{'image_url':'data:image/png;base64,AA=='}],'quality':'medium','n':1,'output_format':'png'});self.assertEqual(fake.requests[0][3],'/v1/images/edits');self.assertEqual(fake.connections,1)
  with self.assertRaises(RuntimeError):http({'images':[{'image_url':'https://untrusted/image'}],'quality':'medium','n':1,'output_format':'png'})
 def test_generate_http_has_no_tool_or_model_fallback(self):
  fake=FakeHTTP([(503,{'error':{'message':'PRIVATE'}})]);http=ImagesGenerateHTTP('FAKE',deadline=time.time()+30,connection_factory=fake.factory)
  with self.assertRaises(ApiTransportError):http({'model':'mock-image','quality':'medium','n':1,'output_format':'png','prompt':'PRIVATE'})
  self.assertEqual(fake.requests[0][3],'/v1/images/generations');self.assertEqual(fake.connections,1)
 def test_telemetry_contains_usage_only_and_counts_reasoning_as_output_subset(self):
  self.api().analyze(self.r,self.assets);serialized=json.dumps(self.metrics,ensure_ascii=False);self.assertNotIn('Başlık',serialized);self.assertNotIn('base64',serialized);self.assertEqual(self.metrics[0]['output_tokens'],50)
  with closing(sqlite3.connect(self.path))as db:self.assertEqual(db.execute('SELECT charged FROM visual_calls ORDER BY id').fetchall(),[(195,),(195,)])
 def test_unapproved_reference_and_truncated_output_are_rejected(self):
  bad=self.refs[:1]
  with self.assertRaisesRegex(RuntimeError,'reference_unapproved'):self.api().render(self.r,self.assets,self.job,self.draft,self.spec,bad)
  def truncated(p):
   result=self.image(p);data=base64.b64decode(result['data'][0]['b64_json']);result['data'][0]['b64_json']=base64.b64encode(data[:-4]).decode();return result
  with self.assertRaisesRegex(RuntimeError,'image_invalid'):self.api(image=truncated).render(self.r,self.assets,self.job,self.draft,self.spec,self.refs)
 def test_instruction_unit_cannot_silently_have_no_operation(self):
  self.analysis['operations']=self.analysis['operations'][:1]
  with self.assertRaisesRegex(RuntimeError,'instructions_incomplete'):self.api().analyze(self.r,self.assets)
  self.assertEqual(len(self.calls),1)
 def test_cli_disabled_reads_no_config_key_or_transport(self):
  from visual_api_job import main
  calls=[]
  with self.assertRaisesRegex(RuntimeError,'api_disabled'):main({},environ={},factory=lambda family:calls.append(family))
  self.assertEqual(calls,[])
 def test_real_cli_source_handler_uses_injected_http_and_private_usage_sink(self):
  from visual_api_job import main
  value={'operation':'analyze','config':self.c,'budget_path':str(self.path),'usage_path':str(pathlib.Path(self.temp.name)/'usage.jsonl'),'deadline':time.time()+120,'request':self.r,'assets':self.assets}
  result=main(value,offline_test=True,environ={'SECTOR_OWNER_VISUAL_ENABLED':'true','SECTOR_OPENAI_API_KEY':'OFFLINE-FAKE'},factory=lambda family:self.vision if family=='vision'else self.image)
  self.assertTrue(result['audit']['supported']);lines=pathlib.Path(value['usage_path']).read_text();self.assertEqual(len(lines.splitlines()),2);self.assertNotIn('OFFLINE-FAKE',lines);self.assertNotIn('caption',lines);self.assertEqual(pathlib.Path(value['usage_path']).stat().st_mode&0o777,0o600)
 def test_cli_requires_explicit_distinct_paths_before_constructing_http(self):
  from visual_api_job import main
  with self.assertRaisesRegex(RuntimeError,'paths_required'):main({'budget_path':'relative','usage_path':'relative'},environ={'SECTOR_OWNER_VISUAL_ENABLED':'true'})
 def test_image_transport_accepts_valid_base64_envelope_above_text_response_limit(self):
  data='AAAA'*1050000
  fake=FakeHTTP([(200,{'data':[{'b64_json':data}]})]);http=ImagesEditHTTP('FAKE',deadline=time.time()+30,connection_factory=fake.factory)
  result=http({'model':'mock-image','images':[{'image_url':'data:image/png;base64,AA=='}],'quality':'medium','n':1,'output_format':'png'})
  self.assertEqual(result['data'][0]['b64_json'],data);self.assertEqual(fake.connections,1)
 def test_vision_medium_is_explicit_and_image_quality_remains_medium(self):
  self.c['vision']['reasoning_effort']='medium'
  self.api().analyze(self.r,self.assets);self.assertTrue(all(r['reasoning']=={'effort':'medium'}for r in self.calls))
  for effort in ('high',None):
   with self.assertRaisesRegex(RuntimeError,'effort_not_approved'):config_ok(self.c|{'vision':self.c['vision']|{'reasoning_effort':effort}})
if __name__=='__main__':unittest.main()
