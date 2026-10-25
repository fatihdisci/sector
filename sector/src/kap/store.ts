import{CIRCUIT_POLICY,CIRCUIT_LIGHT_TTL,CIRCUIT_LIGHT_MAX,circuitSnapshot,circuitScope,listingCircuit,snapshotProblem,type CircuitPolicy,type CircuitSnapshot}from'./circuit-scope';
import {DatabaseSync,type SQLInputValue} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import type {Disclosure,Indices,Listing} from './parser';
import {decide,digestAt,preferences,DEFAULTS,type Preferences} from './rules';
import {focusedDisclosureTickers} from './ticker-scope';
export type Job='live'|'backfill'|'reconcile'|'discovery'|'indices'|'groups';
export const CIRCUIT_WINDOW_MS=180_000;
export interface Lease {job:Job;token:string;cursor:number;ceiling:number|null;failures:number;}
const SCHEMA=`
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(name TEXT PRIMARY KEY,cursor INTEGER NOT NULL DEFAULT 0,ceiling INTEGER,next_at INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,last_ok INTEGER,last_error TEXT);
CREATE TABLE IF NOT EXISTS discovered(id INTEGER PRIMARY KEY,published_at TEXT NOT NULL,first_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS checks(id INTEGER PRIMARY KEY,checked_at INTEGER NOT NULL,disposition TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gaps(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,attempts INTEGER NOT NULL,next_try INTEGER NOT NULL,first_seen INTEGER NOT NULL,last_error TEXT);
CREATE TABLE IF NOT EXISTS disclosures(id INTEGER PRIMARY KEY,source_ref TEXT NOT NULL UNIQUE,oid TEXT,related_oid TEXT,correction INTEGER NOT NULL,published_at TEXT NOT NULL,first_seen INTEGER NOT NULL,metadata TEXT NOT NULL,decision TEXT NOT NULL,silent INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS feed(id INTEGER PRIMARY KEY REFERENCES disclosures(id),source_ref TEXT NOT NULL UNIQUE,title TEXT NOT NULL,company TEXT,published_at TEXT NOT NULL,first_seen INTEGER NOT NULL,topics TEXT NOT NULL,subject_codes TEXT NOT NULL,related_codes TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS queue(id TEXT PRIMARY KEY,source_ref TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'ready',created_at INTEGER NOT NULL,available_at INTEGER NOT NULL,frozen_at INTEGER,payload TEXT NOT NULL,sent_at INTEGER);
CREATE TABLE IF NOT EXISTS queue_members(disclosure_id INTEGER PRIMARY KEY REFERENCES disclosures(id),queue_id TEXT NOT NULL REFERENCES queue(id));
CREATE TABLE IF NOT EXISTS circuit_pending(disclosure_id INTEGER PRIMARY KEY REFERENCES disclosures(id),first_seen INTEGER NOT NULL,codes TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS circuit_light(id INTEGER PRIMARY KEY,published_at TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,disposition TEXT NOT NULL,reason TEXT NOT NULL,list_version TEXT);
CREATE INDEX IF NOT EXISTS circuit_light_expiry ON circuit_light(expires_at);
CREATE INDEX IF NOT EXISTS gaps_due ON gaps(next_try);
CREATE INDEX IF NOT EXISTS queue_ready ON queue(state,available_at);
`;
export class KapStore {
 readonly db:DatabaseSync;
 constructor(path:string){
  this.db=new DatabaseSync(path);const d=this.db;
  try{d.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');const app=Number(d.prepare('PRAGMA application_id').get()!.application_id);
   const count=Number(d.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()!.n);
   if(app!==0x534B4150&&(app!==0||count))throw new Error('kap_database_namespace');
   d.exec('PRAGMA journal_mode=WAL; PRAGMA application_id=1397440848;');d.exec(SCHEMA);
   this.run("INSERT OR IGNORE INTO settings VALUES('preferences',?)",JSON.stringify(DEFAULTS));
   for(const name of ['live','backfill','reconcile','discovery','indices','groups'])this.run('INSERT OR IGNORE INTO jobs(name) VALUES(?)',name);
  }catch(e){d.close();throw e;}
 }
 run(sql:string,...values:SQLInputValue[]){return this.db.prepare(sql).run(...values);}
 row<T>(sql:string,...values:SQLInputValue[]):T|undefined{return this.db.prepare(sql).get(...values) as T|undefined;}
 rows<T>(sql:string,...values:SQLInputValue[]):T[]{return this.db.prepare(sql).all(...values) as T[];}
 transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 get<T>(key:string):T|null {const row=this.row<{value:string}>('SELECT value FROM settings WHERE key=?',key);return row?JSON.parse(row.value):null;}
 set(key:string,value:unknown){this.run('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value));}
 circuitPolicy():CircuitPolicy|null{const p=this.get<CircuitPolicy>('circuit_policy');if(p&&(p.version!==CIRCUIT_POLICY.version||p.authority!==CIRCUIT_POLICY.authority||p.scope!==CIRCUIT_POLICY.scope||!Number.isSafeInteger(p.activated_at)||p.activated_at<=0))throw Error('kap_circuit_policy_invalid');return p;}
 circuit(d:Disclosure,now=Date.now()){return this.circuitPolicy()?circuitScope(d,this.get<CircuitSnapshot>('circuit_snapshot'),this.get<string>('circuit_index_block'),now):null;}
 refreshCircuitIndex(indices:Indices,now:number){if(this.circuitPolicy()){const snapshot=circuitSnapshot(indices,now);this.set('circuit_snapshot',snapshot);this.set('circuit_index_block',null);}}
 pruneCircuitLight(now:number){this.run('DELETE FROM circuit_light WHERE expires_at<=?',now);this.run('DELETE FROM circuit_light WHERE id IN (SELECT id FROM circuit_light ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET ?)',CIRCUIT_LIGHT_MAX);}
 light(id:number,publishedAt:string,reason:string,version:string|undefined,now:number,review=false){this.run('INSERT OR IGNORE INTO circuit_light VALUES(?,?,?,?,?,?,?)',id,publishedAt,now,now+CIRCUIT_LIGHT_TTL,review?'review':'excluded',reason,version??null);this.pruneCircuitLight(now);this.run('DELETE FROM discovered WHERE id=? AND first_seen>=?',id,this.circuitPolicy()!.activated_at);this.run('DELETE FROM gaps WHERE id=?',id);}
 prefs(){return preferences(this.get('preferences'));}
 configure(value:unknown,at=Date.now()){const p=preferences(value);this.transaction(()=>{
  if(p.circuitNotifications&&!this.prefs().circuitNotifications)this.set('circuit_since',at);
  this.set('preferences',p);if(!p.circuitNotifications)this.suppressCircuits();
  // Re-evaluate already collected, not-yet-delivered notifications. Keep source
  // records and delivered messages; a preference change must not replay history.
  for(const row of this.rows<{id:string;metadata:string}>("SELECT q.id,d.metadata FROM queue q JOIN queue_members m ON m.queue_id=q.id JOIN disclosures d ON d.id=m.disclosure_id WHERE q.kind='instant' AND q.sent_at IS NULL AND q.state IN ('ready','preparing','model_queued','needs_review')")){
   if(decide(JSON.parse(row.metadata),p,this.get<Indices>('indices')).action!=='instant')this.run("UPDATE queue SET state='suppressed' WHERE id=? AND sent_at IS NULL",row.id);
  }
 });}
 private suppressCircuits(){
  this.run("UPDATE queue SET state='suppressed' WHERE sent_at IS NULL AND state IN ('ready','preparing','model_queued','needs_review') AND (kind='circuit' OR EXISTS(SELECT 1 FROM queue_members m JOIN disclosures d ON d.id=m.disclosure_id JOIN json_each(d.decision,'$.topics') t WHERE m.queue_id=queue.id AND t.value='circuit'))");
 }
 claim(job:Job,now:number):Lease|null {
  const token=randomUUID();const changed=this.run('UPDATE jobs SET lease_token=?,lease_until=? WHERE name=? AND next_at<=? AND lease_until<=?',token,now+120_000,job,now,now).changes;
  if(!changed)return null;const row=this.row<{cursor:number;ceiling:number|null;failures:number}>('SELECT * FROM jobs WHERE name=?',job)!;return {job,token,...row};
 }
 guard(lease:Lease,now:number){if(!this.row('SELECT 1 FROM jobs WHERE name=? AND lease_token=? AND lease_until>?',lease.job,lease.token,now))throw new Error('kap_lease_lost');}
 finish(lease:Lease,now:number,interval:number,error?:string){
  const failures=error?lease.failures+1:0;const wait=error?Math.min(300_000,30_000*2**Math.min(failures-1,4)):interval;
  this.run('UPDATE jobs SET lease_token=NULL,lease_until=0,next_at=?,failures=?,last_error=?,last_ok=CASE WHEN ? IS NULL THEN ? ELSE last_ok END WHERE name=? AND lease_token=?',now+wait,failures,error??null,error??null,now,lease.job,lease.token);
 }
 discover(list:Listing[],lease:Lease,now:number){this.transaction(()=>{
  this.guard(lease,now);
  // A quiet day is a successful empty observation, not an invalid response.
  // Never bootstrap cursors from an empty list or reset the previous high-water mark.
  if(!list.length){this.set('last_listing',{at:now,max:this.latest(),count:0,oldestPublished:null});return;}
  const ids=list.map(x=>x.id),max=Math.max(...ids),min=Math.min(...ids);
  if(this.get<number>('notification_start')===null){
   this.set('notification_start',now);this.set('bootstrap',{at:new Date(now).toISOString(),latest:max,oldestListed:min});
   this.run("UPDATE jobs SET cursor=? WHERE name='live'",max);
   this.run("UPDATE jobs SET cursor=?,ceiling=? WHERE name='backfill'",min-1,max);
  }
  this.pruneCircuitLight(now);
  for(const r of list)if(Date.parse(r.publishedAt)>=now-86400_000){const p=this.circuitPolicy(),scope=p&&Date.parse(r.publishedAt)>=p.activated_at&&r.circuit?listingCircuit(r.circuit,this.get('circuit_snapshot'),this.get('circuit_index_block'),now):null;if(scope&&(scope.kind==='review'||scope.kind==='pay'&&!scope.codes.length)){this.light(r.id,r.publishedAt,scope.reason,scope.version,now,scope.kind==='review');continue;}this.run('INSERT OR IGNORE INTO discovered VALUES(?,?,?)',r.id,r.publishedAt,now);}
  this.set('last_listing',{at:now,max:Math.max(max,this.latest()),count:list.length,oldestPublished:list.reduce((a,b)=>Date.parse(a.publishedAt)<Date.parse(b.publishedAt)?a:b).publishedAt});
 });}
 latest():number{return this.get<{max:number}>('last_listing')?.max??0;}
 checked(id:number,now=Date.now()){return !!this.row('SELECT 1 FROM checks WHERE id=? UNION ALL SELECT 1 FROM circuit_light WHERE id=? AND expires_at>?',id,id,now);}
 nextRepair(now:number):number|null {
  const row=this.row<{id:number}>(`SELECT id FROM (
   SELECT id,next_try AS due FROM gaps WHERE next_try<=?
   UNION ALL SELECT d.id,d.first_seen AS due FROM discovered d WHERE d.id>? AND NOT EXISTS(SELECT 1 FROM checks c WHERE c.id=d.id) AND NOT EXISTS(SELECT 1 FROM gaps g WHERE g.id=d.id) AND NOT EXISTS(SELECT 1 FROM circuit_light l WHERE l.id=d.id AND l.expires_at>?)
  ) ORDER BY due,id LIMIT 1`,now,this.get<{latest:number}>('bootstrap')?.latest??0,now);return row?.id??null;
 }
 gap(id:number,kind:string,error:string,lease:Lease,now:number,advance=false){this.transaction(()=>{
  this.guard(lease,now);const attempts=(this.row<{attempts:number}>('SELECT attempts FROM gaps WHERE id=?',id)?.attempts??0)+1;
  this.run('INSERT INTO gaps VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,attempts=excluded.attempts,next_try=excluded.next_try,last_error=excluded.last_error',id,kind,attempts,now+Math.min(300_000,30_000*2**Math.min(attempts-1,4)),now,error);
  if(advance)this.advance(lease,id);
 });}
 advance(lease:Lease,id:number){this.run('UPDATE jobs SET cursor=MAX(cursor,?) WHERE name=? AND lease_token=?',id,lease.job,lease.token);}
 skip(lease:Lease,id:number,now:number){this.transaction(()=>{this.guard(lease,now);this.advance(lease,id);});}
 save(d:Disclosure,lease:Lease,now:number,advance:boolean){this.transaction(()=>{
  this.guard(lease,now);
  if(!this.checked(d.id,now)){
   const policy=this.circuitPolicy(),scope=this.circuit(d,now);
   if(policy&&Date.parse(d.publishedAt)>=policy.activated_at&&scope&&(scope.kind==='review'||scope.kind==='pay'&&!scope.codes.length)){this.light(d.id,d.publishedAt,scope.reason,scope.version,now,scope.kind==='review');if(advance)this.advance(lease,d.id);return;}
   const p=this.prefs(),decision=decide(d,p,this.get<Indices>('indices'));
   if(scope&&(scope.kind==='market'||scope.kind==='pay'&&scope.codes.length)){decision.store=true;decision.action=p.circuitNotifications?'circuit':'off';decision.reason=scope.reason;}
   const cutoff=this.get<number>('notification_start');if(cutoff===null)throw new Error('kap_not_bootstrapped');
   const firstSeen=this.row<{first_seen:number}>('SELECT first_seen FROM discovered WHERE id=?',d.id)?.first_seen??now;
   const silent=lease.job==='backfill'||d.id<=(this.get<{latest:number}>('bootstrap')?.latest??0)||Date.parse(d.publishedAt)<cutoff;
   const withinBackfill=lease.job!=='backfill'||Date.parse(d.publishedAt)>=now-86400_000;
   if(decision.store&&withinBackfill){
    this.run('INSERT INTO disclosures VALUES(?,?,?,?,?,?,?,?,?,?)',d.id,d.sourceRef,d.oid,d.relatedOid,Number(d.isCorrection),d.publishedAt,firstSeen,JSON.stringify(d),JSON.stringify(decision),Number(silent));
    this.run('INSERT INTO feed VALUES(?,?,?,?,?,?,?,?,?)',d.id,d.sourceRef,d.title,d.company,d.publishedAt,firstSeen,JSON.stringify(decision.topics),JSON.stringify(d.subjectCodes),JSON.stringify(d.relatedCodes));
    if(!silent&&decision.action!=='off'){
     if(decision.action==='circuit'&&scope?.kind==='market'){const key='kap:circuit-market:'+d.id;this.run('INSERT INTO queue(id,source_ref,kind,created_at,available_at,frozen_at,payload) VALUES(?,?,?,?,?,?,?)',key,key,'circuit',now,now,now,JSON.stringify({disclosureIds:[d.id],codes:[],scope:'market'}));this.run('INSERT INTO queue_members VALUES(?,?)',d.id,key);}
     else if(decision.action==='circuit'){const since=this.get<number>('circuit_since')??0;if(now>=since&&Date.parse(d.publishedAt)>=since)this.run('INSERT INTO circuit_pending VALUES(?,?,?)',d.id,now,JSON.stringify(scope?.kind==='pay'?scope.codes:focusedDisclosureTickers(d,this.get<Indices>('indices'))));}
     else {const key=d.sourceRef;this.run('INSERT INTO queue(id,source_ref,kind,created_at,available_at,frozen_at,payload) VALUES(?,?,?,?,?,?,?)',key,key,decision.action,now,decision.action==='digest'?digestAt(now,p.fundDigestTime):now,now,JSON.stringify({disclosureId:d.id,sourceRef:d.sourceRef,reason:decision.reason}));this.run('INSERT INTO queue_members VALUES(?,?)',d.id,key);}
    }
   }
   this.run('INSERT INTO checks VALUES(?,?,?)',d.id,now,decision.store&&withinBackfill?'stored':'filtered');
  }
  this.run('DELETE FROM gaps WHERE id=?',d.id);
  if(advance)this.advance(lease,d.id);
 });}
 freeze(lease:Lease,now:number){this.transaction(()=>{
  this.guard(lease,now);
  this.pruneCircuitLight(now);
  const policy=this.circuitPolicy();if(policy){const problem=snapshotProblem(this.get('circuit_snapshot'),this.get('circuit_index_block'),now);if(problem){this.set('circuit_group_review',{at:now,reason:problem});return;}}
  const circuitsEnabled=this.prefs().circuitNotifications;if(!circuitsEnabled)this.suppressCircuits();
  // One closed three-minute bucket, independent of the live cursor/edge.
  // Freeze all its members together; a busy window must not become many posts.
  for(let group=0;group<10;group++){
   const first=this.row<{first_seen:number;published_at:string}>('SELECT c.first_seen,d.published_at FROM circuit_pending c JOIN disclosures d ON d.id=c.disclosure_id ORDER BY c.first_seen,c.disclosure_id LIMIT 1');if(!first)break;
   const windowStart=Math.floor(first.first_seen/CIRCUIT_WINDOW_MS)*CIRCUIT_WINDOW_MS,windowEnd=windowStart+CIRCUIT_WINDOW_MS;if(now<windowEnd)break;
   const since=this.get<number>('circuit_since')??0,eligible=(r:{first_seen:number;published_at:string})=>r.first_seen>=since&&Date.parse(r.published_at)>=since;
   const groupEligible=eligible(first);
   const members=this.rows<{disclosure_id:number;codes:string;first_seen:number;published_at:string;metadata:string}>('SELECT c.*,d.published_at,d.metadata FROM circuit_pending c JOIN disclosures d ON d.id=c.disclosure_id WHERE c.first_seen<? ORDER BY c.first_seen,c.disclosure_id',windowEnd).filter(m=>eligible(m)===groupEligible);
   const indices=this.get<Indices>('indices'),selected=(m:{metadata:string})=>{const d=JSON.parse(m.metadata)as Disclosure,scope=this.circuit(d,now);return scope?.kind==='pay'?scope.codes:scope?[]:focusedDisclosureTickers(d,indices);},scoped=members.filter(m=>selected(m).length>0);
   for(const m of members){const scope=this.circuit(JSON.parse(m.metadata),now);if(scope?.kind==='review')this.light(m.disclosure_id,m.published_at,scope.reason,scope.version,now,true);}
   const ids=scoped.map(m=>m.disclosure_id),codes=[...new Set(scoped.flatMap(selected))].sort();
   if(ids.length){const key=`kap:circuit:${ids[0]}`;
    this.run('INSERT INTO queue(id,source_ref,kind,created_at,available_at,frozen_at,payload) VALUES(?,?,?,?,?,?,?)',key,key,'circuit',first.first_seen,now,now,JSON.stringify({disclosureIds:ids,codes,windowStart,windowEnd,...(policy?{scope:'bist30',listVersion:this.get<CircuitSnapshot>('circuit_snapshot')!.version}:{})}));
    if(!circuitsEnabled||!groupEligible)this.run("UPDATE queue SET state='suppressed' WHERE id=?",key);
    for(const id of ids)this.run('INSERT INTO queue_members VALUES(?,?)',id,key);
   }
   // Out-of-scope disclosures remain in source/feed history, but an older
   // pending group must not contaminate an allowed ticker's combined post.
   for(const m of members)this.run('DELETE FROM circuit_pending WHERE disclosure_id=?',m.disclosure_id);
  }
 });}
 health(now=Date.now()){
  const indexes=this.get<Indices>('indices'),latest=this.latest(),live=this.row<{cursor:number}>("SELECT cursor FROM jobs WHERE name='live'")!.cursor;
  const counts=(table:string)=>this.row<{n:number}>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;
  return {at:new Date(now).toISOString(),bootstrap:this.get('bootstrap'),notificationStart:this.get('notification_start'),jobs:this.rows('SELECT name,cursor,ceiling,next_at,lease_until,failures,last_ok,last_error FROM jobs'),
   cursorLagIds:Math.max(0,latest-live),unresolvedGaps:counts('gaps'),oldestGap:this.row('SELECT id,first_seen,attempts,last_error FROM gaps ORDER BY first_seen LIMIT 1')??null,
   sources:counts('disclosures'),feed:counts('feed'),queue:counts('queue'),circuitPending:counts('circuit_pending'),queueByState:this.rows('SELECT kind,state,COUNT(*) AS count,MIN(created_at) AS oldest FROM queue GROUP BY kind,state'),
   circuitScope:this.circuitPolicy()?{policy:this.circuitPolicy(),snapshot:this.get('circuit_snapshot'),problem:snapshotProblem(this.get('circuit_snapshot'),this.get('circuit_index_block'),now),lightRows:counts('circuit_light'),lightBytes:this.row<{n:number}>('SELECT COALESCE(SUM(32+length(published_at)+length(disposition)+length(reason)+COALESCE(length(list_version),0)),0) n FROM circuit_light')!.n,review:this.rows("SELECT id,reason,created_at,expires_at FROM circuit_light WHERE disposition='review' AND expires_at>? ORDER BY created_at DESC LIMIT 10",now),ttlMs:CIRCUIT_LIGHT_TTL,maxRows:CIRCUIT_LIGHT_MAX}:null,
   indexCheckedAt:indexes?.checkedAt??null,indexAgeMs:indexes?now-Date.parse(indexes.checkedAt):null,discovery:this.get('last_listing'),deliveryEnabled:(this.get<{heartbeatAt:number}>('telegram_delivery')?.heartbeatAt??0)>now-60_000};
 }
 close(){this.db.close();}
}
