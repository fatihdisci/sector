"""Local Mac bridge. stdin is a single JSON request; stdout is restricted JSON."""
import base64, json, os, re, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "vendor" / "tweetkit"))
from tweetkit_x import TweetKit, constants as C
EXPECTED='335502216'
def send(**x): print(json.dumps(x),flush=True)
def create_note(tk,text,mids,quote_tweet_id=None):
 # Exact request fields used by pinned upstream TweetKit.post_note; reuse prior upload.
 qid=C.QUERY_IDS['CreateNoteTweet'];path=f'/i/api/graphql/{qid}/CreateNoteTweet'
 variables={'tweet_text':text,'media':{'media_entities':[{'media_id':m,'tagged_users':[]} for m in mids],'possibly_sensitive':False},'semantic_annotation_ids':[],'disallowed_reply_options':None}
 if quote_tweet_id:variables['attachment_url']='https://x.com/i/status/'+quote_tweet_id
 response=tk._session.post(f'{C.GQL_BASE}/{qid}/CreateNoteTweet',data=json.dumps({'variables':variables,'features':C.CREATE_TWEET_FEATURES,'queryId':qid}),headers=tk._headers('POST',path,{'content-type':'application/json'}),timeout=20)
 try:body=response.json()
 except Exception:return {'ok':False,'status':response.status_code}
 if not isinstance(body,dict) or body.get('errors'):return {'ok':False,'status':response.status_code}
 ids=[]
 def walk(node):
  if isinstance(node,dict):
   result=(node.get('tweet_results') or {}).get('result') if isinstance(node.get('tweet_results'),dict) else None
   if isinstance(result,dict) and re.fullmatch(r'\d+',str(result.get('rest_id',''))):ids.append(result['rest_id'])
   for key,value in node.items():
    if 'quote' not in key.lower():walk(value)
  elif isinstance(node,list):
   for value in node:walk(value)
 walk(body.get('data'))
 return {'ok':True,'id':ids[0]} if len(set(ids))==1 else {'ok':False,'status':response.status_code}
def response_diagnostic(response,mids):
 """Allowlisted metadata only; never copy raw server text, content, or headers."""
 diag={'stage':'create','http_status':int(response.status_code),'media_ids':mids,'codes':[],'categories':[],'shape':{}}
 try: body=response.json()
 except Exception: diag['categories']=['invalid_json']; return diag
 if not isinstance(body,dict): diag['categories']=['non_object_json']; return diag
 errors=body.get('errors'); diag['shape']['errors']=isinstance(errors,list)
 if isinstance(errors,list):
  for item in errors[:8]:
   if not isinstance(item,dict):continue
   code=item.get('code');
   if type(code) is int and 0<=code<=999999:diag['codes'].append(code)
   msg=item.get('message','')
   if isinstance(msg,str):
    m=msg.lower()
    for label,terms in [('length',('too long','maximum length','exceeds character')),('rate_limit',('rate limit','too many requests')),('auth',('authentication','unauthorized','not authorized')),('challenge',('challenge','captcha','suspended','locked'))]:
     if any(t in m for t in terms) and label not in diag['categories']:diag['categories'].append(label)
   if not diag['categories']:diag['categories']=['other']
 data=body.get('data');diag['shape']['data']=isinstance(data,dict)
 create=data.get('create_tweet') if isinstance(data,dict) else None;diag['shape']['create_tweet']=isinstance(create,dict)
 results=create.get('tweet_results') if isinstance(create,dict) else None;diag['shape']['tweet_results']=isinstance(results,dict)
 result=results.get('result') if isinstance(results,dict) else None;diag['shape']['result']=isinstance(result,dict)
 diag['shape']['rest_id']=isinstance(result,dict) and isinstance(result.get('rest_id'),str)
 nested=result.get('tweet') if isinstance(result,dict) else None;diag['shape']['nested_tweet']=isinstance(nested,dict)
 diag['shape']['nested_rest_id']=isinstance(nested,dict) and isinstance(nested.get('rest_id'),str)
 return diag
