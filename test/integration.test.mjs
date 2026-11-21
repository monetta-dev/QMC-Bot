import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {createHash,createHmac} from 'node:crypto';
import {freezeSchedule} from '../src/domain.mjs';
import {calendarCard,calendarFlexMessage} from '../src/calendar-flex.mjs';
import '../scripts/build.mjs';
let mf,db;
const calls=[],accepted=new Set();let failure=null,profileName='テスト部員',loginAudience='test-login',loginUserId='Uowner';
const secret='test-webhook-secret';
const testGroup='C'+'1'.repeat(32), unrelatedGroup='C'+'2'.repeat(32);
const adminHeaders={Cookie:'qmc_session=test-session',Origin:'https://qmc.test','X-CSRF-Token':'test-csrf','Content-Type':'application/json'};
const month='2026-11',fixture=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2uoAAAAASUVORK5CYII=','base64');
async function api(path,method='GET',body){return mf.dispatchFetch('https://qmc.test'+path,{method,headers:adminHeaders,...(body?{body:JSON.stringify(body)}:{})});}
async function loginAs(id){
 loginUserId=id;
 try{
  const start=await mf.dispatchFetch('https://qmc.test/auth/line',{redirect:'manual'});
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  const result=await mf.dispatchFetch('https://qmc.test/auth/callback?code=valid&state='+state,{redirect:'manual',headers:{Cookie:start.headers.get('set-cookie').split(';')[0]}});
  assert.equal(result.headers.get('location'),'/');
  return result.headers.get('set-cookie').match(/qmc_session=[^;,]+/)[0];
 }finally{loginUserId='Uowner';}
}
function publish(version,previewHash='',groupId=testGroup){
 return api('/api/schedules/'+month+'/publish','POST',{version,previewHash,groupId});
}
const sql=(s,...p)=>db.prepare(s).bind(...p);
async function tick(at){const r=await mf.dispatchFetch('https://qmc.test/__test_tick',{headers:{'X-Now':String(Date.parse(at))}});assert.equal(r.status,200,await r.text());}
async function sendEvent(event){
 const raw=JSON.stringify({events:[event]});
 return mf.dispatchFetch('https://qmc.test/webhooks/line',{method:'POST',headers:{'X-Line-Signature':createHmac('sha256',secret).update(raw).digest('base64')},body:raw});
}
before(async()=>{
 const entry=`import app,{runScheduled} from './app.mjs'; export default {async fetch(r,env,ctx){if(new URL(r.url).pathname==='/__test_tick'){await runScheduled(env,Number(r.headers.get('X-Now')));return new Response('ok');}return app.fetch(r,env,ctx);}};`;
 mf=new Miniflare({modules:[{type:'ESModule',path:'test-entry.mjs',contents:entry},{type:'ESModule',path:'app.mjs',contents:await readFile('dist/worker.mjs','utf8')}],compatibilityDate:'2026-07-30',d1Databases:{DB:'test-db'},bindings:{LINE_CHANNEL_SECRET:secret,LINE_CHANNEL_ACCESS_TOKEN:'test-token',LINE_LOGIN_CHANNEL_ID:'test-login',LINE_LOGIN_CHANNEL_SECRET:'test-login-secret',BOOTSTRAP_OWNER_ID:'Uowner'},outboundService:async r=>{
  const url=new URL(r.url);
  if(url.pathname==='/oauth2/v2.1/token')return Response.json({id_token:'test-id-token'});
  if(url.pathname==='/oauth2/v2.1/verify'){const form=new URLSearchParams(await r.text());return Response.json({sub:loginUserId,name:loginUserId==='Uowner'?'責任者':'確認する人',nonce:form.get('nonce'),aud:loginAudience,exp:Math.floor(Date.now()/1000)+3600});}
  if(url.pathname.includes('/profile/'))return Response.json({displayName:profileName});
  if(url.pathname.includes('/group/')&&url.pathname.includes('/member/')) {
   return url.pathname===`/v2/bot/group/${testGroup}/member/Uowner`?Response.json({userId:'Uowner'}):Response.json({}, {status:404});
  }
  if(url.pathname.endsWith('/summary'))return Response.json({groupName:'テストグループ'});
  if(url.pathname.endsWith('/push')){
   const payload=await r.json(),key=r.headers.get('X-Line-Retry-Key');calls.push({key,payload});
   if(accepted.has(key))return new Response('{}',{status:409,headers:{'x-line-accepted-request-id':'accepted'}});
   if(failure==='accept-then-timeout'){accepted.add(key);return new Response('{}',{status:500});}
   if(failure==='500')return new Response('{}',{status:500});
   accepted.add(key);return Response.json({});
  }
  return Response.json({});
 }});
 db=await mf.getD1Database('DB');
 for(const file of ['0001.sql','0002.sql','0003.sql','0004.sql']) {
  await db.batch((await readFile(`migrations/${file}`,'utf8')).split(';').map(s=>s.trim()).filter(Boolean).map(s=>db.prepare(s)));
 }
 await db.batch([sql("INSERT INTO admins VALUES('Uowner','owner','責任者')"),sql('INSERT INTO sessions VALUES(?,?,?,?)',createHash('sha256').update('test-session').digest('hex'),'Uowner','test-csrf',Date.now()+86400000)]);
});
after(async()=>{if(mf)await mf.dispose();});
test('browser and home-screen icons return the original bytes, including HEAD requests',async()=>{
 for(const [path,type] of [['favicon.svg','image/svg+xml'],['favicon.ico','image/x-icon'],['apple-touch-icon.png','image/png']]){
  const response=await mf.dispatchFetch('https://qmc.test/'+path);
  assert.equal(response.status,200);
  assert.ok(response.headers.get('content-type').startsWith(type));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile('public/'+path));
  const head=await mf.dispatchFetch('https://qmc.test/'+path,{method:'HEAD'});
  assert.equal(head.status,200);
  assert.equal((await head.arrayBuffer()).byteLength,0);
 }
});
test('production API rejects unauthenticated and cross-origin writes',async()=>{
 assert.equal((await mf.dispatchFetch('https://qmc.test/api/state')).status,401);
 assert.equal((await mf.dispatchFetch('http://localhost/api/state')).status,401);
 assert.equal((await mf.dispatchFetch('https://qmc.test/api/group/confirm',{method:'POST',headers:{Cookie:'qmc_session=test-session','Content-Type':'application/json'},body:'{}'})).status,403);
});

