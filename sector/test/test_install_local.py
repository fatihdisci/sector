import importlib.util,subprocess,tempfile,unittest,sqlite3,time,os
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('installer',Path(__file__).parents[1]/'scripts/install_local.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class InstallerRegression(unittest.TestCase):
    def test_staged_news_filter_must_match_requested_active_mode(self):
        self.assertTrue(module.news_filter_ready({'news_filter':{'requested':'active','mode':'active'}}))
        self.assertTrue(module.news_filter_ready({'news_filter':{'requested':'shadow','mode':'shadow'}}))
        for state in ({'requested':'active','mode':'shadow'},{'requested':'unknown','mode':'unavailable'},None):
            self.assertFalse(module.news_filter_ready({'news_filter':state}))
    def test_dependency_failure_must_not_stop_or_mutate_current_service(self):
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp);root=home/'Library/Application Support/sector-haber';app=root/'app';app.mkdir(parents=True)
            (app/'old-release').write_text('working');python=root/'pdf-venv/bin/python';python.parent.mkdir(parents=True);python.touch()
            calls=[]
            def run(args,**kwargs):
                calls.append(args)
                if args[:2]==['npm','ci']:raise subprocess.CalledProcessError(1,args)
                return subprocess.CompletedProcess(args,1 if args[:2]==['launchctl','print'] else 0,stdout='',stderr='')
            with patch.object(module.platform,'system',return_value='Darwin'),patch.object(module.pathlib.Path,'home',return_value=home),patch.object(module.subprocess,'run',side_effect=run),patch.object(module.sys,'argv',['install_local.py','--update']):
                with self.assertRaises(Exception):module.main()
            self.assertFalse(any(c[:2]==['launchctl','bootout'] for c in calls))
            self.assertEqual(sorted(p.name for p in app.iterdir()),['old-release'])

class FakeInstaller(module.Installer):
    def __init__(self,*args,failure=None,**kwargs):
        super().__init__(*args,**kwargs);self.failure=failure;self.events=[];self.running=True;self.boots=0
    def loaded(self):return self.running
    def process_alive(self):return False
    def stop(self):self.events.append('stop');self.running=False
    def wait_maintenance(self,deadline_ms):
        self.events.append('maintenance')
        if self.failure in ('timeout','wrongapproval'):raise RuntimeError('maintenance_approval_timeout')
        if self.failure=='abort':raise KeyboardInterrupt()
    def wait_ready(self,release=None):
        self.events.append('ready')
        if release:assert not (self.release/'active').exists()
        if release and self.failure=='health':raise RuntimeError('not ready')
        if release and self.failure=='selection' and not module.news_filter_ready({'news_filter':{'requested':'active','mode':'shadow'}}):raise RuntimeError('sector_news_filter_not_active')
    def command(self,args,**kwargs):
        args=list(map(str,args));self.events.append(' '.join(args[:3]))
        if args[:2]==['npm','ci'] and self.failure=='npm':raise RuntimeError('npm failed')
        if args[:3]==['npm','run','build']:
            assert (Path(kwargs['cwd'])/'wrangler.toml').is_file(), 'staged build requires its configuration'
            assert (Path(kwargs['cwd'])/'bot-workflow.json').is_file(), 'staged bot requires reversible workflow configuration'
            assert (Path(kwargs['cwd'])/'miniapp/public/app.js').is_file(), 'staged tests require public Mini App assets'
            assert not (Path(kwargs['cwd'])/'miniapp/config.json').exists(), 'panel credentials must not enter staging'
            if self.failure=='build':raise RuntimeError('build failed')
        if args[:2]==['/usr/bin/xcrun','swiftc']:
            if self.failure=='ocr':raise RuntimeError('OCR failed')
            Path(args[-1]).write_text('new OCR')
        if args[:2]==['launchctl','bootstrap']:
            self.boots+=1
            if self.boots==1 and self.failure=='start':raise RuntimeError('bootstrap failed')
            self.running=True
        return subprocess.CompletedProcess(args,0,stdout='',stderr='')

