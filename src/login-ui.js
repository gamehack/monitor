export function loginHtml(nonce=''){
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>潜界 AI · Ops 登录</title>
<style>
:root{color-scheme:dark;--bg:#0b111a;--card:#172230;--stroke:#27374b;--ink:#f3f8ff;--muted:#9aacbf;--mint:#58e2cd}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(ellipse at 50% 0,#183047 0,#0b111a 55%);color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}
.card{width:min(100%,410px);padding:34px;border:1px solid var(--stroke);border-radius:18px;background:rgba(23,34,48,.96);box-shadow:0 24px 80px #0006}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}.mark{width:42px;height:42px;display:grid;place-items:center;border-radius:12px;background:#124d51;color:var(--mint);font-weight:900;font-size:20px}
.eyebrow{color:var(--mint);font-size:11px;letter-spacing:2px;font-weight:800}h1{margin:3px 0 0;font-size:23px}p{color:var(--muted);font-size:13px;margin:0 0 22px}
label{display:block;margin:16px 0 7px;font-size:13px;color:#c8d6e5}input{width:100%;padding:12px 13px;border:1px solid #395168;border-radius:9px;background:#0d1723;color:var(--ink);font:inherit;outline:none}input:focus{border-color:var(--mint);box-shadow:0 0 0 3px #58e2cd22}
button{width:100%;margin-top:22px;padding:12px;border:0;border-radius:9px;background:#276d64;color:white;font:inherit;font-weight:600;cursor:pointer}button:disabled{opacity:.55;cursor:wait}
#error{min-height:22px;margin-top:12px;color:#f6838d;font-size:13px}.foot{margin-top:22px;color:#74889c;font-size:11px;text-align:center}
</style></head><body><main class="card">
<div class="brand"><div class="mark">Q</div><div><div class="eyebrow">OPERATIONAL INTELLIGENCE</div><h1>潜界 AI · Ops</h1></div></div>
<p>请输入 Ops 管理账号和密码。</p>
<form id="login" autocomplete="on">
<label for="username">用户名</label><input id="username" name="username" autocomplete="username" required maxlength="64" autofocus>
<label for="password">密码</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="256">
<button id="submit" type="submit">登录控制台</button><div id="error" role="alert" aria-live="polite"></div>
</form><div class="foot">受保护的内部运维系统 · HTTPS only</div>
</main><script nonce="${nonce}">
const form=document.getElementById('login'),button=document.getElementById('submit'),error=document.getElementById('error');
form.addEventListener('submit',async event=>{
 event.preventDefault();button.disabled=true;error.textContent='';
 try{
  const response=await fetch('/api/login',{method:'POST',cache:'no-store',headers:{'accept':'application/json','content-type':'application/json','x-ops-request':'1'},body:JSON.stringify({username:document.getElementById('username').value,password:document.getElementById('password').value})});
  const contentType=response.headers.get('content-type')||'';
  const raw=await response.text();
  let data;
  try{data=JSON.parse(raw);}catch{
    const ray=response.headers.get('cf-ray')||'无';
    const target=response.redirected?new URL(response.url).pathname:'未重定向';
    throw new Error('登录接口返回非 JSON（HTTP '+response.status+'，'+contentType+'，'+target+'，Ray ID '+ray+'）。请刷新页面后重试。');
  }
  if(!response.ok){
    if(response.status===429)throw new Error('登录尝试过多，请 15 分钟后再试');
    if(data?.error==='internal_error')throw new Error('登录服务内部异常，Ray ID：'+(data.request_id||response.headers.get('cf-ray')||'无'));
    throw new Error('用户名或密码错误');
  }
  window.location.replace('/');
 }catch(e){error.textContent=e.message||'登录失败，请稍后重试';}
 finally{button.disabled=false;}
});
</script></body></html>`;
}
