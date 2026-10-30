import unittest,copy
from api_candidate import compact_kap_payload
class KapPayloadCompaction(unittest.TestCase):
 def test_only_exact_duplicate_official_body_is_compacted_and_evidence_is_unchanged(self):
  d={'source_id':'kap','official':True,'url':'https://www.kap.org.tr/tr/Bildirim/1690257','body':'issuer\n\n100 shares','passages':[{'id':'metadata','text':'issuer'},{'id':'row','text':'100 shares'}]};p={'documents':[d],'draft':{'claims':[1]}};before=copy.deepcopy(p);r=compact_kap_payload(p);self.assertEqual(r['documents'][0]['body'],'issuer');self.assertEqual(r['documents'][0]['passages'],d['passages']);self.assertEqual(r['draft'],p['draft']);self.assertEqual(p,before)
  for change in ({'body':d['body']+'\nunique fact'},{'official':False},{'source_id':'other'},{'url':'https://example.com'},{'passages':[]}):
   x={'documents':[d|change]};self.assertEqual(compact_kap_payload(x),x)
