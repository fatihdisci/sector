import type {Env} from './types';
export type ApiSettings={shared_budget?:Record<string,unknown>;enabled:boolean;budget_authorized:boolean;model:string|null;reasoning_effort:'low'|'medium';approved_models:string[];hard_limit_micro_usd:number|null;window_id:string|null;expires_at:number|null;input_token_ceiling:number|null;max_output_tokens:number|null;input_micro_usd_per_million:number|null;cached_micro_usd_per_million:number|null;output_micro_usd_per_million:number|null;rate_table_model:string|null;rate_table_valid_from:number|null;rate_table_expires_at:number|null;rate_table_source:string|null;context_window_tokens:number|null};
const positive=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>0;
export function apiSettings(value:unknown,now=Date.now()/1000):ApiSettings{
 const c=value as ApiSettings;
 if(!c||c.enabled!==true||c.budget_authorized!==true)throw Error('api_disabled_or_budget_unauthorized');
 if(!['low','medium'].includes(c.reasoning_effort))throw Error('api_reasoning_effort_not_approved');
 if(typeof c.model!=='string'||!/^[-a-z0-9._]{2,81}$/.test(c.model)||c.model==='gpt-6-luna'||!Array.isArray(c.approved_models)||!c.approved_models.includes(c.model))throw Error('api_model_not_explicitly_approved');
 if(typeof c.window_id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(c.window_id)||typeof c.expires_at!=='number'||!Number.isFinite(c.expires_at)||now>=c.expires_at)throw Error('api_budget_window_missing_or_expired');
 if(![c.hard_limit_micro_usd,c.input_token_ceiling,c.max_output_tokens,c.input_micro_usd_per_million,c.cached_micro_usd_per_million,c.output_micro_usd_per_million,c.context_window_tokens].every(positive))throw Error('api_budget_or_verified_pricing_missing');
 if(c.rate_table_model!==c.model||typeof c.rate_table_valid_from!=='number'||typeof c.rate_table_expires_at!=='number'||!Number.isFinite(c.rate_table_valid_from)||!Number.isFinite(c.rate_table_expires_at)||!(c.rate_table_valid_from<=now&&now<c.rate_table_expires_at)||typeof c.rate_table_source!=='string'||!/^https:\/\/(developers|platform)\.openai\.com\/\S+$/.test(c.rate_table_source))throw Error('api_rate_table_invalid_or_expired');
 if(c.cached_micro_usd_per_million!>c.input_micro_usd_per_million!||c.input_token_ceiling!+c.max_output_tokens!>c.context_window_tokens!||c.max_output_tokens!<16)throw Error('api_context_or_pricing_invalid');
 return c;
}
export function modelRoute(env:Pick<Env,'AI_PROVIDER'|'AI_API_CONFIG'|'AI_MODEL'|'AI_EFFORT'>){
 const provider=env.AI_PROVIDER??'openai-codex';
 if(provider==='openai-codex')return {provider,model:env.AI_MODEL,effort:env.AI_EFFORT};
 if(provider!=='openai-api')throw Error('model_provider_invalid');
 const config=apiSettings(env.AI_API_CONFIG);
 return {provider,model:config.model!,effort:config.reasoning_effort};
}
