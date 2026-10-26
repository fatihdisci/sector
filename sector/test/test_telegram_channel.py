import sys,pathlib,unittest,datetime
from types import SimpleNamespace as N
from unittest.mock import AsyncMock
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
import telegram_channel as c
class ChannelRead(unittest.IsolatedAsyncioTestCase):
 def message(self,id=101,**kw):return N(**dict(dict(id=id,raw_text='Borsa İstanbul haber metni',date=datetime.datetime(2026,10,26,tzinfo=datetime.timezone.utc),edit_date=None,grouped_id=None,photo=None,document=None,media=None,file=None,entities=[]),**kw))
 def client(self,**kw):return N(**dict(dict(get_entity=AsyncMock(return_value=N(id=c.PEER_ID,username=c.CHANNEL,broadcast=True)),get_messages=AsyncMock(return_value=[]),send_message=AsyncMock(),download_media=AsyncMock()),**kw))
 async def test_baseline_reads_only_latest_and_never_sends(self):
  client=self.client(get_messages=AsyncMock(return_value=[self.message(100)]));r=await c.scan(client,{'channel':c.CHANNEL,'after_id':None});self.assertEqual(r['latest_id'],100);self.assertEqual(r['messages'],[]);client.get_messages.assert_awaited_once();client.send_message.assert_not_awaited();client.download_media.assert_not_awaited()
 async def test_identity_whitelist_and_cursor_fail_closed(self):
  for value in [{'channel':'other'}, {'channel':c.CHANNEL,'after_id':-1,'baseline_id':0}]:
   with self.assertRaises(c.QueryError):await c.scan(self.client(),value)
  client=self.client(get_entity=AsyncMock(return_value=N(id=123,username=c.CHANNEL,broadcast=True)))
  with self.assertRaisesRegex(c.QueryError,'identity'):await c.scan(client,{'channel':c.CHANNEL,'after_id':None})
 async def test_paginated_new_messages_and_album_lookback_do_not_enumerate_dialogs(self):
  one=self.message(101,grouped_id=55);two=self.message(102,grouped_id=55);old=self.message(90)
  client=self.client(get_messages=AsyncMock(side_effect=[[two],[one,two,old]]));r=await c.scan(client,{'channel':c.CHANNEL,'after_id':101,'baseline_id':100});self.assertEqual([m['id']for m in r['messages']],[101,102]);self.assertEqual(client.get_messages.await_args_list[0].kwargs,{'min_id':101,'limit':50,'reverse':True});client.send_message.assert_not_awaited()
 async def test_media_version_change_or_deletion_blocks_download(self):
  m=self.message();expected=c.message_value(m)
  for returned in [None,self.message(raw_text='Değişti')]:
   client=self.client(get_messages=AsyncMock(return_value=[returned]))
   with self.assertRaises(c.QueryError):await c.read(client,{'channel':c.CHANNEL,'messages':[expected]})
   client.download_media.assert_not_awaited();client.send_message.assert_not_awaited()
 async def test_media_download_is_bound_to_message_and_bounded(self):
  m=self.message(photo=True,media=N(),file=N(size=3,mime_type='image/jpeg'));expected=c.message_value(m);client=self.client(get_messages=AsyncMock(return_value=[m]),download_media=AsyncMock(return_value=b'abc'));r=await c.read(client,{'channel':c.CHANNEL,'messages':[expected]});self.assertEqual(r['messages'][0]['bytes_base64'],'YWJj');client.send_message.assert_not_awaited()
 def test_utf16_link_offsets_preserve_non_bmp_characters(self):
  class MessageEntityUrl:
   offset=3;length=19
  r=c.message_value(self.message(raw_text='📊 https://example.com',entities=[MessageEntityUrl()]));self.assertEqual(r['links'],['https://example.com'])
if __name__=='__main__':unittest.main()
