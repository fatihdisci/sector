/** Owner-approved scheduled-selection policy carried by a maintenance artifact. */
export const HOURLY_SELECTION_SCHEDULE={
 timezone:'Europe/Istanbul',
 times:Array.from({length:24},(_,hour)=>`${String(hour).padStart(2,'0')}:00`),
 quiet_hours:{start:0,end:8},
} as const;
export function selectionIsQuiet(now:number){
 const hour=new Date(now+3*60*60_000).getUTCHours();
 return hour>=HOURLY_SELECTION_SCHEDULE.quiet_hours.start&&hour<HOURLY_SELECTION_SCHEDULE.quiet_hours.end;
}
