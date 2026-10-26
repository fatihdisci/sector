import type {OutputPreferences} from './output-preferences';
export type Category = 'turkiye'|'central_banks'|'companies'|'technology'|'energy'|'global'|'data'|'bist'|'kap';
export type Template = 'breaking'|'economic_data'|'company'|'global'|'info'|'circuit'|'kap'|'market'|'finance'|'news'|'institutional'|'akd'|'volume'|'broker_flow'|'custody'|'theoretical';
export type Status = 'pending'|'deferred'|'rejected'|'approved'|'needs_review'|'published';
export interface Source {
  id:string; name:string; url:string; family:string; language:string; official:boolean;
  allowed_hosts:string[]; poll_seconds:number; fresh_hours:number; enabled:boolean;
  editorial_priority?:number; minimum_score?:number;
  checked_at:string; terms_url:string; rights_note:string; review_mode:string;
  article_mode?:'html'|'feed_only';
  method?:'rss'|'bridge_pdf'|'reference';
}
export interface Item {title:string;url:string;summary:string;published_at:string|null;}
export interface GalleryRange {version:1;mode:'inline';pages:number;page_urls:string[];source_sha256?:string;rows:{ticker:string;low:string;high:string;fromLow:string;fromHigh:string;page:number;url:string;quote:string}[];}
export interface Document {market_editorial_context?:{version:number;label:string|null;basis:string;calendar_version:string|null;measurement_time_verified:boolean;publication_is_not_data_day:boolean;reason:string};channel_publication?:{channel:string;peer_id:number;message_id:number;posted_at:string;edited_at:string|null;version:string;forwarded:boolean|null;forwarded_at:string|null};source_layout?:{kind:'theoretical'|'institution_summary'|'market_overview';panels:{name:string;symbols:string[]}[];minimum_rows:number};circuit_scope?:{kind:'pay'|'market';included_codes:string[];excluded_codes:string[];list_version?:string};gallery_range?:GalleryRange;buyback_evidence?:import('./buyback-types').BuybackEvidence;editor_corrections?:{path:string;before_value:string;after_value:string}[];output_preferences?:OutputPreferences;source_id:string;source_name:string;family:string;official:boolean;url:string;title:string;body:string;published_at:string|null;passages:{id:string;text:string}[];primary_urls?:string[];equity_codes?:string[];index_tier?:30|100;index_membership?:{bist30:string[];bist100:string[];checked_at:string;source:string};language?:string;images?:string[];market_data?:{kind:'broker_flow'|'akd'|'custody'|'institutional';ticker?:string;broker?:string;focus?:'buy'|'sell'|'both';submitted_at?:number;editorial_period?:string;tickers?:string[];rows?:{side:'buy'|'sell';symbol:string;volume:string;rank?:number}[]};coverage?:{complete:boolean;page_count:number;pages:unknown[]};}
export interface Evidence {document:number;passage:string;quote:string;}
export interface Claim {text:string;evidence:Evidence[];}
export interface CardRow {label:string;value:string;}
export interface CardData {report?:{kind?:'range';circuit?:import('./circuit-selection').CircuitSelection;events?:{id:number;tickers:string[];published_at:string}[];buyback?:import('./buyback-types').BuybackTable;rows:CardRow[];footer:string;general?:{day:string;time:string;companies:number;lots:string;amount:string;missing:number;partial?:boolean;rows:{ticker:string;lots:string;price:string;amount:string;urls:string}[]}};buy_broker?:string;sell_broker?:string;broker?:string;ticker?:string;tickers?:string[];as_of?:string;buy?:CardRow[];sell?:CardRow[];holdings?:CardRow[];metrics?:CardRow[];}
export interface Draft {
  output_preferences?:OutputPreferences;
  card_data?:CardData;
  headline:string;body:string;hashtags:string[];category:Category;importance:number;
  template:Template;claims:Claim[];entities:string[];event_key:string;uncertainties:string[];source_notes?:string[];
  card_headline:string;card_body:string;
}
export interface Env {
  READ_TELEGRAM_CHANNEL?:(manifest:string)=>Promise<Document[]>;
  READ_SPK_X?:(manifest:string)=>Promise<Document[]>;
  KAP_REPORT?:(kind:'circuit'|'buyback'|'general_buyback',at:number,preferences?:OutputPreferences)=>Promise<{draft:Draft;documents:Document[]}>;
  RENDER_REPORT?:(svg:string)=>Promise<Uint8Array>;
  X_PUBLISH_ENABLED?:string;
  DB:D1Database; MEDIA:R2Bucket;
  MODE:'dry_run'|'telegram_review';
  ADMIN_TOKEN?:string; BRIDGE_TOKEN?:string; AI_MODEL:string; AI_EFFORT:'medium';
  TELEGRAM_BOT_TOKEN?:string; TELEGRAM_CHAT_ID?:string; TELEGRAM_USER_ID?:string;
  TELEGRAM_UPDATE_ID?:number;
  KAP_DELIVERY_CHECK?:(documents:Document[])=>'allow'|'suppress'|'hold';
  TELEGRAM_WEBHOOK_SECRET?:string; TELEGRAM_VERIFIED_BOT_ID?:string;
  AI_DAILY_DRAFT_LIMIT:string;
}