def main():
 rid=None
 diag=None
 captured={}
 try:
  req=json.load(sys.stdin); op=req.get('op')
  if op not in ('identity','upload','post'): raise ValueError()
  quote=req.get('quote_tweet_id')
  if quote is not None and(not isinstance(quote,str)or not re.fullmatch(r'[1-9]\d{4,24}',quote)):send(error='x_pre_submit_rejected',status=422,diagnostic={'stage':'pre_submit'});return
  p=subprocess.run(['/usr/bin/security','find-generic-password','-s','tweetkit-endeks-haber','-a','endeks_haber','-w'],capture_output=True,text=True,timeout=20)
  if p.returncode: send(error='x_keychain_unavailable'); return
  cookie=p.stdout.strip()
  pairs=dict(item.strip().split('=',1) for item in cookie.split(';') if '=' in item)
  if any(not pairs.get(name) for name in ('auth_token','ct0','twid')): send(error='x_keychain_invalid'); return
  tk=TweetKit(cookie=cookie,timeout=20)
  if tk.whoami().get('user_id')!=EXPECTED: send(error='x_wrong_account'); return
  profile=tk.user_profile('borsacakali')
  if not profile.get('ok') or str(profile.get('id'))!=EXPECTED or str(profile.get('username','')).lower()!='borsacakali': send(error='x_identity_unverified'); return
  if op=='identity': send(id=EXPECTED,username='borsacakali'); return
  if op=='upload':
   img=base64.b64decode(req.get('image',''),validate=True)
   if len(img)>5000000 or not img.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError()
   with tempfile.TemporaryDirectory(prefix='sector-x-') as d:
    path=os.path.join(d,'image.png')
    with os.fdopen(os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'wb') as f:f.write(img)
    mid=tk.upload_media(path)
   if not re.fullmatch(r'\d+',str(mid)):raise ValueError()
   send(id=str(mid)); return
  text=req.get('text'); mids=req.get('media')
  if not isinstance(text,str) or not text or len(text)>25000 or not isinstance(mids,list) or not 1<=len(mids)<=4 or any(not isinstance(m,str) or not re.fullmatch(r'\d+',m) for m in mids) or len(set(mids))!=len(mids):send(error='x_pre_submit_rejected',status=422,diagnostic={'stage':'pre_submit'});return
  note=req.get('long_note') is True
  weight=req.get('weighted_length')
  if type(weight) is not int or not 1<=weight<=25000 or note!=(weight>280):send(error='x_pre_submit_rejected',status=422,diagnostic={'stage':'pre_submit'});return
  if note and req.get('allow_long') is not True:send(error='x_pre_submit_rejected',status=422,diagnostic={'stage':'pre_submit'});return
  # One attempt only; any failure after this point must be treated as uncertain.
  captured={}
  original_post=tk._session.post
  def capture_post(url,*args,**kwargs):
   response=original_post(url,*args,**kwargs)
   if url.endswith(('/CreateTweet','/CreateNoteTweet')):captured['diag']=response_diagnostic(response,mids)
   return response
  tk._session.post=capture_post
  diag={'stage':'create','media_ids':mids,'categories':['response_unavailable']}
  result=create_note(tk,text,mids,quote) if note else tk.create_tweet(text,media_ids=mids,**({'quote_tweet_id':quote}if quote else{}))
  diag=captured.get('diag',{'stage':'create','media_ids':mids,'categories':['response_unavailable']})
  if not result.get('ok'):
   status=result.get('status')
   if type(status) is int and status in (400,401,403,404,413,422,429):send(error='x_post_rejected',status=status,diagnostic=diag);return
   send(error='x_post_uncertain',diagnostic=diag);return
  if not re.fullmatch(r'\d+',str(result.get('id',''))):send(error='x_post_uncertain',diagnostic=diag);return
  rid=str(result['id']); receipt=tk.get_tweet(rid)
  if not receipt.get('ok') or str(receipt.get('author_id'))!=EXPECTED or str(receipt.get('author','')).lower()!='borsacakali' or (not note and not (receipt.get('text')==text or bool(re.fullmatch(re.escape(text)+(r'(?: https://t\.co/[A-Za-z0-9]+){1,2}'if quote else r' https://t\.co/[A-Za-z0-9]+'),str(receipt.get('text','')))))):
   send(error='x_post_uncertain',id=rid,diagnostic={**diag,'stage':'readback'});return
  q=C.QUERY_IDS['TweetResultByRestId']; path=f'/i/api/graphql/{q}/TweetResultByRestId'
  params={'variables':json.dumps({'tweetId':rid,'withCommunity':False,'includePromotedContent':False,'withVoice':False}), 'features':json.dumps(C.USER_TWEETS_FEATURES), 'fieldToggles':json.dumps({'withArticleRichContentState':False})}
  response=tk._session.get(f'{C.GQL_BASE}/{q}/TweetResultByRestId',params=params,headers=tk._headers('GET',path),timeout=20)
  if response.status_code!=200: send(error='x_post_uncertain',id=rid,diagnostic={**diag,'stage':'readback'});return
  found=[]
  def walk(node):
   if isinstance(node,dict):
    legacy=node.get('legacy')
    if isinstance(legacy,dict) and (legacy.get('id_str') or node.get('rest_id'))==rid and 'full_text' in legacy: found.append(node)
    for v in node.values():walk(v)
   elif isinstance(node,list):
    for v in node:walk(v)
  walk(response.json())
  if not found:send(error='x_post_uncertain',id=rid,diagnostic={**diag,'stage':'readback'});return
  if quote is not None and found[0]['legacy'].get('quoted_status_id_str')!=quote:send(error='x_post_uncertain',id=rid,diagnostic={**diag,'stage':'readback'});return
  if note:
   note_data=((found[0].get('note_tweet') or {}).get('note_tweet_results') or {}).get('result') or {}
   if note_data.get('text')!=text:send(error='x_post_uncertain',id=rid,diagnostic={**diag,'stage':'readback'});return
  photos=(found[0]['legacy'].get('extended_entities') or {}).get('media',[])
  if [str(m.get('id_str','')) for m in photos if m.get('type')=='photo']!=mids:send(error='x_post_uncertain',id=rid,diagnostic={**diag,'stage':'readback'});return
  send(id=rid)
 except Exception as exc:
  diag=captured.get('diag',diag)
  category='timeout' if 'timeout' in type(exc).__name__.lower() else 'transport_or_internal'
  if rid: send(error='x_post_uncertain',id=rid,diagnostic={'stage':'readback','categories':[category]})
  elif diag is not None: send(error='x_post_uncertain',diagnostic={**diag,'categories':[category]})
  else: send(error='x_request_failed')
if __name__=='__main__':main()
