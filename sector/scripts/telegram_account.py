"""Owner-authorized, allowlisted Telegram queries. Never read unrelated dialogs.

Session/API credentials live outside Git. Each request is journalled before send;
unknown sends are never repeated. One account lock serializes setup and queries.
"""
import asyncio,fcntl,getpass,hashlib,json,os,pathlib,re,sqlite3,sys,time
ROOT=pathlib.Path.home()/'Library/Application Support/sector-haber/telegram-account'
MAX_BYTES=20_000_000
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

async def query_movers(client,db,value):
    # One explicit command and one correlated event; no message polling or
    # automatic resend after a timeout/uncertain outcome.
    bot,command,key=validate_query(value);row=resume_state(db,key,bot,command)
    if row and row['state']=='complete':return json.loads(row['result'])
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
        parts=[];ids=[];received=None;deadline=time.monotonic()+90
        for _ in range(20):
            remaining=deadline-time.monotonic()
            if remaining<=0:break
            try:message=await conversation.get_reply(sent,timeout=min(remaining,15 if parts else 90))
            except (asyncio.TimeoutError,TimeoutError):break
            if message.sender_id!=peer.id or getattr(message,'reply_to_msg_id',None)!=sent.id or message.id<=sent.id:
                db.execute("UPDATE requests SET state='ambiguous' WHERE key=?",(key,));db.commit();raise QueryError('bot_query_ambiguous')
            if message.id in ids:continue
            ids.append(message.id);text=message.raw_text or ''
            if len(text)>30000 or sum(map(len,parts))+len(text)>30000:
                db.execute("UPDATE requests SET state='ambiguous' WHERE key=?",(key,));db.commit();raise QueryError('bot_query_size_limit')
            if text:
                if re.search(r'(?:abonelik|üyelik|üye ol|paket|sorgu limiti|günlük limit|kota).{0,60}(?:gerek|doldu|aşıldı|bitti|yetersiz|ulaştı)',text,re.I):
                    db.execute("UPDATE requests SET state='expired' WHERE key=?",(key,));db.commit();raise QueryError('bot_query_provider_limit')
                if '\n' not in text and re.search(r'yükselen',text,re.I) and re.search(r'düşen',text,re.I) and not re.search(r'\d',text):continue
                if getattr(message,'date',None) and received is None:received=message.date.isoformat()
                if movers_complete(text):parts=[text];break
                if text not in parts:parts.append(text)
            combined='\n'.join(parts)
            if movers_complete(combined):break
        if not movers_complete('\n'.join(parts)):
            db.execute("UPDATE requests SET state='expired' WHERE key=?",(key,));db.commit();raise QueryError('bot_query_text_incomplete_movers' if ids else 'bot_query_timeout')
        result={'bot':bot,'command':command,'message_ids':ids,'text':'\n'.join(parts),'images':[]}
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
    deadline=time.monotonic()+90;fingerprint=None;changed=time.monotonic();responses=[]
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
            print(json.dumps(await query(client,db,root,value),ensure_ascii=False))
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
