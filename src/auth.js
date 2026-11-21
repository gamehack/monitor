const enc=new TextEncoder();
const SESSION_COOKIE='__Host-qjai_ops_session';
const SESSION_SECONDS=12*60*60;
const LOGIN_WINDOW=15*60;
const MAX_ATTEMPTS=5;
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const fromHex=s=>Uint8Array.from(String(s).match(/.{2}/g)||[],x=>parseInt(x,16));
export async function sha256Hex(value){
 return hex(await crypto.subtle.digest('SHA-256',enc.encode(value)));
}
export async function derivePasswordHash(password,saltHex,iterations=100000){
 const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:fromHex(saltHex),iterations},key,256);
 return hex(bits);
}
function constantTimeHexEqual(a,b){
 const x=String(a||''),y=String(b||'');
 let diff=x.length^y.length;
 const n=Math.max(x.length,y.length);
 for(let i=0;i<n;i++)diff|=(x.charCodeAt(i)||0)^(y.charCodeAt(i)||0);
 return diff===0;
}
export async function verifyPassword(password,user){
 if(!user||typeof password!=='string')return false;
 try{
  const candidate=await derivePasswordHash(password,user.password_salt,Number(user.iterations));
  return constantTimeHexEqual(candidate,user.password_hash);
 }catch{return false;}
}
export function cookieValue(request,name=SESSION_COOKIE){
 const raw=request.headers.get('cookie')||'';
 for(const part of raw.split(';')){
  const i=part.indexOf('=');
  if(i<0)continue;
  if(part.slice(0,i).trim()===name)return part.slice(i+1).trim();
 }
 return null;
}
export function sessionCookie(token,maxAge=SESSION_SECONDS){
 return SESSION_COOKIE+'='+token+'; Path=/; Max-Age='+maxAge+'; Secure; HttpOnly; SameSite=Strict';
}
export function clearedSessionCookie(){
 return SESSION_COOKIE+'=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict';
}
export async function issueSession(db,username,now=Math.floor(Date.now()/1000)){
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 const token=hex(bytes),tokenHash=await sha256Hex(token),expires=now+SESSION_SECONDS;
 await db.prepare('INSERT INTO admin_sessions(token_hash,username,created_at,expires_at) VALUES(?,?,?,?)')
  .bind(tokenHash,username,now,expires).run();
 await db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').bind(now).run();
 return {token,expires};
}
export async function currentAdmin(request,db,now=Math.floor(Date.now()/1000)){
 const token=cookieValue(request);
 if(!token||!/^[0-9a-f]{64}$/.test(token))return null;
 const tokenHash=await sha256Hex(token);
 const row=await db.prepare('SELECT username,expires_at FROM admin_sessions WHERE token_hash=?').bind(tokenHash).first();
 if(!row)return null;
 if(Number(row.expires_at)<=now){
  await db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(tokenHash).run();
  return null;
 }
 return row.username;
}
export async function deleteSession(request,db){
 const token=cookieValue(request);
 if(!token||!/^[0-9a-f]{64}$/.test(token))return;
 const tokenHash=await sha256Hex(token);
 await db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(tokenHash).run();
}
export async function clientRateKey(request){
 const ip=request.headers.get('cf-connecting-ip')||'unknown';
 return sha256Hex('qjai-ops-login-rate-v1|'+ip);
}
export async function rateLimited(db,key,now=Math.floor(Date.now()/1000)){
 const row=await db.prepare('SELECT window_started_at,attempts,blocked_until FROM admin_login_attempts WHERE ip_hash=?').bind(key).first();
 if(!row)return false;
 if(Number(row.blocked_until)>now)return true;
 return Number(row.window_started_at)>now-LOGIN_WINDOW&&Number(row.attempts)>=MAX_ATTEMPTS;
}
export async function recordLoginFailure(db,key,now=Math.floor(Date.now()/1000)){
 const row=await db.prepare('SELECT window_started_at,attempts FROM admin_login_attempts WHERE ip_hash=?').bind(key).first();
 if(!row||now-Number(row.window_started_at)>=LOGIN_WINDOW){
  await db.prepare('INSERT INTO admin_login_attempts(ip_hash,window_started_at,attempts,blocked_until) VALUES(?,?,1,0) ON CONFLICT(ip_hash) DO UPDATE SET window_started_at=excluded.window_started_at,attempts=1,blocked_until=0')
   .bind(key,now).run();
  return;
 }
 const attempts=Number(row.attempts)+1;
 await db.prepare('UPDATE admin_login_attempts SET attempts=?,blocked_until=? WHERE ip_hash=?')
  .bind(attempts,attempts>=MAX_ATTEMPTS?now+LOGIN_WINDOW:0,key).run();
}
export async function clearLoginFailures(db,key){
 await db.prepare('DELETE FROM admin_login_attempts WHERE ip_hash=?').bind(key).run();
}
export const authConstants=Object.freeze({SESSION_SECONDS,LOGIN_WINDOW,MAX_ATTEMPTS,SESSION_COOKIE});

