import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {sha256} from '../src/utils/text';
import {canonical} from '../src/news-owner-review';
export async function newsReviewArtifact(root:string){
 const files:Record<string,string>={};
 for(const file of ['src/news-routing.ts','src/news-company-catalog.ts','src/newsroom.ts','src/news-readiness.ts','src/news-owner-review.ts','src/news-event-matching.ts'])files[file]=await sha256(await readFile(join(root,file),'utf8'));
 const catalog_hash=await sha256(await readFile(join(root,'src/data/news-companies.json'),'utf8'));
 return {files,catalog_hash,hash:await sha256(canonical({files,catalog_hash}))};
}
