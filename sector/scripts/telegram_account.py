"""Owner-authorized, allowlisted Telegram queries. Never read unrelated dialogs.

Session/API credentials live outside Git. Each request is journalled before send;
unknown sends are never repeated. One account lock serializes setup and queries.
"""
import asyncio,fcntl,getpass,hashlib,json,os,pathlib,re,sqlite3,sys,time
ROOT=pathlib.Path.home()/'Library/Application Support/sector-haber/telegram-account'
MAX_BYTES=20_000_000
monotonic=time.monotonic
class QueryError(Exception):pass

def validate_query(value):
    bot=value.get('bot');command=value.get('command','');key=str(value.get('key',''))
    if not re.fullmatch(r'[0-9]{1,20}',key):raise QueryError('bot_query_invalid')
    if bot=='b0pt_bot':
        if command!='/piyasayd':
            if not command.startswith('/kurum '):raise QueryError('bot_query_invalid')
            arg=command[7:]
            if not 1<=len(arg)<=80 or not all(c.isalnum() or c in " .&’'()_-" for c in arg):raise QueryError('bot_query_invalid')
    elif bot=='ucretsizderinlikbot':
        if command!='/kurum' and not re.fullmatch(r'/(?:akd|takas) [A-Z][A-Z0-9]{3,4}',command):raise QueryError('bot_query_invalid')
    else:raise QueryError('bot_query_invalid')
    return bot,command,key

def validate_raw_query(value):
    bot=value.get('bot');command=value.get('command','')
    if bot=='b0pt_bot' and command=='/doviz':return bot,command,validate_query(dict(value,command='/piyasayd'))[2]
    ticker=re.fullmatch(r'/(detay|teorik|derinlik|akd|takas) ([A-Za-z][A-Za-z0-9]{3,4})',command)
    if ticker:
        verb,symbol=ticker.groups();expected='b0pt_bot' if verb=='detay' else 'ucretsizderinlikbot'
        if bot!=expected:raise QueryError('bot_query_invalid')
        key=validate_query(dict(value,bot='b0pt_bot',command='/piyasayd'))[2]
        return bot,'/'+verb+' '+symbol.upper(),key
    return validate_query(value)

def private_json(path,value):
    tmp=path.with_suffix('.next');tmp.write_text(json.dumps(value,ensure_ascii=False));tmp.chmod(0o600);os.replace(tmp,path)

def open_journal(root):
    db=sqlite3.connect(root/'queries.sqlite');db.row_factory=sqlite3.Row
    db.execute('CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY,bot TEXT,command TEXT,state TEXT,peer_id INTEGER,sent_id INTEGER,result TEXT,created_at REAL)')
    db.execute('CREATE TABLE IF NOT EXISTS peers (username TEXT PRIMARY KEY,peer_id INTEGER)')
    db.execute('CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY,until REAL)');db.commit();return db

def resume_state(db,key,bot,command):
    row=db.execute('SELECT * FROM requests WHERE key=?',(key,)).fetchone()
    if row and (row['bot']!=bot or row['command']!=command):raise QueryError('bot_query_invalid')
    if row and row['state'] in ('sending','uncertain'):raise QueryError('bot_query_delivery_uncertain')
    if row and row['state']=='expired':raise QueryError('bot_query_expired')
    if row and row['state']=='ambiguous':raise QueryError('bot_query_ambiguous')
    if row and row['state']=='reply_mismatch':raise QueryError('bot_query_reply_mismatch')
    return row

def candidate_messages(messages,peer,sent):
    # Another user command makes unthreaded replies ambiguous: never mix queries.
    if any(m.id>sent and m.out for m in messages):raise QueryError('bot_query_ambiguous')
    return sorted([m for m in messages if m.id>sent and not m.out and m.sender_id==peer and (not m.reply_to_msg_id or m.reply_to_msg_id==sent)],key=lambda m:m.id)

def meaningful(messages):
    return any(m.photo or (m.file and (m.file.mime_type or '').startswith('image/')) or re.search(r'net.{0,20}(?:hacim|lot|al[iı]ş|sat[iı]ş)|toplam.{0,20}takas|(?:al[iı]ş|sat[iı]ş).{0,8}hacmi|en çok (?:alınan|satılan)',m.raw_text or '',re.I) and re.search(r'\d',m.raw_text or '') for m in messages)