class StagedInstallerTests(unittest.TestCase):
    def setup_installer(self,root,failure=None):
        source=Path(__file__).parents[1];runtime=root/'runtime';app=runtime/'app';app.mkdir(parents=True)
        (app/'old.txt').write_text('old');(app/'removed.ts').write_text('must not survive update')
        ocr=runtime/'bin/pdf-ocr';ocr.parent.mkdir();ocr.write_text('old OCR')
        pdf=runtime/'pdf-venv/bin/python';pdf.parent.mkdir(parents=True);pdf.touch()
        plist=root/'service.plist';plist.write_text('old plist')
        return FakeInstaller(source,runtime,plist,'/fake/node',failure=failure)
    def maintenance_db(self,i):
        import json
        path=i.runtime/'sector-haber.sqlite';db=sqlite3.connect(path);root=Path(__file__).parents[1];db.executescript((root/'migrations/0001_sector.sql').read_text()+'\n'+(root/'migrations/0008_kap_previews.sql').read_text());db.execute("INSERT INTO telegram_updates(update_id,payload,state,created_at) VALUES(1,'{}','queued',1)");db.execute("INSERT INTO system_state VALUES('news_maintenance_candidate',?)",(json.dumps({'state':'pending','hash':'a'*64,'expires_at':int(time.time()*1000)+86400000}),));db.commit();db.close();return path
    def test_maintenance_success_and_failures_restore_or_activate_without_changing_buffer(self):
        if self.__class__.__name__=='CollectorInstallerTests':self.skipTest('news publisher only')
        for failure in (None,'timeout','wrongapproval','health','activation','abort'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as tmp:
                i=self.setup_installer(Path(tmp),failure);dbpath=self.maintenance_db(i);replace=os.replace
                # A subsequent release has a separate pending pointer. Keep both on rollback.
                db=sqlite3.connect(dbpath);original=db.execute("SELECT value FROM system_state WHERE key='news_maintenance_candidate'").fetchone()[0];db.execute("INSERT INTO system_state VALUES('news_maintenance_staged_candidate',?)",(original.replace('a'*64,'b'*64),));db.commit();before=db.execute('SELECT key,value FROM system_state ORDER BY key').fetchall();db.close()
                def maybe_fail(source,target):
                    if failure=='activation' and str(source).endswith('active.next'):raise OSError('activation failed')
                    return replace(source,target)
                with patch.object(module.os,'replace',side_effect=maybe_fail):
                    if failure:
                        with self.assertRaises((RuntimeError,OSError,KeyboardInterrupt)):i.install(update=True,maintenance=True)
                    else:i.install(update=True,maintenance=True)
                db=sqlite3.connect(dbpath);self.assertEqual(db.execute('SELECT state,payload FROM telegram_updates').fetchone(),('queued','{}'));self.assertEqual(db.execute('SELECT key,value FROM system_state ORDER BY key').fetchall(),before);db.close()
                if failure:self.assertTrue(i.running);self.assertEqual((i.runtime/'app/old.txt').read_text(),'old');self.assertFalse((i.release/'active').exists())
                else:self.assertTrue((i.release/'active').exists());self.assertLess(i.events.index('maintenance'),i.events.index('ready'))
    def test_maintenance_preflight_blocks_inflight_and_near_schedule_without_mutation(self):
        if self.__class__.__name__=='CollectorInstallerTests':self.skipTest('news publisher only')
        with tempfile.TemporaryDirectory() as tmp:
            i=self.setup_installer(Path(tmp));path=self.maintenance_db(i);deadline=int(time.time()*1000)+600000
            db=sqlite3.connect(path);db.execute("INSERT INTO model_jobs(id,article_id,documents,input_hash,state,created_at) VALUES('j','a','[]','h','leased',1)");db.commit();db.close()
            with self.assertRaisesRegex(RuntimeError,'maintenance_in_flight'):module.maintenance_preflight(path,deadline)
            db=sqlite3.connect(path);self.assertEqual(db.execute('SELECT state FROM model_jobs').fetchone()[0],'leased');db.execute('DELETE FROM model_jobs');db.execute("INSERT INTO x_posts(id,draft_id,revision,day,state,content,media_key,created_at) VALUES('p','d',1,'today','posting','x','m',1)");db.commit();db.close()
            with self.assertRaisesRegex(RuntimeError,'maintenance_in_flight'):module.maintenance_preflight(path,deadline)
            db=sqlite3.connect(path);db.execute("UPDATE x_posts SET state='queued'");db.execute("INSERT INTO x_schedules VALUES('p',?,'[]')",(deadline+1000,));db.commit();db.close()
            with self.assertRaisesRegex(RuntimeError,'maintenance_scheduled_nearby'):module.maintenance_preflight(path,deadline)
            db=sqlite3.connect(path);self.assertEqual(db.execute('SELECT state FROM x_posts').fetchone()[0],'queued');db.close()
    def test_second_preflight_failure_restarts_old_service_without_buffer_rewrite(self):
        if self.__class__.__name__=='CollectorInstallerTests':self.skipTest('news publisher only')
        with tempfile.TemporaryDirectory() as tmp:
            i=self.setup_installer(Path(tmp));path=self.maintenance_db(i)
            with patch.object(module,'maintenance_preflight',side_effect=[None,RuntimeError('maintenance_in_flight')]):
                with self.assertRaisesRegex(RuntimeError,'maintenance_in_flight'):i.install(update=True,maintenance=True)
            self.assertTrue(i.running);self.assertEqual((i.runtime/'app/old.txt').read_text(),'old')
            db=sqlite3.connect(path);self.assertEqual(db.execute('SELECT state,payload FROM telegram_updates').fetchone(),('queued','{}'));db.close()
    def test_deadline_after_approval_before_activation_rolls_back(self):
        if self.__class__.__name__=='CollectorInstallerTests':self.skipTest('news publisher only')
        with tempfile.TemporaryDirectory() as tmp:
            i=self.setup_installer(Path(tmp));self.maintenance_db(i)
            with patch.object(module.time,'time',side_effect=[1000.0,1601.0]):
                with self.assertRaisesRegex(RuntimeError,'maintenance_approval_timeout'):i.install(update=True,maintenance=True)
            self.assertTrue(i.running);self.assertFalse((i.release/'active').exists());self.assertEqual((i.runtime/'app/old.txt').read_text(),'old')
    def test_installer_keeps_old_service_running_on_maintenance_preflight_failure(self):
        if self.__class__.__name__=='CollectorInstallerTests':self.skipTest('news publisher only')
        for problem in ('inflight','scheduled'):
            with self.subTest(problem=problem),tempfile.TemporaryDirectory() as tmp:
                i=self.setup_installer(Path(tmp));path=self.maintenance_db(i);db=sqlite3.connect(path)
                if problem=='inflight':db.execute("INSERT INTO model_jobs(id,article_id,documents,input_hash,state,created_at) VALUES('j','a','[]','h','leased',1)")
                else:
                    db.execute("INSERT INTO x_posts(id,draft_id,revision,day,state,content,media_key,created_at) VALUES('p','d',1,'today','queued','x','m',1)")
                    db.execute("INSERT INTO x_schedules VALUES('p',?,'[]')",(int(time.time()*1000)+300000,))
                db.commit();db.close()
                with self.assertRaises(RuntimeError):i.install(update=True,maintenance=True)
                self.assertTrue(i.running);self.assertNotIn('stop',i.events);self.assertEqual((i.runtime/'app/old.txt').read_text(),'old')
    def test_real_maintenance_wait_rejects_wrong_approval_and_accepts_active_owner_result(self):
        if self.__class__.__name__=='CollectorInstallerTests':self.skipTest('news publisher only')
        import json
        with tempfile.TemporaryDirectory() as tmp:
            i=self.setup_installer(Path(tmp));(i.runtime/'service.lock').write_text('123')
            ready={'release':i.release_id,'pid':123,'maintenance':'waiting','news_filter':{'requested':'active','mode':'shadow'}}
            (i.runtime/'service-ready.json').write_text(json.dumps(ready))
            with patch.object(i,'process_alive',return_value=True),patch.object(module.time,'time',side_effect=[1.0,1.002]),patch.object(module.time,'sleep'):
                with self.assertRaisesRegex(RuntimeError,'maintenance_approval_timeout'):module.Installer.wait_maintenance(i,1001)
            ready.update(maintenance='approved',news_filter={'requested':'active','mode':'active'});(i.runtime/'service-ready.json').write_text(json.dumps(ready))
            with patch.object(i,'process_alive',return_value=True),patch.object(module.time,'time',return_value=1.0):module.Installer.wait_maintenance(i,2000)
    def test_maintenance_wait_allows_process_lock_to_appear_after_bootstrap(self):
        if self.__class__.__name__=='CollectorInstallerTests':self.skipTest('news publisher only')
        import json
        with tempfile.TemporaryDirectory() as tmp:
            i=self.setup_installer(Path(tmp));(i.runtime/'service.lock').write_text('123')
            (i.runtime/'service-ready.json').write_text(json.dumps({'release':i.release_id,'pid':123,'maintenance':'approved','news_filter':{'requested':'active','mode':'active'}}))
            with patch.object(i,'process_alive',side_effect=[False,True]),patch.object(module.time,'time',return_value=1.0),patch.object(module.time,'sleep'):
                module.Installer.wait_maintenance(i,2000)
    def test_prepare_failures_leave_old_files_and_service_running(self):
        for failure in getattr(self,'prepare_failures',('npm','build','ocr')):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as tmp:
                i=self.setup_installer(Path(tmp),failure)
                with self.assertRaises(RuntimeError):i.install(update=True)
                self.assertNotIn('stop',i.events);self.assertTrue(i.running)
                self.assertEqual((i.runtime/'app/old.txt').read_text(),'old');self.assertFalse((i.runtime/'app/src').exists())
                self.assertEqual(i.plist.read_text(),'old plist');self.assertFalse((i.runtime/'.install.lock').exists())
    def test_startup_failures_restore_old_application_ocr_and_plist(self):
        for failure in ('start','health'):
            with self.subTest(failure=failure),tempfile.TemporaryDirectory() as tmp:
                i=self.setup_installer(Path(tmp),failure)
                with self.assertRaises(RuntimeError):i.install(update=True)
                self.assertTrue(i.running);self.assertEqual(i.boots,2)
                self.assertFalse((i.runtime/'app').is_symlink())
                self.assertEqual((i.runtime/'app/old.txt').read_text(),'old')
                self.assertEqual((i.runtime/'bin/pdf-ocr').read_text(),'old OCR');self.assertEqual(i.plist.read_text(),'old plist')
    def test_shadow_when_active_requested_rolls_back_before_activation(self):
        if self.__class__.__name__ == 'CollectorInstallerTests':self.skipTest('news publisher only')
        with tempfile.TemporaryDirectory() as tmp:
            i=self.setup_installer(Path(tmp),'selection')
            with self.assertRaisesRegex(RuntimeError,'sector_news_filter_not_active'):i.install(update=True)
            self.assertTrue(i.running);self.assertEqual(i.boots,2);self.assertFalse((i.release/'active').exists())
            self.assertEqual((i.runtime/'app/old.txt').read_text(),'old');self.assertEqual(i.plist.read_text(),'old plist')
    def test_success_switches_to_clean_tree_and_retains_rollback_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            i=self.setup_installer(Path(tmp));i.install(update=True)
            self.assertTrue((i.release/'active').is_file());self.assertTrue((i.runtime/'app').is_symlink());self.assertFalse((i.runtime/'app/removed.ts').exists())
            self.assertTrue((i.runtime/'app/src').is_dir());self.assertEqual((i.backup/'0/removed.ts').read_text(),'must not survive update')
            self.assertLess(i.events.index('npm run build'),i.events.index('stop'))
    def test_tweetkit_release_is_staged_and_swapped_only_for_news(self):
        if self.__class__.__name__ == 'CollectorInstallerTests':self.skipTest('news publisher only')
        with tempfile.TemporaryDirectory() as tmp:
            i=self.setup_installer(Path(tmp));old=i.runtime/'tweetkit-venv';old.mkdir();(old/'marker').write_text('previous')
            i.install(update=True)
            self.assertTrue((i.release/'app/vendor/tweetkit/tweetkit_x/client.py').is_file())
            self.assertTrue((i.release/'app/requirements-tweetkit.txt').is_file())
            self.assertTrue((i.runtime/'tweetkit-venv').is_symlink())
            self.assertTrue(any(event.endswith('-m pip') and 'tweetkit-venv' in event for event in i.events))
            receipt=__import__('json').loads((i.backup/'rollback.json').read_text())
            self.assertTrue(any(x['live'].endswith('/tweetkit-venv') and x['existed'] for x in receipt['paths']))

    def test_news_plist_enables_established_long_posts(self):
        import plistlib
        if self.__class__.__name__ == 'CollectorInstallerTests':self.skipTest('news publisher only')
        with tempfile.TemporaryDirectory() as tmp:
            i=self.setup_installer(Path(tmp));i.install(update=True)
            env=plistlib.loads(i.plist.read_bytes())['EnvironmentVariables']
            self.assertEqual(env.get('X_LONG_NOTE_ENABLED'),'true')

    def test_normal_install_refuses_existing_service_before_preparing(self):
        with tempfile.TemporaryDirectory() as tmp:
            i=self.setup_installer(Path(tmp))
            with self.assertRaisesRegex(RuntimeError,'requires_update'):i.install()
            self.assertEqual(i.events,[]);self.assertTrue(i.running)
    def test_failed_stop_never_swaps_running_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            i=self.setup_installer(Path(tmp))
            with patch.object(i,'stop',side_effect=RuntimeError('still running')):
                with self.assertRaises(RuntimeError):i.install(update=True)
            self.assertEqual((i.runtime/'app/old.txt').read_text(),'old');self.assertFalse((i.runtime/'app').is_symlink())

class MaintenanceCandidatePriorityTests(unittest.TestCase):
    def test_explicit_near_schedule_option_preserves_plan_and_still_blocks_inflight(self):
        with tempfile.TemporaryDirectory() as tmp:
            i=StagedInstallerTests().setup_installer(Path(tmp));path=StagedInstallerTests().maintenance_db(i);deadline=int(time.time()*1000)+600000
            db=sqlite3.connect(path);db.execute("INSERT INTO x_posts(id,draft_id,revision,day,state,content,media_key,created_at) VALUES('p','d',1,'today','queued','x','m',1)");db.execute("INSERT INTO x_schedules VALUES('p',?,'[]')",(deadline-1000,));db.commit()
            before=db.execute('SELECT * FROM x_schedules').fetchall()
            with self.assertRaisesRegex(RuntimeError,'maintenance_scheduled_nearby'):module.maintenance_preflight(path,deadline)
            module.maintenance_preflight(path,deadline,True);self.assertEqual(db.execute('SELECT * FROM x_schedules').fetchall(),before);self.assertEqual(db.execute('SELECT state FROM x_posts').fetchone()[0],'queued')
            db.execute("UPDATE x_posts SET state='posting'");db.commit()
            with self.assertRaisesRegex(RuntimeError,'maintenance_in_flight'):module.maintenance_preflight(path,deadline,True)
            self.assertEqual(db.execute('SELECT state FROM x_posts').fetchone()[0],'posting');db.close()
            with self.assertRaisesRegex(RuntimeError,'near_schedule_override_requires_maintenance'):i.install(update=True,allow_near_scheduled=True)
    def test_preflight_checks_new_pointer_and_never_falls_back_to_old_approval(self):
        import json
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'fixture.sqlite';db=sqlite3.connect(path);root=Path(__file__).parents[1]
            db.executescript((root/'migrations/0001_sector.sql').read_text()+'\n'+(root/'migrations/0008_kap_previews.sql').read_text())
            deadline=int(time.time()*1000)+600000
            valid=json.dumps({'state':'pending','hash':'a'*64,'expires_at':deadline+1000})
            expired=json.dumps({'state':'pending','hash':'b'*64,'expires_at':deadline-1})
            db.executemany('INSERT INTO system_state VALUES(?,?)',[('news_maintenance_candidate',valid),('news_maintenance_staged_candidate',expired)]);db.commit()
            with self.assertRaisesRegex(RuntimeError,'maintenance_candidate_missing'):module.maintenance_preflight(path,deadline)
            db.execute("UPDATE system_state SET value=? WHERE key='news_maintenance_candidate'",(expired,));db.execute("UPDATE system_state SET value=? WHERE key='news_maintenance_staged_candidate'",(valid,));db.commit()
            before=db.execute('SELECT key,value FROM system_state ORDER BY key').fetchall();module.maintenance_preflight(path,deadline)
            self.assertEqual(db.execute('SELECT key,value FROM system_state ORDER BY key').fetchall(),before);db.close()

class CollectorInstallerTests(StagedInstallerTests):
    prepare_failures=('npm','build')
    def setup_installer(self,root,failure=None):
        installer=super().setup_installer(root,failure)
        installer.collector=True;installer.label='com.sectorhaber.kap';installer.service=installer.domain+'/'+installer.label
        pdf=root/'pdf-venv/bin/python';pdf.parent.mkdir(parents=True,exist_ok=True);pdf.touch()
        return installer
    def test_collector_uses_its_own_label_entrypoint_and_preserves_news_ocr(self):
        import plistlib
        with tempfile.TemporaryDirectory() as tmp:
            i=self.setup_installer(Path(tmp));i.install(update=True)
            plist=plistlib.loads(i.plist.read_bytes())
            self.assertEqual(plist['Label'],'com.sectorhaber.kap')
            self.assertNotIn('X_LONG_NOTE_ENABLED',plist['EnvironmentVariables'])
            self.assertTrue(plist['ProgramArguments'][-1].endswith('/app/scripts/kap_service.ts'))
            self.assertEqual((i.runtime/'bin/pdf-ocr').read_text(),'old OCR')
            self.assertFalse(any(event.startswith('/usr/bin/xcrun') for event in i.events))
