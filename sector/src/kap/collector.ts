import type {Disclosure,Indices,Listing} from './parser';
import {KapStore,CIRCUIT_WINDOW_MS,type Job,type Lease} from './store';
export interface Source {listing():Promise<Listing[]>;disclosure(id:number):Promise<Disclosure|null>;indices():Promise<Indices>;}
export class KapCollector {
 constructor(readonly store:KapStore,readonly source:Source,private clock=Date.now){}
 async run(job:Job):Promise<boolean>{
  const lease=this.store.claim(job,this.clock());if(!lease)return false;let interval=30_000;
  try {
   if(job==='discovery'){this.store.discover(await this.source.listing(),lease,this.clock());interval=60_000;}
   else if(job==='indices'){const data=await this.source.indices();this.store.transaction(()=>{this.store.guard(lease,this.clock());this.store.set('indices',data);try{this.store.refreshCircuitIndex(data,this.clock());}catch(e){this.store.set('circuit_index_block',safeError(e));throw e;}});interval=86400_000;}
   else if(job==='groups'){this.store.freeze(lease,this.clock());interval=CIRCUIT_WINDOW_MS-this.clock()%CIRCUIT_WINDOW_MS;}
   else if(this.store.get('notification_start')===null){interval=5000;}
   else if(job==='reconcile'){for(let n=0;n<3;n++){const id=this.store.nextRepair(this.clock());if(id===null)break;await this.process(id,lease,false);}}
   else {
    interval=job==='backfill'?600_000:30_000;let cursor=lease.cursor,valid=0;
    for(let n=0;n<3;n++){
     const id=cursor+1;if(lease.ceiling!==null&&id>lease.ceiling)break;
     if(this.store.checked(id,this.clock())){this.store.skip(lease,id,this.clock());cursor=id;valid++;continue;}
     const item=await this.process(id,lease,true);
     if(item){cursor=id;valid++;}else if(id<this.store.latest()){cursor=id;}else break;
    }
    if(job==='live'&&valid===3)interval=5000;
   }
   this.store.finish(lease,this.clock(),interval);
  }catch(e){if(job==='indices'&&this.store.circuitPolicy())this.store.set('circuit_index_block',safeError(e));this.store.finish(lease,this.clock(),interval,safeError(e));}
  return true;
 }
 private async process(id:number,lease:Lease,advance:boolean):Promise<boolean>{
  try {
   const d=await this.source.disclosure(id),now=this.clock();
   if(!d){this.store.gap(id,'missing','kap_http_404',lease,now,advance&&id<this.store.latest());return false;}
   if(Date.parse(d.publishedAt)>now+300_000)throw new Error('kap_future_date');
   this.store.save(d,lease,now,advance);return true;
  }catch(e){this.store.gap(id,'error',safeError(e),lease,this.clock(),false);throw e;}
 }
}
export function safeError(e:unknown):string {const text=e instanceof Error?e.message:'';return /^kap_[a-z0-9_]+$/.test(text)?text:e instanceof Error&&e.name==='AbortError'?'kap_timeout':'kap_scan_failed';}
