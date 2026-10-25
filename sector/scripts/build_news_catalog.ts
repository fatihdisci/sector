// Offline, reproducible build from retained official source projections. No live preferences are written.
import {readFileSync,writeFileSync} from 'node:fs';
import {buildCatalog,type CatalogInput} from './news_catalog_model';
const [input='src/data/news-catalog-source.json',output='src/data/news-companies.json']=process.argv.slice(2);
const catalog=buildCatalog(JSON.parse(readFileSync(input,'utf8')) as CatalogInput);
writeFileSync(output,JSON.stringify(catalog,null,2)+'\n');
console.log({version:catalog.version,issuers:catalog.issuers.length,equity_codes:catalog.companies.length,unresolved_issuers:catalog.issuers.filter(i=>!i.equity_codes.length).length});
