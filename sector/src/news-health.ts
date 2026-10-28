/** Minimal non-secret filter status for the existing health response. */
export type NewsFilterMode='active'|'shadow'|'unavailable';
export function newsFilterHealth(mode:NewsFilterMode,_readinessReasons:readonly string[]=[]){
 return {mode,reason:mode==='active'?null:mode==='unavailable'?'readiness_unavailable':'readiness_not_passed'} as const;
}
