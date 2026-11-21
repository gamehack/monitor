// Read-only, on-demand summary for the private UI.
// This is a business deliverable snapshot; it is NOT an n8n execution log.
// No D1/Neon storage, automatic polling, retry, alert, or recovery.
import {checkProductHuntReady,productHuntPeriod} from './checks/notion-ready.js';
import {checkOverseasCollector,checkOverseasProducer} from './checks/router.js';
import {overseasCollectorPeriod} from './checks/router.js';
import {checkXIntelligence,xBeijingDay} from './checks/x-ready.js';
import {checkTrustMrrWeekly,tmBeijingClock} from './checks/trustmrr-ready.js';

const ONE_DAY=86400000;
const SHANGHAI='Asia/Shanghai';
export const MONITORS=Object.freeze([
 Object.freeze({id:'producthunt_producer',title:'Product Hunt',subtitle:'每日选品文章 READY',schedule:'每日 18:00',timezone:SHANGHAI,
  source:'Notion · Product Hunt',url:'https://github.com/gamehack/producthunt'}),
 Object.freeze({id:'overseas_collector',title:'海外创业志 · 采集',subtitle:'周度采集 Actions 执行结果',schedule:'周一 20:00',timezone:SHANGHAI,
  source:'GitHub Actions',url:'https://github.com/gamehack/overseas-story-supabase'}),
 Object.freeze({id:'overseas_producer',title:'海外创业志 · 生产',subtitle:'周度生产 Actions 执行结果',schedule:'周一 14:00',timezone:SHANGHAI,
  source:'GitHub Actions',url:'https://github.com/gamehack/overseas-story-producer'}),
 Object.freeze({id:'x_intelligence',title:'X 每日商业情报',subtitle:'Notion 商业情报 READY',schedule:'每日 07:00',timezone:SHANGHAI,
  source:'Notion · X 情报',url:'https://www.notion.so'}),
 Object.freeze({id:'trustmrr_weekly',title:'TrustMRR 周榜',subtitle:'Notion 周榜 READY / source_key',schedule:'周一 19:00',timezone:SHANGHAI,
  source:'Notion · TrustMRR',url:'https://github.com/gamehack/TrustMRR'})
]);

function shanghaiDateParts(now){
 const fields=new Intl.DateTimeFormat('en-US',{
   timeZone:SHANGHAI,year:'numeric',month:'2-digit',day:'2-digit',
   hour:'2-digit',hourCycle:'h23'
 }).formatToParts(new Date(now));
 const find=t=>fields.find(x=>x.type===t)?.value;
 return {date:find('year')+'-'+find('month')+'-'+find('day'),
  hour:Number(find('hour'))};
}
function utcDay(date){return Date.parse(date+'T00:00:00Z');}
function shanghaiTime(day,hour){return day+(hour-8)*3600000;}

export function latestDueAt(now,hour,weekly=false){
 const bj=shanghaiDateParts(now);
 let day=utcDay(bj.date);
 if(weekly) {
   const dow=new Date(day).getUTCDay();
   const daysSinceMonday=(dow+6)%7;
   day-=daysSinceMonday*ONE_DAY;
   if(daysSinceMonday===0&&bj.hour<hour)day-=7*ONE_DAY;
 } else if(bj.hour<hour)day-=ONE_DAY;
 return shanghaiTime(day,hour);
}

const REMOTE_UNAVAILABLE=new Set([
 'GITHUB_API_UNAVAILABLE','NOTION_UNAVAILABLE','NOTION_TOKEN_UNAVAILABLE',
 'NOTION_CREDENTIAL_NOT_CONFIGURED','NOTION_STATUS_UNAVAILABLE',
 'GITHUB_TOKEN_NOT_CONFIGURED'
]);
function classify(outcome) {
 if(outcome?.ok===true||outcome?.ready===true)return 'ready';
 if(REMOTE_UNAVAILABLE.has(outcome?.reason)||outcome?.reason?.startsWith('GITHUB_RUNS_HTTP_')||
   outcome?.reason?.startsWith('GITHUB_JOBS_HTTP_'))return 'unknown';
 return 'missing';
}
async function inspectOne(monitor,env,now){
 let due;
 let outcome;
 switch(monitor.id){
 case 'producthunt_producer':
   due=latestDueAt(now,18);
   outcome=await checkProductHuntReady(env,due);
   break;
 case 'overseas_collector':
   due=latestDueAt(now,20,true);
   outcome=await checkOverseasCollector(env,due);
   break;
 case 'overseas_producer':
   due=latestDueAt(now,14,true);
   outcome=await checkOverseasProducer(env,due);
   break;
 case 'x_intelligence':
   due=latestDueAt(now,7);
   outcome=await checkXIntelligence(env,xBeijingDay(due));
   break;
 case 'trustmrr_weekly':
   due=latestDueAt(now,19,true);
   outcome=await checkTrustMrrWeekly(env,tmBeijingClock(due).date);
   break;
 default: throw Error('unsupported_monitor');
 }
 return {id:monitor.id,status:classify(outcome),
   period:String(outcome?.period||productHuntPeriod(due)),
   reason:String(outcome?.reason||'UNKNOWN').slice(0,80),
   checked_at:new Date(now).toISOString()};
}
export async function inspectMonitors(env,now=Date.now()){
 const results=await Promise.all(MONITORS.map(async monitor=>{
   try{return await inspectOne(monitor,env,now);}
   catch{return {id:monitor.id,status:'unknown',period:null,
     reason:'REMOTE_UNAVAILABLE',checked_at:new Date(now).toISOString()};}
 }));
 return {as_of:new Date(now).toISOString(),
  caveat:'读取最近应完成的业务交付状态；不代表 n8n 上次执行结果；不会触发告警。',
  monitors:results};
}