def movers_complete(text):
    # This is only a collection boundary; the TypeScript parser validates all
    # rows, signs, units, ordering and freshness before producing any content.
    rows=re.findall(r'(?m)^[^\n]*?\b([A-Z][A-Z0-9]{3,4})(?:\.E)?\s*[:|–—-]?\s*\d+[.,]\d{2}',text)
    return bool(re.search(r'yükselen',text,re.I) and re.search(r'düşen',text,re.I) and len(rows)==20 and len(set(rows))==20)

async def query_movers(client,db,value,*,data_only=False,root=ROOT):
    # One explicit command, correlated replies and bounded same-ID refetches.
    # Never resend after timeout/uncertainty; raw mode does not parse or use AI.
    bot,command,key=validate_query(value);row=resume_state(db,key,bot,command)
    if row and row['state']=='complete':
        result=json.loads(row['result'])
        if bool(result.get('data_only'))!=data_only:raise QueryError('bot_query_invalid')
        return result
    if row:raise QueryError('bot_query_delivery_uncertain')
    limit=db.execute("SELECT until FROM limits WHERE key='flood'").fetchone()
    if limit and limit['until']>time.time():raise QueryError('bot_query_rate_limited')
    peer=await client.get_entity(bot)
    if not peer.bot or (peer.username or '').lower()!=bot:raise QueryError('bot_query_peer_invalid')
    bound=db.execute('SELECT peer_id FROM peers WHERE username=?',(bot,)).fetchone()
    if not bound:raise QueryError('bot_query_peer_unverified')
    if bound['peer_id']!=peer.id:raise QueryError('bot_query_peer_invalid')
    pending=db.execute("SELECT key FROM requests WHERE bot=? AND state IN ('sending','sent','uncertain') AND created_at>? LIMIT 1",(bot,time.time()-300)).fetchone()
    if pending:raise QueryError('bot_query_busy')
    latest=db.execute('SELECT MAX(created_at) FROM requests WHERE bot=?',(bot,)).fetchone()[0]
    if latest and time.time()-latest<10:raise QueryError('bot_query_rate_limited')
    async with client.conversation(peer,timeout=90,exclusive=True) as conversation:
        db.execute('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?)',(key,bot,command,'sending',peer.id,None,None,time.time()));db.commit()
        try:sent=await conversation.send_message(command)
        except Exception as error:
            seconds=getattr(error,'seconds',None)
            if isinstance(seconds,int) and seconds>0:db.execute("INSERT OR REPLACE INTO limits VALUES('flood',?)",(time.time()+seconds,))
            db.execute("UPDATE requests SET state='uncertain' WHERE key=?",(key,));db.commit();raise QueryError('bot_query_delivery_uncertain')
        db.execute("UPDATE requests SET state='sent',sent_id=? WHERE key=?",(sent.id,key));db.commit()
        ids=[];texts={};hashes={};received=None;deadline=monotonic()+90
        phase='initial';missing={'initial':0,'followup':0,'refetch':0}
        messages={};unavailable=set();changed=monotonic() if data_only else 0
        def raw_messages():
            return [messages[i] for i in ids if i not in unavailable and not re.search(r'hazırlanıyor|hazirlaniyor|yükleniyor|yukleniyor|işleniyor',messages[i].raw_text or '',re.I)]
        def diagnostic(reason):
            return json.dumps({'reason':reason,'phase':phase,'missing_counts':missing,'message_ids':ids})
        async def wait_missing():
            # A missing SDK result grants no provenance; avoid immediate-None loops.
            remaining=deadline-monotonic()
            if remaining>0:await asyncio.sleep(min(3,remaining))
        async def accept(message,refetch=False):
            nonlocal received,changed
            def mismatch(reason):
                error=QueryError('bot_query_reply_mismatch');error.reason=reason;raise error
            if message is None:
                missing[phase]+=1
                return False
            mid=getattr(message,'id',None)
            if not isinstance(mid,int) or mid<=sent.id or (refetch and mid not in ids):mismatch('message_id')
            sender=getattr(message,'sender_id',None);chat=getattr(message,'chat_id',None);reply=getattr(message,'reply_to_msg_id',None)
            # Refetch is constrained to already verified IDs in the bound peer.
            # Telegram may omit optional headers on an edited message; explicit
            # contradictory metadata always fails closed.
            for name,value,expected in (('sender',sender,peer.id),('chat',chat,peer.id),('reply',reply,sent.id)):
                if value!=expected and (not refetch or value is not None):mismatch(name)
            if message.id not in ids:
                if len(ids)>=20:raise QueryError('bot_query_size_limit')
                ids.append(message.id)
            if data_only and message.id in unavailable:changed=monotonic()
            unavailable.discard(message.id)
            messages[message.id]=message
            text=message.raw_text or ''
            if len(text)>30000:raise QueryError('bot_query_size_limit')
            media_id=str(getattr(getattr(message,'photo',None),'id',None))+':'+str(getattr(getattr(message,'document',None),'id',None))
            digest=hashlib.sha256((text+'\0'+media_id).encode('utf-8')).digest()
            if hashes.get(message.id)==digest:return
            hashes[message.id]=digest
            if data_only:changed=monotonic()
            if re.search(r'(?:abonelik|üyelik|üye ol|paket|sorgu limiti|günlük limit|kota).{0,60}(?:gerek|doldu|aşıldı|bitti|yetersiz|ulaştı)',text,re.I):raise QueryError('bot_query_provider_limit')
            if '\n' not in text and re.search(r'yükselen',text,re.I) and re.search(r'düşen',text,re.I) and not re.search(r'\d',text):text=''
            texts[message.id]=text
            if sum(len(t) for t in texts.values())>30000:raise QueryError('bot_query_size_limit')
            if text and getattr(message,'date',None):received=message.date.isoformat()
        try:
            first=await conversation.get_reply(sent,timeout=max(0.01,deadline-monotonic()))
            if first is None:
                await accept(first);await wait_missing()
            else:await accept(first)
            while True:
                combined='\n'.join(dict.fromkeys(texts.get(i,'') for i in ids if texts.get(i)))
                if data_only:
                    available=raw_messages()
                    media_ready=any(m.photo or (m.file and (m.file.mime_type or '') in ('image/jpeg','image/png','image/webp')) for m in available)
                    if available and (any((m.raw_text or '').strip() for m in available) or media_ready) and monotonic()-changed>=8:break
                elif movers_complete(combined):break
                remaining=deadline-monotonic()
                if remaining<=0:raise QueryError('bot_query_text_incomplete_movers')
                phase='followup'
                try:
                    message=await conversation.get_reply(sent,timeout=min(3,remaining))
                except (asyncio.TimeoutError,TimeoutError):pass
                else:
                    await accept(message)
                    if message is None:await wait_missing()
                if monotonic()>=deadline:raise QueryError('bot_query_text_incomplete_movers')
                if ids:
                    phase='refetch'
                    refreshed=await asyncio.wait_for(client.get_messages(peer,ids=ids),timeout=max(0.01,deadline-monotonic()))
                    for index,message in enumerate(refreshed):
                        if message is None and index<len(ids):unavailable.add(ids[index])
                        await accept(message,True)
                    if any(message is None for message in refreshed):await wait_missing()
        except (asyncio.TimeoutError,TimeoutError):
            db.execute("UPDATE requests SET state='expired',result=? WHERE key=?",(diagnostic('timeout'),key));db.commit();raise QueryError('bot_query_timeout')
        except QueryError as error:
            state='reply_mismatch' if str(error)=='bot_query_reply_mismatch' else 'ambiguous' if str(error)=='bot_query_size_limit' else 'expired'
            db.execute("UPDATE requests SET state=?,result=? WHERE key=?",(state,diagnostic(getattr(error,'reason','deadline' if str(error)=='bot_query_text_incomplete_movers' else 'unspecified')),key));db.commit();raise
        result={'bot':bot,'command':command,'message_ids':ids,'text':combined,'images':[]}
        if data_only:
            kept=raw_messages()
            result.update(data_only=True,message_ids=[m.id for m in kept],text='\n\n'.join(dict.fromkeys(m.raw_text for m in kept if m.raw_text)),messages=[{'id':m.id,'reply_to_msg_id':m.reply_to_msg_id,'sender_id':m.sender_id,'chat_id':m.chat_id,'date':m.date.isoformat() if getattr(m,'date',None) else None,'edit_date':m.edit_date.isoformat() if getattr(m,'edit_date',None) else None} for m in kept])
            directory=root/'responses'/hashlib.sha256(key.encode()).hexdigest()
            for message in kept:
                if not (message.photo or (message.file and (message.file.mime_type or '') in ('image/jpeg','image/png','image/webp'))):continue
                if len(result['images'])>=2 or not message.file or message.file.size>MAX_BYTES:raise QueryError('bot_query_size_limit')
                async def progress(current,total):
                    if current>MAX_BYTES or total>MAX_BYTES:raise QueryError('bot_query_size_limit')
                data=await client.download_media(message,file=bytes,progress_callback=progress)
                if not data or len(data)>MAX_BYTES:raise QueryError('bot_query_size_limit')
                directory.mkdir(parents=True,exist_ok=True,mode=0o700)
                path=directory/(str(message.id)+'.image');path.write_bytes(data);path.chmod(0o600);result['images'].append(str(path.relative_to(root)))
        if received:result['received_at']=received
        db.execute("UPDATE requests SET state='complete',result=? WHERE key=?",(json.dumps(result,ensure_ascii=False),key));db.commit();return result

