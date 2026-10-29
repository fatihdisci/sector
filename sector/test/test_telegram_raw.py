import asyncio,json,pathlib,sqlite3,tempfile,time,unittest,sys
from types import SimpleNamespace as N
from unittest.mock import AsyncMock
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
import telegram_account as account
from telegram_raw import query_raw

class EventTypes:
    NewMessage=staticmethod(lambda **kw:'new')
    MessageEdited=staticmethod(lambda **kw:'edit')
    MessageDeleted=staticmethod(lambda **kw:'delete')

class RawQueries(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.db=account.open_journal(self.root)
        self.db.execute("INSERT INTO peers VALUES('b0pt_bot',7)");self.db.execute("INSERT INTO peers VALUES('ucretsizderinlikbot',8)");self.db.commit()
        self.value={'bot':'b0pt_bot','command':'/piyasayd','key':'456'};self.clock=0;self.handlers={};self.steps=[];self.peer=7
    def tearDown(self):self.db.close();self.temp.cleanup()
    def msg(self,id=11,**fields):
        from datetime import datetime,timezone
        return N(**(dict(id=id,sender_id=self.peer,chat_id=self.peer,reply_to_msg_id=10,out=False,raw_text='Kaynak metni',photo=None,document=None,file=None,date=datetime(2026,10,28,12,tzinfo=timezone.utc),edit_date=None)|fields))
    def image(self,**fields):return self.msg(**(dict(raw_text='',photo=N(id=50),file=N(mime_type='image/png',size=3))|fields))
    async def emit(self,kind,message):
        event=N(deleted_ids=[message])if kind=='delete'else N(message=message)
        await self.handlers[kind](event)
    def client(self,initial):
        async def send(peer,command):
            self.assertEqual(set(self.handlers),{'new','edit','delete'})
            for kind,message in initial:await self.emit(kind,message)
            return self.msg(id=10,out=True,raw_text=command)
        async def entity(name):return N(id=self.peer,username=name,bot=True)
        def add(handler,builder):self.handlers[builder]=handler
        def remove(handler,builder):self.handlers.pop(builder)
        client=N(get_entity=AsyncMock(side_effect=entity),send_message=AsyncMock(side_effect=send),get_messages=AsyncMock(return_value=[None]),download_media=AsyncMock(return_value=b'png'),add_event_handler=add,remove_event_handler=remove)
        return client
    async def wait(self,seconds):
        self.clock+=seconds
        if self.steps:
            for kind,message in self.steps.pop(0):await self.emit(kind,message)
    async def run_query(self,client,value=None):
        return await query_raw(client,self.db,self.root,value or self.value,validate=account.validate_raw_query,resume=account.resume_state,error=account.QueryError,clock=lambda:self.clock,types=EventTypes,wait_event=self.wait)
    def test_eight_explicit_routes_without_expanding_production(self):
        routes=[('b0pt_bot','/detay asels','/detay ASELS'),('b0pt_bot','/piyasayd','/piyasayd'),('b0pt_bot','/doviz','/doviz'),('ucretsizderinlikbot','/takas ASTOR','/takas ASTOR'),('ucretsizderinlikbot','/teorik asels','/teorik ASELS'),('ucretsizderinlikbot','/derinlik asels','/derinlik ASELS'),('ucretsizderinlikbot','/akd ASTOR','/akd ASTOR'),('ucretsizderinlikbot','/kurum','/kurum')]
        for bot,command,normalized in routes:
            self.assertEqual(account.validate_raw_query(dict(self.value,bot=bot,command=command)),(bot,normalized,'456'))
        for bot,command,_ in routes:
            wrong='ucretsizderinlikbot'if bot=='b0pt_bot'else'b0pt_bot'
            with self.assertRaises(account.QueryError):account.validate_raw_query(dict(self.value,bot=wrong,command=command))
        for command in ['/detay ASELS','/doviz','/teorik ASELS','/derinlik ASELS']:
            for bot in ['b0pt_bot','ucretsizderinlikbot']:
                with self.assertRaises(account.QueryError):account.validate_query(dict(self.value,bot=bot,command=command))
        for command in ['/detay ASELS\n/start','/teorik ABC','/derinlik ASELS;evil','/doviz extra']:
            with self.assertRaises(account.QueryError):account.validate_raw_query(dict(self.value,command=command))
    async def test_text_image_and_caption_return_full_original_data_and_no_resend(self):
        for i,message in enumerate([self.msg(raw_text='Tarih: 28.10.2026\nTam metin'),self.image(),self.image(raw_text='Caption\nBütün metin')]):
            value=dict(self.value,key=str(500+i));client=self.client([('new',message)])
            result=await self.run_query(client,value);again=await self.run_query(client,value)
            self.assertEqual(result,again);self.assertEqual(result['text'],message.raw_text);self.assertEqual(result['messages'][0]['date'],message.date.isoformat());self.assertEqual(client.send_message.await_count,1);self.assertEqual(self.handlers,{})
            if message.photo:self.assertEqual((self.root/result['images'][0]).read_bytes(),b'png')
            self.db.execute('DELETE FROM requests');self.db.commit();self.clock=0
    async def test_placeholder_final_edit_delete_before_any_poll_preserves_snapshot(self):
        initial=self.msg(raw_text='Hazırlanıyor');final=self.msg(raw_text='15+15 görsel ve 10+10 caption ayrı kapsamdır')
        client=self.client([('new',initial),('edit',final),('edit',final),('delete',11)])
        result=await self.run_query(client)
        self.assertEqual(result['text'],final.raw_text);self.assertEqual(result['message_ids'],[11]);self.assertGreaterEqual(self.clock,8)
        evidence=json.loads((self.root/result['evidence_path']).read_text())
        self.assertEqual([s['text']for s in evidence['snapshots']],[initial.raw_text,final.raw_text]);self.assertEqual(evidence['sent_id'],10)
        self.assertEqual((self.root/result['evidence_path']).stat().st_mode&0o777,0o600)
    async def test_image_caption_edit_delete_downloads_before_settle_and_reuses_media(self):
        image=self.image();final=self.image(raw_text='Tam caption 10+10');self.steps=[[('edit',final),('delete',11)]]
        client=self.client([('new',image)])
        async def download(*args,**kwargs):self.assertLess(self.clock,8);return b'png'
        client.download_media=AsyncMock(side_effect=download)
        result=await self.run_query(client)
        self.assertEqual(result['text'],final.raw_text);self.assertEqual(len(result['images']),1);client.download_media.assert_awaited_once()
    async def test_delayed_separate_text_and_image_grouped_only_by_query(self):
        client=self.client([('new',self.image())]);self.steps=[[('new',self.msg(id=12,raw_text='Tam ayrı açıklama'))]]
        result=await self.run_query(client)
        self.assertEqual(result['text'],'Tam ayrı açıklama');self.assertEqual(result['message_ids'],[11,12]);self.assertEqual(len(result['images']),1)
    async def test_delete_before_final_times_out_preserves_placeholder_without_replay(self):
        client=self.client([('new',self.msg(raw_text='Hazırlanıyor')),('delete',11)])
        with self.assertRaisesRegex(account.QueryError,'timeout'):await self.run_query(client)
        self.assertEqual(self.clock,90);record=json.loads(self.db.execute('SELECT result FROM requests').fetchone()[0]);self.assertEqual(record['deleted_ids'],[11]);self.assertGreater(record['missing_reads'],0)
        evidence=next((self.root/'responses').glob('*/evidence.json'));self.assertIn('Hazırlanıyor',evidence.read_text())
        with self.assertRaisesRegex(account.QueryError,'expired'):await self.run_query(client)
        self.assertEqual(client.send_message.await_count,1);self.assertEqual(self.handlers,{})
    async def test_wrong_bot_chat_query_or_outbound_is_never_captured(self):
        for fields in [{'sender_id':9},{'chat_id':9},{'reply_to_msg_id':9},{'out':True}]:
            client=self.client([('new',self.msg(raw_text='PRIVATE UNRELATED',**fields))])
            with self.assertRaises(account.QueryError):await self.run_query(client)
            self.assertEqual(list((self.root/'responses').glob('*/evidence.json')),[]);client.download_media.assert_not_awaited();self.assertEqual(self.handlers,{})
            self.db.execute('DELETE FROM requests');self.db.commit()
    async def test_media_deleted_before_download_is_not_reported_as_success(self):
        client=self.client([('new',self.image())]);client.download_media=AsyncMock(side_effect=ValueError('private transport detail'))
        with self.assertRaisesRegex(account.QueryError,'media_unavailable'):await self.run_query(client)
        row=self.db.execute('SELECT result FROM requests').fetchone()[0];self.assertNotIn('private transport',row)
        evidence=json.loads(next((self.root/'responses').glob('*/evidence.json')).read_text());self.assertEqual(evidence['snapshots'][0]['media_state'],'unavailable')
    async def test_wrong_pinned_peer_and_pending_request_block_before_send(self):
        client=self.client([]);client.get_entity=AsyncMock(return_value=N(id=9,bot=True,username='b0pt_bot'))
        with self.assertRaisesRegex(account.QueryError,'peer_invalid'):await self.run_query(client)
        client.send_message.assert_not_awaited()
        self.db.execute('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?)',('999','b0pt_bot','/piyasayd','uncertain',7,9,None,time.time()));self.db.commit();client=self.client([])
        with self.assertRaisesRegex(account.QueryError,'busy'):await self.run_query(client)
        client.send_message.assert_not_awaited()
    async def test_all_eight_raw_commands_collect_without_production_parser(self):
        routes=[('b0pt_bot','/detay asels'),('b0pt_bot','/piyasayd'),('b0pt_bot','/doviz'),('ucretsizderinlikbot','/takas ASTOR'),('ucretsizderinlikbot','/teorik asels'),('ucretsizderinlikbot','/derinlik asels'),('ucretsizderinlikbot','/akd ASTOR'),('ucretsizderinlikbot','/kurum')]
        for index,(bot,command) in enumerate(routes):
            self.peer=7 if bot=='b0pt_bot'else 8;self.clock=0
            client=self.client([('new',self.msg(raw_text='Kaynak birim ve tarih aynen: 22 Ekim 2026, 426.42 Mn lot'))])
            result=await self.run_query(client,dict(self.value,bot=bot,command=command,key=str(600+index)))
            self.assertEqual(result['bot'],bot);self.assertEqual(result['command'],command if command!='/detay asels'and command!='/teorik asels'and command!='/derinlik asels'else command.split()[0]+' ASELS');self.assertIn('22 Ekim 2026',result['text']);self.assertEqual(client.send_message.await_count,1)
            self.db.execute('DELETE FROM requests');self.db.commit()
    async def test_waited_events_keep_arrival_order_and_stale_refetch_cannot_replace_edit(self):
        from datetime import timedelta
        initial=self.msg(raw_text='Hazırlanıyor');final=self.msg(raw_text='Final',edit_date=initial.date+timedelta(seconds=4))
        client=self.client([]);self.steps=[[('new',initial),('edit',final)]];client.get_messages=AsyncMock(return_value=[initial])
        result=await self.run_query(client)
        self.assertEqual(result['text'],'Final');self.assertEqual(result['messages'][0]['edit_date'],final.edit_date.isoformat())
    async def test_raw_media_capacity_and_event_buffer_are_bounded(self):
        oversized=self.image(file=N(mime_type='image/png',size=20_000_001));client=self.client([('new',oversized)])
        with self.assertRaisesRegex(account.QueryError,'size_limit'):await self.run_query(client)
        client.download_media.assert_not_awaited()
        self.db.execute('DELETE FROM requests');self.db.commit();client=self.client([('new',self.msg(id=11+i))for i in range(41)])
        with self.assertRaisesRegex(account.QueryError,'size_limit'):await self.run_query(client)
        self.assertEqual(client.send_message.await_count,1);self.assertEqual(self.handlers,{})
    async def test_unknown_send_is_never_retried_and_handlers_are_removed(self):
        client=self.client([]);client.send_message=AsyncMock(side_effect=TimeoutError())
        with self.assertRaisesRegex(account.QueryError,'delivery_uncertain'):await self.run_query(client)
        with self.assertRaisesRegex(account.QueryError,'delivery_uncertain'):await self.run_query(client)
        self.assertEqual(client.send_message.await_count,1);self.assertEqual(self.handlers,{})
