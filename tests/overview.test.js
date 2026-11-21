import test from 'node:test';
import assert from 'node:assert/strict';
import {MONITORS,latestDueAt,inspectMonitors} from '../src/overview.js';
import {dashboardHtml} from '../src/ui.js';
import {CHECK_ROUTES} from '../src/index.js';

test('exactly the five authorized monitors and no skipped or covered ones',()=>{
 const expected=['producthunt_producer','overseas_collector','overseas_producer','x_intelligence','trustmrr_weekly'];
 assert.deepEqual(MONITORS.map(x=>x.id),expected);
 assert.deepEqual(Object.keys(CHECK_ROUTES).map(x=>x.split('/').at(-1)),expected);
 const html=dashboardHtml('testnonce');
 assert.equal((html.match(/class="card"/g)||[]).length,5);
 for(const id of expected)assert(html.includes('data-monitor="'+id+'"'));
 for(const unwanted of ['site_postchars','host_silicon_valley','site_podcast','site_cms','trustmrr_monthly','/api/recovery','/api/incidents','/api/login','swrCache','setInterval('])
  assert.equal(html.includes(unwanted),false,'unexpected legacy UI: '+unwanted);
 assert(html.includes('nonce="testnonce"'));
 assert(html.includes('刷新交付状态'));
});

test('recent due dates are last completed business periods in Asia/Shanghai',()=>{
 const sun=Date.parse('2026-11-22T18:00:00Z'); // Monday 02:00 BJ
 const m=latestDueAt(sun,19,true);
 assert.equal(new Date(m).toISOString(),'2026-11-16T11:00:00.000Z');
 assert.equal(new Date(latestDueAt(sun,7)).toISOString(),'2026-11-21T23:00:00.000Z');
 const monday19=Date.parse('2026-11-23T11:00:00Z');
 assert.equal(new Date(latestDueAt(monday19,19,true)).toISOString(),'2026-11-23T11:00:00.000Z');
 assert.equal(new Date(latestDueAt(monday19,20,true)).toISOString(),'2026-11-16T12:00:00.000Z');
});

test('summary never queries database or sends Feishu alerts',async()=>{
 const existing=globalThis.fetch,calls=[];
 const env={OPS_NOTION_READ_TOKEN:'n'.repeat(40),OPS_PRODUCTHUNT_NOTION_PARENT_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OPS_TRUSTMRR_NOTION_PARENT_ID:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',OPS_X_NOTION_PARENT_ID:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',GITHUB_READ_TOKEN:'g'.repeat(40),
  OPS_SCHEDULER_TOKEN:'k'.repeat(40),FEISHU_WEBHOOK_URL:'https://open.feishu.cn/open-apis/bot/v2/hook/fake'};
 globalThis.fetch=async url=>{
  const value=String(url);calls.push(value);
  if(value.includes('open.feishu.cn'))throw Error('UI status must never alert');
  if(value.includes('github.com'))return new Response('{}',{status:503});
  return new Response(JSON.stringify({results:[],has_more:false}),{status:200});
 };
 try{
  const result=await inspectMonitors(new Proxy(env,{get(o,k){
   if(k==='HYPERDRIVE'||k==='DB'||k==='OPS_DATABASE_DRIVER')throw Error('No Neon from UI');
   return o[k];
  }}),Date.parse('2026-11-23T13:00:00Z'));
  assert.equal(result.monitors.length,5);
  assert.equal(result.monitors.find(x=>x.id==='producthunt_producer')?.status,'missing');
  assert.equal(result.monitors.find(x=>x.id==='overseas_collector')?.status,'unknown');
  assert(calls.every(x=>!x.includes('open.feishu.cn')));
 }finally{globalThis.fetch=existing;}
});
