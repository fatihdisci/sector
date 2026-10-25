import importlib.util,json,pathlib,sqlite3,tempfile,unittest
spec=importlib.util.spec_from_file_location('owner_reviews',pathlib.Path(__file__).parents[1]/'scripts/record_owner_news_reviews.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class OwnerReviews(unittest.TestCase):
 def test_append_only_idempotency_and_no_activation(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'db';c=sqlite3.connect(p);c.executescript((pathlib.Path(__file__).parents[1]/'migrations/0001_sector.sql').read_text());c.execute("INSERT INTO news_interests VALUES('owner','article','id','s','like',1,1)")
   c.execute("INSERT INTO news_candidates VALUES('id','article','url','s','title','summary','2026-10-25',1,9999999999999,'archive','[]','{}','v',1,1,1,'sig','id','[]','s')");c.commit()
   pkg={k:'test' for k in ['approval_source','rule_version','catalog_version','code_hash','catalog_hash','scope_hash','sample_hash']};pkg.update(context='fresh_publication_owner_review',rows=[{'candidate_id':'id','label':'digest'}])
   self.assertEqual(m.record(p,pkg)['inserted'],0);self.assertEqual(m.record(p,pkg,True)['inserted'],1);self.assertEqual(m.record(p,pkg,True)['inserted'],0)
   self.assertEqual(c.execute('select count(*) from system_state').fetchone()[0],0);self.assertEqual(c.execute('select route from news_candidates').fetchone()[0],'archive');self.assertEqual(c.execute('select count(*) from news_feedback').fetchone()[0],0)
   c.execute("INSERT INTO system_state VALUES('news_filter_preferences','{\"mode\":\"active\"}')");c.commit()
   with self.assertRaises(ValueError):m.record(p,pkg,True)
   c.close()