test('any LINE account can view before a group is linked; only the designated bootstrap gets owner permission',async()=>{
 await sql('DELETE FROM admins').run();
 const cookie=await loginAs('Ureviewer');
 const response=await mf.dispatchFetch('https://qmc.test/api/state?month='+month,{headers:{Cookie:cookie}});
 assert.equal(response.status,200);
 const state=await response.json();
 assert.equal(state.user.role,'viewer');assert.equal(state.group,null);assert.deepEqual(state.admins,[]);
 assert.equal((await sql('SELECT count(*) AS n FROM admins').first()).n,0);
 assert.equal(await sql("SELECT value FROM app_settings WHERE key='bootstrap_consumed'").first(),null);
 const headers={...adminHeaders,Cookie:cookie,'X-CSRF-Token':state.csrf};
 const before=calls.length;
 for(const [path,method,body] of [
  ['/api/schedules/'+month,'PUT',{draft:{},version:0}],
  ['/api/schedules/'+month+'/publish','POST',{version:0}],
  ['/api/members/unknown','PATCH',{name:'改変',approved:true,archived:false}],
  ['/api/group/confirm','POST',{groupId:testGroup}],
  ['/api/admins','POST',{role:'owner'}],
  ['/api/group/candidates','GET'],['/api/quota','GET'],['/api/export','GET']
 ]){
  const denied=await mf.dispatchFetch('https://qmc.test'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
  assert.equal(denied.status,403,path);
 }
 assert.equal(calls.length,before);
 assert.equal((await sql('SELECT count(*) AS n FROM schedules').first()).n,0);
 await loginAs('Uowner');
 assert.equal((await sql("SELECT role FROM admins WHERE line_user_id='Uowner'").first()).role,'owner');
 assert.equal((await sql('SELECT count(*) AS n FROM admins').first()).n,1);
 const loggedOut=await mf.dispatchFetch('https://qmc.test/api/logout',{method:'POST',headers,body:'{}'});
 assert.equal(loggedOut.status,200);
 assert.equal((await mf.dispatchFetch('https://qmc.test/api/state',{headers:{Cookie:cookie}})).status,401);
});

test('a responsible person can grant permission to a login-only user and revocation affects existing sessions',async()=>{
 const cookie=await loginAs('Uhandover');
 const getState=async()=>{const r=await mf.dispatchFetch('https://qmc.test/api/state?month='+month,{headers:{Cookie:cookie}});assert.equal(r.status,200);return r.json();};
 const initial=await getState();assert.equal(initial.user.role,'viewer');
 const ownerState=await (await api('/api/state?month='+month)).json();
 const account=ownerState.admins.find(x=>x.name==='確認する人'&&x.login_id);
 // Match the opaque login identity without requiring friend registration.
 const target=await sql("SELECT id FROM login_users WHERE line_user_id='Uhandover'").first();
 assert.ok(ownerState.admins.some(x=>x.login_id===target.id));assert.ok(account);
 assert.equal((await api('/api/admins','POST',{loginId:target.id,role:'editor'})).status,200);
 assert.equal((await getState()).user.role,'editor');
 const headers={...adminHeaders,Cookie:cookie,'X-CSRF-Token':initial.csrf};
 assert.equal((await mf.dispatchFetch('https://qmc.test/api/schedules/2026-12',{method:'PUT',headers,body:JSON.stringify({version:0,draft:{}})})).status,200);
 assert.equal((await mf.dispatchFetch('https://qmc.test/api/admins',{method:'POST',headers,body:JSON.stringify({loginId:target.id,role:'owner'})})).status,403);
 assert.equal((await api('/api/admins','POST',{loginId:target.id,role:'owner'})).status,200);
 assert.equal((await getState()).user.role,'owner');
 assert.equal((await mf.dispatchFetch('https://qmc.test/api/admins',{method:'POST',headers,body:JSON.stringify({loginId:target.id,role:'none'})})).status,400);
 assert.equal((await api('/api/admins','POST',{loginId:target.id,role:'none'})).status,200);
 assert.equal((await getState()).user.role,'viewer');
 assert.equal((await mf.dispatchFetch('https://qmc.test/api/schedules/2026-12',{method:'PUT',headers,body:JSON.stringify({version:1,draft:{}})})).status,403);
 await sql("DELETE FROM schedules WHERE month='2026-12'").run();
});
test('LINE login binds state to the browser, validates audience, and consumes state only once',async()=>{
 const begin=async()=>{const r=await mf.dispatchFetch('https://qmc.test/auth/line',{redirect:'manual'});assert.equal(r.status,302);const loc=new URL(r.headers.get('location'));assert.equal(loc.searchParams.get('code_challenge_method'),'S256');return {state:loc.searchParams.get('state'),cookie:r.headers.get('set-cookie').split(';')[0]};};
 const first=await begin();
 const wrong=await mf.dispatchFetch('https://qmc.test/auth/callback?code=fake&state='+first.state,{redirect:'manual',headers:{Cookie:'qmc_oauth=wrong'}});assert.ok(wrong.headers.get('location').includes('login-failed'));
 loginAudience='another-app';const denied=await mf.dispatchFetch('https://qmc.test/auth/callback?code=fake&state='+first.state,{redirect:'manual',headers:{Cookie:first.cookie}});assert.ok(denied.headers.get('location').includes('login-failed'));
 loginAudience='test-login';const valid=await begin();const response=await mf.dispatchFetch('https://qmc.test/auth/callback?code=valid&state='+valid.state,{redirect:'manual',headers:{Cookie:valid.cookie}});assert.equal(response.headers.get('location'),'/');assert.ok(response.headers.get('set-cookie').includes('qmc_session='));
 const replay=await mf.dispatchFetch('https://qmc.test/auth/callback?code=valid&state='+valid.state,{redirect:'manual',headers:{Cookie:valid.cookie}});assert.ok(replay.headers.get('location').includes('login-failed'));
});
test('follow, redelivery, stale follow after block, and registration identity',async()=>{
 const send=sendEvent;
 const event={type:'follow',source:{type:'user',userId:'Umember'},timestamp:1000,webhookEventId:'follow-1'};
 assert.equal((await send(event)).status,200);assert.equal((await send(event)).status,200);
 assert.equal((await sql('SELECT COUNT(*) AS n FROM members').first()).n,1);
 await send({...event,type:'unfollow',timestamp:3000,webhookEventId:'unfollow-1'});
 await send({...event,timestamp:2000,webhookEventId:'follow-old'});
 assert.equal((await sql("SELECT following FROM members WHERE line_user_id='Umember'").first()).following,0);
 await send({...event,timestamp:4000,webhookEventId:'follow-new'});
 const m=await sql("SELECT * FROM members WHERE line_user_id='Umember'").first();
 assert.equal(m.following,1);assert.equal(m.approved,0);
 assert.equal((await api('/api/members/'+m.id,'PATCH',{name:'鳩係テスト',approved:true,archived:false})).status,200);
 const state=await (await api('/api/state?month=2026-11')).json();
 assert.ok(!JSON.stringify(state).includes('Umember'));
});
test('invited groups require admin membership and explicit confirmation',async()=>{
 const now=Date.now();
 const groupEvent=(groupId,type,webhookEventId,timestamp)=>sendEvent({type,source:{type:'group',groupId},webhookEventId,timestamp});
 assert.equal((await groupEvent(testGroup,'join','group-join',now)).status,200);
 assert.equal((await groupEvent(unrelatedGroup,'join','group-unrelated',now)).status,200);
 const candidates=await (await api('/api/group/candidates')).json();
 assert.deepEqual(candidates.groups,[{id:testGroup,name:'テストグループ',joinedAt:now}]);
 assert.equal(await sql("SELECT value FROM app_settings WHERE key='group'").first(),null);
 const confirm=(groupId,name='テストグループ')=>api('/api/group/confirm','POST',{groupId,name});
 assert.equal((await confirm(unrelatedGroup)).status,403);
 assert.equal((await confirm(testGroup,'別の名前')).status,409);
 assert.equal((await confirm(testGroup)).status,200);
 assert.equal((await groupEvent(testGroup,'leave','group-leave',now+2)).status,200);
 assert.equal((await groupEvent(testGroup,'join','group-stale',now+1)).status,200);
 assert.deepEqual((await (await api('/api/group/candidates')).json()).groups,[]);
 assert.equal((await confirm(testGroup)).status,409);
 assert.equal((await (await api('/api/state')).json()).group.active,false);
 assert.equal((await groupEvent(testGroup,'join','group-rejoin',now+3)).status,200);
 assert.equal(calls.length,0);
});
test('unassigned days cannot publish and stale saves cannot overwrite',async()=>{
 assert.equal((await api('/api/schedules/2026-11','PUT',{draft:{},version:0})).status,200);
 assert.equal((await api('/api/schedules/2026-11','PUT',{draft:{},version:0})).status,409);
 assert.equal((await publish(1)).status,400);
});
test('uncertain group sends use the same retry key and activate only after acceptance',async()=>{
 const m=await sql("SELECT * FROM members WHERE line_user_id='Umember'").first();
 const draft=Object.fromEntries(Array.from({length:30},(_,i)=>['2026-11-'+String(i+1).padStart(2,'0'),m.id]));
 assert.equal((await api('/api/schedules/2026-11','PUT',{draft,version:1})).status,200);
 const message=calendarFlexMessage(calendarCard(month,freezeSchedule(month,draft,[m]),1));
 const digest=createHash('sha256').update(JSON.stringify([1,message])).digest('hex');
 const before=calls.length;
 assert.equal((await publish(2,digest,unrelatedGroup)).status,409);
 assert.equal((await publish(2,'stale-preview')).status,409);
 const oldPage=await mf.dispatchFetch('https://qmc.test/api/schedules/'+month+'/publish',{method:'POST',headers:{...adminHeaders,'Content-Type':'image/png'},body:fixture});
 assert.equal(oldPage.status,409);
 assert.equal(calls.length,before);
 assert.equal((await sql('SELECT count(*) AS n FROM publication_images').first()).n,0);
 failure='accept-then-timeout';
 const result=await publish(2,digest);assert.equal(result.status,200,await result.clone().text());
 let p=await sql('SELECT * FROM publications ORDER BY revision DESC LIMIT 1').first();
 assert.equal(calls[before].payload.to,testGroup);
 assert.equal(calls[before].payload.messages[0].type,'flex');
 assert.deepEqual(calls[before].payload.messages,[message]);
 assert.equal(p.status,'pending');assert.equal((await sql("SELECT published_id FROM schedules WHERE month='2026-11'").first()).published_id,null);
 assert.equal((await api('/api/schedules/2026-11','PUT',{draft:{},version:2})).status,409);
 failure=null;await sql('UPDATE publications SET next_attempt=0 WHERE id=?',p.id).run();
 await tick(new Date(Date.now()+120000).toISOString());
 p=await sql('SELECT * FROM publications WHERE id=?',p.id).first();
 assert.equal(p.status,'accepted');assert.equal(calls[before].key,calls[before+1].key);
 assert.deepEqual(calls[before+1].payload,calls[before].payload);
 assert.equal((await sql("SELECT published_id FROM schedules WHERE month='2026-11'").first()).published_id,p.id);
});
test('previously shared image URLs continue to serve the original image',async()=>{
 const publication=await sql('SELECT id FROM publications WHERE status=\'accepted\'').first();
 const token='1'.repeat(64);
 await sql('INSERT INTO publication_images VALUES(?,?,?)',publication.id,token,fixture).run();
 const image=await mf.dispatchFetch('https://qmc.test/line-images/'+token+'.png');
 assert.equal(image.headers.get('content-type'),'image/png');
 assert.deepEqual(Buffer.from(await image.arrayBuffer()),fixture);
});

test('viewers can inspect a published calendar without receiving LINE identifiers or pending friends',async()=>{
 await sendEvent({type:'follow',source:{type:'user',userId:'Upending'},timestamp:5000,webhookEventId:'pending-friend'});
 const cookie=await loginAs('Uoutsider');
 const response=await mf.dispatchFetch('https://qmc.test/api/state?month='+month,{headers:{Cookie:cookie}});
 assert.equal(response.status,200);
 const state=await response.json();
 assert.equal(state.user.role,'viewer');assert.ok(state.published);assert.equal(state.members.length,1);
 assert.equal(state.group.name,'テストグループ');assert.equal(state.group.id,undefined);assert.deepEqual(state.admins,[]);
 for(const id of ['Umember','Upending','Uowner',testGroup])assert.ok(!JSON.stringify(state).includes(id),id);
 assert.equal(Object.values(state.published.snapshot)[0].name,'鳩係テスト');
 assert.equal(Object.values(state.published.snapshot)[0].userId,undefined);
});
test('08:00 JST sends only the published recipient, retries without duplicates, stops at 08:15',async()=>{
 const p=await sql('SELECT * FROM publications ORDER BY revision DESC LIMIT 1').first();
 await sql('UPDATE publications SET accepted_at=? WHERE id=?',Date.parse('2026-11-08T00:00:00Z'),p.id).run();
 const before=calls.length;
 await tick('2026-11-09T07:59:00+09:00');assert.equal(calls.length,before);
 failure='accept-then-timeout';await tick('2026-11-09T08:00:00+09:00');failure=null;
 await tick('2026-11-09T08:01:00+09:00');await tick('2026-11-09T08:02:00+09:00');
 assert.equal(calls.length,before+2);assert.equal(calls[before].payload.to,'Umember');assert.equal(calls[before].key,calls[before+1].key);
 const n=await sql("SELECT * FROM notifications WHERE date='2026-11-09'").first();assert.equal(n.status,'accepted');
 await tick('2026-11-10T08:15:00+09:00');assert.equal(calls.length,before+2);
 await tick('2026-11-10T12:00:00+09:00');assert.equal(calls.length,before+2);
 // A draft edit never changes the published reminder.
 await sql("UPDATE schedules SET draft='{}',version=version+1 WHERE month='2026-11'").run();
 await tick('2026-11-11T08:00:00+09:00');assert.equal(calls.at(-1).payload.to,'Umember');
 // An accepted publication after 08:00 must not create a new late notification.
 await sql('UPDATE publications SET accepted_at=? WHERE id=?',Date.parse('2026-11-12T08:01:00+09:00'),p.id).run();
 const len=calls.length;await tick('2026-11-12T08:02:00+09:00');assert.equal(calls.length,len);
});
