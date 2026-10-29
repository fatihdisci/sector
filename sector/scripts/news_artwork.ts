import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {validateNewsArtwork,type NewsArtwork} from '../src/news-artwork';
/** Reviewed local files only. No network, generated image or placeholder fallback. */
export async function loadNewsArtwork(root:string):Promise<NewsArtwork[]>{
 const base=join(root,'assets/news-visuals'),m=JSON.parse(await readFile(join(base,'manifest.json'),'utf8'));
 if(m.version!==1||m.enabled!==true||m.policy!=='all_news_random_once'||m.pools?.breaking?.assets?.length!==4)throw Error('news_artwork_manifest');
 const result:NewsArtwork[]=[];
 for(let i=0;i<4;i++){const a=m.pools.breaking.assets[i],id='breaking-'+(i+1);if(a.id!==id||a.local_path!==id+'.png'||a.verified!==true||!/^[a-f0-9]{64}$/.test(a.sha256))throw Error('news_artwork_manifest');const image={id,sha256:a.sha256,width:a.width,height:a.height,bytes:new Uint8Array(await readFile(join(base,a.local_path)))};await validateNewsArtwork(image);result.push(image);}
 if(new Set(result.map(a=>a.sha256)).size!==4)throw Error('news_artwork_manifest');return result;
}
