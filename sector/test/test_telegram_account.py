import importlib.util,pathlib,tempfile,unittest,time,json
from types import SimpleNamespace as N
from unittest.mock import AsyncMock,patch
spec=importlib.util.spec_from_file_location('telegram_account',pathlib.Path(__file__).parents[1]/'scripts/telegram_account.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class AccountQueries(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name);self.db=m.open_journal(self.root)
        self.value={'bot':'b0pt_bot','command':'/kurum bank of america','key':'123'}
        self.peer=N(id=7,bot=True,username='b0pt_bot')
    def tearDown(self):self.db.close();self.temp.cleanup()
    def request(self,state,sent_id=10):
        self.db.execute('INSERT INTO requests VALUES(?,?,?,?,?,?,?,?)',('123','b0pt_bot','/kurum bank of america',state,7,sent_id,None,time.time()));self.db.commit()
    def message(self,id=11,**kwargs):
        return N(**dict(dict(id=id,out=False,sender_id=7,chat_id=7,reply_to_msg_id=10,photo=None,document=None,file=None,raw_text='Net hacim: 100 milyon TL',edit_date=None),**kwargs))
    def test_routes_are_allowlisted_and_injected_commands_fail(self):
        for bot,command in [('b0pt_bot','/piyasayd'),('b0pt_bot','/kurum Ak Yatırım'),('ucretsizderinlikbot','/kurum'),('ucretsizderinlikbot','/akd ASELS'),('ucretsizderinlikbot','/takas THYAO')]:m.validate_query(dict(self.value,bot=bot,command=command))
        for bot,command in [('evil_bot','/kurum'),('b0pt_bot','/start'),('b0pt_bot','/kurum abc\n/start'),('ucretsizderinlikbot','/akd ASELS;cat')]:
            with self.assertRaises(m.QueryError):m.validate_query(dict(self.value,bot=bot,command=command))
    def movers_text(self):
        return 'En Çok Yükselenler\n'+'\n'.join(f'U{chr(65+i)}AA 10,00 TL +1,00%' for i in range(10))+'\nEn Çok Düşenler\n'+'\n'.join(f'D{chr(65+i)}AA 10,00 TL -1,00%' for i in range(10))
    async def test_piyasayd_collects_correlated_caption_and_delayed_text_once(self):
        self.db.execute("INSERT INTO peers VALUES('b0pt_bot',7)");self.db.commit()
        text=self.movers_text();up,down=text.split('En Çok Düşenler')
        client,conv=self.movers_client([self.message(raw_text=up,photo=object()),self.message(id=12,raw_text='En Çok Düşenler'+down)])
        result=await m.query(client,self.db,self.root,dict(self.value,command='/piyasayd'))
        self.assertEqual(result['text'].replace('\n\n','\n'),text);self.assertEqual(result['message_ids'],[11,12]);self.assertEqual(conv.send_message.await_count,1)
        client.download_media.assert_not_awaited()
    async def test_piyasayd_placeholder_duplicate_and_timeout_fail_closed(self):
        self.db.execute("INSERT INTO peers VALUES('b0pt_bot',7)");self.db.commit();value=dict(self.value,command='/piyasayd')
        a=self.message(raw_text='En çok yükselen ve düşen hisseler');client,conv=self.movers_client([a,a,TimeoutError()])
        with patch.object(m,'monotonic',side_effect=[0,0,0,0,0,100]):
            with self.assertRaisesRegex(m.QueryError,'text_incomplete_movers'):await m.query(client,self.db,self.root,value)
        self.assertEqual(conv.send_message.await_count,1)
        with self.assertRaisesRegex(m.QueryError,'expired'):await m.query(client,self.db,self.root,value)
        self.assertEqual(conv.send_message.await_count,1)
    async def test_piyasayd_rejects_other_request_reply_after_partial(self):
        self.db.execute("INSERT INTO peers VALUES('b0pt_bot',7)");self.db.commit();value=dict(self.value,command='/piyasayd')
        up,down=self.movers_text().split('En Çok Düşenler')
        client,conv=self.movers_client([self.message(raw_text=up),self.message(id=12,reply_to_msg_id=9,raw_text='En Çok Düşenler'+down)])
        with self.assertRaisesRegex(m.QueryError,'ambiguous'):await m.query(client,self.db,self.root,value)
        with self.assertRaisesRegex(m.QueryError,'ambiguous'):await m.query(client,self.db,self.root,value)
        self.assertEqual(conv.send_message.await_count,1)
    async def test_piyasayd_refetches_same_correlated_id_after_30_seconds(self):
        self.db.execute("INSERT INTO peers VALUES('b0pt_bot',7)");self.db.commit()
        initial=self.message(raw_text='Hazırlanıyor',photo=object())
        fixture=(pathlib.Path(__file__).parent/'fixtures/piyasayd-edit.txt').read_text().strip();updated=self.message(raw_text=fixture,photo=object())
        client,conv=self.movers_client([initial,TimeoutError(),TimeoutError()])
        client.get_messages=AsyncMock(side_effect=[[initial],[updated]])
        with patch.object(m,'monotonic',side_effect=[0,0,0,1,1,30,30,30]):
            result=await m.query(client,self.db,self.root,dict(self.value,command='/piyasayd'))
        self.assertEqual(result['text'],fixture);self.assertEqual(result['message_ids'],[11]);self.assertEqual(conv.send_message.await_count,1)
        self.assertEqual(client.get_messages.await_args.kwargs['ids'],[11]);client.download_media.assert_not_awaited()
    async def test_piyasayd_multiple_partial_edits_and_unrelated_id(self):
        self.db.execute("INSERT INTO peers VALUES('b0pt_bot',7)");self.db.commit()
        up,down=self.movers_text().split('En Çok Düşenler')
        initial=self.message(raw_text='Hazırlanıyor');partial=self.message(raw_text=up);final=self.message(raw_text=self.movers_text())
        client,conv=self.movers_client([initial,TimeoutError(),TimeoutError()]);client.get_messages=AsyncMock(side_effect=[[partial],[final]])
        with patch.object(m,'monotonic',side_effect=[0,0,0,1,1,30,30,30]):result=await m.query(client,self.db,self.root,dict(self.value,command='/piyasayd'))
        self.assertEqual(result['text'],self.movers_text());self.assertEqual(result['message_ids'],[11])
        self.db.execute('DELETE FROM requests');self.db.commit()
        client,_=self.movers_client([initial,TimeoutError()]);client.get_messages=AsyncMock(return_value=[self.message(id=12,raw_text=self.movers_text())])
        with self.assertRaisesRegex(m.QueryError,'ambiguous'):await m.query(client,self.db,self.root,dict(self.value,command='/piyasayd'))
    async def test_piyasayd_rejects_refetch_from_wrong_sender(self):
        self.db.execute("INSERT INTO peers VALUES('b0pt_bot',7)");self.db.commit()
        client,_=self.movers_client([self.message(raw_text='Hazırlanıyor'),TimeoutError()])
        client.get_messages=AsyncMock(return_value=[self.message(sender_id=8,raw_text=self.movers_text())])
        with self.assertRaisesRegex(m.QueryError,'ambiguous'):await m.query(client,self.db,self.root,dict(self.value,command='/piyasayd'))
    async def test_piyasayd_explicit_provider_limit_is_not_retried(self):
        self.db.execute("INSERT INTO peers VALUES('b0pt_bot',7)");self.db.commit();value=dict(self.value,command='/piyasayd')
        client,conv=self.movers_client(self.message(raw_text='Günlük limit doldu'))
        with self.assertRaisesRegex(m.QueryError,'provider_limit'):await m.query(client,self.db,self.root,value)
        with self.assertRaisesRegex(m.QueryError,'expired'):await m.query(client,self.db,self.root,value)
        self.assertEqual(conv.send_message.await_count,1)
    async def test_piyasayd_placeholder_then_complete_reply(self):
        self.db.execute("INSERT INTO peers VALUES('b0pt_bot',7)");self.db.commit()
        client,_=self.movers_client([self.message(raw_text='En çok yükselen ve düşen hisseler'),self.message(id=12,raw_text=self.movers_text())])
        result=await m.query(client,self.db,self.root,dict(self.value,command='/piyasayd'))
        self.assertEqual(result['text'],self.movers_text());self.assertEqual(result['message_ids'],[11,12])
    async def test_piyasayd_requires_bound_identity_before_send(self):
        client=N(get_entity=AsyncMock(return_value=self.peer),conversation=unittest.mock.Mock())
        with self.assertRaisesRegex(m.QueryError,'peer_unverified'):await m.query(client,self.db,self.root,dict(self.value,command='/piyasayd'))
        client.conversation.assert_not_called()
    def movers_client(self,response):
        conversation=N(send_message=AsyncMock(return_value=N(id=10)),get_reply=AsyncMock(side_effect=response) if isinstance(response,(Exception,list)) else AsyncMock(return_value=response))
        context=N(__aenter__=AsyncMock(return_value=conversation),__aexit__=AsyncMock(return_value=False))
        # Special methods are resolved on the class rather than the instance.
        class Context:
            async def __aenter__(self):return conversation
            async def __aexit__(self,*args):return False
        client=N(get_entity=AsyncMock(return_value=self.peer),conversation=unittest.mock.Mock(return_value=Context()),get_messages=AsyncMock(return_value=[]),download_media=AsyncMock())
        return client,conversation
    async def test_piyasayd_waits_for_one_correlated_event_no_polling_and_no_second_send(self):
        from datetime import datetime,timezone
        self.db.execute("INSERT INTO peers VALUES('b0pt_bot',7)");self.db.commit()
        message=self.message(raw_text=self.movers_text(),date=datetime(2026,10,27,14,20,tzinfo=timezone.utc))
        client,conv=self.movers_client(message);value=dict(self.value,command='/piyasayd');result=await m.query(client,self.db,self.root,value)
        self.assertEqual(result['received_at'],'2026-10-27T14:20:00+00:00');self.assertEqual(result['images'],[]);self.assertEqual(await m.query(client,self.db,self.root,value),result)
        self.assertEqual(conv.send_message.await_count,1);self.assertEqual(conv.get_reply.await_count,1);client.get_messages.assert_not_awaited();client.download_media.assert_not_awaited()
    async def test_piyasayd_timeout_and_unrelated_reply_never_resend(self):
        self.db.execute("INSERT INTO peers VALUES('b0pt_bot',7)");self.db.commit();value=dict(self.value,command='/piyasayd')
        client,conv=self.movers_client(TimeoutError())
        with self.assertRaisesRegex(m.QueryError,'timeout'):await m.query(client,self.db,self.root,value)
        with self.assertRaisesRegex(m.QueryError,'expired'):await m.query(client,self.db,self.root,value)
        self.assertEqual(conv.send_message.await_count,1);client.get_messages.assert_not_awaited()
        self.db.execute('DELETE FROM requests');self.db.commit();client,conv=self.movers_client(self.message(reply_to_msg_id=9))
        with self.assertRaisesRegex(m.QueryError,'ambiguous'):await m.query(client,self.db,self.root,value)
        with self.assertRaisesRegex(m.QueryError,'ambiguous'):await m.query(client,self.db,self.root,value)
        self.assertEqual(conv.send_message.await_count,1)
    async def test_unknown_send_is_persisted_and_never_resent(self):
        client=N(get_entity=AsyncMock(return_value=self.peer),send_message=AsyncMock(side_effect=TimeoutError()))
        with self.assertRaisesRegex(m.QueryError,'delivery_uncertain'):await m.query(client,self.db,self.root,self.value)
        with self.assertRaisesRegex(m.QueryError,'delivery_uncertain'):await m.query(client,self.db,self.root,self.value)
        self.assertEqual(client.send_message.await_count,1)
    async def test_resume_received_messages_does_not_resend_and_completed_results_reuse(self):
        self.request('sent');client=N(get_entity=AsyncMock(return_value=self.peer),send_message=AsyncMock(),get_messages=AsyncMock(return_value=[self.message()]))
        with patch.object(m.time,'monotonic',side_effect=[0,0,0,0,9,10]),patch.object(m.asyncio,'sleep',new=AsyncMock()):
            result=await m.query(client,self.db,self.root,self.value)
        self.assertEqual(result['text'],'Net hacim: 100 milyon TL');client.send_message.assert_not_awaited()
        client.get_entity.reset_mock();again=await m.query(client,self.db,self.root,self.value)
        self.assertEqual(again,result);client.get_entity.assert_not_awaited()
    async def test_another_unfinished_query_blocks_a_new_command(self):
        self.request('sent');client=N(get_entity=AsyncMock(return_value=self.peer),send_message=AsyncMock())
        with self.assertRaisesRegex(m.QueryError,'busy'):await m.query(client,self.db,self.root,dict(self.value,key='124'))
        client.send_message.assert_not_awaited()
    def test_unrelated_replies_are_excluded_and_interleaved_command_is_ambiguous(self):
        msgs=[self.message(),self.message(12,sender_id=8),self.message(13,reply_to_msg_id=9),self.message(9)]
        self.assertEqual([v.id for v in m.candidate_messages(msgs,7,10)],[11])
        with self.assertRaisesRegex(m.QueryError,'ambiguous'):m.candidate_messages(msgs+[self.message(14,out=True)],7,10)
    async def test_changed_peer_binding_prevents_sending(self):
        self.db.execute('INSERT INTO peers VALUES(?,?)',('b0pt_bot',999));self.db.commit()
        client=N(get_entity=AsyncMock(return_value=self.peer),send_message=AsyncMock())
        with self.assertRaisesRegex(m.QueryError,'peer_invalid'):await m.query(client,self.db,self.root,self.value)
        client.send_message.assert_not_awaited()
    async def test_expired_and_flood_blocked_requests_never_send(self):
        self.db.execute("INSERT INTO limits VALUES('flood',?)",(time.time()+120,));self.db.commit()
        client=N(get_entity=AsyncMock(),send_message=AsyncMock())
        with self.assertRaisesRegex(m.QueryError,'rate_limited'):await m.query(client,self.db,self.root,self.value)
        client.get_entity.assert_not_awaited();client.send_message.assert_not_awaited()
if __name__=='__main__':unittest.main()

class AccountCredentials(unittest.TestCase):
    def test_signed_int32_and_hash_validation(self):
        for value in (0,-1,2147483648,999999999999999,True,'123',None):
            self.assertFalse(m.valid_credentials({'api_id':value,'api_hash':'a'*32}))
        for value in (1,2147483647):
            self.assertTrue(m.valid_credentials({'api_id':value,'api_hash':'a'*32}))
        for cfg in ([],None,{}, {'api_id':1,'api_hash':1}):self.assertFalse(m.valid_credentials(cfg))
    def test_invalid_saved_id_prompts_again_and_preserves_account_binding(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'account.json'
            path.write_text(json.dumps({'api_id':999999999999999,'api_hash':'a'*32,'user_id':42}))
            with patch('builtins.input',side_effect=['999999999999999','123']),patch.object(m.getpass,'getpass',side_effect=['bad','b'*32]),patch('builtins.print'):
                cfg=m.load_credentials(path,setup=True)
            self.assertEqual(cfg,{'api_id':123,'api_hash':'b'*32,'user_id':42})
            self.assertEqual(json.loads(path.read_text()),cfg)
            self.assertEqual(path.stat().st_mode & 0o777,0o600)
    def test_valid_saved_config_does_not_prompt(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'account.json';cfg={'api_id':123,'api_hash':'a'*32,'user_id':42}
            path.write_text(json.dumps(cfg))
            with patch('builtins.input') as prompt:self.assertEqual(m.load_credentials(path,setup=True),cfg)
            prompt.assert_not_called()
    def test_query_rejects_invalid_configuration_without_prompting(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'account.json';path.write_text('{bad')
            with patch('builtins.input') as prompt:
                with self.assertRaisesRegex(m.QueryError,'bot_account_invalid'):m.load_credentials(path)
            prompt.assert_not_called()

class SetupErrors(unittest.TestCase):
    def test_phone_format_retries_and_normalizes(self):
        with patch('builtins.input',side_effect=['','05551234567','+90 (555) 123-45-67']),patch('builtins.print'):
            self.assertEqual(m.prompt_phone(),'+905551234567')
    def test_error_messages_never_include_exception_details(self):
        error=type('ApiIdInvalidError',(Exception,),{})('secret-api-hash')
        self.assertIn('reddedildi',m.setup_error(error))
        self.assertNotIn('secret-api-hash',m.setup_error(error))
        self.assertNotIn('secret',m.setup_error(ValueError('secret')))
    def test_rejected_credentials_prompt_for_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'account.json'
            path.write_text(json.dumps({'api_id':123,'api_hash':'a'*32,'credentials_rejected':True}))
            with patch('builtins.input',return_value='456'),patch.object(m.getpass,'getpass',return_value='b'*32),patch('builtins.print'):
                cfg=m.load_credentials(path,setup=True)
            self.assertEqual(cfg['api_id'],456)
            self.assertNotIn('credentials_rejected',cfg)

class LoginRetries(unittest.TestCase):
    def test_login_can_follow_migration_but_queries_never_retry_commands(self):
        self.assertEqual(m.client_options('setup')['request_retries'],3)
        for mode in ('query','status'):
            self.assertEqual(m.client_options(mode)['request_retries'],0)
        self.assertTrue(m.client_options('setup')['raise_last_call_error'])
