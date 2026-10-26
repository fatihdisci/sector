import {equitySessionLabel} from './market-session';
import type {Document} from './types';
export type ChannelProgrammeKind='opening'|'first_moves'|'summary'|'close'|'institution_summary'|'theoretical_open'|'theoretical_close'|'theoretical';
export interface ChannelProgramme {version:1;kind:ChannelProgrammeKind;label:string;basis:'owner_channel_programme';original_at:string;preview_after:number|null;}
const fold=(s:string)=>s.toLocaleLowerCase('tr-TR').replace(/ı/g,'i').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
// These are the owner's channel publication slots, not new exchange session rules.
// Scan/retry/edit time cannot turn an old source into a different market phase.
export function channelProgramme(at:string,caption:string,layout?:string,forwarded?:boolean|null):ChannelProgramme|null{
 if(forwarded===true||!/(?:Z|[+-]\d{2}:\d{2})$/i.test(at)||!Number.isFinite(Date.parse(at)))return null;
 const session=equitySessionLabel(at);if(session.kind==='closed'||session.kind==='unknown')return null;
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)),part=(k:string)=>parts.find(p=>p.type===k)!.value;
 const day=part('year')+'-'+part('month')+'-'+part('day'),minute=Number(part('hour'))*60+Number(part('minute')),text=fold(caption);
 const result=(kind:ChannelProgrammeKind,label:string,release?:string):ChannelProgramme=>({version:1,kind,label,basis:'owner_channel_programme',original_at:at,preview_after:release?Date.parse(day+'T'+release+':00+03:00'):null});
 if(layout==='theoretical'||/teorik eslesme/.test(text)){
  if(minute>=580&&minute<595)return result('theoretical_open','Açılış öncesi teorik eşleşme','09:53');
  if(session.kind==='full'&&minute>=1080&&minute<1090)return result('theoretical_close','Kapanış öncesi teorik eşleşme','18:05');
  return result('theoretical','Teorik eşleşme');
 }
 if(layout==='institution_summary'||/kurum akd ozeti/.test(text))return result('institution_summary','Kurum AKD özeti');
 if(layout!=='market_overview'&&!/bist\s*100|piyasa raporu|genel piyasa ozeti/.test(text))return null;
 if(minute>=595&&minute<600)return result('opening','Borsa açılışı');
 if(minute>=600&&minute<610)return result('first_moves','Açılışın ilk anları');
 if(session.kind==='full'&&minute>=1091&&minute<1110)return result('close','Gün sonu');
 return result('summary',session.label??'Piyasa özeti');
}
export function documentProgramme(d:Document):ChannelProgramme|null{
 const p=d.channel_publication;
 if(d.source_id!=='sermaye-telegram'||!p||p.channel!=='SermayeBorsasi'||p.peer_id!==2426639373||d.url!==`https://t.me/SermayeBorsasi/${p.message_id}`||!/^[a-f0-9]{64}$/.test(p.version))return null;
 // Explicit source date/time or forwarding has precedence over the timetable.
 if(d.market_editorial_context?.reason==='explicit_source_time_precedes_publication'||d.market_editorial_context?.reason==='forwarded_source')return null;
 let caption=d.title;try{caption=JSON.parse(d.passages.find(p=>p.id==='channel_context')?.text??'{}').caption??caption;}catch{}
 return channelProgramme(p.posted_at,caption,d.source_layout?.kind,p.forwarded);
}
