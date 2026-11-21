// n8n -> OPS single-job checks, handled before any Neon database connection.
import {checkProductHuntReady,productHuntPeriod} from './notion-ready.js';
import {feishuReceipt} from '../alert-delivery.js';

const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});

export function authorizedScheduler(request,env) {
  const secret=env.OPS_SCHEDULER_TOKEN;
  const auth=request.headers.get('authorization')||'';
  if(typeof secret!=='string'||secret.length<32||!auth.startsWith('Bearer '))return false;
  const supplied=auth.slice(7);
  if(supplied.length!==secret.length||supplied.length>256)return false;
  let diff=0;
  for(let i=0;i<secret.length;i++)diff|=secret.charCodeAt(i)^supplied.charCodeAt(i);
  return diff===0;
}

const messages={
  ARTICLE_MISSING:'该业务日期没有找到 Product Hunt 文章',
  DUPLICATE_ARTICLE:'该业务日期存在多篇同名日期前缀的文章',
  READY_MISSING:'文章存在但缺少对应日期的 READY 标记',
  NOTION_UNAVAILABLE:'Notion 查询失败，无法确认 READY 状态'
};

async function notifyFeishu(env,period,reason) {
  const url=env.FEISHU_WEBHOOK_URL;
  if(typeof url!=='string'||!url.trim())
    return {accepted:false,retryable:false,code:null,transportStatus:0,
      failureReason:'missing_webhook_url'};
  let target;
  try {target=new URL(url);} catch {
    return {accepted:false,retryable:false,code:null,transportStatus:0,
      failureReason:'invalid_webhook_url'};
  }
  if(target.protocol!=='https:'||target.hostname!=='open.feishu.cn'||
    !target.pathname.startsWith('/open-apis/bot/v2/hook/'))
    return {accepted:false,retryable:false,code:null,transportStatus:0,
      failureReason:'webhook_url_not_allowed'};
  const payload={msg_type:'text',content:{text:
    '[潜界AI OPS / P0 告警] Product Hunt READY 监控\n'+
    '业务日期：'+period+'\n北京时间 18:00 检查\n'+
    '异常：'+(messages[reason]||messages.NOTION_UNAVAILABLE)+'\n'+
    '关键词：告警 监控 Product Hunt READY OPS\n'+
    '处理方式：人工检查 Notion 文章，无自动恢复。'}};
  try{
    const reply=await fetch(target.toString(),{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(7000)});
    let body=null,responseKind='non_json';
    try {
      const txt=await reply.text();
      if(txt.length<=4096){body=JSON.parse(txt);responseKind='json';}
      else responseKind='oversize';
    }catch {}
    const receipt=feishuReceipt(reply.status,body);
    const failureReason=receipt.accepted?null:
      reply.status<200||reply.status>=300?'http_status':
      body?'provider_rejected':'invalid_provider_response';
    return {...receipt,failureReason,responseKind};
  }catch(error){
    return {accepted:false,retryable:true,code:null,transportStatus:0,
      failureReason:'fetch_exception',
      errorName:typeof error?.name==='string'?error.name:'Error'};
  }
}


export function overseasCollectorPeriod(now=Date.now()) {
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(now));
  const value=type=>parts.find(part=>part.type===type)?.value||'';
  return value('year')+'-'+value('month')+'-'+value('day');
}

function overseasBeijingDay(iso) {
  const timestamp=Date.parse(iso||'');
  return Number.isFinite(timestamp)?overseasCollectorPeriod(timestamp):null;
}

export function findOverseasScheduledRun(period,runs) {
  if(!Array.isArray(runs))return null;
  return runs.filter(run=>run?.event==='schedule'&&run?.head_branch==='main'&&
    overseasBeijingDay(run.created_at)===period&&
    Number.isSafeInteger(Number(run.id))&&Number(run.id)>0)
    .sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0]||null;
}

export function overseasRunVerdict(run,jobs) {
  if(!run)return {ok:false,reason:'SCHEDULED_RUN_MISSING'};
  if(run.status!=='completed')return {ok:false,reason:'RUN_NOT_COMPLETED'};
  if(run.conclusion!=='success')
    return {ok:false,reason:'RUN_CONCLUSION_'+String(run.conclusion||'UNKNOWN').toUpperCase()};
  if(!Array.isArray(jobs)||jobs.length===0)return {ok:false,reason:'JOBS_MISSING'};
  if(jobs.some(job=>job?.status!=='completed'||job?.conclusion!=='success'))
    return {ok:false,reason:'JOB_NOT_SUCCESS'};
  return {ok:true,reason:'SUCCESS'};
}

