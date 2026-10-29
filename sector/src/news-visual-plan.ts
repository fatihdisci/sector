import manifest from '../assets/news-visuals/manifest.json';
import type {Draft} from './types';
// The owner explicitly selected this same four-image pool for all ordinary news.
export function newsVisualPlan(_d:Pick<Draft,'template'>,_options:{breakingConfirmed?:boolean}={}){
 return {pool:'breaking' as const,enabled:manifest.enabled,ready:manifest.enabled&&manifest.pools.breaking.assets.every(a=>a.verified&&!!a.local_path&&!!a.sha256),reason:'all_news_random_once',references:manifest.pools.breaking.assets.map(a=>a.library_id),requiresBreakingConfirmation:false};
}
