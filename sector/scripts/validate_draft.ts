// Local deterministic preflight. Source text stays in stdin; no network calls.
import {draftCards} from '../src/card-pages';
import {CARD_LAYOUTS} from '../src/card-layout';
import {repairDraftStyle} from '../src/style';
import {validateDraft,numericIssues,postText} from '../src/editorial';
import {repairEvidenceReferences,evidenceIssues} from '../src/evidence-references';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>4_000_000)throw Error('input_limit');}
try {
 const {draft,documents}=JSON.parse(input);
 if(process.argv.includes('--normalize')){process.stdout.write(JSON.stringify(repairDraftStyle(repairEvidenceReferences(draft,documents),documents)));process.exit(0);}
 const issues=[...evidenceIssues(draft,documents),...numericIssues(draft,documents)];
 if(postText(draft).length>1024)issues.push('output_capacity_exceeded','capacity_detail:'+JSON.stringify({stage:'caption',code:'caption_too_long',length:postText(draft).length,limit:1024}));
 try{if(validateDraft(draft,documents).verification==='needs_review')issues.push('Taslakta çözülmemiş belirsizlik var. Etkilenen olguyu kaynaklardan çöz veya doğrulanabilir çekirdek haberi seç. Çelişkiyi tahminle düzeltme; aktarılan olguyu hâlâ etkiliyorsa uncertainties korunsun. Yalnız hiç aktarılmayan ikincil alanın kaynak sorunuysa source_notes içinde kaydet.');}catch(e){
  const code=e instanceof Error?e.message:'invalid_draft';issues.push(code);
  if(code==='incomplete_draft'){
   const missing:string[]=[];
   if(typeof draft?.headline!=='string'||!draft.headline.trim())missing.push('headline');
   if(typeof draft?.body!=='string')missing.push('body');
   if(!Array.isArray(draft?.claims)||!draft.claims.length)missing.push('claims');
   if(!Array.isArray(draft?.hashtags)||draft.hashtags.length<2)missing.push('hashtags');
   if(!Array.isArray(draft?.entities)||!draft.entities.length)missing.push('entities');
   if(!Array.isArray(draft?.uncertainties))missing.push('uncertainties');
   if(!Number.isInteger(draft?.importance)||draft.importance<0||draft.importance>100)missing.push('importance');
   if(typeof draft?.event_key!=='string'||!draft.event_key.trim())missing.push('event_key');
   if(missing.length)issues.push('Zorunlu taslak alanları eksik veya geçersiz: '+missing.join(', ')+'. entities için yalnız kaynakta açıkça geçen ilgili isimleri veya kodları kullan; veri uydurma.');
  }
 }
 if(draft?.card_data&&(draft.card_data.overview||['circuit','institutional','akd','volume','broker_flow','custody'].includes(draft.template)))for(const layout of CARD_LAYOUTS)try{draftCards(draft,'navy',layout);}catch(e){
  const code=e instanceof Error&&/^[a-z_]{3,80}$/.test(e.message)?e.message:'render_failed';
  const lengths=Object.fromEntries(['headline','body','card_headline','card_body'].map(k=>[k,typeof draft[k]==='string'?draft[k].length:0]));
  const rows=Object.fromEntries(['buy','sell','holdings','metrics','tickers'].map(k=>[k,Array.isArray(draft.card_data[k])?draft.card_data[k].length:0]));
  issues.push('output_capacity_exceeded','capacity_detail:'+JSON.stringify({stage:'card',layout,code,lengths,rows}));
 }
 process.stdout.write(JSON.stringify([...new Set(issues)]));
}catch{process.stdout.write(JSON.stringify(['invalid_validation_input']));}