export async function checkOverseasCollector(env,now=Date.now()) {
  const period=overseasCollectorPeriod(now);
  const headers={
    'user-agent':'qjai-ops/1.0 (+https://monitor.qjai.org)',
    'accept':'application/vnd.github+json',
    'x-github-api-version':'2022-11-28'
  };
  if(env.GITHUB_READ_TOKEN)headers.authorization='Bearer '+env.GITHUB_READ_TOKEN;
  try {
    const runsResponse=await fetch(
      'https://api.github.com/repos/gamehack/overseas-story-supabase/actions/workflows/weekly-pipeline.yml/runs?branch=main&event=schedule&per_page=20',
      {headers,signal:AbortSignal.timeout(10000)}
    );
    if(!runsResponse.ok)return {ok:false,period,reason:'GITHUB_RUNS_HTTP_'+runsResponse.status};
    const runsPayload=await runsResponse.json();
    if(!Array.isArray(runsPayload.workflow_runs))
      return {ok:false,period,reason:'GITHUB_RUNS_RESPONSE_INVALID'};
    const run=findOverseasScheduledRun(period,runsPayload.workflow_runs);
    if(!run)return {ok:false,period,reason:'SCHEDULED_RUN_MISSING'};
    const initial=overseasRunVerdict(run,null);
    if(initial.reason!=='JOBS_MISSING')
      return {...initial,period,runId:Number(run.id),externalUrl:run.html_url||null};
    const runId=Number(run.id);
    const jobsResponse=await fetch(
      'https://api.github.com/repos/gamehack/overseas-story-supabase/actions/runs/'+runId+'/jobs?per_page=100',
      {headers,signal:AbortSignal.timeout(10000)}
    );
    if(!jobsResponse.ok)
      return {ok:false,period,reason:'GITHUB_JOBS_HTTP_'+jobsResponse.status,
        runId,externalUrl:run.html_url||null};
    const jobsPayload=await jobsResponse.json();
    const verdict=overseasRunVerdict(run,jobsPayload.jobs);
    return {...verdict,period,runId,externalUrl:run.html_url||null};
  } catch {
    return {ok:false,period,reason:'GITHUB_API_UNAVAILABLE'};
  }
}

async function notifyOverseasFeishu(env,outcome) {
  const url=env.FEISHU_WEBHOOK_URL;
  let target;
  try {target=new URL(url);} catch {return false;}
  if(target.protocol!=='https:'||target.hostname!=='open.feishu.cn'||
    !target.pathname.startsWith('/open-apis/bot/v2/hook/'))return false;
  const reason=String(outcome.reason||'UNKNOWN').slice(0,80);
  const runUrl=typeof outcome.externalUrl==='string'&&
    /^https:\/\/github\.com\/gamehack\/overseas-story-supabase\/actions\/runs\/[0-9]+$/.test(outcome.externalUrl)
      ?'\n运行记录：'+outcome.externalUrl:'';
  const payload={msg_type:'text',content:{text:
    '[潜界AI OPS / P0] overseas_collector\n'+
    '业务日期：'+(outcome.period||overseasCollectorPeriod())+'\n'+
    '北京时间 20:00 周度检查\n'+
    '异常：'+reason+'\n'+
    '处理方式：人工检查 GitHub Actions 周度流水线；不自动恢复。'+runUrl}};
  try {
    const reply=await fetch(target.toString(),{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(7000)
    });
    let body=null;
    try {const txt=await reply.text();if(txt.length<=4096)body=JSON.parse(txt);}catch {}
    return feishuReceipt(reply.status,body).accepted;
  } catch {return false;}
}

