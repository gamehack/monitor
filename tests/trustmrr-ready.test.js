import test from 'node:test';
import assert from 'node:assert/strict';
import {tmBeijingClock,tmReadyVerdict,checkTrustMrrWeekly,handleN8nTrustMrrWeeklyCheck} from '../src/checks/trustmrr-ready.js';

const period='2026-11-16';
const base='https://ingest.monitor.qjai.org/v1/checks/trustmrr_weekly';
const token='k'.repeat(40);
const env={OPS_SCHEDULER_TOKEN:token,OPS_NOTION_READ_TOKEN:'n'.repeat(40),OPS_TRUSTMRR_NOTION_PARENT_ID:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 FEISHU_WEBHOOK_URL:'https://open.feishu.cn/open-apis/bot/v2/hook/fake-test'};
const page='4199e605-ccf8-8183-8ea5-c5577107fbea';
const marker='QJAI_PUBLISH_READY v=1 source_key=trustmrr-weekly:2026-11-16 content_sha256='+'0'.repeat(64);
const monday=Date.parse('2026-11-23T11:00:00Z');
const sunday=Date.parse('2026-11-22T06:00:00Z');
const call=url=>new Request(url,{method:'POST',headers:{authorization:'Bearer '+token}});

test('Beijing Monday 19:00 clock boundaries',()=>{
 assert.deepEqual(tmBeijingClock(monday),{date:'2026-11-23',weekday:'Mon',hour:19});
 assert.equal(tmBeijingClock(monday-60000).hour,18);
});

test('status-only ready checks source key, not hash',()=>{
 assert.deepEqual(tmReadyVerdict('body\n'+marker,period),{ok:true,reason:'READY'});
 assert.equal(tmReadyVerdict(marker.replace('0'.repeat(64),'anything'),period).ok,true);
 assert.equal(tmReadyVerdict('QJAI\\_PUBLISH\\_READY v=1 source\\_key=trustmrr-weekly:2026-11-16 content\\_sha256=abc',period).ok,true);
 assert.equal(tmReadyVerdict(marker,'2026-11-23').reason,'PERIOD_MISMATCH');
 assert.equal(tmReadyVerdict(marker+'\nchanged',period).reason,'READY_MISSING');
});

test('read-only Notion returns READY, missing and duplicate',async()=>{
 const old=globalThis.fetch,seen=[];
 const child={id:page,type:'child_page',child_page:{title:period+'｜TrustMRR 周报｜独立产品增长观察｜11-16'}};
 let children=[child];
 globalThis.fetch=async(url,opts)=>{
  seen.push({url:String(url),method:opts.method});
  const data=String(url).includes('/children')
   ?{results:children,has_more:false}
   :{object:'page_markdown',markdown:marker,truncated:false,unknown_block_ids:[],warnings:[]};
  return new Response(JSON.stringify(data),{status:200});
 };
 try {
  assert.deepEqual(await checkTrustMrrWeekly(env,period),{period,ok:true,reason:'READY'});
  assert.equal(seen.length,2);
  assert(seen.every(x=>x.method==='GET'));
  assert(seen[0].url.includes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/children'));
  children=[];
  assert.equal((await checkTrustMrrWeekly(env,period)).reason,'REPORT_MISSING');
  children=[child,{...child,id:'4199e605-ccf8-8183-8ea5-c5577107fbee'}];
  assert.equal((await checkTrustMrrWeekly(env,period)).reason,'DUPLICATE_PERIOD');
 } finally {globalThis.fetch=old;}
});

test('unauthorized, Sunday and Monday before 19:00 make zero network requests',async()=>{
 const old=globalThis.fetch;let calls=0;
 globalThis.fetch=()=>{calls++;throw Error('unexpected I/O')};
 try{
  assert.equal((await handleN8nTrustMrrWeeklyCheck(new Request(base,{method:'POST'}),env,monday)).status,401);
  assert.equal((await handleN8nTrustMrrWeeklyCheck(call(base),env,sunday)).status,409);
  assert.equal((await handleN8nTrustMrrWeeklyCheck(call(base),env,monday-60000)).status,409);
  assert.equal(calls,0);
 }finally{globalThis.fetch=old;}
});

test('authenticated probe is read-only and never sends Feishu',async()=>{
 const old=globalThis.fetch;let reads=0;
 globalThis.fetch=async(url)=>{
  if(String(url).includes('open.feishu.cn'))throw Error('feishu must not be called');
  reads++;
  const data=String(url).includes('/children')
   ?{results:[{id:page,type:'child_page',child_page:{title:period+'｜TrustMRR 周报｜独立产品增长观察｜11-16'}}],has_more:false}
   :{object:'page_markdown',markdown:marker,truncated:false,unknown_block_ids:[],warnings:[]};
  return new Response(JSON.stringify(data),{status:200});
 };
 try {
  const r=await handleN8nTrustMrrWeeklyCheck(call(base+'?probe='+period),env,sunday);
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{period,ok:true,reason:'READY',probe:true,alert_sent:false});
  assert.equal(reads,2);
 }finally{globalThis.fetch=old;}
});

test('missing report alerts exactly once at Monday 19:00; Feishu errors fail',async()=>{
 const old=globalThis.fetch;let calls=0,code=0;
 globalThis.fetch=async(url)=>{
  if(String(url).includes('open.feishu.cn')){calls++;return new Response(JSON.stringify({code}),{status:200})}
  return new Response(JSON.stringify({results:[],has_more:false}),{status:200});
 };
 try {
  const ok=await handleN8nTrustMrrWeeklyCheck(call(base),env,monday);
  assert.deepEqual(await ok.json(),{ok:true,result:'alerted',period_key:'2026-11-23',reason:'REPORT_MISSING'});
  assert.equal(calls,1);
  code=1;
  const failure=await handleN8nTrustMrrWeeklyCheck(call(base),env,monday);
  assert.equal(failure.status,502);
  assert.equal((await failure.json()).result,'delivery_failed');
 }finally{globalThis.fetch=old;}
});

