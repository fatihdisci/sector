import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {initWasm,Resvg} from '@resvg/resvg-wasm';
const root=fileURLToPath(new URL('../',import.meta.url));let ready:Promise<void>|undefined;
export async function png(svg:string):Promise<Uint8Array> {
 await (ready??=readFile(root+'node_modules/@resvg/resvg-wasm/index_bg.wasm').then(b=>initWasm(b)));
 const r=new Resvg(svg,{font:{fontBuffers:[await readFile(root+'assets/NotoSans-Regular.ttf'),await readFile(root+'assets/NotoSans-Bold.ttf'),await readFile(root+'assets/approved-typography/Anton-Regular.ttf'),await readFile(root+'assets/approved-typography/ZillaSlab-Bold.ttf'),await readFile(root+'assets/approved-typography/Inter.ttf')],defaultFontFamily:'Noto Sans'}});
 try{const image=r.render();try{return image.asPng();}finally{image.free();}}finally{r.free();}
}
