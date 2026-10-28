import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
test('candidate staging cannot race a running installer',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'maintenance-lock-'));try{
  const db=join(dir,'runtime.sqlite'),candidate=join(dir,'candidate.json');await writeFile(db,'');await writeFile(candidate,'{}');await writeFile(join(dir,'.install.lock'),'active');
  const result=spawnSync(process.execPath,['--import','tsx','scripts/install_news_candidate.ts',db,candidate,'7'],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/EEXIST/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
