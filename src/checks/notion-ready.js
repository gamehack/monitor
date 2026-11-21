// Read-only Product Hunt Notion READY status. Intentionally DO NOT hash article content.
const PARENT_ENV='OPS_PRODUCTHUNT_NOTION_PARENT_ID';
const NOTION_BASE='https://api.notion.com/v1';
const NOTION_VERSION='2026-03-11';

export function productHuntPeriod(now=Date.now()) {
  const parts=new Intl.DateTimeFormat('en-US',{
    timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(now));
  const value=type=>Number(parts.find(p=>p.type===type)?.value);
  const day=Date.UTC(value('year'),value('month')-1,value('day'))-86400000;
  return new Date(day).toISOString().slice(0,10);
}

export function isNotionReady(markdown,period) {
  if(typeof markdown!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(period))return false;
  // Notion escapes underscores; the producer already checks content integrity.
  const lines=markdown.replace(/\\_/g,'_').trimEnd().split(/\r?\n/);
  const last=lines[lines.length-1]?.trim()||'';
  const marker='QJAI_PUBLISH_READY v=1 source_key=producthunt:'+period;
  // Marker is required, but content_sha256 is neither calculated nor compared here.
  return last===marker||last.startsWith(marker+' ');
}

async function getJson(path,env) {
  const response=await fetch(NOTION_BASE+path,{
    method:'GET',redirect:'manual',
    headers:{Authorization:'Bearer '+env.OPS_NOTION_READ_TOKEN,
      'Notion-Version':NOTION_VERSION,'Accept':'application/json'},
    signal:AbortSignal.timeout(12000)
  });
  if(!response.ok)throw new Error('NOTION_HTTP_'+response.status);
  if(Number(response.headers.get('content-length')||0)>500000)
    throw new Error('NOTION_RESPONSE_OVERSIZE');
  const raw=await response.text();
  if(raw.length>500000)throw new Error('NOTION_RESPONSE_OVERSIZE');
  return JSON.parse(raw);
}

export async function checkProductHuntReady(env,now=Date.now()) {
  const period=productHuntPeriod(now);
  if(typeof env.OPS_NOTION_READ_TOKEN!=='string'||env.OPS_NOTION_READ_TOKEN.length<20)
    throw new Error('NOTION_CREDENTIAL_NOT_CONFIGURED');
  if(!/^[0-9a-f-]{32,36}$/i.test(String(env[PARENT_ENV]||''))) throw new Error('NOTION_PARENT_NOT_CONFIGURED');
  let cursor=null,seen=new Set(),matches=[];
  for(let page=0;page<30;page++) {
    const params='?page_size=100'+(cursor?'&start_cursor='+encodeURIComponent(cursor):'');
    const result=await getJson('/blocks/'+env[PARENT_ENV]+'/children'+params,env);
    if(!Array.isArray(result.results)||typeof result.has_more!=='boolean')
      throw new Error('NOTION_LIST_INVALID');
    for(const block of result.results) {
      if(block?.type!=='child_page')continue;
      if(String(block.child_page?.title||'').startsWith(period+'｜'))
        matches.push({id:block.id,title:block.child_page.title});
    }
    if(matches.length>1)return {period,ready:false,reason:'DUPLICATE_ARTICLE'};
    if(!result.has_more) {
      if(matches.length===0)return {period,ready:false,reason:'ARTICLE_MISSING'};
      const candidate=matches[0];
      if(!/^[0-9a-f-]{32,36}$/i.test(String(candidate.id||'')))
        throw new Error('NOTION_PAGE_ID_INVALID');
      const details=await getJson('/pages/'+candidate.id+'/markdown?markdown_version=v2',env);
      if(details.object!=='page_markdown'||typeof details.markdown!=='string'||
        details.truncated!==false||(details.unknown_block_ids||[]).length>0||
        (details.warnings||[]).length>0)
        throw new Error('NOTION_MARKDOWN_INCOMPLETE');
      return {period,ready:isNotionReady(details.markdown,period),
        reason:isNotionReady(details.markdown,period)?'READY':'READY_MISSING'};
    }
    cursor=result.next_cursor;
    if(typeof cursor!=='string'||!cursor||seen.has(cursor))
      throw new Error('NOTION_CURSOR_INVALID');
    seen.add(cursor);
  }
  throw new Error('NOTION_PAGINATION_LIMIT');
}
