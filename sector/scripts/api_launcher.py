"""Credential-isolating launcher. Import/default invocation performs no lookup/network.
The real Keychain loader is reachable only after explicit approvals and preflight.
"""
import hashlib,json,os,pathlib,stat,subprocess,time,tempfile
from api_candidate import ApiConfig,validate_config
from visual_api import config_ok,CONTRACT
from shared_api_budget import require_shared,SharedBudget
SERVICE='sectorhaber-openai-api'
ACCOUNT='sectorhaber-news'
IMAGE_MODELS={'gpt-image-2.5-sunburst','gpt-image-2.5-sunburst-2026-09-08','gpt-image-2.5-flare','gpt-image-2.5-flare-2026-09-08'}

def keychain_credential_loader():
 # Key is captured in memory, not an argument/config/log; never called on import.
 try:
  r=subprocess.run(['/usr/bin/security','find-generic-password','-s',SERVICE,'-a',ACCOUNT,'-w'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15,check=True)
  key=r.stdout.decode().rstrip('\r\n')
  if not key or len(key)>8192 or any(c in key for c in '\r\n\0'):raise ValueError()
  return key
 except Exception:raise RuntimeError('launcher_credential_unavailable')from None

def local_media_preflight(bundle):
 root=pathlib.Path(bundle['trial_root']);media=pathlib.Path(bundle['media_path']);source=pathlib.Path(bundle['source_path']);ledger=pathlib.Path(bundle['budget_path'])
 live=pathlib.Path.home()/'Library/Application Support/sector-haber'
 if not root.is_absolute()or root.is_symlink()or root.resolve()!=root or root==live or root.is_relative_to(live)or not root.is_relative_to(pathlib.Path(tempfile.gettempdir()).resolve())or not root.is_dir()or root.stat().st_uid!=os.getuid()or stat.S_IMODE(root.stat().st_mode)&0o077:raise RuntimeError('launcher_isolation_required')
 for p in(media,source,ledger):
  if not p.is_absolute()or p.resolve()!=p or not p.is_relative_to(root)or p.is_symlink():raise RuntimeError('launcher_media_not_shared_local')
 if not media.is_dir()or not source.is_file()or not 0<source.stat().st_size<=8_000_000:raise RuntimeError('launcher_media_source_invalid')
 if source.read_bytes()[:8]!=b'\x89PNG\r\n\x1a\n':raise RuntimeError('launcher_media_source_invalid')
 return root,media,source

def preflight(bundle,*,promo_verifier=None,now=None):
 now=time.time()if now is None else now;a=bundle.get('approval',{})
 if a.get('approved')is not True or a.get('action')!='isolated-owner-visual-trial'or a.get('keychain_read_approved')is not True or a.get('service')!=SERVICE or a.get('account')!=ACCOUNT or not now<a.get('expires_at',0):raise RuntimeError('launcher_action_approval_required')
 text=ApiConfig(**bundle['text_config']);visual=bundle['visual_config'];validate_config(text,now);config_ok(visual)
 s=require_shared(text,bundle['budget_path'],'text');other=require_shared(visual,bundle['budget_path'],'visual')
 if s!=other:raise RuntimeError('launcher_shared_budget_mismatch')
 if text.model!='gpt-6.1-terra'or text.reasoning_effort!='medium'or visual['vision']['model']!='gpt-6.1-terra'or visual['vision']['reasoning_effort']!='medium'or visual['image']['model']not in IMAGE_MODELS or visual.get('quality')!='medium':raise RuntimeError('launcher_model_not_approved')
 if visual['rows_per_image']<8 or '1536x864'not in visual['allowed_sizes']:raise RuntimeError('launcher_single_page_media_required')
 local_media_preflight(bundle)
 for key in ('python_path','node_path'):
  executable=bundle.get(key)
  if not isinstance(executable,str)or not pathlib.Path(executable).is_absolute()or not pathlib.Path(executable).is_file()or not os.access(executable,os.X_OK):raise RuntimeError('launcher_interpreter_required')
 root=pathlib.Path(__file__).resolve().parents[1]
 for ref in CONTRACT['references']:
  if hashlib.sha256((root/'assets/visual-templates/bc-v1'/ref['file']).read_bytes()).hexdigest()!=ref['sha256']:raise RuntimeError('launcher_reference_changed')
 if promo_verifier is None:raise RuntimeError('launcher_external_promo_verification_required')
 # Trusted verification must return this exact fresh evidence, not a truthy flag.
 try:verified=promo_verifier(s['promo'])
 except Exception:raise RuntimeError('launcher_external_promo_verification_failed')from None
 if verified!=s['promo']:raise RuntimeError('launcher_external_promo_verification_failed')
 if not s.get('plan_id'):raise RuntimeError('launcher_plan_id_required')
 return s

def run_child(bundle,environment):
 root=pathlib.Path(__file__).resolve().parents[1]
 node=bundle.get('node_path')
 if not isinstance(node,str)or not pathlib.Path(node).is_absolute():raise RuntimeError('launcher_node_path_required')
 # No user-supplied executable/script/argument list and no key in argv/stdin file.
 r=subprocess.run([node,'--import','tsx',str(root/'scripts/isolated_api_trial.ts'),'--approved-real'],input=json.dumps(bundle).encode(),cwd=root,env=environment,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=600,check=False)
 if r.returncode:raise RuntimeError('launcher_trial_failed_no_retry')
 return {'state':'completed','network_authorized':True}

def launch(bundle,*,credential_loader=None,promo_verifier=None,child=None):
 if bundle.get('enabled')is not True:return {'state':'dry_run','network':False,'credential_lookup':False}
 s=preflight(bundle,promo_verifier=promo_verifier)
 ledger=SharedBudget(bundle['budget_path'],s)
 try:ledger.reserve_plan(s['plan_id'],['text']*4+['vision']*4+['image'])
 finally:ledger.db.close()
 # Verification/reservation can take time; recheck expiry/rates at lookup time.
 validate_config(ApiConfig(**bundle['text_config']),time.time());config_ok(bundle['visual_config']);require_shared(ApiConfig(**bundle['text_config']),bundle['budget_path'],'text')
 if time.time()>=bundle['approval']['expires_at']:raise RuntimeError('launcher_action_approval_required')
 loader=credential_loader or keychain_credential_loader
 try:key=loader()
 except Exception:raise RuntimeError('launcher_credential_unavailable')from None
 if not isinstance(key,str)or not key.strip()or any(c in key for c in '\r\n\0'):raise RuntimeError('launcher_credential_invalid')
 env={'PATH':str(pathlib.Path(bundle['node_path']).resolve().parent)+os.pathsep+os.defpath,'TMPDIR':str(pathlib.Path(tempfile.gettempdir()).resolve()),'HOME':str(pathlib.Path.home()),'SECTOR_OPENAI_API_KEY':key,'SECTOR_API_ISOLATED_REAL_APPROVED':'true'}
 try:
  result=(child or run_child)(bundle,env)
  if not isinstance(result,dict)or result.get('state')!='completed':raise RuntimeError('launcher_child_failed_no_retry')
  return {'state':'completed','network_authorized':True}
 except Exception:raise RuntimeError('launcher_child_failed_no_retry')from None
 finally:env.pop('SECTOR_OPENAI_API_KEY',None);key=None

if __name__=='__main__':
 # Approval alone does not manufacture an external promo verifier. Real launches
 # use the callable above with a separately approved verification integration.
 import sys
 try:
  raw=sys.stdin.read(2_000_001);value=json.loads(raw or '{}')
  if len(raw)>2_000_000:raise RuntimeError('launcher_input_limit')
  print(json.dumps(launch(value)))
 except Exception:
  print('{"error":"launcher_preflight_or_execution_failed"}',file=sys.stderr);sys.exit(1)
