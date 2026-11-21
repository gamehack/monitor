import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {
  overseasProducerPeriod,
  findOverseasProducerScheduledRun,
  overseasProducerRunVerdict,
  handleN8nOverseasProducerCheck
} from '../src/checks/router.js';

const period='2026-11-23';
const now=Date.parse('2026-11-23T14:00:00+08:00');
const goodRun={
  id:777,event:'schedule',head_branch:'main',status:'completed',conclusion:'success',
  created_at:'2026-11-22T22:45:00Z',
  html_url:'https://github.com/gamehack/overseas-story-producer/actions/runs/777'
};
const goodJob={id:888,name:'produce',status:'completed',conclusion:'success'};
const env=()=>({
  OPS_SCHEDULER_TOKEN:'t'.repeat(48),
  GITHUB_READ_TOKEN:'g'.repeat(40),
  FEISHU_WEBHOOK_URL:'https://open.feishu.cn/open-apis/bot/v2/hook/mock'
});
const request=token=>new Request('https://ingest.monitor.qjai.org/v1/checks/overseas_producer',{
  method:'POST',headers:token?{Authorization:'Bearer '+token}:{}
});

test('producer monitoring period uses the Asia/Shanghai calendar date',()=>{
  assert.equal(overseasProducerPeriod(now),period);
  assert.equal(overseasProducerPeriod(Date.parse('2026-11-22T22:45:00Z')),period);
});

test('selects only the latest scheduled main-branch production.yml run for the Beijing date',()=>{
  const runs=[
    {...goodRun,id:700,created_at:'2026-11-15T22:45:00Z'},
    {...goodRun,id:701,event:'push'},
    {...goodRun,id:702,head_branch:'feature/test'},
    {...goodRun,id:703,created_at:'2026-11-22T22:35:00Z'},
    {...goodRun,id:704,created_at:'2026-11-22T22:55:00Z'}
  ];
  assert.equal(findOverseasProducerScheduledRun(period,runs).id,704);
});

test('missing, running, failed and cancelled runs are not healthy',()=>{
  assert.equal(overseasProducerRunVerdict(null,null).reason,'SCHEDULED_RUN_MISSING');
  assert.equal(overseasProducerRunVerdict({...goodRun,status:'in_progress'},null).reason,
    'RUN_NOT_COMPLETED');
  assert.equal(overseasProducerRunVerdict({...goodRun,conclusion:'failure'},null).reason,
    'RUN_CONCLUSION_FAILURE');
  assert.equal(overseasProducerRunVerdict({...goodRun,conclusion:'cancelled'},null).reason,
    'RUN_CONCLUSION_CANCELLED');
});

test('success requires a non-empty jobs list and every job completed successfully',()=>{
  assert.equal(overseasProducerRunVerdict(goodRun,[]).reason,'JOBS_MISSING');
  assert.equal(overseasProducerRunVerdict(goodRun,[{...goodJob,status:'in_progress'}]).reason,
    'JOB_NOT_SUCCESS');
  assert.equal(overseasProducerRunVerdict(goodRun,[{...goodJob,conclusion:'skipped'}]).reason,
    'JOB_NOT_SUCCESS');
  assert.equal(overseasProducerRunVerdict(goodRun,[goodJob]).ok,true);
});

test('unauthorized request is rejected before GitHub or Feishu calls',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;throw new Error('unexpected external call');};
  try{
    const response=await handleN8nOverseasProducerCheck(request(null),env(),now);
    assert.equal(response.status,401);
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});

test('successful production run is silent and checks the exact workflow jobs',async()=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async url=>{
    calls.push(String(url));
    if(String(url).includes('/actions/workflows/production.yml/runs?'))
      return new Response(JSON.stringify({workflow_runs:[goodRun]}),{status:200});
    if(String(url).includes('/actions/runs/777/jobs?'))
      return new Response(JSON.stringify({jobs:[goodJob]}),{status:200});
    throw new Error('unexpected external call: '+url);
  };
  try{
    const response=await handleN8nOverseasProducerCheck(request('t'.repeat(48)),env(),now);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.result,'success');
    assert.equal(body.period_key,period);
    assert.equal(body.run_id,777);
    assert.equal(calls.length,2);
  }finally{globalThis.fetch=original;}
});

test('partial or failed production sends one P0 Feishu alert without dispatching a rerun',async()=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push(String(url));
    if(String(url).includes('/actions/workflows/production.yml/runs?'))
      return new Response(JSON.stringify({workflow_runs:[{...goodRun,conclusion:'failure'}]}),{status:200});
    if(String(url).includes('open.feishu.cn')){
      const payload=JSON.parse(options.body);
      assert.match(payload.content.text,/overseas_producer/);
      assert.match(payload.content.text,/RUN_CONCLUSION_FAILURE/);
      assert.match(payload.content.text,/overseas-story-producer\/actions\/runs\/777/);
      assert.match(payload.content.text,/不自动恢复/);
      return new Response(JSON.stringify({code:0}),{status:200});
    }
    throw new Error('unexpected external call: '+url);
  };
  try{
    const response=await handleN8nOverseasProducerCheck(request('t'.repeat(48)),env(),now);
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.result,'alerted');
    assert.equal(body.reason,'RUN_CONCLUSION_FAILURE');
    assert.equal(calls.length,2);
    assert.ok(!calls.some(url=>url.includes('/dispatches')));
  }finally{globalThis.fetch=original;}
});

test('worker routes producer checks before opening a Neon connection',async()=>{
  const original=globalThis.fetch;const calls=[];
  const todayRun={...goodRun,created_at:new Date().toISOString()};
  globalThis.fetch=async url=>{
    calls.push(String(url));
    if(String(url).includes('/actions/workflows/production.yml/runs?'))
      return new Response(JSON.stringify({workflow_runs:[todayRun]}),{status:200});
    if(String(url).includes('/actions/runs/777/jobs?'))
      return new Response(JSON.stringify({jobs:[goodJob]}),{status:200});
    throw new Error('unexpected external call: '+url);
  };
  const base=env();
  const isolated=new Proxy(base,{get(target,key,receiver){
    if(key==='OPS_DATABASE_DRIVER'||key==='HYPERDRIVE')
      throw new Error('Neon must not be accessed by the stateless n8n endpoint');
    return Reflect.get(target,key,receiver);
  }});
  try{
    const response=await worker.fetch(request('t'.repeat(48)),isolated,{});
    assert.equal(response.status,200);
    assert.equal((await response.json()).result,'success');
    assert.equal(calls.length,2);
  }finally{globalThis.fetch=original;}
});
