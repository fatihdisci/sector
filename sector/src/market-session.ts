import calendar from'./data/bist-equity-session-2026.json';
export const EDITORIAL_PERIODS=['Güne başlarken','Açılışın ilk dakikaları','Gün ortası','Kapanışa doğru','Kapanışta']as const;
export function equitySessionLabel(at:string|null,table:typeof calendar|null=calendar){
 const base={label:null as string|null,kind:'unknown',reason:'session_unknown',version:table?.version??null,basis:'original_channel_publication_time',measurement_time_verified:false};
 if(!at||!/(?:Z|[+-]\d{2}:\d{2})$/i.test(at)||!Number.isFinite(Date.parse(at)))return{...base,reason:'publication_time_invalid'};
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(at)),part=(key:string)=>parts.find(p=>p.type===key)!.value;
 const date=part('year')+'-'+part('month')+'-'+part('day'),minute=Number(part('hour'))*60+Number(part('minute'));
 if(!table||Number(part('year'))!==table.year)return{...base,reason:'calendar_year_unknown'};
 const weekday=new Date(date+'T12:00:00Z').getUTCDay();
 if(weekday===0||weekday===6||table.closed.includes(date))return{...base,kind:'closed',reason:'market_closed'};
 const half=table.half.includes(date),s=half?table.half_session:table.full,kind=half?'half':'full';
 if(minute<s.start||minute>=s.end)return{...base,kind,reason:'outside_session'};
 const label=minute<s.continuous_start?EDITORIAL_PERIODS[0]:minute<s.closing_start?(minute<table.editorial.opening_until?EDITORIAL_PERIODS[1]:half?EDITORIAL_PERIODS[3]:minute<table.editorial.midday_until?EDITORIAL_PERIODS[2]:EDITORIAL_PERIODS[3]):EDITORIAL_PERIODS[4];
 return{...base,kind,label,reason:'owner_editorial_label'};
}