async def query(client,db,root,value):
    if value.get('command')=='/piyasayd':return await query_movers(client,db,value)
    bot,command,key=validate_query(value);row=resume_state(db,key,bot,command)
    if row and row['state']=='complete':return json.loads(row['result'])
    limit=db.execute("SELECT until FROM limits WHERE key='flood'").fetchone()
    if limit and limit['until']>time.time():raise QueryError('bot_query_rate_limited')
    peer=await client.get_entity(bot)
    if not peer.bot or (peer.username or '').lower()!=bot:raise QueryError('bot_query_peer_invalid')
    bound=db.execute('SELECT peer_id FROM peers WHERE username=?',(bot,)).fetchone()
    if bound and bound['peer_id']!=peer.id:raise QueryError('bot_query_peer_invalid')
    db.execute('INSERT OR IGNORE INTO peers VALUES(?,?)',(bot,peer.id));db.commit()
    if row and row['peer_id']!=peer.id:raise QueryError('bot_query_peer_invalid')
    if not row:
        pending=db.execute("SELECT key FROM requests WHERE bot=? AND state IN ('sending','sent','uncertain') AND created_at>? LIMIT 1",(bot,time.time()-300)).fetchone()
        if pending:raise QueryError('bot_query_busy')
        latest=db.execute('SELECT MAX(created_at) FROM requests WHERE bot=?',(bot,)).fetchone()[0]
        if latest and time.time()-latest<10:raise QueryError('bot_query_rate_limited')
        db.execute('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?)',(key,bot,command,'sending',peer.id,None,None,time.time()));db.commit()
        try:sent=await client.send_message(peer,command)
        except Exception as error:
            seconds=getattr(error,'seconds',None)
            if isinstance(seconds,int) and seconds>0:db.execute("INSERT OR REPLACE INTO limits VALUES('flood',?)",(time.time()+seconds,))
            db.execute("UPDATE requests SET state='uncertain' WHERE key=?",(key,));db.commit();raise QueryError('bot_query_delivery_uncertain')
        db.execute("UPDATE requests SET state='sent',sent_id=? WHERE key=?",(sent.id,key));db.commit()
        row=db.execute('SELECT * FROM requests WHERE key=?',(key,)).fetchone()
    if time.time()-row['created_at']>300:
        db.execute("UPDATE requests SET state='expired' WHERE key=?",(key,));db.commit();raise QueryError('bot_query_expired')
    deadline=monotonic()+90;fingerprint=None;changed=time.monotonic();responses=[]
    while time.monotonic()<deadline:
        messages=await client.get_messages(peer,min_id=row['sent_id'],limit=60)
        try:responses=candidate_messages(messages,peer.id,row['sent_id'])
        except QueryError:
            db.execute("UPDATE requests SET state='ambiguous' WHERE key=?",(key,));db.commit();raise
        current=[(m.id,m.raw_text,str(m.edit_date),str(getattr(m.photo,'id',None)),str(getattr(m.document,'id',None))) for m in responses]
        if current!=fingerprint:fingerprint=current;changed=time.monotonic()
        if meaningful(responses) and time.monotonic()-changed>=8:break
        await asyncio.sleep(2)
    else:raise QueryError('bot_query_timeout')
    texts=[];images=[];directory=root/'responses'/hashlib.sha256(key.encode()).hexdigest();directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    async def progress(current,total):
        if current>MAX_BYTES or total>MAX_BYTES:raise QueryError('bot_query_size_limit')
    for m in responses:
        if m.raw_text:texts.append(m.raw_text)
        if m.photo or (m.file and (m.file.mime_type or '') in ('image/jpeg','image/png','image/webp')):
            if len(images)>=2 or not m.file or m.file.size>MAX_BYTES:raise QueryError('bot_query_size_limit')
            data=await client.download_media(m,file=bytes,progress_callback=progress)
            if not data or len(data)>MAX_BYTES:raise QueryError('bot_query_size_limit')
            path=directory/(str(m.id)+'.image');path.write_bytes(data);path.chmod(0o600);images.append(str(path.relative_to(root)))
    text='\n\n'.join(texts)
    if len(text)>100_000:raise QueryError('bot_query_size_limit')
    result={'bot':bot,'command':command,'message_ids':[m.id for m in responses],'text':text,'images':images}
    db.execute("UPDATE requests SET state='complete',result=? WHERE key=?",(json.dumps(result,ensure_ascii=False),key));db.commit();return result

