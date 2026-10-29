import sys, types, unittest, unittest.mock as mock, io, json, importlib.util, contextlib
fake=types.ModuleType('tweetkit_x');fake.TweetKit=object;fake.constants=types.SimpleNamespace(QUERY_IDS={'TweetResultByRestId':'q','CreateNoteTweet':'note-q'},CREATE_TWEET_FEATURES={'test':True},USER_TWEETS_FEATURES={},GQL_BASE='https://x.invalid')
sys.modules['tweetkit_x']=fake
spec=importlib.util.spec_from_file_location('bridge','scripts/tweetkit_bridge.py'); bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
class Client:
 def __init__(self,*a,**kw): self.posts=0; self._session=self
 def whoami(self):return {'user_id':'335502216'}
 def user_profile(self,*a):return {'ok':True,'id':'335502216','username':'borsacakali'}
 def post(self,*a,**kw):raise AssertionError('network forbidden in test')
 def create_tweet(self,*a,**kw):self.posts+=1;return {'ok':True,'id':'99'}
 def get_tweet(self,*a):return {'ok':True,'author_id':'335502216','author':'borsacakali','text':'example'}
 def _headers(self,*a):return {}
 def get(self,*a,**kw):
  return types.SimpleNamespace(status_code=200,json=lambda:{'legacy':{'id_str':'99','full_text':'example','extended_entities':{'media':[{'type':'photo','id_str':'12'}]}}})
