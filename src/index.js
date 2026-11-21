// Stateless business checks + database-backed native administrator login.
// Only the private console opens a database connection; n8n monitor endpoints do not.
import {PgD1Database} from './db.js';
import {currentAdmin,verifyPassword,clientRateKey,rateLimited,
 recordLoginFailure,clearLoginFailures,issueSession,deleteSession,
 sessionCookie,clearedSessionCookie} from './auth.js';
import {loginHtml} from './login-ui.js';
import {dashboardHtml} from './ui.js';
import {inspectMonitors} from './overview.js';
import {handleN8nCheck,handleN8nOverseasCheck,handleN8nOverseasProducerCheck} from './checks/router.js';
import {handleN8nXCheck} from './checks/x-ready.js';
import {handleN8nTrustMrrWeeklyCheck} from './checks/trustmrr-ready.js';

export const CHECK_ROUTES=Object.freeze({
 '/v1/checks/producthunt_producer':handleN8nCheck,
 '/v1/checks/overseas_collector':handleN8nOverseasCheck,
 '/v1/checks/overseas_producer':handleN8nOverseasProducerCheck,
 '/v1/checks/x_intelligence':handleN8nXCheck,
 '/v1/checks/trustmrr_weekly':handleN8nTrustMrrWeeklyCheck
});
const HEADERS={'content-type':'application/json; charset=utf-8',
 'cache-control':'no-store','x-content-type-options':'nosniff',
 'referrer-policy':'no-referrer'};
const json=(body,status=200,more={})=>new Response(JSON.stringify(body),
 {status,headers:{...HEADERS,...more}});
const security={
 'cache-control':'private, no-store','x-content-type-options':'nosniff',
 'x-frame-options':'DENY','referrer-policy':'no-referrer',
 'permissions-policy':'camera=(), microphone=(), geolocation=()'
};
function html(body,login=false,nonce=''){
 const policy=login
  ?"default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline'; connect-src 'self';"
  :"default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'";
 return new Response(body,{headers:{...security,'content-type':'text/html; charset=utf-8','content-security-policy':policy}});
}
function sameOriginWrite(req){
 const url=new URL(req.url);
 return req.headers.get('origin')===url.origin &&
  req.headers.get('x-ops-request')==='1' &&
  (req.headers.get('content-type')||'').startsWith('application/json');
}
async function withAuthDb(env,task){
 const connectionString=env.HYPERDRIVE?.connectionString;
 if(typeof connectionString!=='string'||!connectionString)
  throw Error('AUTH_DB_UNAVAILABLE');
 const db=new PgD1Database(connectionString);
 try{await db.connect();return await task(db);}
 finally{await db.close();}
}
export async function nativeLogin(req,db){
 if(!sameOriginWrite(req))return json({error:'csrf_or_origin'},403);
 if(Number(req.headers.get('content-length')||0)>2048)
  return json({error:'request_too_large'},413);
 let body;
 try{body=await req.json();}catch{return json({error:'invalid_json'},400);}
 const username=typeof body?.username==='string'?body.username.trim():'';
 const password=typeof body?.password==='string'?body.password:'';
 if(!username||username.length>64||!password||password.length>256)
  return json({error:'invalid_credentials'},400);
 const now=Math.floor(Date.now()/1000);
 const rateKey=await clientRateKey(req);
 if(await rateLimited(db,rateKey,now))return json({error:'rate_limited'},429);
 const user=await db.prepare(
  'SELECT username,password_hash,password_salt,iterations FROM admin_users WHERE username=?'
 ).bind(username).first();
 const candidate=user||{password_salt:'dc51e786a469ee30e0be3c34d0c3d4ac',
  password_hash:'0'.repeat(64),iterations:100000};
 const valid=await verifyPassword(password,candidate);
 if(!user||!valid){
  await recordLoginFailure(db,rateKey,now);
  return json({error:'invalid_credentials'},401);
 }
 await clearLoginFailures(db,rateKey);
 const session=await issueSession(db,user.username,now);
 return json({ok:true},200,{'set-cookie':sessionCookie(session.token)});
}
async function privateRouter(req,env,now){
 const path=new URL(req.url).pathname;
 if(req.method==='POST'&&path==='/api/login')
  return withAuthDb(env,db=>nativeLogin(req,db));
 if(req.method==='GET'&&path==='/login')
  return withAuthDb(env,async db=>{
   const user=await currentAdmin(req,db);
   const nonce=crypto.randomUUID().replace(/-/g,'');
   return user?Response.redirect('https://monitor.qjai.org/',302):html(loginHtml(nonce),true,nonce);
  });
 if(req.method!=='GET'&&req.method!=='POST')return json({error:'not_found'},404);
 if(!['/','/index.html','/api/status','/api/logout'].includes(path))
  return json({error:'not_found'},404);
 const username=await withAuthDb(env,db=>currentAdmin(req,db));
 if(!username){
  if(req.method==='GET'&&(path==='/'||path==='/index.html'))
   return Response.redirect('https://monitor.qjai.org/login',302);
  return json({error:'unauthorized'},401);
 }
 if(req.method==='POST'&&path==='/api/logout'){
  if(!sameOriginWrite(req))return json({error:'csrf_or_origin'},403);
  await withAuthDb(env,db=>deleteSession(req,db));
  return json({ok:true},200,{'set-cookie':clearedSessionCookie()});
 }
 if(req.method==='GET'&&(path==='/'||path==='/index.html')){
  const nonce=crypto.randomUUID().replace(/-/g,'');
  return html(dashboardHtml(nonce),false,nonce);
 }
 if(req.method==='GET'&&path==='/api/status'){
  if(new URL(req.url).search)return json({error:'invalid_query'},400);
  return json(await inspectMonitors(env,now));
 }
 return json({error:'not_found'},404);
}
export async function dispatch(req,env,now=Date.now()){
 const url=new URL(req.url),host=url.hostname.toLowerCase();
 if(host==='ingest.monitor.qjai.org'||host==='ingest.ops.qjai.org'){
  const handler=CHECK_ROUTES[url.pathname];
  if(!handler||req.method!=='POST')return json({error:'not_found'},404);
  return handler(req,env,now);
 }
 if(host!=='monitor.qjai.org'&&host!=='ops.qjai.org')return json({error:'not_found'},404);
 if(req.method==='GET'&&url.pathname==='/healthz')return json({ok:true});
 return privateRouter(req,env,now);
}
export default {
 async fetch(req,env){
  try{return await dispatch(req,env);}
  catch(error){
   const id=req.headers.get('cf-ray')||crypto.randomUUID();
   console.error(JSON.stringify({type:'ops_handler_error',id,
    path:new URL(req.url).pathname,
    error_name:String(error?.name||'Error').slice(0,60)}));
   return json({error:'internal_error',request_id:id},500);
  }
 }
};
