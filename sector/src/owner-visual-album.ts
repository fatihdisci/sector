import type {Env} from './types';
export interface ManualVisualRow {update_id:number;message_id:number;kind:string;input:string;attempts?:number;}
export async function collectVisualAlbum(env:Env,row:ManualVisualRow,nowMs=Date.now()):Promise<{input:string;message_id:number;members:number[]}|null>{
 const input=JSON.parse(row.input);if(row.kind!=='image'||!input.owner_album||!env.OWNER_VISUAL)return {input:row.input,message_id:row.message_id,members:[row.update_id]};
 if(!/^[A-Za-z0-9_-]{1,100}$/.test(input.owner_album))throw Error('owner_visual_album_invalid');
 const key='owner_visual_album:'+input.owner_album;const sealed=await env.DB.prepare('SELECT value FROM system_state WHERE key=?').bind(key).first<{value:string}>();const prior=sealed?JSON.parse(sealed.value):null;
 if(prior&&!prior.members.includes(row.update_id))throw Error('owner_visual_album_late_member');
 if(prior?.input)return {input:prior.input,message_id:prior.message_id,members:prior.members};
 const group=(await env.DB.prepare("SELECT update_id,message_id,kind,input FROM manual_requests WHERE kind='image' AND state IN ('queued','reading') AND json_valid(input) AND json_extract(input,'$.owner_album')=? ORDER BY message_id,update_id").bind(input.owner_album).all<ManualVisualRow>()).results;
 if(!group.length)throw Error('owner_visual_album_missing');
 const decoded=group.map(r=>({row:r,value:JSON.parse(r.input)}));
 if(nowMs-Math.max(...decoded.map(r=>Number(r.value.received_at_ms??0)))<1500){await env.DB.prepare("UPDATE manual_requests SET state='queued',lease_until=? WHERE kind='image' AND state IN ('queued','reading') AND json_extract(input,'$.owner_album')=?").bind(Math.ceil(nowMs/1000)+2,input.owner_album).run();return null;}
 if(group.length>4){await env.DB.batch(group.map(r=>env.DB.prepare("UPDATE manual_requests SET state='needs_review',lease_until=0,error='owner_visual_source_limit' WHERE update_id=?").bind(r.update_id)));throw Error('owner_visual_source_limit');}
 const members=group.map(r=>r.update_id),leader=group[0];
 const packed={...decoded[0].value,source_message_ids:decoded.map(r=>r.value.source_message_id??r.row.message_id),images:decoded.map(r=>({...r.value.image,source_message_id:r.value.source_message_id??r.row.message_id,caption:r.value.source_caption_original??r.value.owner_text_original??r.value.text??''})),text:decoded.map(r=>r.value.text??'').filter(Boolean).join('\n'),owner_message_text:decoded.map(r=>r.value.owner_message_text??'').filter(Boolean).join('\n'),editor_request:decoded.map(r=>r.value.editor_request?.trim()?r.value.editor_request:r.value.owner_message_text??'').filter(Boolean).join('\n')};
 const value={members,message_id:leader.message_id,input:JSON.stringify(packed)};
 const inserted=await env.DB.prepare('INSERT OR IGNORE INTO system_state(key,value) VALUES(?,?)').bind(key,JSON.stringify(value)).run();if(!inserted.meta.changes)throw Error('owner_visual_album_in_progress');
 await env.DB.batch(members.map(id=>env.DB.prepare("UPDATE manual_requests SET state='reading',lease_until=? WHERE update_id=? AND state IN ('queued','reading')").bind(Math.floor(nowMs/1000)+600,id)));
 return {input:value.input,message_id:leader.message_id,members};
}
