"""Stage and verify a release before stopping only the ENDEKS news service.

Importing this module has no side effects. Tests use temporary roots and fake
process commands. Secrets, databases and the main Hermes gateway are not managed
here. Previous application/OCR/plist paths remain in the rollback directory.
"""
import json,os,pathlib,plistlib,shutil,subprocess,time,sys,uuid,platform,re,sqlite3

def news_filter_ready(value):
    status=value.get('news_filter') if isinstance(value,dict) else None
    if not isinstance(status,dict) or status.get('requested') not in ('active','shadow') or status.get('mode') not in ('active','shadow'):return False
    return status['requested']!='active' or status['mode']=='active'

def maintenance_preflight(path,deadline_ms,allow_near_scheduled=False):
    db=sqlite3.connect(pathlib.Path(path).resolve().as_uri()+'?mode=ro',uri=True)
    try:
        try:
            row=db.execute("SELECT value FROM system_state WHERE key IN ('news_maintenance_staged_candidate','news_maintenance_candidate') ORDER BY CASE key WHEN 'news_maintenance_staged_candidate' THEN 0 ELSE 1 END LIMIT 1").fetchone();candidate=json.loads(row[0]) if row else None
            if not isinstance(candidate,dict) or candidate.get('state')!='pending' or not re.fullmatch(r'[a-f0-9]{64}',str(candidate.get('hash',''))) or not isinstance(candidate.get('expires_at'),int) or candidate['expires_at']<=deadline_ms:raise ValueError()
        except (ValueError,TypeError,json.JSONDecodeError):raise RuntimeError('maintenance_candidate_missing')
        checks=["SELECT 1 FROM model_jobs WHERE state='leased' LIMIT 1", "SELECT 1 FROM x_posts WHERE state IN ('uploading','posting') LIMIT 1", "SELECT 1 FROM drafts WHERE delivery_state='sending' LIMIT 1", "SELECT 1 FROM telegram_effects WHERE state='sending' LIMIT 1", "SELECT 1 FROM kap_previews WHERE state='sending' LIMIT 1", "SELECT 1 FROM news_digest_runs WHERE state='sending' LIMIT 1", "SELECT 1 FROM news_digest_pages WHERE state='sending' LIMIT 1"]
        if any(db.execute(q).fetchone() for q in checks):raise RuntimeError('maintenance_in_flight')
        if db.execute("SELECT 1 FROM x_posts p WHERE p.state='queued' AND NOT EXISTS(SELECT 1 FROM x_schedules s WHERE s.post_id=p.id) LIMIT 1").fetchone():raise RuntimeError('maintenance_unscheduled_pending')
        if not allow_near_scheduled and db.execute("SELECT 1 FROM x_posts p JOIN x_schedules s ON s.post_id=p.id WHERE p.state='queued' AND s.due_at<=? LIMIT 1",(deadline_ms+300000,)).fetchone():raise RuntimeError('maintenance_scheduled_nearby')
    finally:db.close()

