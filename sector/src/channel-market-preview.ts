// A separate editor-preview lane: does not relabel news urgency or feedback.
export function channelMarketPreviewSQL(alias='a'):string{
 if(!/^[a-z]+$/.test(alias))throw Error('invalid_sql_alias');
 return `(${alias}.source_id='sermaye-telegram'
 AND julianday(${alias}.published_at) BETWEEN julianday('now','-1 day') AND julianday('now','+5 minutes')
 AND json_valid(${alias}.document)
 AND json_extract(CASE WHEN json_valid(${alias}.document) THEN ${alias}.document ELSE '{}' END,'$.version')=1
 AND json_extract(CASE WHEN json_valid(${alias}.document) THEN ${alias}.document ELSE '{}' END,'$.channel')='SermayeBorsasi'
 AND json_extract(CASE WHEN json_valid(${alias}.document) THEN ${alias}.document ELSE '{}' END,'$.peer_id')=2426639373
 AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(${alias}.document) THEN ${alias}.document ELSE '{}' END,'$.messages') cm
 WHERE json_extract(cm.value,'$.media')='image'
 AND (json_extract(cm.value,'$.text') LIKE '%BIST 100 — __:__%'
 OR json_extract(cm.value,'$.text') LIKE '%Kurum AKD Özeti — __:__%'
 OR json_extract(cm.value,'$.text') LIKE '%Teorik Eşleşme — __:__%'
 OR json_extract(cm.value,'$.text') LIKE '%Piyasa Raporu — __:__%')))`;
}
export function latestChannelVersionSQL(alias='a'):string{
 return `NOT EXISTS(SELECT 1 FROM articles newer WHERE newer.source_id=${alias}.source_id
 AND newer.id!=${alias}.id AND json_valid(newer.document)
 AND json_extract(CASE WHEN json_valid(newer.document) THEN newer.document ELSE '{}' END,'$.url')=json_extract(CASE WHEN json_valid(${alias}.document) THEN ${alias}.document ELSE '{}' END,'$.url')
 AND (json_extract(CASE WHEN json_valid(newer.document) THEN newer.document ELSE '{}' END,'$.captured_at')>json_extract(CASE WHEN json_valid(${alias}.document) THEN ${alias}.document ELSE '{}' END,'$.captured_at')
 OR (json_extract(CASE WHEN json_valid(newer.document) THEN newer.document ELSE '{}' END,'$.captured_at')=json_extract(CASE WHEN json_valid(${alias}.document) THEN ${alias}.document ELSE '{}' END,'$.captured_at') AND newer.rowid>${alias}.rowid)))`;
}
