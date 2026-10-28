import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sha256} from '../src/utils/text';
import {canonical} from '../src/news-owner-review';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function newsReviewArtifact(root:string){
 const files:Record<string,string>={};
 for(const file of ['scripts/validate_draft.ts','scripts/manual_reader.ts','src/output-capacity.ts','src/model-recovery.ts','scripts/install_news_candidate.ts','scripts/stage_news_candidate.ts','scripts/news_review_artifact.ts','src/news-maintenance-request.ts','src/telegram-inbox.ts','src/worker.ts','scripts/local_service.ts','scripts/install_local.py','src/dedupe.ts','src/channel-market-preview.ts','src/channel-programme.ts','src/market-overview.ts','src/market-overview-types.ts','src/market-overview-card.ts','src/card.ts','src/card-data.ts','src/card-redesign.ts','src/editor-tools.ts','src/telegram-ui.ts','scripts/image_vision.py','scripts/read_image.py','scripts/image_reader.ts','src/news-routing.ts','src/news-company-catalog.ts','src/newsroom.ts','src/news-readiness.ts','src/news-owner-review.ts','src/news-event-matching.ts','src/news-schedule-review.ts','src/news-selection-schedule.ts','src/news-maintenance-review.ts','src/article.ts','src/gallery-range.ts','src/gallery-save.ts','src/pipeline.ts','src/news-inbox.ts','src/report-card.ts','src/types.ts','src/market-time.ts','src/market-session.ts','src/channel-publication.ts','src/style.ts','src/editorial.ts','src/ai.ts','src/bridge.ts','src/telegram-channel.ts','scripts/telegram_channel.py','src/data/bist-equity-session-2026.json'])files[file]=await sha256(await readFile(join(root,file),'utf8'));
 files['src/hashtag-edit.ts']=await sha256(await readFile(join(root,'src/hashtag-edit.ts'),'utf8'));
 for(const file of ['src/news-maintenance-chain.ts','src/news-maintenance-store.ts'])files[file]=await sha256(await readFile(join(root,file),'utf8'));
 const catalog_hash=await sha256(await readFile(join(root,'src/data/news-companies.json'),'utf8'));
 return {files,catalog_hash,hash:await sha256(canonical({files,catalog_hash}))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const root=resolve(process.argv[2]??'.');
 console.log(JSON.stringify(await newsReviewArtifact(root),null,2));
}