class BridgeTest(unittest.TestCase):
 def run_request(self,request,client=None,key=0):
  if request.get('op')=='post':request.setdefault('weighted_length',len(request.get('text','')))
  output=io.StringIO(); c=client or Client()
  with mock.patch.object(bridge.sys,'stdin',io.StringIO(json.dumps(request))),mock.patch.object(bridge.subprocess,'run',return_value=types.SimpleNamespace(returncode=key,stdout='auth_token=mock-secret; ct0=mock-csrf; twid=u%3D335502216')),mock.patch.object(bridge,'TweetKit',return_value=c),contextlib.redirect_stdout(output):bridge.main()
  result=json.loads(output.getvalue());self.assertNotIn('mock-secret',output.getvalue());return result,c
 def test_identity_success_and_missing_key(self):
  self.assertEqual(self.run_request({'op':'identity'})[0]['id'],'335502216')
  self.assertEqual(self.run_request({'op':'identity'},key=1)[0]['error'],'x_keychain_unavailable')
 def test_renamed_handle_requires_same_account_and_rejects_old_handle(self):
  self.assertEqual(self.run_request({'op':'identity'})[0]['username'],'borsacakali')
  for profile in ({'ok':True,'id':'335502216','username':'endeks_haber'},{'ok':True,'id':'999','username':'borsacakali'}):
   c=Client();c.user_profile=lambda *a,p=profile:p
   result,c=self.run_request({'op':'post','text':'example','media':['12']},c)
   self.assertEqual(result['error'],'x_identity_unverified');self.assertEqual(c.posts,0)
 def test_empty_main_key_does_not_use_ambient_or_file(self):
  output=io.StringIO()
  with mock.patch.object(bridge.sys,'stdin',io.StringIO('{"op":"identity"}')),mock.patch.dict('os.environ',{'TWEETKIT_COOKIE':'ambient-value'}),mock.patch.object(bridge.subprocess,'run',return_value=types.SimpleNamespace(returncode=0,stdout='')),mock.patch.object(bridge,'TweetKit') as tk,contextlib.redirect_stdout(output): bridge.main()
  self.assertEqual(json.loads(output.getvalue())['error'],'x_keychain_invalid');tk.assert_not_called()
 def test_side_mismatch_fails_before_upload(self):
  c=Client();c.whoami=lambda:{'user_id':'1855628451237281792'}
  self.assertEqual(self.run_request({'op':'upload','image':'abc'},c)[0]['error'],'x_wrong_account')
 def test_invalid_image_fails(self):self.assertEqual(self.run_request({'op':'upload','image':'aA=='})[0]['error'],'x_request_failed')
 def test_post_success_requires_verified_receipt(self):
  r,c=self.run_request({'op':'post','text':'example','media':['12']});self.assertEqual(r['id'],'99');self.assertEqual(c.posts,1)
 def test_wrong_receipt_author_is_uncertain(self):
  c=Client();c.get_tweet=lambda *a:{'ok':True,'author_id':'1855628451237281792','author':'sectorrrrr35','text':'example'}
  r,c=self.run_request({'op':'post','text':'example','media':['12']},c);self.assertEqual(r['error'],'x_post_uncertain');self.assertEqual(r['id'],'99');self.assertEqual(c.posts,1)
 def test_submission_timeout_never_retries(self):
  c=Client()
  def timeout(*a,**kw):c.posts+=1;raise TimeoutError()
  c.create_tweet=timeout
  r,c=self.run_request({'op':'post','text':'example','media':['12']},c);self.assertEqual(r['error'],'x_post_uncertain');self.assertEqual(r['diagnostic']['categories'],['timeout']);self.assertEqual(c.posts,1)
 def test_incomplete_readback_is_uncertain(self):
  c=Client();c.get=lambda *a,**kw:types.SimpleNamespace(status_code=200,json=lambda:{'legacy':{'id_str':'99','full_text':'example','extended_entities':{'media':[]}}})
  r,c=self.run_request({'op':'post','text':'example','media':['12']},c);self.assertEqual(r['error'],'x_post_uncertain');self.assertEqual(r['id'],'99');self.assertEqual(c.posts,1)
 def test_response_metadata_is_allowlisted_and_private_text_never_recorded(self):
  bodies=[
   ({'data':{'create_tweet':{'tweet_results':{'result':{'rest_id':'99','private_text':'DO_NOT_LEAK'}}}}},'rest_id'),
   ({'data':{'create_tweet':{'tweet_results':{'result':{'tweet':{'rest_id':'99'},'quoted_status':{'rest_id':'111'}}}}}},'nested_rest_id'),
   ({'data':{'create_tweet':{'tweet_results':{'result':{'quoted_status':{'rest_id':'111'}}}}}},'result'),
  ]
  for body,flag in bodies:
   meta=bridge.response_diagnostic(types.SimpleNamespace(status_code=200,json=lambda:body),['12']);self.assertTrue(meta['shape'][flag]);self.assertNotIn('DO_NOT_LEAK',json.dumps(meta));self.assertNotIn('111',json.dumps(meta))
  body={'errors':[{'code':88,'message':'Rate limit PRIVATE-TEXT auth_token=DO_NOT_LEAK'}]}
  meta=bridge.response_diagnostic(types.SimpleNamespace(status_code=429,json=lambda:body),['12']);self.assertEqual(meta['codes'],[88]);self.assertIn('rate_limit',meta['categories']);self.assertNotIn('PRIVATE',json.dumps(meta));self.assertNotIn('DO_NOT_LEAK',json.dumps(meta))
  for message,category in [('authentication required','auth'),('too long','length'),('captcha challenge','challenge')]:
   meta=bridge.response_diagnostic(types.SimpleNamespace(status_code=200,json=lambda:{'errors':[{'message':message}]}),['12']);self.assertIn(category,meta['categories'])
 def test_exact_media_id_list_must_match_in_order(self):
  for media in ([{'type':'photo','id_str':'77'}],[{'type':'photo'}],[]):
   c=Client();c.get=lambda *a,**kw:types.SimpleNamespace(status_code=200,json=lambda:{'legacy':{'id_str':'99','full_text':'example','extended_entities':{'media':media}}})
   r,c=self.run_request({'op':'post','text':'example','media':['12']},c);self.assertEqual(r['error'],'x_post_uncertain');self.assertEqual(r['id'],'99');self.assertEqual(c.posts,1)
  for ids,expected in [(['12','13'],True),(['13','12'],False)]:
   c=Client();c.get=lambda *a,**kw:types.SimpleNamespace(status_code=200,json=lambda:{'legacy':{'id_str':'99','full_text':'example','extended_entities':{'media':[{'type':'photo','id_str':i} for i in ids]}}})
   r,c=self.run_request({'op':'post','text':'example','media':['12','13']},c);self.assertEqual('error' not in r,expected);self.assertEqual(c.posts,1)
 def test_definite_rejection_and_unclassified_response(self):
  for status,expected in [(403,'x_post_rejected'),(429,'x_post_rejected'),(200,'x_post_uncertain'),(500,'x_post_uncertain')]:
   c=Client()
   def fail(*a,**kw):c.posts+=1;return {'ok':False,'status':status}
   c.create_tweet=fail
   r,c=self.run_request({'op':'post','text':'example','media':['12']},c);self.assertEqual(r['error'],expected);self.assertEqual(c.posts,1)
   if expected=='x_post_rejected':self.assertEqual(r['status'],status)
 def test_create_response_capture_runs_once_without_exposing_message(self):
  c=Client();c.post=lambda *a,**kw:types.SimpleNamespace(status_code=200,json=lambda:{'errors':[{'code':186,'message':'too long PRIVATE'}]})
  def create(*a,**kw):c.posts+=1;c._session.post('https://x.invalid/CreateTweet');return {'ok':False,'status':200}
  c.create_tweet=create
  r,c=self.run_request({'op':'post','text':'example','media':['12']},c);self.assertEqual(c.posts,1);self.assertEqual(r['diagnostic']['codes'],[186]);self.assertNotIn('PRIVATE',json.dumps(r));self.assertEqual(r['error'],'x_post_uncertain')
 def test_note_contract_exact_body_and_quote_id_exclusion(self):
  c=Client();seen=[]
  def post(url,**kw):seen.append((url,kw));return types.SimpleNamespace(status_code=200,json=lambda:{'data':{'note_operation':{'tweet_results':{'result':{'rest_id':'99'}}}}})
  c.post=post;c._headers=lambda *args: {'content-type':'application/json'}
  result=bridge.create_note(c,'a'*359,['12']);self.assertEqual(result['id'],'99');self.assertEqual(len(seen),1)
  url,kw=seen[0];body=json.loads(kw['data']);self.assertTrue(url.endswith('/note-q/CreateNoteTweet'));self.assertEqual(body['queryId'],'note-q');self.assertEqual(body['features'],{'test':True});self.assertEqual(body['variables'],{'tweet_text':'a'*359,'media':{'media_entities':[{'media_id':'12','tagged_users':[]}],'possibly_sensitive':False},'semantic_annotation_ids':[],'disallowed_reply_options':None});self.assertEqual(kw['headers'],{'content-type':'application/json'})
  c.post=lambda *a,**kw:types.SimpleNamespace(status_code=200,json=lambda:{'data':{'quoted_status_result':{'tweet_results':{'result':{'rest_id':'88'}}}}})
  self.assertFalse(bridge.create_note(c,'a'*359,['12'])['ok'])
 def test_long_note_reads_full_text_and_media_or_keeps_known_id_uncertain(self):
  text='a'*359
  for full in (text,'truncated'):
   c=Client();c.get_tweet=lambda *a:{'ok':True,'author_id':'335502216','author':'borsacakali','text':'legacy truncated'}
   c.get=lambda *a,**kw:types.SimpleNamespace(status_code=200,json=lambda:{'legacy':{'id_str':'99','full_text':'legacy truncated','extended_entities':{'media':[{'type':'photo','id_str':'12'}]}},'note_tweet':{'note_tweet_results':{'result':{'text':full}}}})
   with mock.patch.object(bridge,'create_note',return_value={'ok':True,'id':'99'}) as note:
    result,_=self.run_request({'op':'post','text':text,'media':['12'],'long_note':True,'allow_long':True},c);note.assert_called_once();self.assertEqual(c.posts,0);self.assertEqual(result.get('id'),'99');self.assertEqual('error' not in result,full==text)
 def test_note_one_to_four_preserves_ids_and_rejects_invalid_before_create(self):
  for count in (1,2,3,4):
   mids=[str(12+i) for i in range(count)];c=Client();c.get_tweet=lambda *a:{'ok':True,'author_id':'335502216','author':'borsacakali','text':'truncated'}
   c.get=lambda *a,**kw:types.SimpleNamespace(status_code=200,json=lambda:{'legacy':{'id_str':'99','full_text':'truncated','extended_entities':{'media':[{'type':'photo','id_str':m} for m in mids]}},'note_tweet':{'note_tweet_results':{'result':{'text':'a'*359}}}})
   with mock.patch.object(bridge,'create_note',return_value={'ok':True,'id':'99'}) as note:
    result,_=self.run_request({'op':'post','text':'a'*359,'media':mids,'long_note':True,'allow_long':True},c);self.assertEqual(result.get('id'),'99');self.assertNotIn('error',result);self.assertEqual(note.call_args.args[2],mids);self.assertEqual(c.posts,0)
  for mids in (['1','1'],['1','2','3','4','5'],['bad']):
   with mock.patch.object(bridge,'create_note') as note:
    result,c=self.run_request({'op':'post','text':'a'*359,'media':mids,'long_note':True,'allow_long':True});self.assertEqual(result['error'],'x_pre_submit_rejected');note.assert_not_called();self.assertEqual(c.posts,0)
 def test_bridge_text_and_weight_limits_are_definite_pre_submit(self):
  for text,weight in [('https://example.com/'+'a'*25001,23),('a'*25001,25001),('😀'*12501,25002)]:
   result,c=self.run_request({'op':'post','text':text,'media':['12'],'weighted_length':weight,'long_note':weight>280,'allow_long':True});self.assertEqual(result['error'],'x_pre_submit_rejected');self.assertEqual(result['status'],422);self.assertEqual(c.posts,0)
 def test_note_payload_one_to_four_reuses_every_uploaded_id_once_in_order(self):
  for count in (1,2,3,4):
   c=Client();seen=[];mids=[str(12+i) for i in range(count)]
   def post(url,**kw):seen.append(json.loads(kw['data']));return types.SimpleNamespace(status_code=200,json=lambda:{'data':{'operation':{'tweet_results':{'result':{'rest_id':'99'}}}}})
   c.post=post;result=bridge.create_note(c,'a'*359,mids);self.assertTrue(result['ok']);self.assertEqual(len(seen),1);self.assertEqual([m['media_id'] for m in seen[0]['variables']['media']['media_entities']],mids)
 def test_post_ambiguous_does_not_retry(self):
  c=Client();c.get_tweet=lambda *a:{'ok':False}
  r,c=self.run_request({'op':'post','text':'example','media':['12']},c);self.assertEqual(r['error'],'x_post_uncertain');self.assertEqual(c.posts,1)
if __name__=='__main__':unittest.main()
