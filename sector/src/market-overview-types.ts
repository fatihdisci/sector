export interface OverviewRow{label:string;value:string;}
export interface OverviewPanel{key:'contribution_up'|'contribution_down'|'gainers'|'losers'|'volume';title:string;rows:OverviewRow[];}
export interface OverviewBroker{name:string;net:string;share:string;total:string;}
export type OverviewView='summary'|'opening'|'first_moves'|'close';
export interface MarketOverview{version:1;view?:OverviewView;level:string;percent:string;direction:'down'|'up';points:string;volume:string;low:string;high:string;panels:OverviewPanel[];breadth:{up:string;neutral:string;down:string};brokers:{side:'buy'|'sell';first5:string;rows:OverviewBroker[]}[];}
