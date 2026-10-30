import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialPolicy,hasPublisherAttribution,styleIssues} from '../src/style';
import type {Document,Draft} from '../src/types';
const doc=(v:Partial<Document>):Document=>({source_id:'test',source_name:'CNBC-e',family:'test',official:false,url:'https://example.test',title:'Haber',body:'Haber içeriği',passages:[],published_at:null,...v});
test('verified KAP equity uses Borsa, BIST and exact main code',()=>{
 assert.deepEqual(editorialPolicy([doc({official:true,source_id:'kap',equity_codes:['THYAO'],body:'Şirket yeni sözleşmesini duyurdu.'})]).required_hashtags,['#Borsa','#BIST','#THYAO']);
 assert.deepEqual(editorialPolicy([doc({body:'BIST: TUREX pay geri alımı yaptı.'})]).required_hashtags,['#Borsa','#BIST','#TUREX']);
 assert.deepEqual(editorialPolicy([doc({equity_codes:['THYAO','TAVHL']})]).required_hashtags,['#Borsa','#BIST','#THYAO','#TAVHL']);
});
test('foreign equities and acronyms do not invent BIST tickers',()=>{
 assert.deepEqual(editorialPolicy([doc({title:'Tesla ve SpaceX birleşme ihtimali',body:'NASDAQ, NASA ve CNBC gelişmeyi takip ediyor.'})]).required_hashtags,[]);
 assert.deepEqual(editorialPolicy([doc({title:'Borsa İstanbul yükseldi',body:'SPK ve TCMB açıklama yaptı.'})]).required_hashtags,['#Borsa','#BIST']);
});
test('publisher attributions are rejected while true speaker and uncertainty remain valid',()=>{
 for(const text of ['CNBC-e’nin haberine göre birleşme gündemde.','Reuters’a göre şirket plan hazırlıyor.','Kaynak: Bloomberg HT','CNBC-e aktardığına göre yeni karar açıklandı.'])assert(hasPublisherAttribution(text,['CNBC-e','Reuters','Bloomberg HT']),text);
 for(const text of ['Musk, birleşme ihtimalini gündeme getirdi.','Şirket, işlemin onaya bağlı olduğunu açıkladı.','Birleşme planlandığı iddia edildi.','CNBC yeni yayın merkezini açacağını duyurdu.'])assert(!hasPublisherAttribution(text,['CNBC']),text);
 const draft={headline:'Şirket sözleşme imzaladı',body:'Açıklama yapıldı.',card_headline:'Yeni sözleşme',card_body:'Açıklama yapıldı.',hashtags:['#Borsa','#BIST','#THYAO']} as Draft;
 assert.deepEqual(styleIssues(draft,[doc({equity_codes:['THYAO']})]),[]);
 assert(styleIssues({...draft,hashtags:['#Şirket','#Yatırım']},[doc({equity_codes:['THYAO']})]).includes('missing_market_hashtags'));
});

import {headlineWithEmoji,invalidEmojiPlacement} from '../src/style';
test('one leading emoji only; body, tags, card text and trailing or compound emoji are rejected',()=>{
 const d={headline:'📢 Şirket yeni yatırımını açıkladı',body:'İzin süreci devam ediyor.',card_headline:'Yeni yatırım planı',card_body:'İzin süreci sürüyor.',hashtags:['#Borsa','#BIST']} as Draft;
 assert.equal(headlineWithEmoji('Şirket yatırım planlıyor'),'📢 Şirket yatırım planlıyor');
 assert.equal(headlineWithEmoji(d.headline),d.headline);
 assert.equal(invalidEmojiPlacement(d),false);
 assert.equal(invalidEmojiPlacement({...d,headline:'🚨 Acil açıklama yapıldı'}),false);
 for(const change of [{headline:'📢🚨 Açıklama'},{headline:'Açıklama 📢'},{headline:'📢 Açıklama 🚨'},{body:'Açıklama 📊'},{card_body:'📈 Yatırım arttı'},{hashtags:['#Borsa','📢#BIST']},{headline:'🇹🇷 Açıklama'},{headline:'👩‍💻 Açıklama'}])assert(invalidEmojiPlacement({...d,...change}));
});
test('fund categories override equity tags and do not match unrelated word fragments',()=>{
 assert.deepEqual(editorialPolicy([doc({title:'Fon tasfiyesi açıklandı',equity_codes:['TEST']})]).required_hashtags,['#Fon','#Tasfiye']);
 for(const title of ['Yatırım fonlarının getirisi','Fonların ödeme süreci','TEFAS işlemleri','PBLK açıklaması','Şirket tasfiyesi'])assert(!editorialPolicy([doc({title,equity_codes:['TEST']})]).required_hashtags.some(t=>['#Fon','#Tasfiye','#PBLK'].includes(t)));
 for(const title of ['Telefon satışları arttı','Şirket fonlama sağladı','Yeni fonksiyon duyuruldu'])assert.deepEqual(editorialPolicy([doc({title})]).required_hashtags,[]);
});

