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
