// Only an explicitly confirmed exact revision/content/media set can outlive its draft TTL.
export const MAX_SCHEDULE_LATE=5*60_000;
export function scheduleHoldSql(draftAlias:string){return `EXISTS(SELECT 1 FROM x_schedule_bindings b JOIN x_posts p ON p.id=b.post_id JOIN x_schedules s ON s.post_id=p.id WHERE b.draft_id=${draftAlias}.id AND b.revision=${draftAlias}.revision AND b.content=${draftAlias}.content AND b.media_key=${draftAlias}.media_key AND p.draft_id=b.draft_id AND p.revision=b.revision AND p.media_key=b.media_key AND p.state IN ('queued','uploading','posting') AND b.valid_until=s.due_at+${MAX_SCHEDULE_LATE} AND b.valid_until>=?)`;}
export function scheduledDraftEligible(d:any,post:any,b:any,time:number){
 const held=!!b&&b.draft_id===post.draft_id&&b.revision===post.revision&&b.content===d?.content&&b.media_key===post.media_key&&b.valid_until===b.due_at+MAX_SCHEDULE_LATE&&time<=b.valid_until;
 return !!d&&d.revision===post.revision&&d.state==='pending'&&(d.expires_at>Math.floor(time/1000)||held)&&d.media_key===post.media_key&&!!d.media_key&&d.delivery_state==='sent'&&d.verification!=='needs_review';
}