class Installer:
    def __init__(self,source,runtime,plist,node,run=subprocess.run,*,collector=False):
        self.source=pathlib.Path(source);self.runtime=pathlib.Path(runtime);self.plist=pathlib.Path(plist);self.node=node;self.run=run
        self.collector=collector;self.label='com.sectorhaber.kap' if collector else 'com.sectorhaber.news'
        self.domain=f'gui/{os.getuid()}';self.service=self.domain+'/'+self.label
        self.release_id=uuid.uuid4().hex
        self.release=self.runtime/'releases'/self.release_id
        self.backup=self.runtime/'backups'/('update-'+self.release_id)
        self.swapped=[]
    def command(self,args,**kwargs):
        return self.run([str(a) for a in args],check=True,capture_output=True,text=True,timeout=660,**kwargs)
    def loaded(self):
        return self.run(['launchctl','print',self.service],capture_output=True,text=True).returncode==0
    def process_alive(self):
        try:pid=int((self.runtime/'service.lock').read_text());os.kill(pid,0);return True
        except (FileNotFoundError,ValueError,ProcessLookupError):return False
    def stop(self):
        # Older collectors had no process lock. Capture their launchd PID too.
        snapshot=self.run(['launchctl','print',self.service],capture_output=True,text=True)
        match=re.search(r'^\s*pid = (\d+)\s*$',snapshot.stdout or '',re.MULTILINE)
        previous_pid=int(match[1]) if match else None
        def previous_alive():
            if previous_pid is None:return False
            try:os.kill(previous_pid,0);return True
            except ProcessLookupError:return False
        if self.loaded():self.command(['launchctl','bootout',self.service])
        deadline=time.monotonic()+650
        while self.loaded() or self.process_alive() or previous_alive():
            if time.monotonic()>deadline:raise RuntimeError('sector_service_did_not_stop')
            time.sleep(.5)
    def wait_ready(self,release=None):
        # Sustained process readiness, not a remote API or a real Telegram test.
        deadline=time.monotonic()+45;stable=None
        while time.monotonic()<deadline:
            ready=self.loaded() and self.process_alive()
            if ready and release:
                try:
                    value=json.loads((self.runtime/'service-ready.json').read_text())
                    ready=value.get('release')==release and value.get('pid')==int((self.runtime/'service.lock').read_text())
                    if ready and not self.collector and not news_filter_ready(value):raise RuntimeError('sector_news_filter_not_active')
                except (FileNotFoundError,ValueError):ready=False
            stable=(stable or time.monotonic()) if ready else None
            if stable and time.monotonic()-stable>=5:return
            time.sleep(.5)
        raise RuntimeError('sector_startup_not_ready')
    def wait_maintenance(self,deadline_ms):
        startup_deadline=time.monotonic()+45;started=False
        while int(time.time()*1000)<deadline_ms:
            running=self.loaded() and self.process_alive()
            if not running:
                if started or time.monotonic()>=startup_deadline:raise RuntimeError('maintenance_service_stopped')
                time.sleep(.5);continue
            started=True
            try:
                value=json.loads((self.runtime/'service-ready.json').read_text())
                if value.get('release')==self.release_id and value.get('pid')==int((self.runtime/'service.lock').read_text()) and value.get('maintenance')=='approved' and news_filter_ready(value) and value['news_filter']['requested']=='active':return
            except (FileNotFoundError,ValueError,KeyError):pass
            time.sleep(.5)
        raise RuntimeError('maintenance_approval_timeout')
    def prepare(self):
        app=self.release/'app';app.mkdir(parents=True,mode=0o700)
        for name in ['src','scripts','assets','migrations','test']:
            shutil.copytree(self.source/name,app/name,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
        # UI regression tests need public assets; never copy panel credentials/config.
        shutil.copytree(self.source/'miniapp/public',app/'miniapp/public')
        for name in ['sources.json','package.json','package-lock.json','tsconfig.json','requirements-pdf.txt','requirements-telegram.txt','wrangler.toml','bot-workflow.json']:
            shutil.copy2(self.source/name,app/name)
        if not self.collector:
            shutil.copytree(self.source/'vendor/tweetkit',app/'vendor/tweetkit',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
            shutil.copy2(self.source/'requirements-tweetkit.txt',app/'requirements-tweetkit.txt')
            tweetkit=self.release/'tweetkit-venv/bin/python'
            self.command([sys.executable,'-m','venv',tweetkit.parent.parent])
            self.command([tweetkit,'-m','pip','install','-r',app/'requirements-tweetkit.txt'])
            self.command([tweetkit,'-c',"import sys; sys.path.insert(0,'vendor/tweetkit'); import tweetkit_x,requests,bs4,lxml,x_client_transaction"],cwd=app)
            self.command([tweetkit,'test/tweetkit-bridge-test.py'],cwd=app)
        # Install scripts are disabled, just as in CI. All checks precede bootout.
        self.command(['npm','ci','--ignore-scripts'],cwd=app)
        for check in ['check','test','build']:self.command(['npm','run',check],cwd=app)
        pdf=(self.runtime.parent if self.collector else self.runtime)/'pdf-venv/bin/python'
        if not pdf.exists():
            pdf=self.release/'pdf-venv/bin/python'
            self.command([sys.executable,'-m','venv',pdf.parent.parent])
            self.command([pdf,'-m','pip','install','-r',app/'requirements-pdf.txt'])
        self.command([pdf,'-c','import pdfplumber,pypdfium2'])
        self.command([pdf,'-m','unittest','discover','-s','test','-p','test_*.py'],cwd=app)
        if not self.collector:
            ocr=self.release/'pdf-ocr'
            self.command(['/usr/bin/xcrun','swiftc','-O',app/'scripts/pdf_ocr.swift','-o',ocr])
            ocr.chmod(0o700)
        # The release stays at this path; virtualenv and node paths never move.
        self.command(['npm','prune','--omit=dev','--ignore-scripts'],cwd=app)
        logs=self.runtime/'logs'
        payload={'Label':self.label,'ProgramArguments':[self.node,str(self.runtime/'app/node_modules/tsx/dist/cli.mjs'),str(self.runtime/('app/scripts/kap_service.ts' if self.collector else 'app/scripts/local_service.ts'))],
          'WorkingDirectory':str(self.runtime/'app'),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':30,'ExitTimeOut':600,
          'EnvironmentVariables':{'HOME':str(pathlib.Path.home()),'PATH':str(pathlib.Path(self.node).parent)+':/opt/homebrew/bin:/usr/bin:/bin','NODE_NO_WARNINGS':'1','SECTOR_RELEASE_ID':self.release_id},
          'StandardOutPath':str(logs/'service.log'),'StandardErrorPath':str(logs/'service.error.log')}
        # The owner's established long-post capability must survive news-service updates.
        if not self.collector:payload['EnvironmentVariables']['X_LONG_NOTE_ENABLED']='true'
        (self.release/'service.plist').write_bytes(plistlib.dumps(payload))
    def record(self,state):
        self.backup.mkdir(parents=True,exist_ok=True,mode=0o700)
        data={'state':state,'release':str(self.release),'paths':[{'live':str(p),'previous':str(old),'existed':had} for p,old,had in self.swapped]}
        temp=self.backup/'rollback.next';temp.write_text(json.dumps(data,indent=2));temp.chmod(0o600);os.replace(temp,self.backup/'rollback.json')
    def replace(self,path,target,symlink=True):
        path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True)
        previous=self.backup/str(len(self.swapped));had=path.exists() or path.is_symlink()
        self.swapped.append((path,previous,had));self.record('switching')
        if had:os.replace(path,previous)
        staged=path.with_name(path.name+'.next-'+self.release_id)
        if symlink:staged.symlink_to(target)
        else:shutil.copy2(target,staged)
        os.replace(staged,path)
    def restore(self):
        for path,previous,had in reversed(self.swapped):
            # If moving the old path failed it is still the live one; keep it.
            if had and not (previous.exists() or previous.is_symlink()):continue
            if path.is_symlink() or path.is_file():path.unlink()
            if had:os.replace(previous,path)
        self.record('rolled_back')
    def install(self,update=False,maintenance=False,allow_near_scheduled=False):
        self.runtime.mkdir(parents=True,exist_ok=True,mode=0o700)
        lock=self.runtime/'.install.lock'
        fd=os.open(lock,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        try:
            was_running=self.loaded()
            if allow_near_scheduled and not maintenance:raise RuntimeError('near_schedule_override_requires_maintenance')
            if maintenance and (self.collector or not update or not was_running):raise RuntimeError('maintenance_requires_running_news_update')
            if not update and (was_running or (self.runtime/'app').exists() or (self.runtime/'app').is_symlink()):raise RuntimeError('existing_installation_requires_update')
            if not was_running and self.process_alive():raise RuntimeError('unmanaged_sector_process_running')
            self.prepare()
            deadline_ms=int(time.time()*1000)+600000 if maintenance else None
            if maintenance:
                maintenance_preflight(self.runtime/'sector-haber.sqlite',deadline_ms,allow_near_scheduled)
                plist_path=self.release/'service.plist';payload=plistlib.loads(plist_path.read_bytes());payload['EnvironmentVariables'].update({'SECTOR_MAINTENANCE_MODE':'1','SECTOR_MAINTENANCE_DEADLINE':str(deadline_ms)});plist_path.write_bytes(plistlib.dumps(payload))
            # Detect a service started by somebody else while staging.
            if not update and (self.loaded() or self.process_alive()):raise RuntimeError('sector_started_during_staging')
            self.record('prepared')
            if was_running:self.stop()
            try:
                if maintenance:maintenance_preflight(self.runtime/'sector-haber.sqlite',deadline_ms,allow_near_scheduled)
                self.replace(self.runtime/'app',self.release/'app')
                if not self.collector:self.replace(self.runtime/'bin/pdf-ocr',self.release/'pdf-ocr')
                if (self.release/'pdf-venv').exists():self.replace(self.runtime/'pdf-venv',self.release/'pdf-venv')
                if not self.collector:self.replace(self.runtime/'tweetkit-venv',self.release/'tweetkit-venv')
                self.replace(self.plist,self.release/'service.plist',symlink=False)
                (self.runtime/'logs').mkdir(exist_ok=True)
                self.command(['launchctl','bootstrap',self.domain,self.plist])
                if maintenance:self.wait_maintenance(deadline_ms)
                self.wait_ready(self.release_id)
                if maintenance and int(time.time()*1000)>=deadline_ms:raise RuntimeError('maintenance_approval_timeout')
                self.record('active')
                # This is the last switch operation: no Telegram/model loop ran
                # while startup was being verified or could still roll back.
                activation=self.release/'active.next';activation.touch(mode=0o600)
                os.replace(activation,self.release/'active')
            except BaseException:
                # Never swap files underneath a process that has not stopped.
                self.stop();self.restore()
                if was_running:
                    self.command(['launchctl','bootstrap',self.domain,self.plist]);self.wait_ready()
                raise
        finally:
            os.close(fd);lock.unlink()

def main():
    if platform.system()!='Darwin':raise RuntimeError('local_installer_requires_macos')
    node=shutil.which('node')
    if not node:raise RuntimeError('node_required')
    home=pathlib.Path.home()
    if any(arg not in ('--update','--maintenance','--maintenance-allow-near-scheduled') for arg in sys.argv[1:]):raise RuntimeError('invalid_installer_option')
    Installer(pathlib.Path(__file__).resolve().parents[1],home/'Library/Application Support/sector-haber',home/'Library/LaunchAgents/com.sectorhaber.news.plist',node,run=subprocess.run).install('--update' in sys.argv,'--maintenance' in sys.argv,'--maintenance-allow-near-scheduled' in sys.argv)
    print('ENDEKS HABER release verified and activated. Rollback files retained; main Hermes gateway unchanged.')

if __name__=='__main__':main()
