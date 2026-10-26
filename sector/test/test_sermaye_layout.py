import sys,pathlib,json,unittest
sys.path.insert(0,str(pathlib.Path(__file__).parents[1]/'scripts'))
from sermaye_layout import source_layout
from image_vision import extract
class SermayeFormats(unittest.TestCase):
 def test_real_five_uploaded_ocr_layouts_and_all_panel_rows(self):
  root=pathlib.Path(__file__).parent/'fixtures/sermaye'
  for i,kind,count in [(1,'market_overview',25),(2,'institution_summary',10),(3,'market_overview',25),(4,'market_overview',25),(5,'theoretical',40)]:
   raw=json.loads((root/f'ocr-{i}.json').read_text());layout=source_layout(raw);self.assertEqual(layout['kind'],kind);self.assertEqual(layout['minimum_rows'],count)
  self.assertIn('GMSTR.F',source_layout(json.loads((root/'ocr-2.json').read_text()))['panels'][1]['symbols'])
 def test_unrelated_akd_does_not_become_theoretical_or_general_market(self):
  self.assertIsNone(source_layout([{'text':'KTLEV ARACI KURUM DAĞILIMI','x':.1,'y':.1}]))
 def test_missing_source_rows_fail_even_if_audit_says_supported(self):
  e={'images':['fixture.png'],'source_layout':{'kind':'theoretical','panels':[{'name':'buy','symbols':['KAPLM','ASTOR']}]}}
  answers=iter([{'complete':True,'facts':['Teorik fiyat: KAPLM 94,05 TL'],'issues':[]},{'supported':True,'issues':[]}])
  with self.assertRaisesRegex(RuntimeError,'image_vision_incomplete'):extract(e,lambda *args:next(answers))
 def test_pixel_audit_preserves_theoretical_role_and_distinct_brokers(self):
  calls=[];e={'images':['fixture.png'],'source_layout':{'kind':'institution_summary','panels':[{'name':'buy','symbols':['YKBNK']},{'name':'sell','symbols':['ASTOR']}]}}
  def invoke(job,prompt,payload):
   calls.append(prompt);return {'complete':True,'facts':['BofA üzerinden YKBNK net alım: +1,16 milyar TL','QNB üzerinden ASTOR net satım: -732,80 milyon TL'],'issues':[]}if len(calls)==1 else{'supported':True,'issues':[]}
  r=extract(e,invoke);self.assertEqual(r['source_layout'],e['source_layout']);self.assertIn('TEORİK',calls[0]);self.assertIn('puan/yüzde',calls[1]);self.assertIn('QNB',r['body'])

class SermayeCropTests(unittest.TestCase):
 def test_theoretical_crops_preserve_original_and_real_headers(self):
  import tempfile,subprocess
  from PIL import Image
  from read_image import read_image
  # Synthetic pixels and mocked OCR validate cropping without network/model calls.
  with tempfile.TemporaryDirectory()as d:
   p=pathlib.Path(d);src=p/'source.png';Image.new('RGB',(1080,1350),'white').save(src)
   from unittest.mock import patch
   blocks=[{'text':'Teorik Eşleşme','x':.1,'y':.03,'width':.3,'height':.02,'confidence':1}]
   with patch('read_image.subprocess.run',return_value=type('R',(),{'stdout':json.dumps(blocks)})()):
    e=read_image(src,p/'out',pathlib.Path('/not-used-ocr'))
   self.assertEqual(len(e['images']),5)
   self.assertTrue(all(pathlib.Path(f).exists()for f in e['images']))

class SermayeFormatEquivalents(unittest.TestCase):
 def test_only_explicit_scale_currency_percent_change_and_lot_separators_survive(self):
  answers=iter([{'complete':True,'facts':['BofA net: 3,58 Mr₺; YKBNK 720,14 Mn; Kalan: 8.373.303; değişim: %10.00'],'issues':[]},{'supported':True,'issues':[]}])
  r=extract({'images':['fixture.png'],'source_layout':{'kind':'institution_summary','panels':[]}},lambda *args:next(answers))
  self.assertIn('3,58 milyar TL',r['body']);self.assertIn('720,14 milyon;',r['body']);self.assertNotIn('720,14 milyon TL',r['body']);self.assertIn('8.373.303',r['body']);self.assertIn('%10,00',r['body']);self.assertIn('Mr₺',r['passages'][0]['text'])
