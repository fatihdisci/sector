/** Offline-only candidate: no live database, secrets, network or service changes. */
import {spawnSync} from 'node:child_process';
import {readdirSync,writeFileSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import anchor from '../src/data/news-maintenance-anchor.json';
import {newsReviewArtifact} from './news_review_artifact';
import {canonical} from '../src/news-owner-review';
import {sha256} from '../src/utils/text';

const output=process.argv[2];if(!output)throw Error('candidate_output_path_required');
const tests=readdirSync('test').filter(f=>f.endsWith('.test.ts')).sort().map(f=>'test/'+f);
function run(command:string,args:string[],env=process.env){
 const result=spawnSync(command,args,{encoding:'utf8',env,maxBuffer:20_000_000});
 if(result.status!==0)throw Error('candidate_checks_failed:'+command);
 return (result.stdout??'')+'\n'+(result.stderr??'');
}
const ts=run(process.execPath,['--import','tsx','--test',...tests]);
run('npm',['run','check']);
run('npm',['run','build']);
const python=join(homedir(),'Library/Application Support/sector-haber/pdf-venv/bin/python');
const py=run(python,['-m','unittest','discover','-s','test','-p','test_*.py'],{...process.env,PYTHONPATH:'scripts'});
const artifact=await newsReviewArtifact(process.cwd()),created_at=Date.now();
const oldFiles=anchor.runtime_files,oldCatalog=anchor.parent_artifact.catalog_hash;
// Optional non-secret runtime artifact export; staging independently validates its owner chain.
const previousInput=process.argv[3]?JSON.parse(readFileSync(resolve(process.argv[3]),'utf8')):null;
const previous=previousInput?.news_review_artifact??previousInput??{files:oldFiles,catalog_hash:oldCatalog,hash:await sha256(canonical({files:oldFiles,catalog_hash:oldCatalog}))};
if(previous.catalog_hash!==oldCatalog||previous.hash!==await sha256(canonical({files:previous.files,catalog_hash:previous.catalog_hash})))throw Error('previous_artifact_invalid');
const previous_artifact_hash=previous.hash;
const candidate={state:'pending',hash:artifact.hash,rule:anchor.rule,catalog:anchor.catalog,scope:anchor.scope,activated_at:anchor.activated_at,schedule_since:anchor.schedule_since,parent_state_hash:anchor.parent_state_hash,previous_artifact_hash,created_at,expires_at:created_at+24*3600_000,checks:{typescript_summary:ts.match(/# tests \d+[\s\S]*?# duration_ms [^\n]*/)?.[0]??'passed',python_summary:py.match(/Ran \d+ tests[^\n]*[\s\S]*?OK[^\n]*/)?.[0]??'passed',typecheck:'passed',build:'passed',baseline_and_pending_candidate:'passed'}};
writeFileSync(resolve(output),JSON.stringify(candidate,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({output:resolve(output),hash:artifact.hash,checks:candidate.checks}));
