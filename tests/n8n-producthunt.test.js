import test from 'node:test';
import assert from 'node:assert/strict';
import {productHuntPeriod,isNotionReady,checkProductHuntReady} from '../src/checks/notion-ready.js';
import {authorizedScheduler,handleN8nCheck} from '../src/checks/router.js';
import {feishuReceipt} from '../src/alert-delivery.js';

const period='2026-11-18';
const sha='a'.repeat(64);
const marker='QJAI_PUBLISH_READY v=1 source_key=producthunt:'+period+' content_sha256='+sha;
test('business date is yesterday in Los Angeles, not Beijing day',()=>{
  const beijing18=Date.parse('2026-11-19T10:00:00Z');
  assert.equal(productHuntPeriod(beijing18),period);
  assert.equal(productHuntPeriod(Date.parse('2026-01-19T10:00:00Z')),'2026-01-18');
});
test('READY marker verifies date, not content SHA256',()=>{
  assert.equal(isNotionReady('# Article\n\n'+marker,period),true);
  assert.equal(isNotionReady('# Article\n\n'+marker.replaceAll('_','\\_'),period),true);
  assert.equal(isNotionReady('# Article\n\n'+marker.replace(sha,'0'.repeat(64)),period),true);
  assert.equal(isNotionReady('# Article\n\nQJAI_PUBLISH_READY v=1 source_key=producthunt:2026-11-17 content_sha256='+sha,period),false);
  assert.equal(isNotionReady('# Article without marker',period),false);
});
test('scheduler token cannot be bypassed',()=>{
  const env={OPS_SCHEDULER_TOKEN:'t'.repeat(48)};
  assert.equal(authorizedScheduler(new Request('https://ingest.monitor.qjai.org/v1/checks/producthunt_producer',{headers:{Authorization:'Bearer '+env.OPS_SCHEDULER_TOKEN}}),env),true);
  assert.equal(authorizedScheduler(new Request('https://ingest.monitor.qjai.org/v1/checks/producthunt_producer',{headers:{Authorization:'Bearer '+'x'.repeat(48)}}),env),false);
});
test('unauthorized request has no external side effect',async()=>{
  const orig=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw Error('not allowed')};
  try{
    const result=await handleN8nCheck(new Request('https://ingest.monitor.qjai.org/v1/checks/producthunt_producer',{method:'POST'}),{OPS_SCHEDULER_TOKEN:'t'.repeat(48)});
    assert.equal(result.status,401);assert.equal(calls,0);
  } finally {globalThis.fetch=orig;}
});
test('Notion READY readback is read-only and does not hash content',async()=>{
  const orig=globalThis.fetch;let calls=0;
  globalThis.fetch=async url=>{
    calls++;
    if(String(url).includes('/children?'))return new Response(JSON.stringify({results:[{
      type:'child_page',id:'11111111-1111-4111-8111-111111111111',
      child_page:{title:period+'｜Article'}}],has_more:false}),{status:200});
    return new Response(JSON.stringify({object:'page_markdown',markdown:'# Body\n'+marker,
      truncated:false,unknown_block_ids:[],warnings:[]}),{status:200});
  };
  try{
    const out=await checkProductHuntReady({OPS_NOTION_READ_TOKEN:'n'.repeat(40),OPS_PRODUCTHUNT_NOTION_PARENT_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OPS_TRUSTMRR_NOTION_PARENT_ID:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',OPS_X_NOTION_PARENT_ID:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},Date.parse('2026-11-19T10:00:00Z'));
    assert.deepEqual(out,{period,ready:true,reason:'READY'});assert.equal(calls,2);
  }finally{globalThis.fetch=orig;}
});
test('Notion missing returns ARTICLE_MISSING without checking GitHub',async()=>{
  const orig=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({results:[],has_more:false}),{status:200})};
  try{const out=await checkProductHuntReady({OPS_NOTION_READ_TOKEN:'n'.repeat(40),OPS_PRODUCTHUNT_NOTION_PARENT_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OPS_TRUSTMRR_NOTION_PARENT_ID:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',OPS_X_NOTION_PARENT_ID:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},Date.parse('2026-11-19T10:00:00Z'));
    assert.equal(out.reason,'ARTICLE_MISSING');assert.equal(calls,1);
  }finally{globalThis.fetch=orig;}
});
test('n8n endpoint sends a keyword-compliant Feishu alert only when Notion is missing',async()=>{
  const orig=globalThis.fetch;let notionCalls=0,feishuCalls=0,feishuText='';
  globalThis.fetch=async(url,opts)=>{
    if(String(url).includes('api.notion.com')){notionCalls++;return new Response(JSON.stringify({results:[],has_more:false}),{status:200});}
    if(String(url).includes('open.feishu.cn')){
      feishuCalls++;
      feishuText=JSON.parse(opts.body).content.text;
      return new Response(JSON.stringify({code:0}),{status:200});
    }
    throw Error('Unexpected external call');
  };
  const env={OPS_SCHEDULER_TOKEN:'t'.repeat(48),
    OPS_NOTION_READ_TOKEN:'n'.repeat(40),OPS_PRODUCTHUNT_NOTION_PARENT_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OPS_TRUSTMRR_NOTION_PARENT_ID:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',OPS_X_NOTION_PARENT_ID:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    FEISHU_WEBHOOK_URL:'https://open.feishu.cn/open-apis/bot/v2/hook/mock'};
  try{
    const res=await handleN8nCheck(new Request('https://ingest.monitor.qjai.org/v1/checks/producthunt_producer',{method:'POST',headers:{Authorization:'Bearer '+env.OPS_SCHEDULER_TOKEN}}),env);
    assert.equal(res.status,200);
    assert.equal((await res.json()).result,'alerted');
    for(const keyword of ['告警','监控','Product Hunt','READY','OPS']) assert.ok(feishuText.includes(keyword));
    assert.equal(notionCalls,1);assert.equal(feishuCalls,1);
  } finally{globalThis.fetch=orig;}
});

test('Feishu receipt accepts numeric-string success codes',()=>{
  assert.equal(feishuReceipt(200,{StatusCode:'0'}).accepted,true);
  assert.equal(feishuReceipt(200,{code:'19021'}).accepted,false);
});
test('n8n endpoint exposes safe provider diagnostics without response body',async()=>{
  const orig=globalThis.fetch;
  globalThis.fetch=async url=>{
    if(String(url).includes('api.notion.com'))
      return new Response(JSON.stringify({results:[],has_more:false}),{status:200});
    if(String(url).includes('open.feishu.cn'))
      return new Response(JSON.stringify({code:19021,msg:'invalid webhook'}),{status:200});
    throw Error('Unexpected external call');
  };
  const env={OPS_SCHEDULER_TOKEN:'t'.repeat(48),
    OPS_NOTION_READ_TOKEN:'n'.repeat(40),OPS_PRODUCTHUNT_NOTION_PARENT_ID:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',OPS_TRUSTMRR_NOTION_PARENT_ID:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',OPS_X_NOTION_PARENT_ID:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    FEISHU_WEBHOOK_URL:'https://open.feishu.cn/open-apis/bot/v2/hook/mock'};
  try{
    const res=await handleN8nCheck(new Request('https://ingest.monitor.qjai.org/v1/checks/producthunt_producer',{
      method:'POST',headers:{Authorization:'Bearer '+env.OPS_SCHEDULER_TOKEN}}),env);
    const body=await res.json();
    assert.equal(res.status,502);
    assert.equal(body.delivery.provider_code,19021);
    assert.equal(body.delivery.failure_reason,'provider_rejected');
    assert.equal(Object.hasOwn(body.delivery,'response_body'),false);
    assert.equal(JSON.stringify(body).includes('invalid webhook'),false);
  }finally{globalThis.fetch=orig;}
});
