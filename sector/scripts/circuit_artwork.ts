import {readFile}from'node:fs/promises';import{join}from'node:path';import{bytesHash}from'../src/media-set';import type{CircuitArtwork}from'../src/circuit-artwork';
/** Only the reviewed local allowlist file; no remote fallback or placeholder. */
export async function loadCircuitArtwork(root:string):Promise<CircuitArtwork>{const base=join(root,'assets/circuit-general'),m=JSON.parse(await readFile(join(base,'manifest.json'),'utf8'));if(m.version!==1||m.enabled!==true||m.purpose!=='circuit_daily'||m.file!=='general.png'||!/^[a-f0-9]{64}$/.test(m.sha256)||!Number.isSafeInteger(m.width)||!Number.isSafeInteger(m.height))throw Error('circuit_artwork_manifest');const bytes=new Uint8Array(await readFile(join(base,m.file)));if(await bytesHash(bytes)!==m.sha256)throw Error('circuit_artwork_hash');return{bytes,sha256:m.sha256,width:m.width,height:m.height};}

export async function loadCircuitArtworkPool(root:string):Promise<CircuitArtwork[]>{
 const base=join(root,'assets/circuit-general'),m=JSON.parse(await readFile(join(base,'manifest.json'),'utf8'));const first=await loadCircuitArtwork(root);
 if(!Array.isArray(m.alternatives)||m.alternatives.length!==2||m.alternatives.map((a:any)=>a.file).join(',')!=='pause.png,circuit.png')throw Error('circuit_artwork_pool_invalid');
 const pool=[first];for(const a of m.alternatives){if(!/^[a-f0-9]{64}$/.test(a.sha256)||a.width!==1672||a.height!==941)throw Error('circuit_artwork_pool_invalid');const bytes=new Uint8Array(await readFile(join(base,a.file)));if(await bytesHash(bytes)!==a.sha256||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))throw Error('circuit_artwork_pool_invalid');const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(view.getUint32(16)!==a.width||view.getUint32(20)!==a.height)throw Error('circuit_artwork_pool_invalid');pool.push({bytes,sha256:a.sha256,width:a.width,height:a.height});}
 if(new Set(pool.map(a=>a.sha256)).size!==3)throw Error('circuit_artwork_pool_invalid');return pool;
}
