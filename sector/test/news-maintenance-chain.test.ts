import test from 'node:test';import assert from 'node:assert/strict';
import {validMaintenanceChain,type MaintenanceLink} from '../src/news-maintenance-chain';
import {canonical,type ReviewArtifact} from '../src/news-owner-review';import {sha256} from '../src/utils/text';
async function fixture(){
 const artifact=async(n:number):Promise<ReviewArtifact>=>{const files={'src/fixture.ts':String(n).repeat(64)},catalog_hash='c'.repeat(64);return{files,catalog_hash,hash:await sha256(canonical({files,catalog_hash}))};};
 const base=await artifact(0),fields={rule:'fixture-rule',catalog:'fixture-catalog',scope:'fixture-scope',activated_at:1,schedule_since:2,parent_state_hash:'p'.repeat(64)},links:MaintenanceLink[]=[];let previous=base.hash;
 for(let n=1;n<=3;n++){const a=await artifact(n),created_at=100+n*10,candidate_raw=JSON.stringify({state:'pending',hash:a.hash,previous_artifact_hash:previous,...fields,created_at,expires_at:created_at+5}),candidate_digest=await sha256(candidate_raw),common={owner:'fixture-owner',chat:'fixture-chat',message:n,nonce:'nonce-'+n,artifact:a.hash,candidate_digest};links.push({artifact:a,candidate_raw,request:{...common,state:'approved',expires_at:created_at+5},event:{...common,approved_at:created_at+1}});previous=a.hash;}
 return{parentValid:true,base,recordedAt:100,fields,owner:'fixture-owner',chat:'fixture-chat',now:1000,links};
}
test('second and third sequential maintenance approvals keep every exact predecessor',async()=>{
 const f=await fixture();assert.equal(await validMaintenanceChain({...f,links:f.links.slice(0,2)}),true);assert.equal(await validMaintenanceChain(f),true);
 // Approval remains durable after its request expiry; its recorded approval was in time.
 assert.equal(await validMaintenanceChain({...f,now:100000}),true);
});
test('chain rejects missing/replayed approvals, hash drift, bad parents, changed scope and wrong identity',async()=>{
 const mutations=[(f:any)=>f.parentValid=false,(f:any)=>f.links.splice(1,1),(f:any)=>f.links[1].event=null,(f:any)=>f.links[1].artifact.files['src/fixture.ts']='bad',(f:any)=>f.links[1].request.owner='other',(f:any)=>f.chat='other',(f:any)=>f.fields.scope='changed',(f:any)=>f.links[1].event.message++,(f:any)=>f.links[1].event.approved_at=9999,(f:any)=>f.links[1].request.candidate_digest='wrong',(f:any)=>f.links[1].event=f.links[0].event,(f:any)=>f.links.push(f.links[0])];
 for(const mutate of mutations){const f=await fixture();mutate(f);assert.equal(await validMaintenanceChain(f),false);}
});
test('rollback can validate an earlier prefix, never gives a future or unapproved candidate approval',async()=>{
 const f=await fixture();assert.equal(await validMaintenanceChain({...f,links:f.links.slice(0,1)}),true);
 const noApproval=structuredClone(f);noApproval.links[2].request.state='pending';assert.equal(await validMaintenanceChain(noApproval),false);
 assert.equal(await validMaintenanceChain({...f,links:[...f.links,f.links[2]]}),false);
});
