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
    def test_kurum_loading_status_is_not_final_content(self):
        from telegram_raw_protocol import is_placeholder
        self.assertTrue(is_placeholder('🔄 YAPI KREDI kurum verisi alınıyor...'))

    def test_bopt_institutional_profile_folds_turkish_and_rejects_wrong_or_incomplete_answers(self):
        from telegram_raw_protocol import payload_matches
        good='🏦 YAPI KREDI KURUM ANALİZİ\n🟢 EN ÇOK ALINAN HİSSELER:\n'+'\n'.join(f'{i}. A{i:04}: {i}.2Mn TL' for i in range(1,11))+'\n🔴 EN ÇOK SATILAN HİSSELER:\n'+'\n'.join(f'{i}. B{i:04}: {i}.2Mn TL' for i in range(1,11))
        self.assertTrue(payload_matches('b0pt_bot','/kurum yapı kredi',good,True))
        self.assertFalse(payload_matches('b0pt_bot','/kurum yapı kredi',good.replace('YAPI KREDI','AK YATIRIM'),True))
        self.assertFalse(payload_matches('b0pt_bot','/kurum yapı kredi',good,False))
        self.assertFalse(payload_matches('b0pt_bot','/kurum yapı kredi',good.replace('SATILAN','SATILMIŞ'),True))
        self.assertFalse(payload_matches('b0pt_bot','/kurum yapı',good,True))
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
    def protocol_fixtures(self):return json.loads((pathlib.Path(__file__).parent/'fixtures/telegram-raw-source-protocol.json').read_text())
    async def test_three_source_frames_with_no_reply_header_match_payload_and_preserve_full_data(self):
        for fixture in self.protocol_fixtures():
            self.peer=7 if fixture['bot']=='b0pt_bot'else 8;self.clock=0
            message=self.image(raw_text=fixture['text'],reply_to_msg_id=None)if fixture['media']else self.msg(raw_text=fixture['text'],reply_to_msg_id=None)
            client=self.client([('new',message)])
            result=await self.run_query(client,dict(self.value,bot=fixture['bot'],command=fixture['command']))
            self.assertEqual(result['text'],fixture['text']);self.assertIsNone(result['messages'][0]['reply_to_msg_id']);self.assertEqual(result['messages'][0]['binding'],'serialized_profile');self.assertEqual(client.send_message.await_count,1)
            self.db.execute('DELETE FROM requests');self.db.commit()
    async def test_correlated_loading_then_unthreaded_source_final_and_deletion(self):
        fixture=self.protocol_fixtures()[2]
        initial=self.msg(raw_text='🔄 En çok yükselen ve düşen hisseler için veri alınıyor...')
        final=self.image(id=12,raw_text=fixture['text'],reply_to_msg_id=None)
        client=self.client([('new',initial),('new',final),('delete',11),('delete',12)])
        result=await self.run_query(client)
        self.assertEqual(result['message_ids'],[12]);self.assertEqual(result['text'],fixture['text'])
        evidence=json.loads((self.root/result['evidence_path']).read_text());self.assertTrue(evidence['snapshots'][0]['placeholder'])
    def test_loading_variants_and_all_eight_source_profiles(self):
        from telegram_raw_protocol import is_placeholder,payload_matches
        for text in ['VERİ ALINIYOR','Veriler alınıyor...','Hazırlanıyor','Yükleniyor']:
            self.assertTrue(is_placeholder(text))
        for fixture in self.protocol_fixtures():self.assertTrue(payload_matches(fixture['bot'],fixture['command'],fixture['text'],fixture['media']))
        for command,text,media in [('/detay ASELS','📊 ASELS Detaylı Hisse Bilgisi',True),('/doviz','DÖVİZ KURLARI USD:49 EUR:55 ALTIN:6499 XU100:11165 VIOP:13982 Bitcoin:80226',True)]:self.assertTrue(payload_matches('b0pt_bot',command,text,media))
        for command,text,media in [('/teorik ASELS','#ASELS Teorik Eşleşme Verileri Güncel:358 Önceki Kapanış:340 Fiyat:358 Miktar:1 Alış:0 Satış:1',False),('/akd ASTOR','ASTOR - Aracı Kurum Dağılımı (Günlük)',True),('/kurum','Borsa İstanbul Aracı Kurum Verileri 22 Ekim 2026 En Çok Net Alış Yapanlar 5 En Çok Net Satış Yapanlar 5',False)]:self.assertTrue(payload_matches('ucretsizderinlikbot',command,text,media))
    async def test_unthreaded_wrong_ticker_generic_and_image_only_fail_without_capture(self):
        self.peer=8
        for text,media in [('THYAO - 25 Kademe Derinlik',True),('Saat 14:03 fiyat 358.50',False),('',True)]:
            message=self.image(raw_text=text,reply_to_msg_id=None)if media else self.msg(raw_text=text,reply_to_msg_id=None)
            client=self.client([('new',message)])
            with self.assertRaisesRegex(account.QueryError,'reply_mismatch'):await self.run_query(client,dict(self.value,bot='ucretsizderinlikbot',command='/derinlik ASELS'))
            record=json.loads(self.db.execute('SELECT result FROM requests').fetchone()[0]);self.assertEqual(record['rejection']['field'],'payload_profile');self.assertNotIn('THYAO',json.dumps(record))
            client.download_media.assert_not_awaited();self.db.execute('DELETE FROM requests');self.db.commit()
    async def test_explicit_wrong_reply_never_falls_back_to_payload_matching(self):
        self.peer=8;client=self.client([('new',self.image(raw_text='ASELS - 25 Kademe Derinlik',reply_to_msg_id=9))])
        with self.assertRaisesRegex(account.QueryError,'reply_mismatch'):await self.run_query(client,dict(self.value,bot='ucretsizderinlikbot',command='/derinlik ASELS'))
        record=json.loads(self.db.execute('SELECT result FROM requests').fetchone()[0]);self.assertEqual(record['rejection']['field'],'reply_to_msg_id')
    async def test_manual_other_device_command_between_baseline_and_send_is_conflict(self):
        self.peer=8;client=self.client([('new',self.image(raw_text='ASELS - 25 Kademe Derinlik',reply_to_msg_id=None))])
        async def reads(peer,**kwargs):
            if kwargs.get('limit')==1:return [self.msg(id=8)]
            if 'min_id'in kwargs:return [self.msg(id=9,out=True)]
            return [None]
        client.get_messages=AsyncMock(side_effect=reads)
        with self.assertRaisesRegex(account.QueryError,'ambiguous'):await self.run_query(client,dict(self.value,bot='ucretsizderinlikbot',command='/derinlik ASELS'))
        record=json.loads(self.db.execute('SELECT result FROM requests').fetchone()[0]);self.assertEqual(record['rejection']['field'],'outbound_history');self.assertEqual(client.send_message.await_count,1)
    async def test_multiple_unthreaded_finals_are_ambiguous(self):
        self.peer=8;first=self.image(raw_text='ASELS - 25 Kademe Derinlik',reply_to_msg_id=None);second=self.image(id=12,raw_text=first.raw_text,reply_to_msg_id=None)
        client=self.client([('new',first),('new',second)])
        with self.assertRaisesRegex(account.QueryError,'ambiguous'):await self.run_query(client,dict(self.value,bot='ucretsizderinlikbot',command='/derinlik ASELS'))
        record=json.loads(self.db.execute('SELECT result FROM requests').fetchone()[0]);self.assertEqual(record['rejection']['field'],'multiple_final_candidates')
    async def test_same_id_image_edit_can_keep_verified_placeholder_chain_without_header(self):
        initial=self.msg(raw_text='Veriler alınıyor...');final=self.image(reply_to_msg_id=None)
        client=self.client([('new',initial),('edit',final),('delete',11)])
        result=await self.run_query(client);self.assertEqual(result['message_ids'],[11]);self.assertEqual(len(result['images']),1);self.assertEqual(result['messages'][0]['binding'],'reply')
    async def test_unthreaded_same_id_edit_cannot_switch_ticker(self):
        self.peer=8;initial=self.image(raw_text='ASELS - 25 Kademe Derinlik',reply_to_msg_id=None);edited=self.image(raw_text='THYAO - 25 Kademe Derinlik',reply_to_msg_id=None)
        client=self.client([('new',initial),('edit',edited)])
        with self.assertRaisesRegex(account.QueryError,'reply_mismatch'):await self.run_query(client,dict(self.value,bot='ucretsizderinlikbot',command='/derinlik ASELS'))
    async def test_other_bot_pending_query_blocks_raw_send_globally(self):
        self.db.execute('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?)',('999','ucretsizderinlikbot','/takas ASTOR','sent',8,9,None,time.time()));self.db.commit()
        client=self.client([])
        with self.assertRaisesRegex(account.QueryError,'busy'):await self.run_query(client)
        client.send_message.assert_not_awaited()
    async def test_unknown_send_is_never_retried_and_handlers_are_removed(self):
        client=self.client([]);client.send_message=AsyncMock(side_effect=TimeoutError())
        with self.assertRaisesRegex(account.QueryError,'delivery_uncertain'):await self.run_query(client)
        with self.assertRaisesRegex(account.QueryError,'delivery_uncertain'):await self.run_query(client)
        self.assertEqual(client.send_message.await_count,1);self.assertEqual(self.handlers,{})
