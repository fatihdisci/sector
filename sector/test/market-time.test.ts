import test from'node:test';import assert from'node:assert/strict';import{execFileSync}from'node:child_process';import{marketTimeContext,marketTimeIssues}from'../src/market-time';import{editorialPolicy}from'../src/style';import{validateDraft}from'../src/editorial';import{acceptHermes}from'../src/ai';import{draftCards}from'../src/card-pages';import{png}from'../scripts/render_local';import type{Draft,Document}from'../src/types';
// Public message 26431 excerpt; original pixels inspected separately. Source
// dates/forward variants below are synthetic, not recovered production metadata.
const quote='BIST 100: 11.004,37 puan. Görselde değişim “%1,01 düşüşle” ve ayrıca -112,62 puan olarak verilmiş.';
const doc:Document={source_id:'sermaye-telegram',source_name:'Sermaye Borsası (@SermayeBorsasi)',official:false,family:'telegram-sermayeborsasi',language:'tr',url:'https://t.me/SermayeBorsasi/26431',title:'Sermaye Borsası kaynak görseli',published_at:'2026-10-26T11:00:03Z',body:quote,source_layout:{kind:'market_overview',panels:[],minimum_rows:0},passages:[{id:'image_normalized_2',text:quote},{id:'graph',text:'Grafik: BIST 100 hareketi; saat etiketleri 09:55, 13:25 ve 13:40.'},{id:'channel_context',text:JSON.stringify({message_id:26431,posted_at:'2026-10-26T11:00:03Z',edited_at:'2026-10-26T11:01:11Z',caption:'📈 BIST 100 — 14:00',version:'fixture-only'})}]};
const draft:Draft={headline:'📊 Kaynak tablosunda BIST 100',body:'Görselde endeks 11.004,37 puan, değişim %1,01 düşüş ve puan farkı -112,62 puan olarak gösteriliyor.',card_headline:'Kaynak tablosunda BIST 100',card_body:'Görselde endeks 11.004,37 puan; değişim %1,01 düşüş, puan farkı -112,62 puan.',template:'market',category:'bist',importance:65,hashtags:['#Borsa','#BIST'],entities:['BIST 100'],event_key:'fixture-source-snapshot',uncertainties:[],source_notes:['Görselde veri tarihi yok. Kanalın yayın zamanı veri tarihi değildir; ölçüm tarihi veya güncellik iddiası kurulmadı.'],claims:[{text:'Kaynak görselinde BIST 100 11.004,37 puan, değişim %1,01 düşüş ve puan farkı -112,62 puan olarak yer alıyor.',evidence:[{document:0,passage:'image_normalized_2',quote}]}]};
function withDate(text:string,forwarded?:boolean){return{...doc,body:doc.body+'\n'+text,passages:[...doc.passages.filter(p=>p.id!=='channel_context'),{id:'image_date',text},{id:'channel_context',text:JSON.stringify({message_id:26431,posted_at:doc.published_at,forwarded,forwarded_at:forwarded?'2026-10-23T10:00:00Z':null,caption:'BIST 100 — 14:00'})}]};}
test('actual stored provenance proves publication/edit times, not the measurement date or forward state',()=>{
 const c=marketTimeContext([doc])[0];assert.equal(c.publication_day,'2026-10-26');assert.equal(c.data_day_status,'unknown');assert.equal(c.forward_state,'unknown');assert.equal(c.measurement_time,null);assert.equal(c.caption_time,'14:00');assert.equal(c.graph_last_label,'13:40');assert.equal(c.independent_date_verification,false);
 const cap={...doc,body:doc.body+'\nYayın tarihi: 26 Ekim 2026',passages:[...doc.passages,{id:'not_data_date',text:'Yayın tarihi: 26 Ekim 2026'}]};assert.equal(marketTimeContext([cap])[0].data_day_status,'unknown');
});
test('explicit source data date can agree with publication day, without treating message metadata as independent verification',()=>{
 const d=withDate('VERİ TARİHİ: 26 EKİM 2026',false),c=marketTimeContext([d])[0];assert.deepEqual(c.source_data_days,['2026-10-26']);assert.equal(c.same_as_publication_day,true);assert.equal(c.data_day_status,'source_labelled');assert.equal(c.independent_date_verification,false);assert(marketTimeIssues({...draft,card_data:{as_of:'26 Ekim 2026'}},[d]).includes('market_card_datetime_forbidden'));
 assert(marketTimeIssues({...draft,body:'Bugün endeks yükseldi.'},[d]).includes('unsupported_market_currentness'));
});
test('old/forwarded source keeps its labelled day and never borrows the channel publication date',()=>{
 const d=withDate('İşlem tarihi: 23.10.2026',true),c=marketTimeContext([d])[0];assert.equal(c.forward_state,'forwarded');assert.deepEqual(c.source_data_days,['2026-10-23']);assert.equal(c.same_as_publication_day,false);assert.equal(c.publication_day,'2026-10-26');
 assert(marketTimeIssues({...draft,card_data:{as_of:'26 Ekim 2026'}},[d]).includes('unsupported_market_data_day'));assert.deepEqual(marketTimeIssues(draft,[d]),[]);
 const undated={...d,passages:d.passages.filter(p=>p.id!=='image_date')};assert.equal(marketTimeContext([undated])[0].data_day_status,'unknown');
});
test('conflicting or invalid source days do not become a usable as-of date; caption and graph times are never measurement time',()=>{
 const d=withDate('Veri tarihi: 26 Ekim 2026\nÖlçüm tarihi: 23 Ekim 2026');assert.equal(marketTimeContext([d])[0].data_day_status,'conflict');assert(marketTimeIssues({...draft,card_data:{as_of:'26 Ekim 2026'}},[d]).includes('unsupported_market_data_day'));
 assert(marketTimeIssues(draft,[d]).includes('market_source_date_conflict'));const invalid=withDate('Veri tarihi: 31.02.2026');assert.equal(marketTimeContext([invalid])[0].data_day_status,'invalid');assert(marketTimeIssues(draft,[invalid]).includes('market_source_date_invalid'));
 assert(marketTimeIssues({...draft,card_data:{as_of:'14:00'}},[doc]).includes('unsupported_market_measurement_time'));assert(marketTimeIssues({...draft,body:'Kaynak tablosunda saat 13:40 itibarıyla değerler.'},[doc]).includes('unsupported_market_measurement_time'));
});
test('date-unknown static snapshot needs explicit source context in tweet and card; source numbers and evidence guards remain unchanged',()=>{
 assert.deepEqual(marketTimeIssues(draft,[doc]),[]);assert.equal(validateDraft(draft,[doc]).verification,'single_source_attributed');
 for(const text of['Bugün','Şimdi','Anlık','Güncel','Şu an'])assert(marketTimeIssues({...draft,body:text+' BIST 100'},[doc]).includes('unsupported_market_currentness'));
 assert(marketTimeIssues({...draft,headline:'📉 BIST 100 düşüşte',body:'Endeks 11.004,37 puanda.'},[doc]).includes('market_snapshot_attribution_required'));
 assert(marketTimeIssues({...draft,card_data:{metrics:[{label:'Bugün',value:'11.004,37 puan'}]}},[doc]).includes('unsupported_market_currentness'));
 assert(marketTimeIssues({...draft,body:'Kaynak tablosunda 26 Ekim değerleri.'},[doc]).includes('unsupported_market_data_day'));
 assert.throws(()=>validateDraft({...draft,body:'Görselde endeks 99.999,99 puan.'},[doc]),/unsupported_number_or_unit/);
 assert.throws(()=>acceptHermes(draft,{supported:false,issues:['unresolved']},[doc]),/semantic_review_failed/);
 assert.throws(()=>validateDraft({...draft,claims:[{...draft.claims[0],evidence:[{document:0,passage:'image_normalized_2',quote:'Bu alıntı kaynakta kesinlikle yoktur.'}]}]},[doc]),/invented_evidence/);
});
test('missing date is not automatically removed from uncertainties or hidden by normalization; preflight still rejects unresolved data',()=>{
 const d={...draft,uncertainties:['Görseldeki değerin dönemi ile açıklama çelişiyor.']};assert.equal(validateDraft(d,[doc]).verification,'needs_review');
 const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/validate_draft.ts'],{input:JSON.stringify({draft:d,documents:[doc]}),encoding:'utf8'}));assert(result.some((x:string)=>x.includes('çözülmemiş belirsizlik')));
 const datedUnknown={...draft,uncertainties:['Görselde açık tarih bulunmuyor; ölçümün hangi tarihe ait olduğu belirlenemiyor.']};assert.equal(validateDraft(datedUnknown,[doc]).verification,'needs_review');
 assert.deepEqual(d.uncertainties,['Görseldeki değerin dönemi ile açıklama çelişiyor.']);assert.equal(editorialPolicy([doc]).market_time![0].data_day_status,'unknown');
});
test('KAP, standard news and non-overview AKD flows are outside this narrow snapshot rule',()=>{
 for(const d of[{...doc,source_id:'kap',official:true},{...doc,source_id:'rss'},{...doc,source_layout:{kind:'institution_summary' as const,panels:[],minimum_rows:0}}]){assert.deepEqual(marketTimeContext([d]),[]);assert.deepEqual(marketTimeIssues(draft,[d]),[]);}
});
test('date-free source-attributed card renders a real PNG without inventing an as-of or footer',async()=>{
 const svg=draftCards(draft,'navy','editorial')[0];assert(svg.includes('Kaynak tablosunda'));assert(!svg.includes('26 Ekim'));assert(!svg.includes('14:00'));const image=await png(svg);assert(image.length>10000);assert.equal(new DataView(image.buffer,image.byteOffset).getUint32(16),1080);
});
