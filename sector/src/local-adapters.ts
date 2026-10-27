import {DatabaseSync} from 'node:sqlite';
import {mkdir,unlink,open,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,resolve,sep} from 'node:path';
// The same repository/pipeline contract used by D1, backed by a separate local
// SQLite database when the always-on Mac is the runtime. Batches are atomic.
export async function localDatabase(path:string,schema:string):Promise<D1Database> {
 const sql=new DatabaseSync(path);sql.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
 const application=Number(sql.prepare('PRAGMA application_id').get()!.application_id);
 const tables=sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
 if(application!==0x53454354&&(application!==0||tables.length))throw new Error('database_namespace_mismatch');
 sql.exec('PRAGMA application_id=1397048148;');sql.exec(schema);
 class Statement {
  args:unknown[]=[];constructor(public text:string){}
  bind(...args:unknown[]){const s=new Statement(this.text);s.args=args;return s;}
  sync(){const r=sql.prepare(this.text).run(...this.args as never[]);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}
  run(){return Promise.resolve(this.sync());}
  first(column?:string){const row=sql.prepare(this.text).get(...this.args as never[]);return Promise.resolve(column?row?.[column]??null:row??null);}
  all(){return Promise.resolve({success:true,results:sql.prepare(this.text).all(...this.args as never[])});}
 }
 return {prepare:(text:string)=>new Statement(text),batch:(statements:Statement[])=>{sql.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>s.sync());sql.exec('COMMIT');return Promise.resolve(result);}catch(e){sql.exec('ROLLBACK');return Promise.reject(e);}}} as unknown as D1Database;
}
export async function localMedia(directory:string):Promise<R2Bucket> {
 await mkdir(directory,{recursive:true,mode:0o700});
 const root=await realpath(directory),inside=(p:string)=>p.startsWith(root+sep);
 const path=(key:string)=>{const p=resolve(root,key);if(!inside(p))throw new Error('invalid_media_key');return p;};
 const checked=async(p:string)=>{const canonical=await realpath(p);if(!inside(canonical))throw new Error('invalid_media_key');return canonical;};
 async function parents(p:string){
  const parts=p.slice(root.length+1).split(sep).slice(0,-1);let current=root;
  for(const part of parts){current=join(current,part);try{await mkdir(current,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}const stat=await lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink()||!inside(await realpath(current)))throw Error('invalid_media_key');}
 }
 return {
  put:async(key:string,value:Uint8Array)=>{const p=path(key);await parents(p);const f=await open(p,constants.O_WRONLY|constants.O_CREAT|constants.O_NOFOLLOW,0o600);try{const canonical=await checked(p);const a=await f.stat(),b=await lstat(canonical);if(!a.isFile()||a.dev!==b.dev||a.ino!==b.ino)throw Error('invalid_media_key');await f.truncate(0);await f.writeFile(value);}finally{await f.close();}return {};},
  get:async(key:string)=>{try{const p=path(key),canonical=await checked(p),f=await open(canonical,constants.O_RDONLY|constants.O_NOFOLLOW);try{const a=await f.stat(),b=await lstat(canonical);if(!a.isFile()||a.dev!==b.dev||a.ino!==b.ino||await checked(p)!==canonical)throw Error('invalid_media_key');const data=await f.readFile();return {arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)};}finally{await f.close();}}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}},
  delete:async(key:string)=>{const p=path(key);try{const canonical=await checked(p);if(canonical!==p)throw Error('invalid_media_key');await unlink(p);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 } as unknown as R2Bucket;
}
