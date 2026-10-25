"""Append explicit owner fresh-context reviews. Never writes preferences/readiness/history.
Input is a locally prepared approval package; --apply is required for writes.
"""
import argparse,hashlib,json,pathlib,sqlite3,time

def record(db_path,package,apply=False):
    if package.get('context')!='fresh_publication_owner_review' or not package.get('approval_source'):raise ValueError('explicit_context_and_approval_source_required')
    rows=package['rows']
    if len({r['candidate_id'] for r in rows})!=len(rows) or any(r['label'] not in ('instant','digest','archive') for r in rows):raise ValueError('invalid_labels')
    for key in ['rule_version','catalog_version','code_hash','catalog_hash','scope_hash','sample_hash']:
        if not package.get(key):raise ValueError('missing_version_binding')
    c=sqlite3.connect('file:'+str(pathlib.Path(db_path).resolve())+'?mode='+('rw' if apply else 'ro'),uri=True)
    try:
        if not apply:c.execute('PRAGMA query_only=ON')
        else:c.execute('BEGIN IMMEDIATE')
        prefs=c.execute("SELECT value FROM system_state WHERE key='news_filter_preferences'").fetchone()
        p=json.loads(prefs[0]) if prefs else {}
        if p.get('mode','shadow')!='shadow' or p.get('digest_enabled',False):raise ValueError('shadow_disabled_digest_required')
        actors=c.execute('SELECT DISTINCT actor FROM news_interests').fetchall()
        if len(actors)!=1:raise ValueError('owner_identity_ambiguous')
        actor=actors[0][0];count=0
        for r in rows:
            n=c.execute('SELECT title,url,confidence,route,rule_version,evaluated_at FROM news_candidates WHERE id=?',(r['candidate_id'],)).fetchone()
            if not n:raise ValueError('candidate_missing')
            # This is today's observed record, not reconstructed click-time history.
            evidence=json.dumps({'current_observation':dict(zip(['title','url','confidence','route','rule_version','evaluated_at'],n)),'approved_context':r.get('basis','fresh publication; historical decision not asserted')},ensure_ascii=False)
            identity=hashlib.sha256((package['approval_source']+r['candidate_id']+package['sample_hash']).encode()).hexdigest()
            if apply:
                count+=c.execute('INSERT OR IGNORE INTO news_owner_route_reviews VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(identity,r['candidate_id'],actor,r['label'],package['context'],package['approval_source'],package['rule_version'],package['catalog_version'],package['code_hash'],package['catalog_hash'],package['scope_hash'],package['sample_hash'],evidence,int(time.time()*1000))).rowcount
        if apply:c.commit()
        return {'validated':len(rows),'inserted':count,'activation_performed':False}
    finally:c.close()
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('database');p.add_argument('package');p.add_argument('--apply',action='store_true');a=p.parse_args()
    print(json.dumps(record(a.database,json.loads(pathlib.Path(a.package).read_text()),a.apply)))
