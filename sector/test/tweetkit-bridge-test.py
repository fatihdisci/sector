import sys, types, unittest, unittest.mock as mock, io, json, importlib.util, contextlib
fake=types.ModuleType('tweetkit_x');fake.TweetKit=object;fake.constants=types.SimpleNamespace(QUERY_IDS={'TweetResultByRestId':'q'},USER_TWEETS_FEATURES={},GQL_BASE='https://x.invalid')
sys.modules['tweetkit_x']=fake
spec=importlib.util.spec_from_file_location('bridge','scripts/tweetkit_bridge.py'); bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)
class Client:
 def __init__(self,*a,**kw): self.posts=0; self._session=self
 def whoami(self):return {'user_id':'335502216'}
 def user_profile(self,*a):return {'ok':True,'id':'335502216','username':'endeks_haber'}
 def create_tweet(self,*a,**kw):self.posts+=1;return {'ok':True,'id':'99'}
 def get_tweet(self,*a):return {'ok':True,'author_id':'335502216','author':'endeks_haber','text':'example'}
 def _headers(self,*a):return {}
 def get(self,*a,**kw):
  return types.SimpleNamespace(status_code=200,json=lambda:{'legacy':{'id_str':'99','full_text':'example','extended_entities':{'media':[{'type':'photo','id_str':'12'}]}}})
class BridgeTest(unittest.TestCase):
 def run_request(self,request,client=None,key=0):
  output=io.StringIO(); c=client or Client()
  with mock.patch.object(bridge.sys,'stdin',io.StringIO(json.dumps(request))),mock.patch.object(bridge.subprocess,'run',return_value=types.SimpleNamespace(returncode=key,stdout='auth_token=mock-secret; ct0=mock-csrf; twid=u%3D335502216')),mock.patch.object(bridge,'TweetKit',return_value=c),contextlib.redirect_stdout(output):bridge.main()
  result=json.loads(output.getvalue());self.assertNotIn('mock-secret',output.getvalue());return result,c
 def test_identity_success_and_missing_key(self):
  self.assertEqual(self.run_request({'op':'identity'})[0]['id'],'335502216')
  self.assertEqual(self.run_request({'op':'identity'},key=1)[0]['error'],'x_keychain_unavailable')
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
  r,c=self.run_request({'op':'post','text':'example','media':['12']},c);self.assertEqual(r['error'],'x_request_failed');self.assertEqual(c.posts,1)
 def test_incomplete_readback_is_uncertain(self):
  c=Client();c.get=lambda *a,**kw:types.SimpleNamespace(status_code=200,json=lambda:{'legacy':{'id_str':'99','full_text':'example','extended_entities':{'media':[]}}})
  r,c=self.run_request({'op':'post','text':'example','media':['12']},c);self.assertEqual(r['error'],'x_post_uncertain');self.assertEqual(r['id'],'99');self.assertEqual(c.posts,1)
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
 def test_post_ambiguous_does_not_retry(self):
  c=Client();c.get_tweet=lambda *a:{'ok':False}
  r,c=self.run_request({'op':'post','text':'example','media':['12']},c);self.assertEqual(r['error'],'x_post_uncertain');self.assertEqual(c.posts,1)
if __name__=='__main__':unittest.main()
