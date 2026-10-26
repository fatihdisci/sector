import twitter from 'twitter-text';
// Local ceiling, not a claim that the connected account/API is entitled to long posts.
// X makes the final entitlement decision on the explicit owner-approved POST.
export const X_LONG_TEXT_LIMIT=25_000;
export function xTextValid(text:string):boolean{
 return text.length<=X_LONG_TEXT_LIMIT*2&&twitter.parseTweet(text,{...twitter.configs.defaults,maxWeightedTweetLength:X_LONG_TEXT_LIMIT}).valid;
}
