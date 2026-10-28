import datetime as dt
import json
import unittest
import pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
from usage_report import summarize

class ReportTests(unittest.TestCase):
 def test_trt_day_partial_and_bad_lines(self):
  def line(**kw):return json.dumps({'timestamp':'2026-10-26T21:30:00+00:00','stage':'audit','model':'gpt-6-luna','success':True,**kw})
  rows=[line(input_tokens=7,output_tokens=0,cached_tokens=2,reasoning_tokens=1),line(success=False,input_tokens=None),line(model='gpt-6.1-terra',input_tokens=4,output_tokens=2),'{broken',line(timestamp='2026-10-26T20:59:59Z',input_tokens=99)]
  result=summarize(rows,dt.date(2026,10,27))[('audit','gpt-6-luna')]
  self.assertEqual((result['calls'],result['success'],result['error'],result['missing_usage']), (2,1,1,1))
  self.assertEqual((result['input_tokens'],result['output_tokens'],result['cached_tokens'],result['reasoning_tokens']),(7,0,2,1))
  terra=summarize(rows,dt.date(2026,10,27))[('audit','gpt-6.1-terra')]
  self.assertEqual((terra['calls'],terra['input_tokens'],terra['output_tokens']),(1,4,2))
 def test_missing_is_unknown(self):
  row=json.dumps({'timestamp':'2026-10-27T00:00:00+03:00','stage':'vision','model':'gpt-6-luna','success':True})
  result=summarize([row],dt.date(2026,10,27))[('vision','gpt-6-luna')]
  self.assertIsNone(result['input_tokens']);self.assertEqual(result['missing_usage'],1)
