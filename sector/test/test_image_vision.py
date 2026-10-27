import pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'scripts'))
from image_vision import extract
class VisualEvidenceTests(unittest.TestCase):
 def test_pixel_facts_replace_wrong_ocr_and_original_image_is_preserved(self):
  evidence={'body':'OCR: yüksek 30%','images':['source.png'],'passages':[],'coverage':{'complete':True}}
  calls=[]
  def invoke(job,prompt,payload):
   calls.append((job,prompt,payload))
   return {'complete':True,'facts':['Konu: Gram altın','Anlık fiyat: 6.507,66','Gün içi en düşük: 6.465,03','Gün içi en yüksek: 6.607,81'],'issues':[]} if len(calls)==1 else {'supported':True,'issues':[]}
  out=extract(evidence,invoke)
  self.assertEqual(len(calls),2);self.assertEqual(out['images'],evidence['images'])
  self.assertNotIn('30%',out['body']);self.assertEqual(len(out['passages']),4)
  self.assertEqual(calls[1][0]['documents'],[evidence])
  self.assertEqual(calls[0][0]['model'],'gpt-6.1-terra');self.assertEqual(calls[0][0]['effort'],'low')
 def test_unreadable_or_audit_failure_never_becomes_evidence(self):
  for result in [{'complete':False,'facts':['x']},{'complete':True,'facts':[]},{'complete':True,'facts':[123]}]:
   with self.assertRaisesRegex(RuntimeError,'image_vision_incomplete'):extract({},lambda *args:result)
  n=0
  def invoke(*args):
   nonlocal n
   n+=1
   return {'complete':True,'facts':['Fiyat: 100'],'issues':[]} if n==1 else {'supported':False,'issues':['Etiket yanlış']}
  with self.assertRaisesRegex(RuntimeError,'image_vision_unverified'):extract({},invoke)

 def test_one_correction_is_independently_audited_before_acceptance(self):
  answers=iter([{'complete':True,'facts':['Net kâr: 100 milyon TL'],'issues':[]},{'supported':False,'issues':['Tabloda eksi işareti var']},{'complete':True,'facts':['Net kâr: -100 milyon TL'],'issues':[]},{'supported':True,'issues':[]}])
  calls=[]
  def invoke(job,prompt,payload):
   calls.append(payload);return next(answers)
  out=extract({'images':['original.png']},invoke)
  self.assertEqual(len(calls),4);self.assertEqual(out['body'],'Net kâr: -100 milyon TL')
  self.assertEqual(calls[2]['audit_issues'],['Tabloda eksi işareti var'])
 def test_incomplete_read_gets_one_correction_and_independent_audit(self):
  answers=iter([{'complete':False,'facts':['BIST: 100'],'issues':['Hacim okunamadı']},{'complete':True,'facts':['BIST: 100','Hacim: 20'],'issues':[]},{'supported':True,'issues':[]}]);calls=[]
  def invoke(job,prompt,payload):calls.append(payload);return next(answers)
  out=extract({'images':['original.png']},invoke)
  self.assertEqual(calls[1]['audit_issues'],['Hacim okunamadı']);self.assertEqual(len(calls),3);self.assertIn('Hacim: 20',out['body'])
 def test_second_incomplete_read_is_rejected(self):
  calls=[]
  def invoke(*args):calls.append(1);return {'complete':False,'facts':[],'issues':['Okunamıyor']}
  with self.assertRaisesRegex(RuntimeError,'image_vision_unverified'):extract({},invoke)
  self.assertEqual(len(calls),2)
 def test_audited_visual_layout_replaces_incomplete_ocr_and_retains_missing_label_notes(self):
  names=['ENDEKSI YUKSELTENLER','ENDEKSI DUSURENLER','EN COK YUKSELENLER','EN COK DUSENLER','HACIM LIDERLERI']
  panels=[{'name':n,'symbols':['ASTOR','PETKM']}for n in names]
  evidence={'images':['source.png'],'source_layout':{'kind':'market_overview','panels':[{'name':n,'symbols':['ASTOR']}for n in names],'minimum_rows':5}}
  notes=['Para birimi ve veri tarihi yazmıyor.'];calls=[]
  def invoke(job,prompt,payload):
   calls.append(payload)
   return {'complete':True,'facts':['ASTOR 102,5 milyon; PETKM 84,8 milyon'],'notes':notes,'issues':[],'visual_layout':{'kind':'market_overview','panels':panels}}if len(calls)==1 else {'supported':True,'issues':[]}
  out=extract(evidence,invoke)
  self.assertEqual(out['source_layout']['minimum_rows'],10);self.assertEqual(out['source_layout']['panels'],panels)
  self.assertEqual(calls[1]['notes'],notes);self.assertEqual(calls[1]['visual_layout']['panels'],panels)
  self.assertTrue(any(p['id']=='image_source_note_1'for p in out['passages']));self.assertNotIn('84,8 milyon TL',out['body'])
 def test_visual_layout_can_be_discovered_without_ocr(self):
  layout={'kind':'theoretical','panels':[{'name':'buy','symbols':['ASTOR']},{'name':'sell','symbols':['PETKM']}]}
  answers=iter([{'complete':True,'facts':['ASTOR teorik fiyat 172,40 TL; PETKM teorik fiyat 20 TL'],'issues':[],'visual_layout':layout},{'supported':True,'issues':[]}])
  out=extract({'body':'','images':['source.png']},lambda *args:next(answers))
  self.assertEqual(out['source_layout']['minimum_rows'],2)
 def test_notes_cannot_bypass_a_failed_pixel_audit(self):
  def invoke(job,prompt,payload):
   if 'facts'in payload and 'visual_layout'in payload:return {'supported':False,'issues':['Para birimi uydurulmuş']}
   return {'complete':True,'facts':['Hacim: 100 milyon TL'],'notes':['Para birimi yok'],'issues':[]}
  with self.assertRaisesRegex(RuntimeError,'image_vision_unverified'):extract({},invoke)
