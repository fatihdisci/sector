import test from 'node:test';import assert from 'node:assert/strict';import{channelProgramme}from'../src/channel-programme';
test('owner channel slots use Istanbul original publication and keep holidays/unknown calendars neutral',()=>{
 for(const [t,k]of [['09:40','theoretical_open'],['09:52','theoretical_open'],['18:02','theoretical_close'],['18:04','theoretical_close']]as const){const p=channelProgramme(`2026-10-26T${t}:00+03:00`,'Teorik Eşleşme');assert.equal(p?.kind,k);assert.equal(p!.preview_after,null);}
 for(const [t,k]of [['09:55','opening'],['10:01','first_moves'],['12:01','summary'],['18:11','close']]as const)assert.equal(channelProgramme(`2026-10-26T${t}:00+03:00`,'BIST 100')?.kind,k);
 assert.equal(channelProgramme('2026-10-26T12:01:00+03:00','Kurum AKD Özeti')?.kind,'institution_summary');
 assert.equal(channelProgramme('2026-10-26T10:01:00+03:00','Şirket sözleşme imzaladı'),null);
 assert.equal(channelProgramme('2026-10-25T10:01:00+03:00','BIST 100'),null);
 assert.equal(channelProgramme('2027-10-26T10:01:00+03:00','BIST 100'),null);
 assert.equal(channelProgramme('2026-10-26T10:01:00+03:00','BIST 100',undefined,true),null);
});
test('owner full-day headers are distinct and half days never claim two hours to close',()=>{
 for(const [time,label] of [['09:55','Açılış öncesi görünüm'],['10:01','Açılışın ilk anları'],['11:00','İlk saatin ardından'],['12:00','Gün ortası'],['14:00','Öğleden sonra'],['16:00','Kapanışa iki saat kala'],['17:00','Kapanışa doğru'],['18:11','Gün sonu']] as const)assert.equal(channelProgramme(`2026-10-26T${time}:00+03:00`,'BIST 100')?.label,label,time);
 for(const t of ['11:00','12:00','14:00','16:00','17:00'])assert.notEqual(channelProgramme(`2026-10-28T${t}:00+03:00`,'BIST 100')?.label,'Kapanışa iki saat kala');
 assert.equal(channelProgramme('2026-10-29T16:00:00+03:00','BIST 100'),null);
 assert.equal(channelProgramme('2026-10-26T16:01:00+03:00','Kurum AKD Özeti')?.label,'Kurum AKD özeti');
 assert.equal(channelProgramme('2026-10-26T09:52:00+03:00','Teorik Eşleşme')?.label,'Açılış öncesi teorik eşleşme');
});