def valid_credentials(cfg):
    return (isinstance(cfg,dict) and type(cfg.get('api_id')) is int
            and 1<=cfg['api_id']<=2147483647
            and isinstance(cfg.get('api_hash'),str)
            and re.fullmatch(r'[0-9a-fA-F]{32}',cfg['api_hash']) is not None)

def load_credentials(config,setup=False):
    cfg=None
    if config.exists():
        try:cfg=json.loads(config.read_text())
        except (ValueError,UnicodeError):pass
    if valid_credentials(cfg) and not cfg.get('credentials_rejected'):return cfg
    if not setup:
        raise QueryError('bot_account_invalid' if config.exists() else 'bot_account_not_connected')
    if config.exists():print('Kaydedilmiş API bilgileri geçersiz. Lütfen yeniden gir.')
    print('API ID yazarken görünür. API hash güvenlik için görünmez; yalnızca bir kez yapıştırıp Enter tuşuna bas.')
    while True:
        api_id=input('App api_id: ').strip()
        if not re.fullmatch(r'[0-9]{1,10}',api_id) or not 1<=int(api_id)<=2147483647:
            print('Geçersiz API ID. Telefon numarası değil, API development tools sayfasındaki App api_id değerini gir.');continue
        break
    while True:
        api_hash=getpass.getpass('App api_hash (gizli): ').strip()
        if re.fullmatch(r'[0-9a-fA-F]{32}',api_hash):break
        print('API hash 32 onaltılık karakter olmalı. Değeri yalnızca bir kez yapıştır.')
    updated=dict(cfg) if isinstance(cfg,dict) else {}
    updated.pop('credentials_rejected',None)
    updated.update(api_id=int(api_id),api_hash=api_hash)
    private_json(config,updated)
    return updated

