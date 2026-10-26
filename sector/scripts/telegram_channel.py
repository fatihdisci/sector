"""Read-only, single-channel adapter. No dialog enumeration, joining or sends."""
import base64,hashlib,json
from telegram_account import QueryError
CHANNEL='SermayeBorsasi'
PEER_ID=2426639373

def validate(value):
 if not isinstance(value,dict)or value.get('channel')!=CHANNEL:raise QueryError('channel_not_allowed')
 return value

def message_value(m):
 text=m.raw_text or ''
 if len(text)>100_000:raise QueryError('channel_text_limit')
 links=[];raw=text.encode('utf-16-le')
 for e in m.entities or []:
  kind=type(e).__name__;url=e.url if kind=='MessageEntityTextUrl'else raw[e.offset*2:(e.offset+e.length)*2].decode('utf-16-le')if kind=='MessageEntityUrl'else None
  if url and url.startswith(('https://','http://'))and url not in links:links.append(url)
 if len(links)>8:raise QueryError('channel_link_limit')
 kind='image'if m.photo else 'pdf'if m.file and m.file.mime_type=='application/pdf'else 'image'if m.file and m.file.mime_type in('image/png','image/jpeg','image/webp')else 'unsupported'if m.media and type(m.media).__name__!='MessageMediaWebPage'else None
 value={'id':m.id,'at':m.date.isoformat(),'edited_at':m.edit_date.isoformat()if m.edit_date else None,'text':text,'links':links,'group':str(m.grouped_id)if m.grouped_id else None,'media':kind,'size':m.file.size if kind and m.file else 0}
 value['fingerprint']=hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
 # Add provenance AFTER the legacy fingerprint: do not replay old posts when
 # adding metadata. This is a transport observation, never a market data date.
 fwd=getattr(m,'fwd_from',None)
 value['provenance']={'forwarded':bool(fwd),'forwarded_at':fwd.date.isoformat()if fwd and getattr(fwd,'date',None)else None}
 return value

async def peer_for(client,value):
 validate(value);peer=await client.get_entity(CHANNEL)
 if peer.id!=PEER_ID or(peer.username or'').lower()!=CHANNEL.lower()or not getattr(peer,'broadcast',False):raise QueryError('channel_identity_mismatch')
 return peer

async def scan(client,value):
 peer=await peer_for(client,value);cursor=value.get('after_id');baseline=value.get('baseline_id')
 if cursor is None:
  rows=await client.get_messages(peer,limit=1)
  return {'channel':CHANNEL,'peer_id':PEER_ID,'baseline':True,'latest_id':rows[0].id if rows else 0,'messages':[]}
 if type(cursor)is not int or type(baseline)is not int or not 0<=baseline<=cursor:raise QueryError('channel_cursor_invalid')
 fresh=await client.get_messages(peer,min_id=cursor,limit=50,reverse=True)
 recent=await client.get_messages(peer,limit=20)
 groups={m.grouped_id for m in fresh if m.grouped_id}
 messages={m.id:m for m in list(fresh)+[m for m in recent if baseline<m.id<=cursor and(m.edit_date or m.grouped_id in groups)]if m and m.id>baseline}
 return {'channel':CHANNEL,'peer_id':PEER_ID,'baseline':False,'latest_id':max([cursor]+[m.id for m in fresh]),'messages':[message_value(messages[i])for i in sorted(messages)]}

async def read(client,value):
 peer=await peer_for(client,value);expected=value.get('messages')
 if not isinstance(expected,list)or not 1<=len(expected)<=10 or any(not isinstance(m,dict)or type(m.get('id'))is not int or m['id']<=0 or not isinstance(m.get('fingerprint'),str)or len(m['fingerprint'])!=64 for m in expected)or len({m['id']for m in expected})!=len(expected):raise QueryError('channel_manifest_invalid')
 rows=await client.get_messages(peer,ids=[m['id']for m in expected]);result=[];total=0
 for original,m in zip(expected,rows):
  if not m:raise QueryError('channel_message_deleted')
  item=message_value(m)
  if item['id']!=original['id']or item['fingerprint']!=original['fingerprint']:raise QueryError('channel_message_changed')
  if item['media']=='unsupported':raise QueryError('channel_media_unsupported')
  if item['media']:
   if not m.file or m.file.size>20_000_000:raise QueryError('channel_media_limit')
   async def progress(current,size):
    if current>20_000_000 or size>20_000_000:raise QueryError('channel_media_limit')
   data=await client.download_media(m,file=bytes,progress_callback=progress)
   if not data or len(data)>20_000_000:raise QueryError('channel_media_limit')
   total+=len(data)
   if total>40_000_000:raise QueryError('channel_media_limit')
   item['sha256']=hashlib.sha256(data).hexdigest();item['bytes_base64']=base64.b64encode(data).decode()
  result.append(item)
 return {'channel':CHANNEL,'peer_id':PEER_ID,'messages':result}
