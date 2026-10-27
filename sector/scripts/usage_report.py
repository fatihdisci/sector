"""Local, privacy-preserving daily summary of recorded model usage."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo

FIELDS = ('input_tokens', 'output_tokens', 'cached_tokens', 'reasoning_tokens')


def summarize(lines, day):
    groups = {}
    for line in lines:
        try:
            row = json.loads(line)
            if not isinstance(row, dict) or not isinstance(row.get('timestamp'), str):
                continue
            timestamp = dt.datetime.fromisoformat(row['timestamp'].replace('Z', '+00:00'))
            if timestamp.tzinfo is None or timestamp.astimezone(ZoneInfo('Europe/Istanbul')).date() != day:
                continue
            stage, model, success = row.get('stage'), row.get('model'), row.get('success')
            if stage not in ('generate', 'audit', 'repair', 'vision', 'vision_audit', 'vision_repair', None) or model not in ('gpt-6-luna', None) or not isinstance(success, bool):
                continue
            key = (stage or 'unknown', model or 'unknown')
            group = groups.setdefault(key, {'calls': 0, 'success': 0, 'error': 0, 'missing_usage': 0, **{f: None for f in FIELDS}})
            group['calls'] += 1
            group['success' if success else 'error'] += 1
            values = [row.get(f) for f in FIELDS]
            values = [v if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else None for v in values]
            if any(v is None for v in values):
                group['missing_usage'] += 1
            for field, value in zip(FIELDS, values):
                if value is not None:
                    group[field] = (group[field] or 0) + value
        except (ValueError, TypeError, OverflowError, json.JSONDecodeError):
            continue
    return groups


def main():
    parser = argparse.ArgumentParser(description='TRT günlük model kullanım özeti')
    parser.add_argument('--date', type=dt.date.fromisoformat, default=dt.datetime.now(ZoneInfo('Europe/Istanbul')).date())
    parser.add_argument('--file', type=Path)
    args = parser.parse_args()
    root = (Path.home() / 'Library/Application Support/sector-haber').resolve()
    directory = Path(os.environ.get('SECTOR_USAGE_DIR', 'usage'))
    directory = (directory if directory.is_absolute() else root / directory).resolve()
    if args.file is None and not directory.is_relative_to(root):
        parser.error('SECTOR_USAGE_DIR uygulama veri dizini içinde olmalı')
    path = args.file or directory / 'model-calls.jsonl'
    try:
        with path.open(encoding='utf-8', errors='replace') as source:
            groups = summarize(source, args.date)
    except FileNotFoundError:
        groups = {}
    print(f'{args.date} (Europe/Istanbul)')
    if not groups:
        print('Kayıt yok.')
    for (stage, model), row in sorted(groups.items()):
        totals = ' '.join(f'{field}={row[field] if row[field] is not None else "bilinmiyor"}' for field in FIELDS)
        print(f'{stage} / {model}: çağrı={row["calls"]} başarılı={row["success"]} hata={row["error"]} eksik_usage={row["missing_usage"]} {totals}')

if __name__ == '__main__':
    main()
