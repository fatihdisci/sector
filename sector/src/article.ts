import {galleryRange} from './gallery-range';
import {sha256} from './utils/text';
import {parseHTML} from 'linkedom';
import {extractArticleSource} from './reused/source-extract';
import {readPublic} from './network';
import {normalizeUrl} from './utils/text';
import type {Source,Item,Document} from './types';
// A single reader for model input, editorial inspection and clipboard export.
export async function readDocument(item:Item,source:Source,fetcher:typeof fetch=fetch):Promise<Document> {
  if(source.article_mode==='feed_only')throw new Error('full_article_not_authorized');
  const page=await readPublic(item.url,source.allowed_hosts,{Accept:'text/html,application/xhtml+xml;q=0.9'},fetcher);
  if(!/html|xml/i.test(page.headers.get('content-type')??''))throw new Error('unsupported_document');
  const doc=documentFromHtml(page.text,item,source,page.url);if(doc.gallery_range)doc.gallery_range.source_sha256=await sha256(page.text);return doc;
}
export function documentFromHtml(html:string,item:Item,source:Source,url=item.url):Document {
  const {document}=parseHTML(html);
  const canonical=document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if(canonical&&normalizeUrl(new URL(canonical,url).href)!==normalizeUrl(url))throw new Error('article_identity_mismatch');
  const heading=(new URL(url).hostname==='www.federalreserve.gov'?document.querySelector('#article h3.title'):document.querySelector('h1'))?.textContent?.replace(/\s+/g,' ').trim();
  // Own-page title is authoritative when RSS title was updated. Canonical URL
  // must still match, and every passage comes from the article root only.
  const title=heading||item.title;
  const extracted=extractArticleSource(html,{type:source.id==='kap'?'kap':'rss',url,title});
  if(source.id==='tcmb-data'&&/Aylık Gelişmeler|Veri \(Tablolar\)/.test(extracted.text)&&!/%|yüzde|milyar|milyon/.test(extracted.text))throw new Error('release_attachment_required');
  if(extracted.text.length<80)throw new Error('article_body_too_short');
  const isGallery=/\/foto-galeri\/|\/[a-z0-9-]+-g\d+/i.test(url);
  const gallery=isGallery&&((new URL(url).hostname==='www.cnbce.com'&&/100.*dip.*zirve/i.test(title))||/data-(?:total|count|page)|pagination|gallery-pagination/i.test(html))?galleryRange(html,url,source):undefined;
  if(gallery)return {gallery_range:gallery,coverage:{complete:true,page_count:gallery.pages,pages:gallery.page_urls.map((url,i)=>({number:i+1,url}))},source_id:source.id,source_name:source.name,family:source.family,official:source.official,url,title,body:gallery.rows.map(r=>r.quote).join('\n\n'),published_at:item.published_at,language:source.language,passages:gallery.rows.map(r=>({id:'gallery_'+r.page,text:r.quote})),primary_urls:[]};
  return {source_id:source.id,source_name:source.name,family:source.family,official:source.official,url,title,body:extracted.text,published_at:item.published_at,language:source.language,
    passages:extracted.document.passages.map(p=>({id:p.id,text:p.text})).concat(extracted.document.tables.map(t=>({id:t.id,text:JSON.stringify(t.rows)}))),
    primary_urls:[...parseHTML(extracted.html).document.querySelectorAll('a[href]')].map(a=>a.getAttribute('href')??'').filter(u=>/^https:\/\/www\.kap\.org\.tr\/tr\/Bildirim\/\d+$/i.test(u)).slice(0,2)};
}
