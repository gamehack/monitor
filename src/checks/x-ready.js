// OPS X daily intelligence: read only the current Beijing-day Notion READY article.
// No Neon, CMS, WeChat, Grok, recovery action, or article content in outputs.
const xParent=env=>env.OPS_X_NOTION_PARENT_ID;
const X_NOTION='https://api.notion.com/v1';
const X_NOTION_VERSION='2026-03-11';
const X_JSON_HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const xReply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:X_JSON_HEADERS});

export function xBeijingDay(now=Date.now()) {
  const fields=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(now));
  const get=t=>fields.find(p=>p.type===t)?.value||'';
  return get('year')+'-'+get('month')+'-'+get('day');
}

export function xArticleVerdict(raw,period) {
  if(typeof raw!=='string'||raw.length<140||raw.length>500000)
    return {ok:false,reason:'CONTENT_INCOMPLETE'};
  const text=raw.replace(/\\_/g,'_').replace(/<br\s*\/?>/gi,'\n')
    .replace(/\r\n/g,'\n').replace(/&nbsp;/g,' ').trim();
  const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
  if(lines[lines.length-1]!=='交付状态：READY')
    return {ok:false,reason:'READY_MISSING'};
  if(!lines.includes('日期：'+period)||!lines.includes('生成者：Grok'))
    return {ok:false,reason:'METADATA_INVALID'};
  const dayBefore=new Date(Date.parse(period+'T00:00:00Z')-86400000)
    .toISOString().slice(0,10);
  const interval='采集区间：北京时间 '+dayBefore+' 06:00 至 '+period+' 06:00';
  if(!lines.includes(interval))return {ok:false,reason:'METADATA_INVALID'};
  if(!lines.some(x=>x.startsWith('实际完成时间（北京时间）：'+period+' ')&&
       /^实际完成时间（北京时间）：\d{4}-\d\d-\d\d \d\d:\d\d$/.test(x)))
    return {ok:false,reason:'METADATA_INVALID'};
  const found=lines.find(x=>/^原帖来源数量：\d+$/.test(x));
  if(!found)return {ok:false,reason:'METADATA_INVALID'};
  const count=Number(found.slice('原帖来源数量：'.length));
  if(!Number.isSafeInteger(count)||count>100)return {ok:false,reason:'METADATA_INVALID'};
  const headings=['今日摘要','重点资讯','潜界 AI 商业机会','建议动作','来源与核验说明'];
  const positions=headings.map(t=>lines.findIndex(x=>new RegExp('^#{2,4}\\s*'+t+'\\s*$').test(x)));
  if(positions.some(n=>n<0)||positions.some((n,i)=>i>0&&n<=positions[i-1]))
    return {ok:false,reason:'CONTENT_INCOMPLETE'};
  for(let i=0;i<positions.length;i++){
    const section=lines.slice(positions[i]+1, i+1<positions.length?positions[i+1]:lines.length-1)
      .join(' ').trim();
    if(section.length<16)return {ok:false,reason:'CONTENT_INCOMPLETE'};
  }
  if(count>0&&!/https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/\s]+\/status\/\d{8,}/i.test(text))
    return {ok:false,reason:'SOURCE_LINK_MISSING'};
  return {ok:true,reason:'READY'};
}

async function xNotionJson(path,env) {
  const r=await fetch(X_NOTION+path,{method:'GET',redirect:'manual',
    headers:{authorization:'Bearer '+env.OPS_NOTION_READ_TOKEN,
      'Notion-Version':X_NOTION_VERSION,accept:'application/json'},
    signal:AbortSignal.timeout(12000)});
  if(!r.ok||Number(r.headers.get('content-length')||0)>500000)
    throw new Error('NOTION_READ_FAILED');
  const text=await r.text();
  if(text.length>500000)throw new Error('NOTION_READ_OVERSIZE');
  return JSON.parse(text);
}

