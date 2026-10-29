import manifest from '../assets/news-visuals/manifest.json';
import type {Draft} from './types';
// Planning metadata only. No Library fetch, image generation, file read or publish.
export function newsVisualPlan(d:Pick<Draft,'template'>,{breakingConfirmed=false}:{breakingConfirmed?:boolean}={}){
 const breaking=d.template==='breaking'&&breakingConfirmed;
 const pool=breaking?'breaking':'general';
 return {pool,enabled:false as const,ready:false as const,reason:breaking?'library_assets_not_materialized':'normal_news_visuals_missing',references:breaking?manifest.pools.breaking.assets.map(a=>a.library_id):[],requiresBreakingConfirmation:d.template==='breaking'&&!breakingConfirmed};
}