export async function handleN8nCheck(request,env) {
  const url=new URL(request.url);
  if(request.method!=='POST'||url.hostname!=='ingest.monitor.qjai.org'||
    url.pathname!=='/v1/checks/producthunt_producer')return response({error:'not_found'},404);
  if(!env.OPS_SCHEDULER_TOKEN)return response({error:'service_unavailable'},503);
  if(!authorizedScheduler(request,env))return response({error:'unauthorized'},401);
  if(Number(request.headers.get('content-length')||0)>128)
    return response({error:'request_too_large'},413);
  let outcome;
  try{outcome=await checkProductHuntReady(env);}
  catch{
    // Never log or expose Notion tokens, article content, or raw provider errors.
    outcome={period:productHuntPeriod(),ready:false,reason:'NOTION_UNAVAILABLE'};
  }
  if(outcome.ready)return response({ok:true,result:'ready',period_key:outcome.period});
  const delivery=await notifyFeishu(env,outcome.period,outcome.reason);
  return delivery.accepted
    ?response({ok:true,result:'alerted',period_key:outcome.period,reason:outcome.reason})
    :response({ok:false,result:'delivery_failed',period_key:outcome.period,
      reason:outcome.reason,delivery:{
        http_status:delivery.transportStatus,
        provider_code:delivery.code,
        retryable:delivery.retryable,
        failure_reason:delivery.failureReason,
        response_kind:delivery.responseKind||null,
        error_name:delivery.errorName||null
      }},502);
}

export async function handleN8nOverseasCheck(request,env,now=Date.now()) {
  const url=new URL(request.url);
  if(request.method!=='POST'||url.hostname!=='ingest.monitor.qjai.org'||
    url.pathname!=='/v1/checks/overseas_collector')return response({error:'not_found'},404);
  if(!env.OPS_SCHEDULER_TOKEN)return response({error:'service_unavailable'},503);
  if(!authorizedScheduler(request,env))return response({error:'unauthorized'},401);
  if(Number(request.headers.get('content-length')||0)>128)
    return response({error:'request_too_large'},413);
  const outcome=await checkOverseasCollector(env,now);
  if(outcome.ok)return response({ok:true,result:'success',
    period_key:outcome.period,run_id:outcome.runId});
  const notified=await notifyOverseasFeishu(env,outcome);
  return notified
    ?response({ok:true,result:'alerted',period_key:outcome.period,reason:outcome.reason})
    :response({ok:false,result:'delivery_failed',period_key:outcome.period,
      reason:outcome.reason},502);
}


export function overseasProducerPeriod(now=Date.now()) {
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(now));
  const value=type=>parts.find(part=>part.type===type)?.value||'';
  return value('year')+'-'+value('month')+'-'+value('day');
}

function overseasProducerBeijingDay(iso) {
  const timestamp=Date.parse(iso||'');
  return Number.isFinite(timestamp)?overseasProducerPeriod(timestamp):null;
}

export function findOverseasProducerScheduledRun(period,runs) {
  if(!Array.isArray(runs))return null;
  return runs.filter(run=>run?.event==='schedule'&&run?.head_branch==='main'&&
    overseasProducerBeijingDay(run.created_at)===period&&
    Number.isSafeInteger(Number(run.id))&&Number(run.id)>0)
    .sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0]||null;
}

export function overseasProducerRunVerdict(run,jobs) {
  if(!run)return {ok:false,reason:'SCHEDULED_RUN_MISSING'};
  if(run.status!=='completed')return {ok:false,reason:'RUN_NOT_COMPLETED'};
  if(run.conclusion!=='success')
    return {ok:false,reason:'RUN_CONCLUSION_'+String(run.conclusion||'UNKNOWN').toUpperCase()};
  if(!Array.isArray(jobs)||jobs.length===0)return {ok:false,reason:'JOBS_MISSING'};
  if(jobs.some(job=>job?.status!=='completed'||job?.conclusion!=='success'))
    return {ok:false,reason:'JOB_NOT_SUCCESS'};
  return {ok:true,reason:'SUCCESS'};
}

