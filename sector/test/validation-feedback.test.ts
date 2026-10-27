import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('model repair feedback identifies an empty required entities field',()=>{
 const fact='Örnek Holding yeni tesis yatırımı planlıyor ve izin süreci devam ediyor.';
 const documents=[{source_id:'test',source_name:'Test',family:'test',official:false,url:'https://example.test',title:'Örnek Holding yatırım planını duyurdu',body:fact,passages:[{id:'p1',text:fact}],published_at:null}];
 const draft={headline:'📢 Örnek Holding yeni tesis planlıyor',body:'Yeni tesisin izin süreci henüz tamamlanmadı.',card_headline:'Örnek Holding yatırım planlıyor',card_body:'Yeni tesis için izin süreci sürüyor.',hashtags:['#Yatırım','#Sanayi'],category:'companies',importance:75,template:'company',claims:[{text:fact,evidence:[{document:0,passage:'p1',quote:fact}]}],entities:[],event_key:'ornek-yatirim',uncertainties:[]};
 const result=spawnSync(process.execPath,['--import','tsx','scripts/validate_draft.ts'],{input:JSON.stringify({draft,documents}),encoding:'utf8'});
 assert.equal(result.status,0);const issues=JSON.parse(result.stdout);assert(issues.includes('incomplete_draft'));assert(issues.some((issue:string)=>issue.includes('entities')));
});
