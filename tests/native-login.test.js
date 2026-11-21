import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeLogin,dispatch,CHECK_ROUTES} from '../src/index.js';
import {derivePasswordHash,currentAdmin,deleteSession} from '../src/auth.js';
import {loginHtml} from '../src/login-ui.js';
import {translateSql} from '../src/sql-compat.js';

const username='owner@example.com',password='MyLongSecurePassword2026!';
const salt='abcdef0123456789abcdef0123456789';
const origin='https://monitor.qjai.org';
const loginReq=(body,originHeader=origin)=>new Request(origin+'/api/login',{
 method:'POST',
 headers:{'origin':originHeader,'x-ops-request':'1','content-type':'application/json','cf-connecting-ip':'192.0.2.100'},
 body:JSON.stringify(body)
});

function fakeDb(hash){
 const sessions=new Map(),attempts=new Map();
 return {sessions,attempts,prepare(sql){
  let args=[];
  return {
   bind(...values){args=values;return this},
   async first(){
    if(sql.startsWith('SELECT username,password_hash,password_salt'))
      return args[0]===username?{username,password_hash:hash,password_salt:salt,iterations:100000}:null;
    if(sql.startsWith('SELECT window_started_at,attempts'))
      return attempts.get(args[0])||null;
    if(sql.startsWith('SELECT username,expires_at'))
      return sessions.get(args[0])||null;
    throw Error('unexpected SELECT '+sql);
   },
   async run(){
    if(sql.startsWith('INSERT INTO admin_sessions')){
     sessions.set(args[0],{username:args[1],expires_at:args[3]});return {};
    }
    if(sql.startsWith('DELETE FROM admin_sessions')){
     if(sql.includes('token_hash'))sessions.delete(args[0]);else
      for(const [key,value] of sessions)if(value.expires_at<=args[0])sessions.delete(key);
     return {};
    }
    if(sql.startsWith('DELETE FROM admin_login_attempts')){attempts.delete(args[0]);return {};}
    if(sql.startsWith('INSERT INTO admin_login_attempts')){attempts.set(args[0],{
      window_started_at:args[1],attempts:1,blocked_until:0});return {};}
    if(sql.startsWith('UPDATE admin_login_attempts')){const previous=attempts.get(args[2]);attempts.set(args[2],{
      ...previous,attempts:args[0],blocked_until:args[1]});return {};}
    throw Error('unexpected mutation '+sql);
   }
  }
 }};
}

test('native login preserves PBKDF2 credentials and issues DB-backed secure HttpOnly cookie',async()=>{
 const db=fakeDb(await derivePasswordHash(password,salt));
 const invalid=await nativeLogin(loginReq({username,password:'nope'}),db);
 assert.equal(invalid.status,401);
 assert.equal(db.attempts.size,1);
 const valid=await nativeLogin(loginReq({username,password}),db);
 assert.equal(valid.status,200);
 assert.deepEqual(await valid.json(),{ok:true});
 const cookie=valid.headers.get('set-cookie');
 assert.match(cookie,/^__Host-qjai_ops_session=[a-f0-9]{64}; Path=\/; Max-Age=43200; Secure; HttpOnly; SameSite=Strict$/);
 assert.equal(db.sessions.size,1);
 assert.equal(db.attempts.size,0);
 const current=new Request(origin+'/api/status',{headers:{cookie:cookie.split(';')[0]}});
 assert.equal(await currentAdmin(current,db),username);
 await deleteSession(current,db);
 assert.equal(await currentAdmin(current,db),null);
});

test('origin, guard header and body validation prevent CSRF or malformed login',async()=>{
 const db=fakeDb(await derivePasswordHash(password,salt));
 assert.equal((await nativeLogin(loginReq({username,password},'https://evil.example'),db)).status,403);
 assert.equal((await nativeLogin(new Request(origin+'/api/login',{method:'POST',
   headers:{origin,'content-type':'application/json'},body:JSON.stringify({username,password})}),db)).status,403);
 assert.equal((await nativeLogin(loginReq({username,password:''}),db)).status,400);
 assert.equal(db.sessions.size,0);
});

test('login UI contains native username and password, nonce CSP support and no Access dependency',()=>{
 const html=loginHtml('test-csp-nonce');
 for(const part of ['autocomplete="username"','autocomplete="current-password"','/api/login','nonce="test-csp-nonce"'])
  assert(html.includes(part));
 assert(!html.includes('Cloudflare Access'));
});

test('five business ingestion routes still reject unauthenticated without touching Neon',async()=>{
 const expected=['producthunt_producer','overseas_collector','overseas_producer','x_intelligence','trustmrr_weekly'];
 assert.deepEqual(Object.keys(CHECK_ROUTES).map(x=>x.split('/').at(-1)),expected);
 const env=new Proxy({OPS_SCHEDULER_TOKEN:'a'.repeat(40)},{
  get(t,k){if(k==='HYPERDRIVE')throw Error('No DB access on ingestion');return t[k];}
 });
 for(const id of expected){
  const r=await dispatch(new Request('https://ingest.monitor.qjai.org/v1/checks/'+id,{method:'POST'}),env);
  assert.equal(r.status,401);
 }
});

test('existing D1-shaped auth statements translate to parameterized Postgres',()=>{
 assert.equal(translateSql('SELECT * FROM admin_users WHERE username=?'),
  'SELECT * FROM admin_users WHERE username=$1');
 assert.equal(translateSql('INSERT INTO admin_sessions(token_hash,username) VALUES(?,?)'),
  'INSERT INTO admin_sessions(token_hash,username) VALUES($1,$2)');
});
