"""Local Mac bridge. stdin is a single JSON request; stdout is restricted JSON."""
import base64, json, os, re, subprocess, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "vendor" / "tweetkit"))
from tweetkit_x import TweetKit, constants as C
EXPECTED='335502216'
def send(**x): print(json.dumps(x),flush=True)
def main():
 rid=None
 try:
  req=json.load(sys.stdin); op=req.get('op')
  if op not in ('identity','upload','post'): raise ValueError()
  p=subprocess.run(['/usr/bin/security','find-generic-password','-s','tweetkit-endeks-haber','-a','endeks_haber','-w'],capture_output=True,text=True,timeout=20)
  if p.returncode: send(error='x_keychain_unavailable'); return
  cookie=p.stdout.strip()
  pairs=dict(item.strip().split('=',1) for item in cookie.split(';') if '=' in item)
  if any(not pairs.get(name) for name in ('auth_token','ct0','twid')): send(error='x_keychain_invalid'); return
  tk=TweetKit(cookie=cookie,timeout=20)
  if tk.whoami().get('user_id')!=EXPECTED: send(error='x_wrong_account'); return
  profile=tk.user_profile('endeks_haber')
  if not profile.get('ok') or str(profile.get('id'))!=EXPECTED or str(profile.get('username','')).lower()!='endeks_haber': send(error='x_identity_unverified'); return
  if op=='identity': send(id=EXPECTED,username='endeks_haber'); return
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
  if not isinstance(text,str) or not text or not isinstance(mids,list) or not 1<=len(mids)<=4 or any(not isinstance(m,str) or not re.fullmatch(r'\d+',m) for m in mids):raise ValueError()
  # One attempt only; any failure after this point must be treated as uncertain.
  result=tk.create_tweet(text,media_ids=mids)
  if not result.get('ok'):
   status=result.get('status')
   if type(status) is int and status in (400,401,403,404,413,422,429):send(error='x_post_rejected',status=status);return
   send(error='x_post_uncertain');return
  if not re.fullmatch(r'\d+',str(result.get('id',''))):send(error='x_post_uncertain');return
  rid=str(result['id']); receipt=tk.get_tweet(rid)
  if not receipt.get('ok') or str(receipt.get('author_id'))!=EXPECTED or str(receipt.get('author','')).lower()!='endeks_haber' or not (receipt.get('text')==text or bool(re.fullmatch(re.escape(text)+r' https://t\.co/[A-Za-z0-9]+',str(receipt.get('text',''))))):
   send(error='x_post_uncertain',id=rid);return
  q=C.QUERY_IDS['TweetResultByRestId']; path=f'/i/api/graphql/{q}/TweetResultByRestId'
  params={'variables':json.dumps({'tweetId':rid,'withCommunity':False,'includePromotedContent':False,'withVoice':False}), 'features':json.dumps(C.USER_TWEETS_FEATURES), 'fieldToggles':json.dumps({'withArticleRichContentState':False})}
  response=tk._session.get(f'{C.GQL_BASE}/{q}/TweetResultByRestId',params=params,headers=tk._headers('GET',path),timeout=20)
  if response.status_code!=200: send(error='x_post_uncertain',id=rid);return
  found=[]
  def walk(node):
   if isinstance(node,dict):
    legacy=node.get('legacy')
    if isinstance(legacy,dict) and (legacy.get('id_str') or node.get('rest_id'))==rid and 'full_text' in legacy: found.append(legacy)
    for v in node.values():walk(v)
   elif isinstance(node,list):
    for v in node:walk(v)
  walk(response.json())
  if not found:send(error='x_post_uncertain',id=rid);return
  photos=(found[0].get('extended_entities') or {}).get('media',[])
  if [str(m.get('id_str','')) for m in photos if m.get('type')=='photo']!=mids:send(error='x_post_uncertain',id=rid);return
  send(id=rid)
 except Exception:
  if rid: send(error='x_post_uncertain',id=rid)
  else: send(error='x_request_failed')
if __name__=='__main__':main()