def prompt_phone():
    while True:
        value=re.sub(r'[\s()\-]','',input('Telefon (+90 ile, görünür): ').strip())
        if re.fullmatch(r'\+[1-9][0-9]{7,14}',value):return value
        print('Telefonu ülke koduyla gir: +90 ardından 10 haneli numara. Başına ayrıca 0 ekleme.')

def setup_error(error):
    # Never interpolate exception text: Telegram requests can contain credentials.
    messages={
        'ApiIdInvalidError':'API ID / API hash eşleşmesi Telegram tarafından reddedildi. Dosyayı yeniden açıp iki değeri aynı uygulama sayfasından gir.',
        'PhoneNumberInvalidError':'Telefon numarası geçersiz. Dosyayı yeniden açıp ülke koduyla (+90...) gir.',
        'PhoneNumberBannedError':'Telegram bu telefon numarasıyla girişe izin vermiyor.',
        'PhoneNumberFloodError':'Bu telefon için çok fazla giriş denemesi var. Bir süre bekleyip yeniden dene.',
        'PhoneCodeInvalidError':'Giriş kodu yanlış. Telegram uygulamasındaki en son kodu kullan.',
        'PhoneCodeExpiredError':'Giriş kodunun süresi doldu. Kurulumu yeniden aç.',
        'PasswordHashInvalidError':'İki aşamalı doğrulama şifresi yanlış.',
        'AuthRestartError':'Telegram giriş işleminin yeniden başlatılmasını istedi. Dosyayı yeniden aç.',
    }
    if isinstance(error,(TimeoutError,ConnectionError,OSError)):
        return 'Telegram bağlantısı tamamlanamadı. İnternet bağlantısını kontrol edip tekrar dene.'
    return messages.get(type(error).__name__,'Giriş tamamlanamadı. Güvenli hata türü: '+type(error).__name__)

