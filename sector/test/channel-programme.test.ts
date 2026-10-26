import test from 'node:test';import assert from 'node:assert/strict';import{channelProgramme}from'../src/channel-programme';
test('owner channel slots use Istanbul original publication and keep holidays/unknown calendars neutral',()=>{
 for(const [t,k]of [['09:40','theoretical_open'],['09:52','theoretical_open'],['18:02','theoretical_close'],['18:04','theoretical_close']]as const){const p=channelProgramme(`2026-10-26T${t}:00+03:00`,'Teorik Eşleşme');assert.equal(p?.kind,k);assert.equal(new Date(p!.preview_after!).toISOString(),`2026-10-26T${k==='theoretical_open'?'06:53':'15:05'}:00.000Z`);}
 for(const [t,k]of [['09:55','opening'],['10:01','first_moves'],['12:01','summary'],['18:11','close']]as const)assert.equal(channelProgramme(`2026-10-26T${t}:00+03:00`,'BIST 100')?.kind,k);
 assert.equal(channelProgramme('2026-10-26T12:01:00+03:00','Kurum AKD Özeti')?.kind,'institution_summary');
 assert.equal(channelProgramme('2026-10-26T10:01:00+03:00','Şirket sözleşme imzaladı'),null);
 assert.equal(channelProgramme('2026-10-25T10:01:00+03:00','BIST 100'),null);
 assert.equal(channelProgramme('2027-10-26T10:01:00+03:00','BIST 100'),null);
 assert.equal(channelProgramme('2026-10-26T10:01:00+03:00','BIST 100',undefined,true),null);
});
