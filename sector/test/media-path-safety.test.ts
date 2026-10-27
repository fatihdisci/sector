import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {localMedia} from '../src/local-adapters';import {readMedia} from '../src/media-set';import type {Env} from '../src/types';
test('local media rejects traversal, same-prefix siblings and symlink escapes while accepting a real PNG',async()=>{
 const base=await mkdtemp(join(tmpdir(),'sector-media-safe-')),root=join(base,'media'),sibling=join(base,'media-other');
 try{await mkdir(sibling);const png=new Uint8Array([137,80,78,71,13,10,26,10,1]);await writeFile(join(sibling,'outside.png'),png);const store=await localMedia(root);const valid='drafts/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/1.png';await store.put(valid,png);assert.deepEqual(new Uint8Array(await (await store.get(valid))!.arrayBuffer()),png);
  await assert.rejects(()=>store.get('../media-other/outside.png'));await assert.rejects(()=>store.get(sibling+'/outside.png'));
  await symlink(join(sibling,'outside.png'),join(root,'outside.png'));await assert.rejects(()=>store.get('outside.png'));await assert.rejects(()=>store.put('outside.png',png));
  await symlink(sibling,join(root,'linked'));await assert.rejects(()=>store.get('linked/outside.png'));await assert.rejects(()=>store.put('linked/new.png',png));
 }finally{await rm(base,{recursive:true,force:true});}
});
test('manifestless legacy media still enforces draft PNG key allowlist',async()=>{
 let gets=0;const env={DB:{prepare:()=>({bind:()=>({first:async()=>null})})},MEDIA:{get:async()=>{gets++;return {arrayBuffer:async()=>new Uint8Array([137,80]).buffer}}}} as unknown as Env;
 for(const key of ['../outside.png','drafts/aaa/../../outside.png','drafts/aaa/image.jpg','evidence/aaa.png'])await assert.rejects(()=>readMedia(env,key));assert.equal(gets,0);
 await readMedia(env,'drafts/aaa/1.png');assert.equal(gets,1);
});