def client_options(mode):
    # Login may need another RPC after Telegram migrates the phone's data center.
    # Queries retain one attempt: an uncertain outgoing command must not repeat.
    return dict(request_retries=3 if mode=='setup' else 0,
                raise_last_call_error=True,connection_retries=1,timeout=15,flood_sleep_threshold=0)

async def main(mode,root=ROOT):
    os.umask(0o077);root.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (root/'account.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise QueryError('bot_query_busy')
        config=root/'account.json'
        if mode=='setup':
            if not sys.stdin.isatty():raise QueryError('bot_account_terminal_required')
            print('Telegram API ID ve API hash: my.telegram.org → API development tools. Bilgiler yalnız bu bilgisayarda saklanır.')
        cfg=load_credentials(config,setup=mode=='setup')
        from telethon import TelegramClient
        from telethon.errors import FloodWaitError
        client=TelegramClient(str(root/'account'),cfg['api_id'],cfg['api_hash'],receive_updates=mode not in ('channel-scan','channel-read'),**client_options(mode))
        db=open_journal(root)
        try:
            if mode in ('channel-scan','channel-read'):
                limit=db.execute("SELECT until FROM limits WHERE key='flood'").fetchone()
                if limit and limit['until']>time.time():raise QueryError('bot_query_rate_limited')
            await client.connect()
            if mode=='setup':
                await client.start(phone=prompt_phone,code_callback=lambda:getpass.getpass('Telegram giriş kodu: '),password=lambda:getpass.getpass('İki aşamalı doğrulama şifresi: '))
            if not await client.is_user_authorized():raise QueryError('bot_account_not_connected')
            me=await client.get_me()
            if me.bot:raise QueryError('bot_account_user_required')
            if cfg.get('user_id') and cfg['user_id']!=me.id:raise QueryError('bot_account_mismatch')
            if mode=='setup':
                cfg['user_id']=me.id;private_json(config,cfg);print('Hesap bağlandı. Editör botunda /kurum, /akd KTLEV veya /takas THYAO kullanabilirsin.');return
            if not cfg.get('user_id'):raise QueryError('bot_account_not_connected')
            if mode=='status':print(json.dumps({'connected':True}));return
            value=json.loads(sys.stdin.read(4096))
            if mode in ('channel-scan','channel-read'):
                from telegram_channel import scan,read
                print(json.dumps(await(scan(client,value)if mode=='channel-scan'else read(client,value)),ensure_ascii=False));return
            if mode=='query-data':
                from telegram_raw import query_raw
                result=await query_raw(client,db,root,value,validate=validate_raw_query,resume=resume_state,error=QueryError)
            else:result=await query(client,db,root,value)
            print(json.dumps(result,ensure_ascii=False))
        except FloodWaitError as error:
            db.execute("INSERT OR REPLACE INTO limits VALUES('flood',?)",(time.time()+error.seconds,));db.commit();raise QueryError('bot_query_rate_limited')
        except Exception as error:
            if mode=='setup':
                if type(error).__name__=='ApiIdInvalidError':
                    cfg['credentials_rejected']=True;private_json(config,cfg)
                print(setup_error(error),file=sys.stderr)
            raise
        finally:
            await client.disconnect();db.close()

if __name__=='__main__':
    sys.modules.setdefault('telegram_account',sys.modules[__name__])
    try:asyncio.run(main(sys.argv[1] if len(sys.argv)>1 else 'query'))
    except Exception as error:
        code=str(error) if isinstance(error,QueryError) else 'bot_account_dependency_missing' if isinstance(error,ModuleNotFoundError) else 'bot_query_failed'
        print(json.dumps({'error':code}),file=sys.stderr);sys.exit(1)
