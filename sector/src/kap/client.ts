import{sha256}from'../utils/text';
import {ORIGIN,parseDisclosure,parseListing,parseIndices,fullText} from './parser';
export class KapHttpError extends Error {constructor(public status:number){super('kap_http_'+status);}}
export class KapClient {
 private active=0;private waiting:(()=>void)[]=[];
 constructor(private request:typeof fetch=fetch){}
 private async acquire(){if(this.active>=2)await new Promise<void>(r=>this.waiting.push(r));else this.active++;}
 private release(){const next=this.waiting.shift();if(next)next();else this.active--;}
 async read(path:string,accept:string):Promise<string> {
  const url=new URL(path,ORIGIN);if(url.origin!==ORIGIN||url.username||url.password)throw new Error('kap_origin');
  await this.acquire();
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),12_000);
  try {
   const r=await this.request(url,{headers:{Accept:accept,'Accept-Language':'tr'},signal:abort.signal,redirect:'manual'});
   if(!r.ok){await r.body?.cancel();throw new KapHttpError(r.status);}
   if(!(r.headers.get('content-type')??'').toLowerCase().includes(accept)){await r.body?.cancel();throw new Error('kap_content_type');}
   if(Number(r.headers.get('content-length')??0)>16*1024*1024){await r.body?.cancel();throw new Error('kap_body_limit');}
   const reader=r.body?.getReader();if(!reader)throw new Error('kap_body_empty');
   const chunks:Uint8Array[]=[];let size=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16*1024*1024){await reader.cancel();throw new Error('kap_body_limit');}chunks.push(value);}}finally{reader.releaseLock();}
   const out=new Uint8Array(size);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return new TextDecoder('utf-8',{fatal:true}).decode(out);
  }finally{clearTimeout(timer);this.release();}
 }
 async disclosure(id:number){if(!Number.isSafeInteger(id)||id<=0)throw new Error('kap_id');try{return parseDisclosure(await this.read(`/tr/Bildirim/${id}`,'text/html'),id);}catch(e){if(e instanceof KapHttpError&&e.status===404)return null;throw e;}}
 async listing(){return parseListing(JSON.parse(await this.read('/tr/api/disclosure/list/light','application/json')));}
 async indices(){const raw=await this.read('/tr/Endeksler','text/html');return{...parseIndices(raw),sourceSha256:await sha256(raw)};}
 async fullText(id:number){if(!Number.isSafeInteger(id)||id<=0)throw new Error('kap_id');return fullText(await this.read(`/tr/Bildirim/${id}`,'text/html'),id);}
}
