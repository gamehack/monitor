import test from 'node:test';
import assert from 'node:assert/strict';
import {xBeijingDay,xArticleVerdict,checkXIntelligence,handleN8nXCheck} from '../src/checks/x-ready.js';

const date='2026-11-21';
const article=[
  '日期：2026-11-21',
  '采集区间：北京时间 2026-11-20 06:00 至 2026-11-21 06:00',
  '生成者：Grok',
  '交付状态：READY',
  '实际完成时间（北京时间）：2026-11-21 06:15',
  '原帖来源数量：1',
  '## 今日摘要',
  '今日原帖包含值得验证的真实收入数据和小规模 AI 商业产品。',
  '## 重点资讯',
  '原帖链接：https://x.com/example/status/2123804308961440064 分析创业商业机会及客户数据。',
  '## 潜界 AI 商业机会',
  '该机会需要进一步测试付费意愿、客户价值和垂直行业潜力。',
  '## 建议动作',
  '找到三个客户沟通需求，使用真实数据验证是否值得进一步开发。',
  '## 来源与核验说明',
  '收入属于作者的自述，尚未进行独立验证，避免当作已证实的收入。',
  '交付状态：READY'
].join('\n');

test('Beijing day, including cross-UTC-midnight',()=>{
  assert.equal(xBeijingDay(Date.parse('2026-11-20T23:10:00Z')),'2026-11-21');
  assert.equal(xBeijingDay(Date.parse('2026-11-21T16:00:00Z')),'2026-11-22');
});
test('valid Grok article and correct source metadata',()=>{
  assert.deepEqual(xArticleVerdict(article,date),{ok:true,reason:'READY'});
  assert.equal(xArticleVerdict(article.replace(/交付状态：READY$/,'交付状态：DRAFT'),date).reason,'READY_MISSING');
});
test('rejects missing final READY, false content, bad period and missing source',()=>{
  assert.equal(xArticleVerdict(article.replace(/交付状态：READY$/,'交付状态：DRAFT'),date).reason,'READY_MISSING');
  assert.equal(xArticleVerdict(article.replace('2026-11-20 06:00','2026-11-19 06:00'),date).reason,'METADATA_INVALID');
  assert.equal(xArticleVerdict(article.replace('## 建议动作','## 无建议'),date).reason,'CONTENT_INCOMPLETE');
  assert.equal(xArticleVerdict(article.replace('https://x.com/example/status/2123804308961440064','无有效来源'),date).reason,'SOURCE_LINK_MISSING');
});
test('auth guard: unauthenticated probe has no external I/O',async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('unexpected network access')};
  try{
    const r=await handleN8nXCheck(new Request('https://ingest.monitor.qjai.org/v1/checks/x_intelligence?probe='+date,{method:'POST'}),{OPS_SCHEDULER_TOKEN:'k'.repeat(40)},Date.parse('2026-11-21T23:00:00Z'));
    assert.equal(r.status,401);
  }finally{globalThis.fetch=old;}
});
test('Notion read-only response: unique exact child and markdown',async()=>{
  const old=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async(url)=>{
    calls++;
    const value=String(url).includes('/children')
      ?{results:[{id:'41e9e605-ccf8-81f4-8fa8-f6e1ba32e691',type:'child_page',child_page:{title:date+'｜X 每日商业情报'}}],has_more:false}
      :{object:'page_markdown',markdown:article,truncated:false,unknown_block_ids:[],warnings:[]};
    return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const r=await checkXIntelligence({OPS_NOTION_READ_TOKEN:'z'.repeat(40),OPS_X_NOTION_PARENT_ID:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},date);
    assert.deepEqual(r,{period:date,ok:true,reason:'READY'});
    assert.equal(calls,2);
  }finally{globalThis.fetch=old;}
});
test('duplicate date pages fail closed',async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({results:[
    {id:'1',type:'child_page',child_page:{title:date+'｜X 每日商业情报'}},
    {id:'2',type:'child_page',child_page:{title:date+'｜重复'}}],has_more:false}),{status:200});
  try{assert.equal((await checkXIntelligence({OPS_NOTION_READ_TOKEN:'z'.repeat(40),OPS_X_NOTION_PARENT_ID:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},date)).reason,'DUPLICATE_ARTICLE');}
  finally{globalThis.fetch=old;}
});
test('probe returns result and never calls Feishu',async()=>{
  const old=globalThis.fetch;
  let count=0;
  globalThis.fetch=async url=>{
    count++;
    if(String(url).includes('open.feishu.cn'))throw Error('unexpected alert');
    return new Response(JSON.stringify({results:[],has_more:false}),{status:200});
  };
  try {
    const r=await handleN8nXCheck(new Request('https://ingest.monitor.qjai.org/v1/checks/x_intelligence?probe='+date,{method:'POST',headers:{authorization:'Bearer '+'k'.repeat(40)}}),
      {OPS_SCHEDULER_TOKEN:'k'.repeat(40),OPS_NOTION_READ_TOKEN:'z'.repeat(40),OPS_X_NOTION_PARENT_ID:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'},Date.parse('2026-11-22T00:00:00Z'));
    assert.equal(r.status,200);
    assert.deepEqual(await r.json(),{period:date,ok:false,reason:'ARTICLE_MISSING',probe:true,alert_sent:false});
    assert.equal(count,1);
  }finally{globalThis.fetch=old;}
});
