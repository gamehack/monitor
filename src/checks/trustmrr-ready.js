// OPS item 15: TrustMRR weekly Notion READY status only.
// Deliberately no article SHA-256 validation, Top 25 checks, GitHub jobs, or Neon.
const tmParent=env=>env.OPS_TRUSTMRR_NOTION_PARENT_ID;
const TM_NOTION='https://api.notion.com/v1';
const TM_VERSION='2026-03-11';
const TM_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const tmJson=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:TM_HEADERS});

export function tmBeijingClock(now=Date.now()){
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',
    day:'2-digit',weekday:'short',hour:'2-digit',hourCycle:'h23'
  }).formatToParts(new Date(now));
  const get=k=>parts.find(x=>x.type===k)?.value||'';
  return {date:get('year')+'-'+get('month')+'-'+get('day'),
    weekday:get('weekday'),hour:Number(get('hour'))};
}

export function tmReadyVerdict(markdown,period){
  if(typeof markdown!=='string'||markdown.length===0)
    return {ok:false,reason:'READY_MISSING'};
  const lines=markdown.replace(/\r\n?/g,'\n').trimEnd().split('\n');
  const last=(lines[lines.length-1]||'').trim()
    .replace(/\\_/g,'_').replace(/^<code>/,'').replace(/<\/code>$/,'');
  const match=/^QJAI_PUBLISH_READY v=1 source_key=(\S+)(?:\s|$)/.exec(last);
  if(!match)return {ok:false,reason:'READY_MISSING'};
  if(match[1]!=='trustmrr-weekly:'+period)
    return {ok:false,reason:'PERIOD_MISMATCH'};
  // Only the READY state and source_key are checked. Do NOT validate any digest.
  return {ok:true,reason:'READY'};
}

async function tmNotionGet(path,env){
  const resp=await fetch(TM_NOTION+path,{
    method:'GET',redirect:'manual',
    headers:{authorization:'Bearer '+env.OPS_NOTION_READ_TOKEN,
      'Notion-Version':TM_VERSION,accept:'application/json'},
    signal:AbortSignal.timeout(12000)
  });
  if(!resp.ok||Number(resp.headers.get('content-length')||0)>500000)
    throw new Error('NOTION_READ_FAILED');
  const raw=await resp.text();
  if(raw.length>500000)throw new Error('NOTION_RESPONSE_OVERSIZE');
  return JSON.parse(raw);
}

export async function checkTrustMrrWeekly(env,period){
  if(!env.OPS_NOTION_READ_TOKEN||String(env.OPS_NOTION_READ_TOKEN).length<20)
    return {period,ok:false,reason:'NOTION_TOKEN_UNAVAILABLE'};
  let cursor=null;
  const seen=new Set(),matches=[];
  try {
    for(let page=0;page<30;page++){
      const result=await tmNotionGet('/blocks/'+tmParent(env)+'/children?page_size=100'+
        (cursor?'&start_cursor='+encodeURIComponent(cursor):''),env);
      if(!Array.isArray(result.results)||typeof result.has_more!=='boolean')
        throw new Error('INVALID_CHILDREN_RESPONSE');
      for(const block of result.results){
        if(block?.type!=='child_page')continue;
        const title=block.child_page?.title||'';
        if(title.startsWith(period+'｜TrustMRR 周报｜'))
          matches.push({id:block.id,title});
      }
      if(matches.length>1)return {period,ok:false,reason:'DUPLICATE_PERIOD'};
      if(!result.has_more)break;
      cursor=result.next_cursor;
      if(!cursor||seen.has(cursor)||page===29)
        throw new Error('NOTION_PAGINATION_LIMIT');
      seen.add(cursor);
    }
    if(!matches.length)return {period,ok:false,reason:'REPORT_MISSING'};
    if(!/^[0-9a-f-]{32,36}$/i.test(String(matches[0].id)))
      return {period,ok:false,reason:'INVALID_PAGE_ID'};
    const article=await tmNotionGet('/pages/'+matches[0].id+
      '/markdown?markdown_version=v2',env);
    if(article.object!=='page_markdown'||typeof article.markdown!=='string'||
      article.truncated!==false||
      (article.unknown_block_ids||[]).length>0||
      (article.warnings||[]).length>0)
      return {period,ok:false,reason:'NOTION_STATUS_UNAVAILABLE'};
    return {period,...tmReadyVerdict(article.markdown,period)};
  }catch{
    return {period,ok:false,reason:'NOTION_UNAVAILABLE'};
  }
}