test('KAP empty fund fields and buyback budgets do not override company tags',()=>{
 const body='İlgili Fonlar\nRelated Funds\n[]\nGeri Alım İçin Ayrılan Fonun Toplam Tutarı (TL): 1.400.000.000';
 for(const [title,code] of [['BÜLBÜLOĞLU VİNÇ — Yeni İş İlişkisi','BVSAN'],['CVK MADEN — Payların Geri Alınmasına İlişkin Bildirim','CVKMD']]){
  assert.deepEqual(editorialPolicy([doc({source_id:'kap',official:true,title,body,equity_codes:[code]})]).required_hashtags,['#Borsa','#BIST','#'+code]);
 }
 assert.deepEqual(editorialPolicy([doc({source_id:'kap',title:'Özel Durum Açıklaması',body:'Yatırım fonlarının tasfiye sürecine ilişkin açıklama.',equity_codes:['TEST']})]).required_hashtags,['#Fon','#Tasfiye']);
});
test('recent IPO KAP tickers require exactly one final HalkaArz hashtag',()=>{
 const source=doc({source_id:'kap',official:true,title:'KPEKS — Payların Geri Alınmasına İlişkin Bildirim',equity_codes:['KPEKS']});
 assert.deepEqual(editorialPolicy([source]).required_hashtags,['#Borsa','#BIST','#KPEKS','#HalkaArz']);
 const draft=repairDraftStyle({...groundedDraft,hashtags:['#Şirket','#KPEKS','#HalkaArz','#HalkaArz']},[source]);
 assert.deepEqual(draft.hashtags,['#Borsa','#BIST','#KPEKS','#HalkaArz']);
 assert.equal(draft.hashtags.filter(t=>t==='#HalkaArz').length,1);
 const nonIpo=doc({...source,equity_codes:['THYAO']});assert(!editorialPolicy([nonIpo]).required_hashtags.includes('#HalkaArz'));
});

