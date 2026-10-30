import {kapNews} from '../src/kap-artwork';
import {newsArtworkEligible} from '../src/news-artwork';
import {readFile} from 'node:fs/promises';import {spawn} from 'node:child_process';import {isAbsolute} from 'node:path';
import contract from '../assets/visual-templates/bc-v1/contract.json';
import {requestBinding,validateVisualRequest,validateVisualAnalysis,visualAssets,visualDocument,visualHash,authorizedVisualSpec,assertVisualReceipt,type OwnerVisualRuntime,type VisualInput,type VisualRequest,type VisualAnalysis,type VisualLease} from '../src/owner-visual';
import {bytesHash} from '../src/media-set';import type {Env,Document,Draft} from '../src/types';
export interface VisualRunnerOptions {root:string;python:string;vars?:NodeJS.ProcessEnv;invoke?:(value:unknown,environment:NodeJS.ProcessEnv)=>Promise<any>;}
const mime=(b:Uint8Array)=>b[0]===137&&b[1]===80?'image/png':b[0]===255&&b[1]===216?'image/jpeg':String.fromCharCode(...b.slice(0,4))==='RIFF'&&String.fromCharCode(...b.slice(8,12))==='WEBP'?'image/webp':null;
export async function createOwnerVisualRuntime(env:Env,options:VisualRunnerOptions):Promise<OwnerVisualRuntime>{
 const vars=options.vars??process.env;
 const disabled=()=>{throw Error('owner_visual_api_disabled')};
 if(vars.SECTOR_OWNER_VISUAL_ENABLED!=='true')return {enabled:false,analyze:async()=>disabled(),revise:async()=>disabled(),render:async()=>disabled()};
 const configPath=vars.SECTOR_OWNER_VISUAL_CONFIG,budgetPath=vars.SECTOR_OWNER_VISUAL_BUDGET,usagePath=vars.SECTOR_OWNER_VISUAL_USAGE;
 if(!configPath||!budgetPath||!usagePath||![configPath,budgetPath,usagePath].every(isAbsolute)||new Set([configPath,budgetPath,usagePath]).size!==3)throw Error('owner_visual_explicit_paths_required');
 const config=JSON.parse(await readFile(configPath,'utf8'));
 if(config.enabled!==true||config.budget_authorized!==true||config.template_version!==contract.version)throw Error('owner_visual_config_disabled');
 if(!vars.SECTOR_OPENAI_API_KEY?.trim())throw Error('owner_visual_key_missing');
 const references=await Promise.all(contract.references.map(async ref=>{const bytes=new Uint8Array(await readFile(options.root+'assets/visual-templates/bc-v1/'+ref.file));if(await bytesHash(bytes)!==ref.sha256)throw Error('owner_visual_reference_changed');return {sha256:ref.sha256,base64:Buffer.from(bytes).toString('base64')};}));
 const invoke=options.invoke??((input:unknown,environment:NodeJS.ProcessEnv)=>new Promise((resolve,reject)=>{
  const child=spawn(options.python,[options.root+'scripts/visual_api_job.py'],{cwd:options.root,env:environment,stdio:['pipe','pipe','pipe']});let raw='',bytes=0,killed=false;
  const deadline=(input as {deadline:number}).deadline;const timer=setTimeout(()=>{killed=true;child.kill('SIGKILL')},Math.max(1,Math.min(500_000,deadline*1000-Date.now())));
  child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>32_000_000){killed=true;child.kill('SIGKILL')}else raw+=chunk.toString()});child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timer);reject(Error('owner_visual_failed_no_retry'))});child.on('close',code=>{clearTimeout(timer);if(code!==0||killed){reject(Error('owner_visual_failed_no_retry'));return}try{resolve(JSON.parse(raw))}catch{reject(Error('owner_visual_result_invalid'))}});child.stdin.end(JSON.stringify(input));
 }));
 const call=(operation:string,value:unknown,deadline:number)=>invoke({operation,config,budget_path:budgetPath,usage_path:usagePath,deadline,...value as object},{PATH:vars.PATH??'',HOME:vars.HOME??'',SECTOR_OWNER_VISUAL_ENABLED:'true',SECTOR_OPENAI_API_KEY:vars.SECTOR_OPENAI_API_KEY});
 const runtime:OwnerVisualRuntime={enabled:true,
  async analyze(input:VisualInput){
   if(input.images.length>4||input.images.some(a=>a.bytes.length>8_000_000))throw Error('owner_visual_source_limit');
   const assets=await Promise.all(input.images.map(async image=>{const kind=mime(image.bytes);if(!kind)throw Error('owner_visual_source_mime_invalid');const sha256=await bytesHash(image.bytes),ext=kind==='image/jpeg'?'jpg':kind==='image/png'?'png':'webp',key=`visual-sources/${sha256}.${ext}`;return {key,sha256,mime:kind,source_message_id:image.source_message_id,caption:image.caption,bytes:image.bytes}}));
   const base={version:1 as const,source_message_ids:input.source_message_ids,owner_message_id:input.message_id,owner_text:input.owner_text,source_text:input.source_text,instructions:input.instructions,submitted_at:input.submitted_at,edit_context:input.edit_context??null,assets:assets.map(({bytes,...a})=>a)},binding=await requestBinding(base),request:VisualRequest={...base,binding,request_id:binding};await validateVisualRequest(request);
   const analysis=await call('analyze',{request,assets:assets.map(({bytes,...a})=>({...a,base64:Buffer.from(bytes).toString('base64')}))},Date.now()/1000+480)as VisualAnalysis;validateVisualAnalysis(request,analysis);
   for(const asset of assets)await env.MEDIA.put(asset.key,asset.bytes,{httpMetadata:{contentType:asset.mime}});
   const facts=analysis.facts.map(f=>({id:f.id,text:f.label+': '+f.value}));const additions=analysis.operations.filter(o=>['add','title','date','time'].includes(o.kind)&&o.value!==null).map(o=>({id:'owner_'+o.id,text:'Kullanıcının açık düzenleme beyanı: '+(o.label??o.kind)+': '+o.value+' ('+o.quote+')'}));
   return [{source_id:'manual-input',source_name:'Gönderdiğin görsel/veri',family:'owner-submitted',official:false,url:'https://t.me/habernewssbot?start=source_'+input.source_message_ids[0]+'#visual-'+binding,title:analysis.facts[0].label,body:[...facts,...additions].map(f=>f.text).join('\n'),passages:[...facts,...additions,{id:'visual_source',text:'Kaynakta okunan değerler: ' + facts.map(f=>f.text).join('; ')}],published_at:null,owner_visual:{version:1,request,analysis}}as Document];
  },
  async revise(documents,request,context){
   const own=visualDocument(documents);if(!own)throw Error('owner_visual_source_missing');const assets=await visualAssets(env,own.request);const instructions=[own.request.instructions,'Yeni düzenleme (öncelikli): '+request].filter(Boolean).join('\n');if(instructions.length>12000)throw Error('owner_visual_instruction_limit');
   return runtime.analyze({kind:assets.length?'image':'text',message_id:context.owner_message_id??own.request.owner_message_id,source_message_ids:own.request.source_message_ids,owner_text:request,source_text:own.request.source_text,instructions,submitted_at:Math.floor(Date.now()/1000),edit_context:{draft_id:context.draft_id,revision:context.revision},images:assets.map(a=>({bytes:Uint8Array.from(Buffer.from(a.base64,'base64')),source_message_id:a.source_message_id,caption:a.caption}))});
  },
  async render(job:VisualLease,draft:Draft){
   const own=visualDocument(job.documents);if(!own)throw Error('owner_visual_source_missing');await validateVisualRequest(own.request);validateVisualAnalysis(own.request,own.analysis);const assets=await visualAssets(env,own.request),spec=authorizedVisualSpec(draft,own.analysis);
   const result=await call('render',{request:own.request,assets,job:{id:job.id,lease_token:job.lease_token,input_hash:job.input_hash,expected_revision:job.expected_revision??0},draft,spec,references},job.deadline);await assertVisualReceipt(job,draft,result.visual_result,result.cards);return result;
  }
 };return runtime;
}
export async function renderModelJob(env:Env,job:VisualLease,draft:Draft,renderCode:()=>Promise<{svg_hash:string;png_base64:string}[]>){if(env.KAP_GENERAL_IMAGE&&kapNews(draft,job.documents))return {cards:[]};if(env.NEWS_GENERAL_IMAGES&&newsArtworkEligible(draft,job.documents))return {cards:[]};if(!visualDocument(job.documents))return {cards:await renderCode()};if(!env.OWNER_VISUAL?.enabled)throw Error('owner_visual_api_disabled');return env.OWNER_VISUAL.render(job,draft);}
