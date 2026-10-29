import type {Draft,Document,Env} from './types';
import {callback} from './approval';
import {CARD_LAYOUTS} from './card-layout';
export type Button={text:string;callback_data?:string;url?:string};
export type Markup={inline_keyboard:Button[][]};
export type DraftView='main'|'more'|'layouts';
export type PublicationState={published?:boolean;deferred?:boolean;manual?:boolean;api?:string;published_at?:number|null;due_at?:number|null};
export const sourceButton=(docs:Document[]):Button=>{const value=docs[0]?.url;if(!value)throw Error('source_url_missing');const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw Error('source_url_invalid');return {text:'Kaynağı aç',url:value};};
export async function publicationState(env:Env,id:string):Promise<PublicationState>{
 const mark=await env.DB.prepare('SELECT state,published_at FROM publication_marks WHERE draft_id=?').bind(id).first<{state:string;published_at:number|null}>();
 const api=await env.DB.prepare("SELECT x.state,x.finished_at,s.due_at FROM x_posts x LEFT JOIN x_schedules s ON s.post_id=x.id WHERE x.draft_id=? AND x.state IN ('queued','uploading','posting','sent','uncertain') ORDER BY CASE WHEN x.state='sent' THEN 0 ELSE 1 END,x.created_at DESC LIMIT 1").bind(id).first<{state:string;finished_at:number|null;due_at:number|null}>();
 return {published:api?.state==='sent'||mark?.state==='published',deferred:mark?.state==='deferred',manual:mark?.state==='published'&&api?.state!=='sent',api:api?.state,due_at:api?.due_at,published_at:api?.state==='sent'?api.finished_at:mark?.published_at};
}
export function draftKeyboard(id:string,revision:number,docs:Document[],publish:boolean,draft?:Draft,state:PublicationState={},view:DraftView='main',editable=true):Markup{
 for(const doc of docs)sourceButton([doc]);sourceButton(docs);
 const menu=(action:string,text:string):Button=>({text,callback_data:`dm:${action}:${id}:${revision}`});
 const pub=(action:string,text:string):Button=>({text,callback_data:`dp:${action}:${id}:${revision}`});
 const more=menu('more','Diğer'),back=menu('main','Geri'),locked=state.published||!!state.api;
 if(view==='main')return {inline_keyboard:[state.api==='queued'?[{text:state.due_at?`İptal · ${new Date(state.due_at).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul',dateStyle:'short',timeStyle:'short'})}`:'Paylaşımı iptal et',callback_data:`xcancel:${id}:${revision}`},more]:locked?[menu('summary','Yayın özeti'),more]:state.deferred?[pub('undo','Hazıra al'),more]:[...(publish&&editable?[{text:'X’te paylaş',callback_data:`xpost:${id}:${revision}`}]:[]),...(editable&&!draft?.automated_daily&&draft?.tweet_style!=='owner_ready'?[{text:'Düzenle',callback_data:callback('edit',id,revision)}]:[]),more]]};
 const layouts=editable&&!draft?.automated_daily&&draft?.tweet_style!=='owner_ready'&&!locked&&draft?.template!=='circuit'&&!draft?.card_data?.report&&!draft?.card_data?.overview;
 if(view==='layouts'&&layouts)return {inline_keyboard:[[{text:'Rastgele tasarım',callback_data:`design:${id}:${revision}`}],...CARD_LAYOUTS.map(l=>[{text:({editorial:'Standart',frame:'Çerçeveli',rail:'Sol şeritli',masthead:'Başlık bloğu',center:'Ortalanmış',brief:'Kısa haber'})[l],callback_data:`design:${id}:${revision}:${l}`}]),[back]]};
 const rows:Button[][]=[[sourceButton(docs)]];
 if(layouts)rows.push([menu('layouts','Tasarımı değiştir')]);
 rows.push([{text:'PNG indir',callback_data:`asset:image:${id}:${revision}`}]);
 if(editable&&!locked)rows.push([pub('mark','Elle paylaştım'),...(!state.deferred?[pub('defer','Ertele')]:[])]);
 if(editable)rows.push([{text:'Kanıtlar',callback_data:`ed:evidence:${id}:${revision}`}]);
 const data=draft?.card_data,table=!!data&&(!!data.report||!!data.overview||!!data.tickers?.length||['buy','sell','holdings','metrics'].some(k=>(data as any)[k]?.length));
 if(table&&editable)rows.push([{text:'Tablo verileri',callback_data:`ed:data:${id}:${revision}`}]);
 if(editable&&!locked&&!data?.report&&['buy','sell','holdings','metrics'].some(k=>(data as any)?.[k]?.length))rows.push([{text:'Hücre düzelt',callback_data:`ed:correct:${id}:${revision}`}]);
 if(data?.report?.general||data?.report?.buyback)rows.push([{text:'CSV indir',callback_data:`asset:csv:${id}:${revision}`}]);
 if(editable&&state.manual&&!state.api)rows.push([pub('time','Manuel saati düzelt'),pub('undo','İşareti geri al')]);
 rows.push([back]);return {inline_keyboard:rows};
}
export function newsKeyboard(id:string,url:string,choice:string|null=null,view:'main'|'more'='main',retryRevision?:number,detailed=true):Markup{
 const button=(text:string,callback_data:string):Button=>({text,callback_data});
 if(view==='main')return {inline_keyboard:[[button('İçerik oluştur','news:'+id)],[button('❤️'+(choice==='like'?' ✓':''),'ni:l:'+id),button('👎'+(choice==='dislike'?' ✓':''),'ni:d:'+id),button('Diğer','nm:more:'+id)]]};
 return {inline_keyboard:[[sourceButton([{url}] as Document[])],...(detailed?[[button('Tekrar haber','nf:repeat:'+id),button('Acil değil','nf:digest:'+id)]]:[]),...(retryRevision?[ [button('Yeniden gönder (çift olabilir)',`newsretry:${id}:${retryRevision}`)] ]:[]),[button('Geri','nm:main:'+id)]]};
}