export async function checkXIntelligence(env,period=xBeijingDay()) {
  if(typeof env.OPS_NOTION_READ_TOKEN!=='string'||env.OPS_NOTION_READ_TOKEN.length<20)
    return {period,ok:false,reason:'NOTION_TOKEN_UNAVAILABLE'};
  let cursor=null,seen=new Set(),matches=[];
  try {
    for(let page=0;page<30;page++){
      const path='/blocks/'+xParent(env)+'/children?page_size=100'+
        (cursor?'&start_cursor='+encodeURIComponent(cursor):'');
      const result=await xNotionJson(path,env);
      if(!Array.isArray(result.results)||typeof result.has_more!=='boolean')
        throw new Error('NOTION_LIST_INVALID');
      for(const block of result.results){
        if(block?.type!=='child_page')continue;
        const title=block.child_page?.title||'';
        if(title.startsWith(period+'｜'))matches.push({id:block.id,title});
      }
      if(matches.length>1)return {period,ok:false,reason:'DUPLICATE_ARTICLE'};
      if(!result.has_more)break;
      cursor=result.next_cursor;
      if(!cursor||seen.has(cursor)||page===29)throw new Error('NOTION_PAGINATION_LIMIT');
      seen.add(cursor);
    }
    if(matches.length===0)return {period,ok:false,reason:'ARTICLE_MISSING'};
    const one=matches[0];
    if(one.title!==period+'｜X 每日商业情报')return {period,ok:false,reason:'TITLE_MISMATCH'};
    if(!/^[0-9a-f-]{32,36}$/i.test(String(one.id)))
      return {period,ok:false,reason:'NOTION_PAGE_INVALID'};
    const result=await xNotionJson('/pages/'+one.id+'/markdown?markdown_version=v2',env);
    if(result.object!=='page_markdown'||typeof result.markdown!=='string'||
      result.truncated!==false||(result.unknown_block_ids||[]).length>0||
      (result.warnings||[]).length>0)
      return {period,ok:false,reason:'NOTION_MARKDOWN_INCOMPLETE'};
    return {period,...xArticleVerdict(result.markdown,period)};
  } catch {
    return {period,ok:false,reason:'NOTION_UNAVAILABLE'};
  }
}

function xAuthorized(req,env) {
  const secret=env.OPS_SCHEDULER_TOKEN;
  const auth=req.headers.get('authorization')||'';
  if(typeof secret!=='string'||secret.length<32||!auth.startsWith('Bearer '))return false;
  const supplied=auth.slice(7);
  if(supplied.length!==secret.length||supplied.length>256)return false;
  let diff=0;
  for(let i=0;i<secret.length;i++)diff|=secret.charCodeAt(i)^supplied.charCodeAt(i);
  return diff===0;
}

async function xAlert(env,outcome) {
  let u;
  try{u=new URL(env.FEISHU_WEBHOOK_URL);}catch{return false;}
  if(u.protocol!=='https:'||u.hostname!=='open.feishu.cn'||
     !u.pathname.startsWith('/open-apis/bot/v2/hook/'))return false;
  const msg='[潜界AI OPS / P0] X 商业情报 READY 监控\n业务日期：'+outcome.period+
    '\n检查时间：07:00 Asia/Shanghai\n异常：'+outcome.reason+
    '\n处理方式：人工检查 Grok / Notion 正式文章，不自动补产。';
  try {
    const r=await fetch(u.toString(),{method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({msg_type:'text',content:{text:msg}}),
      signal:AbortSignal.timeout(7000)});
    if(!r.ok)return false;
    const raw=await r.text();
    if(raw.length>4096)return false;
    const body=JSON.parse(raw);
    return Number(body?.code??body?.StatusCode??body?.errcode)===0;
  }catch{return false;}
}

export async function handleN8nXCheck(req,env,now=Date.now()) {
  const url=new URL(req.url);
  if(req.method!=='POST'||url.hostname!=='ingest.monitor.qjai.org'||
      url.pathname!=='/v1/checks/x_intelligence')return xReply({error:'not_found'},404);
  if(!env.OPS_SCHEDULER_TOKEN)return xReply({error:'service_unavailable'},503);
  if(!xAuthorized(req,env))return xReply({error:'unauthorized'},401);
  if(Number(req.headers.get('content-length')||0)>128)
    return xReply({error:'request_too_large'},413);
  const today=xBeijingDay(now),probe=url.searchParams.get('probe');
  if([...url.searchParams.keys()].some(k=>k!=='probe')||
      (probe!==null&&!/^\d{4}-\d\d-\d\d$/.test(probe)))
    return xReply({error:'invalid_query'},400);
  if(probe!==null){
    const delta=Date.parse(today+'T00:00:00Z')-Date.parse(probe+'T00:00:00Z');
    if(!Number.isFinite(delta)||delta<0||delta>7*86400000)
      return xReply({error:'probe_period_out_of_range'},400);
  }
  const outcome=await checkXIntelligence(env,probe||today);
  if(probe!==null)return xReply({...outcome,probe:true,alert_sent:false});
  if(outcome.ok)return xReply({ok:true,result:'ready',period_key:today});
  const alerted=await xAlert(env,outcome);
  return alerted
    ?xReply({ok:true,result:'alerted',period_key:today,reason:outcome.reason})
    :xReply({ok:false,result:'delivery_failed',period_key:today,
      reason:outcome.reason},502);
}