export async function checkOverseasProducer(env,now=Date.now()) {
  const period=overseasProducerPeriod(now);
  if(typeof env.GITHUB_READ_TOKEN!=='string'||env.GITHUB_READ_TOKEN.length<20)
    return {ok:false,period,reason:'GITHUB_TOKEN_NOT_CONFIGURED'};
  const headers={
    'user-agent':'qjai-ops/1.0 (+https://monitor.qjai.org)',
    'accept':'application/vnd.github+json',
    'x-github-api-version':'2022-11-28',
    authorization:'Bearer '+env.GITHUB_READ_TOKEN
  };
  try {
    const runsResponse=await fetch(
      'https://api.github.com/repos/gamehack/overseas-story-producer/actions/workflows/production.yml/runs?branch=main&event=schedule&per_page=20',
      {headers,signal:AbortSignal.timeout(10000)}
    );
    if(!runsResponse.ok)return {ok:false,period,reason:'GITHUB_RUNS_HTTP_'+runsResponse.status};
    const runsPayload=await runsResponse.json();
    if(!Array.isArray(runsPayload.workflow_runs))
      return {ok:false,period,reason:'GITHUB_RUNS_RESPONSE_INVALID'};
    const run=findOverseasProducerScheduledRun(period,runsPayload.workflow_runs);
    if(!run)return {ok:false,period,reason:'SCHEDULED_RUN_MISSING'};
    const initial=overseasProducerRunVerdict(run,null);
    if(initial.reason!=='JOBS_MISSING')
      return {...initial,period,runId:Number(run.id),externalUrl:run.html_url||null};
    const runId=Number(run.id);
    const jobsResponse=await fetch(
      'https://api.github.com/repos/gamehack/overseas-story-producer/actions/runs/'+runId+'/jobs?per_page=100',
      {headers,signal:AbortSignal.timeout(10000)}
    );
    if(!jobsResponse.ok)
      return {ok:false,period,reason:'GITHUB_JOBS_HTTP_'+jobsResponse.status,
        runId,externalUrl:run.html_url||null};
    const jobsPayload=await jobsResponse.json();
    const verdict=overseasProducerRunVerdict(run,jobsPayload.jobs);
    return {...verdict,period,runId,externalUrl:run.html_url||null};
  } catch {
    return {ok:false,period,reason:'GITHUB_API_UNAVAILABLE'};
  }
}

async function notifyOverseasProducerFeishu(env,outcome) {
  const url=env.FEISHU_WEBHOOK_URL;
  let target;
  try {target=new URL(url);} catch {return false;}
  if(target.protocol!=='https:'||target.hostname!=='open.feishu.cn'||
    !target.pathname.startsWith('/open-apis/bot/v2/hook/'))return false;
  const reason=String(outcome.reason||'UNKNOWN').slice(0,80);
  const runUrlPrefix='https://github.com/gamehack/overseas-story-producer/actions/runs/';
  const runUrl=typeof outcome.externalUrl==='string'&&
    outcome.externalUrl.startsWith(runUrlPrefix)&&
    /^[0-9]+$/.test(outcome.externalUrl.slice(runUrlPrefix.length))
      ?'\n运行记录：'+outcome.externalUrl:'';
  const payload={msg_type:'text',content:{text:
    '[潜界AI OPS / P0] overseas_producer\n'+
    '业务日期：'+(outcome.period||overseasProducerPeriod())+'\n'+
    '北京时间 14:00 周度检查\n'+
    '异常：'+reason+'\n'+
    '处理方式：人工检查 GitHub Actions 生产流水线；不自动恢复。'+runUrl}};
  try {
    const reply=await fetch(target.toString(),{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(7000)
    });
    let body=null;
    try {const txt=await reply.text();if(txt.length<=4096)body=JSON.parse(txt);}catch {}
    return feishuReceipt(reply.status,body).accepted;
  } catch {return false;}
}

export async function handleN8nOverseasProducerCheck(request,env,now=Date.now()) {
  const url=new URL(request.url);
  if(request.method!=='POST'||url.hostname!=='ingest.monitor.qjai.org'||
    url.pathname!=='/v1/checks/overseas_producer')return response({error:'not_found'},404);
  if(!env.OPS_SCHEDULER_TOKEN)return response({error:'service_unavailable'},503);
  if(!authorizedScheduler(request,env))return response({error:'unauthorized'},401);
  if(Number(request.headers.get('content-length')||0)>128)
    return response({error:'request_too_large'},413);
  const outcome=await checkOverseasProducer(env,now);
  if(outcome.ok)return response({ok:true,result:'success',
    period_key:outcome.period,run_id:outcome.runId});
  const notified=await notifyOverseasProducerFeishu(env,outcome);
  return notified
    ?response({ok:true,result:'alerted',period_key:outcome.period,reason:outcome.reason})
    :response({ok:false,result:'delivery_failed',period_key:outcome.period,
      reason:outcome.reason},502);
}
