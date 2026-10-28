"""Extract numeric usage only; never persist provider text or credentials."""
import time


def usage_metrics(response, *, job_id, stage, model, started_at, outcome):
    usage = response.get('usage') if isinstance(response, dict) else None
    usage = usage if isinstance(usage, dict) else {}
    def number(value):
        return value if isinstance(value, int) and not isinstance(value, bool) and value >= 0 else None
    input_details = usage.get('input_tokens_details')
    output_details = usage.get('output_tokens_details')
    return {
        'job_id': job_id, 'stage': stage, 'model': model, 'outcome': outcome,
        'duration_ms': max(0, int((time.monotonic() - started_at) * 1000)),
        'input_tokens': number(usage.get('input_tokens')),
        'output_tokens': number(usage.get('output_tokens')),
        'cached_tokens': number(input_details.get('cached_tokens')) if isinstance(input_details, dict) else None,
        'reasoning_tokens': number(output_details.get('reasoning_tokens')) if isinstance(output_details, dict) else None,
    }


def _field(obj, name):
    if isinstance(obj, dict):
        return obj.get(name)
    return getattr(obj, name, None)


def provider_usage(response):
    """Copy only known numeric fields from the provider's response object."""
    raw = _field(response, 'usage')
    def first(*values):
        return next((v for v in values if v is not None), None)
    inp = first(_field(raw, 'input_tokens'), _field(raw, 'prompt_tokens'))
    out = first(_field(raw, 'output_tokens'), _field(raw, 'completion_tokens'))
    inp_details = first(_field(raw, 'input_tokens_details'), _field(raw, 'prompt_tokens_details'))
    out_details = first(_field(raw, 'output_tokens_details'), _field(raw, 'completion_tokens_details'))
    return {'usage': {'input_tokens': inp, 'output_tokens': out,
        'input_tokens_details': {'cached_tokens': _field(inp_details, 'cached_tokens')},
        'output_tokens_details': {'reasoning_tokens': _field(out_details, 'reasoning_tokens')}}}


def record_call(response, *, job_id, stage, model, started_at, success):
    """Best-effort append; the file contains no provider or prompt text."""
    import datetime, json, os, pathlib, re, stat
    try:
        root = (pathlib.Path.home() / 'Library/Application Support/sector-haber').resolve()
        configured = os.environ.get('SECTOR_USAGE_DIR', 'usage')
        target = pathlib.Path(configured)
        directory = (target if target.is_absolute() else root / target).resolve()
        if not directory.is_relative_to(root):
            return
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        safe_id = job_id if isinstance(job_id, str) and (re.fullmatch(r'[a-f0-9]{64}', job_id) or re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', job_id) or job_id == 'image-evidence') else None
        safe_stage = stage if stage in ('generate', 'audit', 'repair', 'vision', 'vision_audit', 'vision_repair') else None
        safe_model = model if model in ('gpt-6-luna', 'gpt-6.1-terra') else None
        row = usage_metrics(provider_usage(response), job_id=safe_id, stage=safe_stage,
                            model=safe_model, started_at=started_at, outcome='ok' if success else 'error')
        row['success'] = bool(success)
        row['timestamp'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        data = (json.dumps(row, separators=(',', ':')) + '\n').encode()
        flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, 'O_NOFOLLOW', 0)
        fd = os.open(directory / 'model-calls.jsonl', flags, 0o600)
        try:
            if stat.S_ISREG(os.fstat(fd).st_mode):
                os.write(fd, data)
        finally:
            os.close(fd)
    except Exception:
        pass


def instrument_agent(agent, job):
    """Wrap the actual Hermes transport methods, including failed attempts."""
    import functools
    # Codex streaming delegates to this method, so wrapping both double-counts.
    for name in ('_interruptible_api_call',):
        original = getattr(agent, name, None)
        if not callable(original):
            continue
        @functools.wraps(original)
        def wrapped(*args, _original=original, **kwargs):
            started = time.monotonic()
            response = None
            success = False
            try:
                response = _original(*args, **kwargs)
                success = True
                return response
            finally:
                record_call(response, job_id=job.get('id'), stage=job.get('metric_stage'),
                            model=job.get('model'), started_at=started, success=success)
        setattr(agent, name, wrapped)