import {repairDraftStyle} from '../src/style';
import {postText,validateDraft} from '../src/editorial';
const fact='Örnek Holding yeni tesis yatırımı planlıyor ve izin süreci devam ediyor.';
const groundedDocument=doc({title:'Örnek Holding yatırım planını duyurdu',body:fact,passages:[{id:'p1',text:fact}]});
const groundedDraft:Draft={headline:'📢 Örnek Holding yeni tesis planlıyor',body:'Yeni tesisin izin süreci henüz tamamlanmadı.',card_headline:'Örnek Holding yatırım planlıyor',card_body:'Yeni tesis için izin süreci sürüyor.',hashtags:['#Yatırım','#Sanayi'],category:'companies',importance:75,template:'company',claims:[{text:fact,evidence:[{document:0,passage:'p1',quote:fact}]}],entities:['Örnek Holding'],event_key:'ornek-yatirim',uncertainties:[]};
test('model hashtag paragraphs are consolidated once across normalization, caption and copy text',()=>{
 const d={...groundedDraft,body:groundedDraft.body+'\n\n#Yatırım #Sanayi\n#yatırım #Sanayi',hashtags:['#Yatırım','#yatırım','#Sanayi']};
 const fixed=repairDraftStyle(d,[groundedDocument]);
 assert.equal(fixed.body,groundedDraft.body);assert.deepEqual(fixed.hashtags,['#Yatırım','#Sanayi']);
 assert.deepEqual(repairDraftStyle(fixed,[groundedDocument]),fixed);
 assert.equal(postText(d),postText(fixed));
 assert.equal((postText(d).match(/#Yatırım/gi)??[]).length,1);
 assert.throws(()=>validateDraft({...d,hashtags:fixed.hashtags},[groundedDocument]),/misplaced_hashtags/);
 assert.doesNotThrow(()=>validateDraft(fixed,[groundedDocument]));
});
test('inline ticker wording survives while trailing hashtag labels and duplicates are removed',()=>{
 const d={headline:'📢 #THYAO sözleşme imzaladı',body:'#THYAO sözleşme imzaladı. #Borsa #BIST\n\nEtiketler: #Borsa #BIST #THYAO',hashtags:['#borsa','#BIST'],card_headline:'#THYAO sözleşmesi',card_body:'Süreç sürüyor.'} as Draft;
 const fixed=repairDraftStyle(d,[doc({equity_codes:['THYAO']})]);
 assert.equal(fixed.headline,'📢 THYAO sözleşme imzaladı');assert.equal(fixed.body,'THYAO sözleşme imzaladı.');assert.equal(fixed.card_headline,'THYAO sözleşmesi');
 assert.deepEqual(fixed.hashtags,['#Borsa','#BIST','#THYAO']);assert.deepEqual(repairDraftStyle(fixed,[doc({equity_codes:['THYAO']})]),fixed);
});
test('source-backed circuit group tickers and alphanumeric codes are all preserved',()=>{
 const docs=['DUNYH','AKSUE'].map(code=>doc({official:true,source_id:'kap',title:'Pay Bazında Devre Kesici Bildirimi',equity_codes:[code]}));
 const expected=['#Borsa','#BIST','#DUNYH','#AKSUE'];
 assert.deepEqual(editorialPolicy(docs).required_hashtags,expected);
 const fixed=repairDraftStyle({...groundedDraft,hashtags:['#Borsa','#BIST','#DevreKesici','#FAKE']},docs);
 assert.deepEqual(fixed.hashtags,expected);assert.deepEqual(styleIssues(fixed,docs),[]);
 assert.deepEqual(editorialPolicy([doc({equity_codes:['sise','SISE','A1CAP','A2','XU1000']})]).verified_equity_codes,['SISE','A1CAP']);
 assert.deepEqual(editorialPolicy([doc({body:'BIST: A1CAP açıklama yaptı.'})]).required_hashtags,['#Borsa','#BIST','#A1CAP']);
});
test('grouped circuit validation permits only source-mandated extra tags and preserves URL fragments',()=>{
 const docs=['DUNYH','AKSUE'].map(code=>doc({...groundedDocument,official:true,source_id:'kap',title:'Pay Bazında Devre Kesici Bildirimi',equity_codes:[code]}));
 const fixed=repairDraftStyle(groundedDraft,docs);
 assert.doesNotThrow(()=>validateDraft(fixed,docs));
 assert.throws(()=>validateDraft({...fixed,hashtags:[...fixed.hashtags,'#Fazla']},docs),/incomplete_draft/);
 const link='https://example.org/news#section';
 assert.equal(repairDraftStyle({...groundedDraft,body:link},[groundedDocument]).body,link);
});
test('KAP company attachments do not turn financial reports into fund stories',()=>{
 const docs=[doc({source_id:'kap',official:true,title:'Finansal Rapor',equity_codes:['KLGYO']}),doc({source_id:'kap_pdf',official:true,title:'Bilanço eki',body:'Şirket fon kaynaklarını ve yatırım fonlarını muhasebe dipnotunda açıkladı.'})];
 assert.deepEqual(editorialPolicy(docs).required_hashtags,['#Borsa','#BIST','#KLGYO']);
 const original={headline:'Kiler finansal sonuçlarını açıkladı',body:'Faaliyet sonuçları duyuruldu.',hashtags:['#Fon','#PBLK','#Tasfiye']} as Draft;
 const fixed=repairDraftStyle(original,docs);
 assert.deepEqual(fixed.hashtags,['#Borsa','#BIST','#KLGYO']);assert.equal(fixed.body,original.body);
 assert.deepEqual(repairDraftStyle(fixed,docs),fixed);assert.deepEqual(original.hashtags,['#Fon','#PBLK','#Tasfiye']);
});
test('missing mandatory tags are repaired without a model call or invented ticker',()=>{
 const d={headline:'Yatırım açıklaması',hashtags:['#Yeni Yatırım','#İş-Dünyası']} as Draft;
 assert.deepEqual(repairDraftStyle(d,[doc({equity_codes:['THYAO']})]).hashtags,['#Borsa','#BIST','#THYAO']);
 assert.deepEqual(repairDraftStyle(d,[doc({title:'Fon tasfiyesi'})]).hashtags,['#Fon','#Tasfiye','#YeniYatırım']);
 assert.deepEqual(repairDraftStyle(d,[doc({title:'Tesla yatırım planlıyor'})]).hashtags,['#YeniYatırım','#İşDünyası']);
});
test('verified equity .E suffix is removed from visible text and table cells without changing evidence',()=>{
 const source=doc({source_id:'kap',official:true,equity_codes:['KARCL','A1CAP'],title:'Devre Kesici Bildirimi',body:'KARCL.E işlem sırasında sürekli işleme ara verildi.'});
 const quote=source.body;
 const original={...groundedDraft,headline:'📢 KARCL.E’de devre kesici uygulandı',body:"KARCL.E'de emir toplama başladı. A1CAP.E işlem sırasında da ara verildi.",card_headline:'KARCL.E devre kesici',card_body:'KARCL.E için emir toplama başladı.',card_data:{ticker:'KARCL.E',buy:[{label:'KARCL.E',value:'100 adet'}]},claims:[{text:quote,evidence:[{document:0,passage:'p1',quote}]}]};
 const snapshot=JSON.stringify(source),fixed=repairDraftStyle(original,[source]);
 assert.equal(fixed.headline,'📢 KARCL’de devre kesici uygulandı');
 assert.equal(fixed.body,"KARCL'de emir toplama başladı. A1CAP işlem sırasında da ara verildi.");
 assert.equal(fixed.card_headline,'KARCL devre kesici');assert.equal(fixed.card_body,'KARCL için emir toplama başladı.');
 assert.equal(fixed.card_data?.ticker,'KARCL');assert.equal(fixed.card_data?.buy?.[0].label,'KARCL');
 assert.deepEqual(fixed.claims,original.claims);assert.equal(JSON.stringify(source),snapshot);
 assert.equal(original.card_data.ticker,'KARCL.E');assert.deepEqual(repairDraftStyle(fixed,[source]),fixed);
 assert(styleIssues(original,[source]).includes('market_suffix_in_display'));
});
test('equity display normalization does not strip other instruments, unknown codes or URL paths',()=>{
 const body='KARCL.TE temerrüt sırası; KARCL.EPS, YKARCL.E, OTHER.E; https://example.test/KARCL.E';
 const fixed=repairDraftStyle({...groundedDraft,body},[doc({equity_codes:['KARCL']})]);
 assert.equal(fixed.body,body);
});
test('circuit tickers lead the caption once and source-backed artwork metadata survives normalization',()=>{
 const docs=['TUPRS','THYAO','A1CAP'].map(code=>doc({source_id:'kap',official:true,title:'Pay Bazında Devre Kesici Bildirimi',equity_codes:[code]}));
 const d=repairDraftStyle({...groundedDraft,headline:'🚨 Devre kesici uygulandı',body:'Sürekli işleme ara verildi.',card_data:{tickers:['FAKE']}},docs);
 assert.deepEqual(d.card_data?.tickers,['TUPRS','THYAO','A1CAP']);
 const text=postText(d);assert.equal(text.split('\n')[0],'🚨 #tuprs #thyao #a1cap');
 assert(text.startsWith('🚨 #tuprs #thyao #a1cap\nDevre kesici uygulandı\n\n'));
 assert(text.endsWith('#Borsa #BIST'));for(const code of d.card_data!.tickers!)assert.equal(text.split('#'+code.toLowerCase()).length-1,1);
 assert.deepEqual(repairDraftStyle(d,docs),d);
});

test('fund and liquidation tags require both words in the relevant source; PBLK is not automatic',()=>{
 for(const title of ['Fon getirileri yükseldi','Şirket tasfiyesi başladı','TEFAS ödeme duyurusu','Telefon fonksiyonları']){const d=repairDraftStyle({...groundedDraft,hashtags:['#Fon','#Tasfiye','#PBLK']},[doc({title})]);assert(!d.hashtags.some(t=>['#Fon','#Tasfiye','#PBLK'].includes(t)),title);}
 const d=repairDraftStyle({...groundedDraft,hashtags:['#PBLK']},[doc({title:'Yatırım fonlarının tasfiyesi başladı'})]);assert.deepEqual(d.hashtags,['#Fon','#Tasfiye']);
 const optional=repairDraftStyle({...groundedDraft,hashtags:['#PBLK']},[doc({title:'PBLK fon tasfiyesi açıklandı'})]);assert(optional.hashtags.includes('#PBLK'));
});

test('trusted news source appears once as a final separate line; ready packages remain exact',async()=>{
 const {postText}=await import('../src/editorial');const d={...groundedDraft,news_source_name:'Bloomberg HT'};assert(postText(d).endsWith('\n\n-Bloomberg HT'));assert.equal(postText({...d,tweet_style:'owner_ready',body:'Birebir metin'}),'Birebir metin');assert.throws(()=>postText({...d,news_source_name:'unsafe\nforged'}),/news_source_unverified/);
});
