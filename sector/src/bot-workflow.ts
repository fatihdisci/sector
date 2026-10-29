import type {Env,Document} from './types';
export function botWorkflow(env:Pick<Env,'BOT_WORKFLOW_MODE'>):'full'|'news_only'{const mode=env.BOT_WORKFLOW_MODE??'full';if(mode!=='full'&&mode!=='news_only')throw Error('invalid_bot_workflow');return mode;}
export const BOT_DATA_MESSAGE='Veri sorgulama ve kaynak görselden içerik üretimi bu botta kapalı. Haber metni, link veya PDF gönderebilirsin. Hazırlanmış tweet ve PNG paketini /hazir ile onay kartına alabilirsin; X paylaşımı ayrıca onayını bekler.';
export function isDataEvidence(d:Document){return !!(d.market_data||d.market_movers||d.source_layout||d.owner_visual);}