function tmAuthorized(req,env){
  const secret=env.OPS_SCHEDULER_TOKEN;
  const auth=req.headers.get('authorization')||'';
  if(typeof secret!=='string'||secret.length<32||!auth.startsWith('Bearer '))
    return false;
  const got=auth.slice(7);
  if(got.length!==secret.length||got.length>256)return false;
  let mismatch=0;
  for(let i=0;i<secret.length;i++)
    mismatch|=secret.charCodeAt(i)^got.charCodeAt(i);
  return mismatch===0;
}

async function tmFeishuAlert(env,outcome){
  let url;
  try{url=new URL(env.FEISHU_WEBHOOK_URL);}catch{return false;}
  if(url.protocol!=='https:'||url.hostname!=='open.feishu.cn'||
     !url.pathname.startsWith('/open-apis/bot/v2/hook/'))return false;
  const message='[潜界AI OPS / P0] TrustMRR 周榜 READY 监控\n'+
    '业务期号：trustmrr-weekly:'+outcome.period+
    '\n检查时间：周一 19:00（北京时间）'+
    '\n异常：'+outcome.reason+
    '\n处理方式：人工检查 TrustMRR GitHub Actions 与 Notion 当周 READY；不自动补产。';
  try{
    const r=await fetch(url.toString(),{method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({msg_type:'text',content:{text:message}}),
      signal:AbortSignal.timeout(7000)});
    if(!r.ok)return false;
    const raw=await r.text();
    if(raw.length>4096)return false;
    const body=JSON.parse(raw);
    return Number(body?.code??body?.StatusCode??body?.errcode)===0;
  }catch{return false;}
}

export async function handleN8nTrustMrrWeeklyCheck(req,env,now=Date.now()){
  const url=new URL(req.url);
  if(req.method!=='POST'||url.hostname!=='ingest.monitor.qjai.org'||
    url.pathname!=='/v1/checks/trustmrr_weekly')
    return tmJson({error:'not_found'},404);
  if(!env.OPS_SCHEDULER_TOKEN)return tmJson({error:'service_unavailable'},503);
  if(!tmAuthorized(req,env))return tmJson({error:'unauthorized'},401);
  if(Number(req.headers.get('content-length')||0)>128)
    return tmJson({error:'request_too_large'},413);
  const probe=url.searchParams.get('probe');
  if([...url.searchParams.keys()].some(k=>k!=='probe')||
    (probe!==null&&!/^\d{4}-\d\d-\d\d$/.test(probe)))
    return tmJson({error:'invalid_query'},400);
  const clock=tmBeijingClock(now);
  if(probe===null&&(clock.weekday!=='Mon'||clock.hour<19))
    return tmJson({error:'outside_monday_19_window',period_key:clock.date},409);
  if(probe!==null){
    const probed=Date.parse(probe+'T00:00:00Z');
    const diff=Date.parse(clock.date+'T00:00:00Z')-probed;
    if(!Number.isFinite(probed)||!Number.isFinite(diff)||
       diff<0||diff>84*86400000||new Date(probed).getUTCDay()!==1)
      return tmJson({error:'invalid_probe_period'},400);
  }
  const period=probe||clock.date;
  const result=await checkTrustMrrWeekly(env,period);
  if(probe!==null)
    return tmJson({...result,probe:true,alert_sent:false});
  if(result.ok)return tmJson({ok:true,result:'ready',period_key:period});
  const sent=await tmFeishuAlert(env,result);
  return sent
    ?tmJson({ok:true,result:'alerted',period_key:period,reason:result.reason})
    :tmJson({ok:false,result:'delivery_failed',
      period_key:period,reason:result.reason},502);
}
