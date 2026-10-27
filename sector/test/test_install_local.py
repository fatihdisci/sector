import importlib.util,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('installer',Path(__file__).parents[1]/'scripts/install_local.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class InstallerRegression(unittest.TestCase):
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
    def wait_ready(self,release=None):
        self.events.append('ready')
        if release:assert not (self.release/'active').exists()
        if release and self.failure=='health':raise RuntimeError('not ready')
    def command(self,args,**kwargs):
        args=list(map(str,args));self.events.append(' '.join(args[:3]))
        if args[:2]==['npm','ci'] and self.failure=='npm':raise RuntimeError('npm failed')
        if args[:3]==['npm','run','build']:
            assert (Path(kwargs['cwd'])/'wrangler.toml').is_file(), 'staged build requires its configuration'
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
