"""Explicit API subprocess entrypoint. Nothing is read or sent on import."""
import contextlib,io,json,os,pathlib,sys,time
from api_candidate import ApiConfig,OfflineApiCandidate,JsonlTelemetry,validate_config
from responses_http import ResponsesHTTP

def main(envelope, *, environ=None, transport_factory=ResponsesHTTP, offline_test=False):
    environ=os.environ if environ is None else environ
    if environ.get('SECTOR_OPENAI_API_ENABLED')!='true':raise RuntimeError('api_disabled')
    config=ApiConfig(**envelope['config']);validate_config(config,time.time())
    if not offline_test:
        from shared_api_budget import require_shared
        require_shared(config,envelope['budget_path'],'text')
    # Read this one explicit injected variable only after configuration validation.
    key=environ.get('SECTOR_OPENAI_API_KEY')
    if not isinstance(key,str)or not key.strip()or any(c in key for c in '\r\n'):raise RuntimeError('api_key_missing_or_invalid')
    job=envelope['job']
    paths=[envelope.get('budget_path'),envelope.get('telemetry_path')]
    if any(not isinstance(p,str)or not pathlib.Path(p).is_absolute()for p in paths)or paths[0]==paths[1]:raise RuntimeError('api_explicit_paths_required')
    transport=transport_factory(key,deadline=min(job['deadline'],config.expires_at,config.rate_table_expires_at))
    return OfflineApiCandidate(config,paths[0],transport,JsonlTelemetry(paths[1],config.approved_models)).run_job(job)

if __name__=='__main__':
    try:
        raw=sys.stdin.read(4_000_001)
        if len(raw)>4_000_000:raise RuntimeError('api_job_input_limit')
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):result=main(json.loads(raw))
        print(json.dumps(result,ensure_ascii=False))
    except Exception:
        # Deliberately omit arbitrary exception/provider/prompt/credential content.
        print(json.dumps({'error':'api_job_failed_no_retry'}),file=sys.stderr)
        sys.exit(1)
