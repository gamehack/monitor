// Read-only OPS UI: exactly five live monitor contracts, no historical DB.
import {MONITORS} from './overview.js';

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function dashboardHtml(nonce){
 const cards=MONITORS.map((m,i)=>`
 <article class="card" data-monitor="${esc(m.id)}">
 <div class="card-head"><span class="number">${String(i+1).padStart(2,'0')}</span><span class="status idle" data-field="status">未读取</span></div>
 <h3>${esc(m.title)}</h3><p class="description">${esc(m.subtitle)}</p>
 <dl>
   <div><dt>检查时间</dt><dd>${esc(m.schedule)}</dd></div>
   <div><dt>交付来源</dt><dd>${esc(m.source)}</dd></div>
   <div><dt>业务期号</dt><dd data-field="period">—</dd></div>
 </dl>
 <p class="reason" data-field="reason">等待读取最近应完成周期</p>
 <a class="origin" target="_blank" rel="noopener noreferrer" href="${esc(m.url)}">查看业务来源 <span aria-hidden="true">↗</span></a>
 </article>`).join('');
 return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/>
<meta name="theme-color" content="#091420"/>
<title>潜界 AI · OPS</title>
<style>
:root{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#e6f0f9;background:#091420;font-synthesis:none}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(50rem 30rem at 78% -10%,#20456766,transparent 74%),#091420}
a{color:inherit;text-decoration:none}button{font:inherit}button:focus-visible,a:focus-visible{outline:2px solid #81d5ff;outline-offset:3px}
.container{max-width:1230px;margin:auto;padding:0 26px}
header{border-bottom:1px solid #25374b;background:#0a1724bc}
.header-inner{min-height:76px;display:flex;justify-content:space-between;align-items:center;gap:20px}
.brand{display:flex;align-items:center;gap:12px;font-size:16px;font-weight:700;letter-spacing:.01em}
.mark{display:grid;place-items:center;width:35px;height:35px;border-radius:11px;background:linear-gradient(135deg,#247fb5,#6474ec);box-shadow:0 0 24px #387bc550;font-size:17px}
.brand small{display:block;margin-top:3px;color:#88a3ba;font-size:10px;letter-spacing:.09em;font-weight:600}
.private{border:1px solid #2d455e;border-radius:20px;padding:7px 11px;color:#a4bbcd;font-size:11px;white-space:nowrap}
.top-actions{display:flex;align-items:center;gap:10px}.logout{border:1px solid #3c596e;border-radius:10px;background:#132a3b;color:#c2d8e7;padding:7px 12px;cursor:pointer;font-size:12px}.logout:hover{background:#21435a}
main{padding-top:53px;padding-bottom:70px}
.kicker{color:#83cde7;text-transform:uppercase;font-size:12px;font-weight:700;letter-spacing:.14em}
.kicker:before{content:'';display:inline-block;width:7px;height:7px;margin-right:9px;background:#59cdda;border-radius:50%;box-shadow:0 0 10px #44cadd}
.hero{display:flex;justify-content:space-between;align-items:flex-end;gap:25px;margin-bottom:34px}
h1{font-size:clamp(29px,4vw,46px);letter-spacing:-.045em;line-height:1.25;margin:17px 0 12px}
.lead{font-size:14px;color:#a1b2c5;line-height:1.85;max-width:660px;margin:0}
.action{background:#21577b;border:1px solid #447c9d;border-radius:11px;color:#e8f6ff;padding:12px 18px;cursor:pointer;white-space:nowrap;transition:background .15s}
.action:hover{background:#2e749b}.action:disabled{opacity:.6;cursor:wait}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin-bottom:42px}
.metric{padding:23px 21px;border:1px solid #2b4053;border-radius:14px;background:#122332}
.metric span{display:block;color:#91a6ba;font-size:12px;margin-bottom:13px}
.metric strong{font-size:29px;font-weight:700;letter-spacing:-.025em;font-variant-numeric:tabular-nums}
.metric small{font-size:12px;font-weight:500;color:#9bb0bf}
.section-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px}
h2{font-size:18px;margin:0}.timestamp{font-size:12px;color:#87a1b8}
.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.card{display:flex;flex-direction:column;border:1px solid #2a4458;border-radius:16px;background:linear-gradient(160deg,#162b3d 0%,#10202e 90%);padding:23px;min-height:297px;transition:border-color .15s}
.card:hover{border-color:#47708c}.card-head{display:flex;align-items:center;justify-content:space-between}
.number{font-size:12px;color:#7996ad}.status{font-size:11px;padding:5px 10px;border-radius:25px;border:1px solid #435368;background:#263749;color:#a8b8c9}
.status.ready{background:#113f36;border-color:#2b745b;color:#a7efd0}
.status.missing{background:#54292a;border-color:#88504a;color:#f6b9b0}
.status.unknown{background:#4e3e27;border-color:#866c40;color:#f2d3a0}
.card h3{font-size:20px;letter-spacing:-.027em;margin:20px 0 6px}
.description{font-size:12px;color:#8ca8ba;line-height:1.65;margin:0 0 18px}
dl{margin:0}dl div{display:flex;justify-content:space-between;gap:10px;margin:0 0 11px;font-size:12px}
dt{color:#8ca3b5;white-space:nowrap}dd{margin:0;color:#e0edf7;text-align:right;overflow-wrap:anywhere}
.reason{color:#819bad;font-size:11px;line-height:1.7;margin:4px 0 20px;min-height:19px;overflow-wrap:anywhere}
.origin{display:inline-flex;gap:7px;color:#86d9f0;font-size:12px;margin-top:auto;width:max-content}.origin:hover{color:white}
.note{border:1px solid #2a4253;background:#0d1c29;border-radius:13px;padding:17px 19px;color:#9eb4c5;font-size:12px;line-height:1.9;margin-top:22px}.note strong{color:#d3e5f1}
footer{border-top:1px solid #253a4a;padding:26px 0;color:#7890a5;font-size:12px}
.footer-inner{display:flex;justify-content:space-between;gap:15px}
@media(max-width:1020px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:650px){.container{padding:0 18px}header .header-inner{min-height:66px}.hero{display:block}main{padding-top:32px}.action{width:100%;margin-top:21px}.cards{grid-template-columns:1fr}.stats{gap:10px}.metric{padding:18px}.section-head{display:block}.timestamp{display:block;margin-top:7px}.footer-inner{display:block}.footer-inner span{display:block;margin-bottom:8px}}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<header><div class="container header-inner"><div class="brand"><span class="mark" aria-hidden="true">潜</span><div>潜界 AI · OPS<small>BUSINESS DELIVERY MONITORING</small></div></div><div class="top-actions"><span class="private">PRIVATE · PRODUCTION</span><button type="button" id="logout" class="logout">退出登录</button></div></div></header>
<main class="container">
<div class="kicker">OPERATION CONTROL</div>
<div class="hero"><div><h1>业务交付监控</h1><p class="lead">仅保留五条生产监控链路。n8n 定时触发，Cloudflare Worker 校验交付，失败通过飞书通知。业务监控不访问数据库；登录会话复用原有 Neon 认证表。无自动补产、无后台轮询。</p></div><button class="action" id="refresh" type="button">刷新交付状态</button></div>
<div class="stats" aria-label="监控范围">
<div class="metric"><span>生产监控</span><strong>05</strong></div>
<div class="metric"><span>本次读取 · READY</span><strong id="ready-count">—</strong></div>
<div class="metric"><span>本次读取 · 未交付</span><strong id="missing-count">—</strong></div>
<div class="metric"><span>已跳过 / 已覆盖</span><strong>18 <small>/ 1</small></strong></div>
</div>
<section aria-labelledby="monitor-title"><div class="section-head"><h2 id="monitor-title">有效监控链路</h2><span class="timestamp" id="checked-at" aria-live="polite">尚未读取</span></div><div class="cards">${cards}</div></section>
<aside class="note"><strong>状态说明：</strong>仅在进入页面或手动点击时，读取最近<strong>应完成周期</strong>的业务交付结果；不代表 n8n 的最后一次执行记录。页面读取不会发送告警或运行生产补产。无法读取上游时显示“无法确认”，绝不当作 READY。</aside>
</main>
<footer><div class="container footer-inner"><span>QJAI OPS · 五项有效监控 · 私有只读控制台</span><span>n8n 调度 · Cloudflare Worker · 飞书 · Cron 0</span></div></footer>
<script nonce="${esc(nonce)}">
(()=>{
const button=document.getElementById('refresh'),timestamp=document.getElementById('checked-at');
const legend={ready:['已交付','ready'],missing:['未交付','missing'],unknown:['无法确认','unknown']};
const known={READY:'交付状态 READY',SUCCESS:'GitHub Actions 已成功',ARTICLE_MISSING:'文章缺失',
REPORT_MISSING:'本周周报缺失',SCHEDULED_RUN_MISSING:'未找到应执行的 GitHub Actions',
READY_MISSING:'没有有效 READY 标记',NOTION_UNAVAILABLE:'Notion 暂不可读',
GITHUB_API_UNAVAILABLE:'GitHub API 暂不可读',REMOTE_UNAVAILABLE:'暂时无法访问上游服务',
PERIOD_MISMATCH:'业务期号与 READY 不匹配',DUPLICATE_PERIOD:'当周存在重复文章'};
const fmt=iso=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
async function refresh(){
 if(button.disabled)return;
 button.disabled=true;button.textContent='正在读取…';timestamp.textContent='正在检查五条链路';
 try{
  const response=await fetch('/api/status',{cache:'no-store',credentials:'same-origin'});
  if(!response.ok)throw Error(response.status===401?'身份验证已失效':'请求失败 HTTP '+response.status);
  const data=await response.json();
  let ready=0,missing=0;
  for(const item of data.monitors||[]){
   const card=[...document.querySelectorAll('[data-monitor]')]
    .find(x=>x.getAttribute('data-monitor')===item.id);
   if(!card)continue;
   const badge=card.querySelector('[data-field="status"]');
   const [label,clazz]=legend[item.status]||legend.unknown;
   badge.className='status '+clazz;badge.textContent=label;
   card.querySelector('[data-field="period"]').textContent=item.period||'—';
   card.querySelector('[data-field="reason"]').textContent=known[item.reason]||item.reason||'状态未知';
   if(item.status==='ready')ready++;if(item.status==='missing')missing++;
  }
  document.getElementById('ready-count').textContent=String(ready).padStart(2,'0');
  document.getElementById('missing-count').textContent=String(missing).padStart(2,'0');
  timestamp.textContent='读取于 '+fmt(data.as_of)+'（北京时间）';
 }catch(error){timestamp.textContent='状态读取失败：'+String(error.message||'未知错误').slice(0,120);}
 finally{button.textContent='刷新交付状态';button.disabled=false;}
}
button.addEventListener('click',refresh);
document.getElementById('logout').addEventListener('click',async()=>{
 const target=document.getElementById('logout');
 if(target.disabled)return;
 target.disabled=true;
 try{
  const res=await fetch('/api/logout',{method:'POST',credentials:'same-origin',
   headers:{'content-type':'application/json','x-ops-request':'1'},body:'{}'});
  if(res.ok)location.assign('/login');
  else throw Error('退出失败 HTTP '+res.status);
 }catch(e){target.disabled=false;timestamp.textContent=String(e.message||'退出失败');}
});
refresh();
})();
</script>
</body></html>`;
}
