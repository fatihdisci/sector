"""Explicit data-only Telegram collection. No OCR, model, publishing or resend."""
import asyncio,hashlib,json,pathlib,time
from telegram_raw_protocol import is_placeholder,payload_matches
MAX_BYTES=20_000_000

def event_types():
    from telethon import events
    return events

placeholder=is_placeholder

def save_json(path,value):
    temp=path.with_suffix('.next');temp.write_text(json.dumps(value,ensure_ascii=False));temp.chmod(0o600);temp.replace(path)

async def query_raw(client,db,root,value,*,validate,resume,error,clock=time.monotonic,types=None,wait_event=None):
    bot,command,key=validate(value);row=resume(db,key,bot,command)
    if row and row['state']=='complete':
        result=json.loads(row['result'])
        if result.get('data_only')is not True:raise error('bot_query_invalid')
        return result
    if row:raise error('bot_query_delivery_uncertain')
    limit=db.execute("SELECT until FROM limits WHERE key='flood'").fetchone()
    if limit and limit['until']>time.time():raise error('bot_query_rate_limited')
    peer=await client.get_entity(bot)
    if not peer.bot or (peer.username or '').lower()!=bot:raise error('bot_query_peer_invalid')
    pin=db.execute('SELECT peer_id FROM peers WHERE username=?',(bot,)).fetchone()
    if not pin:raise error('bot_query_peer_unverified')
    if pin['peer_id']!=peer.id:raise error('bot_query_peer_invalid')
    if db.execute("SELECT 1 FROM requests WHERE state IN ('sending','sent','uncertain') AND created_at>?",(time.time()-300,)).fetchone():raise error('bot_query_busy')
    latest=db.execute('SELECT MAX(created_at) FROM requests WHERE bot=?',(bot,)).fetchone()[0]
    if latest and time.time()-latest<10:raise error('bot_query_rate_limited')
    baseline=await client.get_messages(peer,limit=1)
    baseline_id=max((m.id for m in baseline if m is not None),default=0)
    queue=asyncio.Queue(maxsize=40);overflow=False;sent=None;pending_item=None;phase='send';snapshots={};evidence=[];deleted=set();missing=0;changed=clock();deadline=None
    rejection=None;unthreaded_root=None
    directory=pathlib.Path(root)/'responses'/hashlib.sha256(key.encode()).hexdigest()
    async def enqueue(kind,event):
        nonlocal overflow
        try:queue.put_nowait((kind,event))
        except asyncio.QueueFull:overflow=True
    async def new(event):await enqueue('new',event)
    async def edit(event):await enqueue('edit',event)
    async def deletion(event):await enqueue('delete',event)
    def diagnostics(reason):return json.dumps({'reason':reason,'phase':phase,'message_ids':list(snapshots),'missing_reads':missing,'deleted_ids':sorted(deleted),'rejection':rejection,'baseline_id':baseline_id})
    def persist():
        directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        save_json(directory/'evidence.json',{'key':key,'bot':bot,'command':command,'peer_id':peer.id,'sent_id':sent.id,'snapshots':evidence})
    async def capture(message,kind):
        nonlocal changed,rejection,unthreaded_root
        mid=getattr(message,'id',None)
        def reject(field,reason='bot_query_reply_mismatch'):
            nonlocal rejection
            rejection={'field':field,'message_id':mid if isinstance(mid,int)else None,'has_reply':getattr(message,'reply_to_msg_id',None)is not None,'out':bool(getattr(message,'out',False))}
            raise error(reason)
        if not isinstance(mid,int)or mid<=sent.id:reject('message_id')
        if getattr(message,'out',False):reject('outbound','bot_query_ambiguous')
        for field in ['sender_id','chat_id']:
            if getattr(message,field,None)!=peer.id:reject(field)
        reply=getattr(message,'reply_to_msg_id',None)
        if reply is not None and reply!=sent.id:reject('reply_to_msg_id')
        previous=snapshots.get(mid)
        media=bool(message.photo or (message.file and (message.file.mime_type or '') in ('image/jpeg','image/png','image/webp')))
        binding='reply'if reply==sent.id else previous['binding']if previous else None
        if binding=='serialized_profile' and (message.raw_text or '').strip() and not placeholder(message.raw_text) and not payload_matches(bot,command,message.raw_text,media):reject('payload_profile')
        if binding is None:
            # A headerless new final needs the command-specific source schema,
            # plus the locked query, baseline and outgoing-conflict checks.
            if not payload_matches(bot,command,message.raw_text or '',media):reject('payload_profile')
            if unthreaded_root is not None:reject('multiple_final_candidates','bot_query_ambiguous')
            unthreaded_root=mid;binding='serialized_profile'
        previous=snapshots.get(mid)
        version=getattr(message,'edit_date',None)or getattr(message,'date',None)
        if previous and previous.get('version')and version and version.timestamp()<previous['version']:return
        text=message.raw_text or ''
        if len(text)>30000 or len(snapshots)>=20 and mid not in snapshots:raise error('bot_query_size_limit')
        media=bool(message.photo or (message.file and (message.file.mime_type or '') in ('image/jpeg','image/png','image/webp')))
        media_id=str(getattr(getattr(message,'photo',None),'id',None))+':'+str(getattr(getattr(message,'document',None),'id',None))
        digest=hashlib.sha256((text+'\0'+media_id).encode()).hexdigest()
        if mid in snapshots and snapshots[mid]['digest']==digest:return
        if len(evidence)>=80:raise error('bot_query_size_limit')
        changed=clock()
        snap={'id':mid,'sender_id':message.sender_id,'chat_id':message.chat_id,'reply_to_msg_id':message.reply_to_msg_id,'out':False,'date':message.date.isoformat()if getattr(message,'date',None)else None,'edit_date':message.edit_date.isoformat()if getattr(message,'edit_date',None)else None,'kind':kind,'binding':binding,'version':version.timestamp()if version else None,'text':text,'has_media':media,'media_id':media_id,'digest':digest,'image':None,'media_state':'pending'if media else 'none','placeholder':placeholder(text)}
        previous=snapshots.get(mid)
        if previous and previous['media_id']==media_id and previous['image']:
            snap.update(image=previous['image'],media_state='saved')
        snapshots[mid]=snap;evidence.append(snap);persist() # Preserve event before any later RPC/deletion.
        if sum(len(s['text'])for s in snapshots.values())>100000:raise error('bot_query_size_limit')
        if media and not snap['image']:
            if not message.file or message.file.size>MAX_BYTES:raise error('bot_query_size_limit')
            if sum(s['has_media']for s in snapshots.values())>2:raise error('bot_query_size_limit')
            async def progress(current,total):
                if current>MAX_BYTES or total>MAX_BYTES:raise error('bot_query_size_limit')
            remaining=deadline-clock()
            if remaining<=0:raise error('bot_query_timeout')
            try:data=await asyncio.wait_for(client.download_media(message,file=bytes,progress_callback=progress),remaining)
            except Exception:
                snap['media_state']='unavailable';persist();raise error('bot_query_media_unavailable')from None
            if not data or len(data)>MAX_BYTES:raise error('bot_query_size_limit')
            path=directory/(str(mid)+'-'+digest[:16]+'.image');path.write_bytes(data);path.chmod(0o600)
            snap.update(image=str(path.relative_to(root)),media_state='saved');persist()
    builders=types or event_types();handlers=[(new,builders.NewMessage(chats=peer)),(edit,builders.MessageEdited(chats=peer)),(deletion,builders.MessageDeleted())]
    for handler,builder in handlers:client.add_event_handler(handler,builder)
    try:
        db.execute('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?)',(key,bot,command,'sending',peer.id,None,None,time.time()));db.commit()
        try:sent=await client.send_message(peer,command)
        except Exception as exc:
            seconds=getattr(exc,'seconds',None)
            if isinstance(seconds,int)and seconds>0:db.execute("INSERT OR REPLACE INTO limits VALUES('flood',?)",(time.time()+seconds,))
            db.execute("UPDATE requests SET state='uncertain' WHERE key=?",(key,));db.commit();raise error('bot_query_delivery_uncertain')from None
        deadline=clock()+90
        db.execute("UPDATE requests SET state='sent',sent_id=? WHERE key=?",(sent.id,key));db.commit()
        while True:
            if overflow:raise error('bot_query_size_limit')
            # Drain received events before settling. Telegram deletion never erases a verified snapshot.
            while pending_item is not None or not queue.empty():
                if overflow:raise error('bot_query_size_limit')
                if clock()>=deadline:raise error('bot_query_timeout')
                kind,event=pending_item if pending_item is not None else queue.get_nowait();pending_item=None;phase=kind
                if kind=='delete':
                    deleted.update(i for i in event.deleted_ids if i in snapshots);continue
                message=getattr(event,'message',event)
                if getattr(message,'id',0)<=sent.id:
                    if getattr(message,'out',False)and baseline_id<message.id<sent.id:
                        rejection={'field':'outbound_baseline','message_id':message.id,'has_reply':False,'out':True}
                        raise error('bot_query_ambiguous')
                    continue
                await capture(message,kind)
            finals=[s for s in snapshots.values()if not s['placeholder']and(s['text'].strip()or s['image'])]
            if finals and clock()-changed>=8:
                # Reconcile the bounded baseline window: another device can send
                # a command before our own send response/event is delivered.
                remaining=deadline-clock()
                if remaining<=0:raise error('bot_query_timeout')
                history=await asyncio.wait_for(client.get_messages(peer,min_id=baseline_id,limit=60),remaining)
                if len(history)>=60:raise error('bot_query_ambiguous')
                for other in history:
                    if other is not None and other.out and other.id>baseline_id and other.id!=sent.id:
                        rejection={'field':'outbound_history','message_id':other.id,'has_reply':bool(other.reply_to_msg_id),'out':True}
                        raise error('bot_query_ambiguous')
                if not queue.empty():continue
                result={'data_only':True,'bot':bot,'command':command,'sent_id':sent.id,'sent_at':sent.date.isoformat()if getattr(sent,'date',None)else None,'message_ids':[s['id']for s in finals],'text':'\n\n'.join(dict.fromkeys(s['text']for s in finals if s['text'])),'images':[s['image']for s in finals if s['image']],'messages':finals,'settle_seconds':8,'evidence_path':str((directory/'evidence.json').relative_to(root))}
                db.execute("UPDATE requests SET state='complete',result=? WHERE key=?",(json.dumps(result,ensure_ascii=False),key));db.commit();return result
            remaining=deadline-clock()
            if remaining<=0:raise error('bot_query_timeout')
            phase='wait'
            try:
                if wait_event is None:item=await asyncio.wait_for(queue.get(),min(3,remaining))
                else:
                    await wait_event(min(3,remaining));item=queue.get_nowait()
                pending_item=item
            except (asyncio.TimeoutError,asyncio.QueueEmpty):
                # Event capture is authoritative; refetch only IDs with proven binding.
                if snapshots:
                    phase='refetch'
                    refreshed=await asyncio.wait_for(client.get_messages(peer,ids=list(snapshots)),max(.01,deadline-clock()))
                    for message in refreshed:
                        if message is None:missing+=1
                        else:
                            if message.id not in snapshots:raise error('bot_query_reply_mismatch')
                            await capture(message,'refetch')
    except Exception as exc:
        if sent is not None:
            reason=str(exc)if isinstance(exc,error)else 'bot_query_timeout'if isinstance(exc,TimeoutError)else 'bot_query_failed'
            state='reply_mismatch'if reason=='bot_query_reply_mismatch'else 'ambiguous'if reason=='bot_query_ambiguous'else 'expired'
            db.execute('UPDATE requests SET state=?,result=? WHERE key=?',(state,diagnostics(reason),key));db.commit()
        raise
    finally:
        for handler,builder in handlers:client.remove_event_handler(handler,builder)
