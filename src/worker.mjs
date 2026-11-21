import html from '../public/index.html';
import css from '../public/style.css';
import client from '../public/app.js';
import favicon from '../public/favicon.svg';
import faviconIco from '../public/favicon.ico';
import touchIcon from '../public/apple-touch-icon.png';
import {jstParts,validMonth,datesInMonth,normalizeDraft,publicationIssues,freezeSchedule,sameAssignment,reminderTime,reminderStartsAt,reminderPhase} from './domain.mjs';
import {calendarCard,calendarFlexMessage} from './calendar-flex.mjs';
import {verifySignature,lineRequest,push,sha256,randomToken,b64url} from './line.mjs';

const DAY=86400000;
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const query=(env,sql,...params)=>env.DB.prepare(sql).bind(...params);
const audit=(env,actor,action,detail)=>query(env,'INSERT INTO audit_log(actor,action,detail,at) VALUES(?,?,?,?)',actor,action,detail,Date.now());
const cookieValue=(r,name)=>(r.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);
const local=(r,env)=>env.DEV_MODE==='true' && ['localhost','127.0.0.1','[::1]'].includes(new URL(r.url).hostname);
const secureCookie=(r,name,value,maxAge)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(r.url).protocol==='https:'?'; Secure':''}`;
const redirect=(location,cookies=[])=>new Response(null,{status:302,headers:[['Location',location],...cookies.map(c=>['Set-Cookie',c])]});
async function body(r) {
  if(!r.headers.get('content-type')?.startsWith('application/json')) fail('JSONで送信してください',415);
  if(Number(r.headers.get('content-length')||0)>50000) fail('入力内容が大きすぎます',413);
  const text=await r.text();if(text.length>50000) fail('入力内容が大きすぎます',413);
  try{return JSON.parse(text);}catch{fail('入力内容を読み取れません');}
}
async function sharedImage(r,env,token) {
  const row=await query(env,`SELECT i.png FROM publication_images i JOIN publications p ON p.id=i.publication_id
    WHERE i.token=? AND p.status IN ('pending','accepted')`,token).first();
  if(!row) fail('ページが見つかりません',404);
  return new Response(r.method==='HEAD'?null:new Uint8Array(row.png),{headers:{
    'Content-Type':'image/png','Content-Length':String(row.png.length),'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'
  }});
}
async function setting(env,key) {const row=await query(env,'SELECT value FROM app_settings WHERE key=?',key).first();return row?JSON.parse(row.value):null;}
const setSetting=(env,key,value)=>query(env,'INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,JSON.stringify(value));
async function admin(r,env,mutate=false) {
  if(local(r,env)) return {line_user_id:'local-owner',name:'開発用 鳩係',role:'owner',csrf:'local-csrf'};
  const token=cookieValue(r,'qmc_session');
  if(!token) fail('LINEでログインしてください',401);
  const a=await query(env,`SELECT s.line_user_id,COALESCE(a.name,u.name,'閲覧ユーザー') AS name,
    COALESCE(a.role,'viewer') AS role,s.csrf FROM sessions s
    LEFT JOIN admins a ON a.line_user_id=s.line_user_id
    LEFT JOIN login_users u ON u.line_user_id=s.line_user_id
    WHERE s.token_hash=? AND s.expires_at>?`,await sha256(token),Date.now()).first();
  if(!a) fail('ログインの有効期限が切れました',401);
  if(mutate && (r.headers.get('origin')!==new URL(r.url).origin || r.headers.get('x-csrf-token')!==a.csrf)) fail('画面を更新してもう一度操作してください',403);
  return a;
}
async function authStart(r,env) {
  if(!env.LINE_LOGIN_CHANNEL_ID || !env.LINE_LOGIN_CHANNEL_SECRET) return redirect('/?notice=login-not-ready');
  const state=randomToken(),verifier=randomToken(),nonce=randomToken();
  await query(env,'INSERT INTO oauth_states(state_hash,verifier,nonce,expires_at) VALUES(?,?,?,?)',await sha256(state),verifier,nonce,Date.now()+600000).run();
  const u=new URL('https://access.line.me/oauth2/v2.1/authorize');
  const challenge=b64url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  u.search=new URLSearchParams({response_type:'code',client_id:env.LINE_LOGIN_CHANNEL_ID,redirect_uri:new URL('/auth/callback',r.url).href,state,scope:'profile openid',nonce,code_challenge:challenge,code_challenge_method:'S256'});
  return redirect(u.href,[secureCookie(r,'qmc_oauth',state,600)]);
}
async function authCallback(r,env) {
  const u=new URL(r.url),state=u.searchParams.get('state');
  if(!state || state!==cookieValue(r,'qmc_oauth')) return redirect('/?notice=login-failed');
  const stateHash=await sha256(state);
  const old=await query(env,'DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING *',stateHash,Date.now()).first();
  if(!old || !u.searchParams.get('code')) return redirect('/?notice=login-failed');
  const tokenResponse=await fetch('https://api.line.me/oauth2/v2.1/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',code:u.searchParams.get('code'),redirect_uri:new URL('/auth/callback',r.url).href,client_id:env.LINE_LOGIN_CHANNEL_ID,client_secret:env.LINE_LOGIN_CHANNEL_SECRET,code_verifier:old.verifier}),signal:AbortSignal.timeout(12000)});
  if(!tokenResponse.ok) return redirect('/?notice=login-failed');
  const tokens=await tokenResponse.json();
  const verified=await fetch('https://api.line.me/oauth2/v2.1/verify',{method:'POST',body:new URLSearchParams({id_token:tokens.id_token,client_id:env.LINE_LOGIN_CHANNEL_ID,nonce:old.nonce}),signal:AbortSignal.timeout(12000)});
  if(!verified.ok) return redirect('/?notice=login-failed');
  const user=await verified.json();
  if(!user.sub || user.nonce!==old.nonce || String(user.aud)!==String(env.LINE_LOGIN_CHANNEL_ID) || user.exp*1000<=Date.now()) return redirect('/?notice=login-failed');
  if(env.BOOTSTRAP_OWNER_ID && user.sub===env.BOOTSTRAP_OWNER_ID && !await setting(env,'bootstrap_consumed')) {
    await env.DB.batch([
      query(env,"INSERT INTO admins(line_user_id,role,name) SELECT ?,'owner',? WHERE NOT EXISTS(SELECT 1 FROM admins WHERE role='owner')",user.sub,user.name||'鳩係'),
      setSetting(env,'bootstrap_consumed',true)
    ]);
  }
  const token=randomToken(),csrf=randomToken();
  await env.DB.batch([
    query(env,`INSERT INTO login_users(id,line_user_id,name,created_at) VALUES(?,?,?,?)
      ON CONFLICT(line_user_id) DO UPDATE SET name=excluded.name`,crypto.randomUUID(),user.sub,String(user.name||'LINEユーザー').slice(0,100),Date.now()),
    query(env,'INSERT INTO sessions VALUES(?,?,?,?)',await sha256(token),user.sub,csrf,Date.now()+7*DAY)
  ]);
  return redirect('/',[secureCookie(r,'qmc_session',token,7*86400),secureCookie(r,'qmc_oauth','',0)]);
}

async function webhook(r,env) {
  if(!env.LINE_CHANNEL_SECRET) return json({error:'接続設定が未完了です'},503);
  if(Number(r.headers.get('content-length')||0)>200000) fail('リクエストが大きすぎます',413);
  const raw=await r.text();if(raw.length>200000) fail('リクエストが大きすぎます',413);
  if(!await verifySignature(raw,r.headers.get('x-line-signature'),env.LINE_CHANNEL_SECRET)) fail('署名を検証できません',401);
  let events;try{events=JSON.parse(raw).events;}catch{fail('Webhook形式エラー');}
  if(!Array.isArray(events)||events.length>100) fail('Webhook形式エラー');
  for(const event of events) await processEvent(env,event);
  return json({ok:true});
}
async function processEvent(env,event) {
  const {type,source,webhookEventId:id}=event;
  if(!id || !source || !Number.isFinite(event.timestamp)) return;
  if(await query(env,'SELECT 1 FROM webhook_events WHERE id=?',id).first()) return;
  const now=Date.now(),statements=[];
  if(source.type==='user' && source.userId && (type==='follow'||type==='unfollow'||(type==='message' && event.message?.type==='text' && event.message.text.trim()==='登録'))) {
    let profile={displayName:'新しい友だち'};
    if(type!=='unfollow') {
      try{profile=await lineRequest(env,`/v2/bot/profile/${encodeURIComponent(source.userId)}`);}catch{ /* following state still needs to be recorded */ }
    }
    const following=type==='unfollow'?0:1;
    statements.push(query(env,`INSERT INTO members(id,line_user_id,display_name,name,following,event_at,created_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(line_user_id) DO UPDATE SET following=excluded.following,event_at=excluded.event_at,
      display_name=CASE WHEN ?=1 THEN members.display_name ELSE excluded.display_name END
      WHERE excluded.event_at>=members.event_at`,crypto.randomUUID(),source.userId,profile.displayName.slice(0,100),profile.displayName.slice(0,40),following,event.timestamp,now,type==='unfollow'||profile.displayName==='新しい友だち'?1:0));
  }
  if(source.type==='group' && source.groupId && ['leave','join'].includes(type)) {
    const active=type==='join';
    statements.push(query(env,`INSERT INTO line_groups(group_id,active,event_at) VALUES(?,?,?)
      ON CONFLICT(group_id) DO UPDATE SET active=excluded.active,event_at=excluded.event_at
      WHERE excluded.event_at>line_groups.event_at`,source.groupId,Number(active),event.timestamp));
    statements.push(query(env,`UPDATE app_settings SET value=json_set(value,'$.active',json(?),'$.eventAt',?)
      WHERE key='group' AND json_extract(value,'$.id')=?
      AND COALESCE(json_extract(value,'$.eventAt'),0)<?`,JSON.stringify(active),event.timestamp,source.groupId,event.timestamp));
  }
  statements.push(query(env,'INSERT OR IGNORE INTO webhook_events(id,received_at) VALUES(?,?)',id,now));
  await env.DB.batch(statements);
  if(type==='follow' && event.replyToken) {
    try{await lineRequest(env,'/v2/bot/message/reply',{method:'POST',body:{replyToken:event.replyToken,messages:[{type:'text',text:`鳩当番リマインダーです 🕊️\n友だち追加ありがとうございます。鳩係が登録を確認すると、担当日の${reminderTime}にこのトークへお知らせします。\n通常のメッセージには自動で返信しません。`}]}});}catch{console.warn(JSON.stringify({event:'welcome_reply_failed'}));}
  }
}

async function state(r,env,a,month) {
  if(!validMonth(month)) fail('年月を確認してください');
  const canEdit=['owner','editor'].includes(a.role);
  const [members,schedule,publications,notifications,group,admins,cron,currentPublication]=await Promise.all([
    query(env,'SELECT id,display_name,name,approved,following,archived FROM members ORDER BY archived,approved DESC,name').all(),
    query(env,'SELECT * FROM schedules WHERE month=?',month).first(),
    query(env,'SELECT id,month,revision,snapshot,status,created_at,accepted_at,error FROM publications WHERE month=? ORDER BY revision DESC LIMIT 20',month).all(),
    query(env,'SELECT id,date,member_id,status,accepted_at,error FROM notifications WHERE date LIKE ? ORDER BY date DESC',month+'-%').all(),
    setting(env,'group'),
    a.role==='owner'?query(env,`SELECT u.id AS login_id,m.id,COALESCE(m.name,u.name) AS name,a.role,
      (u.line_user_id=?) AS is_self FROM login_users u
      LEFT JOIN members m ON m.line_user_id=u.line_user_id LEFT JOIN admins a ON a.line_user_id=u.line_user_id
      UNION ALL SELECT NULL,m.id,m.name,a.role,(m.line_user_id=?) AS is_self FROM members m
      LEFT JOIN admins a ON a.line_user_id=m.line_user_id
      WHERE m.approved=1 AND m.archived=0 AND NOT EXISTS(SELECT 1 FROM login_users u WHERE u.line_user_id=m.line_user_id)
      ORDER BY name`,a.line_user_id,a.line_user_id).all():Promise.resolve({results:[]}),
    setting(env,'cron'),
    query(env,'SELECT p.id,p.month,p.revision,p.snapshot,p.status,p.accepted_at FROM publications p JOIN schedules s ON s.published_id=p.id WHERE s.month=?',month).first()
  ]);
  const publicSnapshot=raw=>Object.fromEntries(Object.entries(JSON.parse(raw)).map(([day,{userId,...entry}])=>[day,entry]));
  const pubs=publications.results.map(p=>({...p,snapshot:publicSnapshot(p.snapshot)}));
  const current=currentPublication?{...currentPublication,snapshot:publicSnapshot(currentPublication.snapshot)}:null;
  const t=jstParts(),entry=current?.snapshot[t.date],job=notifications.results.find(n=>n.date===t.date);
  let todayStatus=month!==t.month?null:!entry?'not_shared':entry.off?'off':job?.status||'scheduled';
  if(todayStatus==='scheduled') {
    const phase=reminderPhase(t);
    if(phase==='ended') todayStatus='needs_attention';
    if(phase==='sending') todayStatus='waiting';
  }
  return json({user:{name:a.name,role:a.role},csrf:a.csrf,month,members:canEdit?members.results:members.results.filter(m=>m.approved&&!m.archived).map(({display_name,...m})=>({...m,display_name:m.name})),
    schedule:{draft:JSON.parse(schedule?.draft||'{}'),version:schedule?.version||0,publishedId:schedule?.published_id||null},
    publications:pubs,published:current,todayStatus,notifications:notifications.results,group:canEdit?group:group?{name:group.name,active:group.active}:null,admins:admins.results,cron,
    connection:{messaging:!!(env.LINE_CHANNEL_SECRET&&env.LINE_CHANNEL_ACCESS_TOKEN),login:!!env.LINE_LOGIN_CHANNEL_ID},
    officialId:env.LINE_OFFICIAL_ID||'@788fjcfb',local:local(r,env)});
}
async function saveDraft(env,a,month,data) {
  if(!validMonth(month) || !Number.isInteger(data.version)) fail('年月と保存内容を確認してください');
  const members=(await query(env,'SELECT * FROM members').all()).results;
  let draft;try{draft=normalizeDraft(month,data.draft,members);}catch(e){fail(e.message);}
  await query(env,'INSERT OR IGNORE INTO schedules(month,updated_at) VALUES(?,?)',month,Date.now()).run();
  const changed=await query(env,`UPDATE schedules SET draft=?,version=version+1,updated_at=? WHERE month=? AND version=?
    AND NOT EXISTS(SELECT 1 FROM publications WHERE month=? AND status='pending')`,JSON.stringify(draft),Date.now(),month,data.version,month).run();
  if(!changed.meta.changes) fail('他の画面で更新されたか、LINEへ送信中です。再読み込みしてください。',409);
  await audit(env,a.line_user_id,'draft_saved',month).run();
  return json({ok:true,version:data.version+1});
}
async function publishSchedule(r,env,a,month) {
  if(r.headers.get('content-type')==='image/png') fail('画面を再読み込みし、LINE共有を開き直してください。',409);
  const {version,groupId,previewHash}=await body(r);
  if(!validMonth(month)||!Number.isSafeInteger(version)) fail('当番表を開き直してください。');
  const group=await setting(env,'group');
  if(!group?.active) fail('先に設定画面でLINEグループを連携してください');
  if(group.id!==groupId) fail('共有先が変更されました。再読み込みして確認してください。',409);
  if(!env.LINE_CHANNEL_ACCESS_TOKEN) fail('LINEの接続設定がまだ完了していません',503);
  const previous=await query(env,"SELECT id FROM publications WHERE month=? AND status='pending'",month).first();
  if(previous) fail('LINEへの共有を確認中です。再読み込みして確認してください。',409);
  const schedule=await query(env,'SELECT * FROM schedules WHERE month=?',month).first();
  if(!schedule||schedule.version!==version) fail('当番表が更新されています。再読み込みして確認してください。',409);
  const members=(await query(env,'SELECT * FROM members').all()).results,draft=JSON.parse(schedule.draft);
  const issues=publicationIssues(month,draft,members);if(issues.length) fail(issues.slice(0,3).join(' / '));
  const snapshot=freezeSchedule(month,draft,members),id=crypto.randomUUID();
  const rev=(await query(env,'SELECT COALESCE(MAX(revision),0)+1 AS n FROM publications WHERE month=?',month).first()).n;
  const message=calendarFlexMessage(calendarCard(month,snapshot,rev));
  if(await sha256(JSON.stringify([rev,message]))!==previewHash) {
    fail('プレビューを開いた後に当番表が変わりました。再読み込みして確認してください。',409);
  }
  const payload={to:group.id,messages:[message]};
  // Save the exact message and its snapshot together so retries send the same card.
  const result=await env.DB.batch([
    query(env,`INSERT INTO publications(id,month,revision,snapshot,payload,group_id,status,created_at)
      SELECT ?,?,?,?,?,?,'pending',? WHERE EXISTS(SELECT 1 FROM schedules WHERE month=? AND version=?)
      AND NOT EXISTS(SELECT 1 FROM publications WHERE month=? AND (status='pending' OR revision>=?))
      AND EXISTS(SELECT 1 FROM app_settings WHERE key='group' AND json_extract(value,'$.id')=? AND json_extract(value,'$.active')=1)`,
      id,month,rev,JSON.stringify(snapshot),JSON.stringify(payload),group.id,Date.now(),month,version,month,rev,group.id),
    query(env,"INSERT INTO audit_log(actor,action,detail,at) SELECT ?,'publish_requested',?,? FROM publications WHERE id=?",a.line_user_id,month,Date.now(),id)
  ]);
  if(!result[0].meta.changes) fail('当番表が更新されました。再読み込みしてください。',409);
  await deliverPublication(env,id);
  return json({id,...await query(env,'SELECT status,error FROM publications WHERE id=?',id).first()});
}
async function deliverPublication(env,id,now=Date.now()) {
  const p=await query(env,"SELECT * FROM publications WHERE id=? AND status='pending'",id).first();
  if(!p || p.next_attempt>now) return;
  if(now-p.created_at>23*3600000) {await query(env,"UPDATE publications SET status='expired',error='送信結果を確認できないまま時間が経過しました。グループを確認して再共有してください。' WHERE id=? AND status='pending'",id).run();return;}
  const group=await setting(env,'group');
  if(!group?.active || group.id!==p.group_id) {await query(env,"UPDATE publications SET status='failed',error='共有先グループとの連携が切れています' WHERE id=? AND status='pending'",id).run();return;}
  try {
    await push(env,JSON.parse(p.payload),p.id);
    // A send confirmed after the reminder starts must not create a late recipient.
    await env.DB.batch([
      query(env,"UPDATE publications SET status='accepted',accepted_at=?,error=NULL WHERE id=? AND status='pending'",now,id),
      query(env,"UPDATE schedules SET published_id=? WHERE month=? AND EXISTS(SELECT 1 FROM publications WHERE id=? AND status='accepted') AND NOT EXISTS(SELECT 1 FROM publications WHERE month=? AND status='accepted' AND revision>?)",id,p.month,id,p.month,p.revision)
    ]);
  } catch(e) {
    const retry=e.retryable!==false && ![400,401,403,404].includes(e.status);
    await query(env,"UPDATE publications SET status=?,attempts=attempts+1,next_attempt=?,error=? WHERE id=? AND status='pending'",retry?'pending':'failed',now+Math.min(3600000,60000*2**Math.min(p.attempts,6)),e.status?e.message:'LINEの受付結果を確認中です。自動で再確認します。',id).run();
  }
}
export async function runScheduled(env,now=Date.now()) {
  await setSetting(env,'cron',{at:now}).run();
  const publications=await query(env,"SELECT id FROM publications WHERE status='pending' AND next_attempt<=? LIMIT 5",now).all();
  for(const p of publications.results) await deliverPublication(env,p.id,now);
  const t=jstParts(now),phase=reminderPhase(t);
  if(phase==='sending') {
    const pending=await query(env,"SELECT 1 FROM publications WHERE month=? AND status='pending'",t.month).first();
    if(!pending) {
      const base=await query(env,"SELECT * FROM publications WHERE month=? AND status='accepted' AND accepted_at<=? ORDER BY revision DESC LIMIT 1",t.month,reminderStartsAt(t.date)).first();
      const latest=await query(env,'SELECT p.* FROM publications p JOIN schedules s ON s.published_id=p.id WHERE s.month=?',t.month).first();
      if(base && latest) {
        const assignment=JSON.parse(base.snapshot)[t.date],current=JSON.parse(latest.snapshot)[t.date];
        if(assignment && !assignment.off && sameAssignment(assignment,current)) {
          const member=await query(env,'SELECT 1 FROM members WHERE id=? AND approved=1 AND following=1 AND archived=0',assignment.memberId).first();
          if(member) {
            const payload={to:assignment.userId,messages:[{type:'text',text:`今日（${Number(t.date.slice(5,7))}/${Number(t.date.slice(8))}）は鳩のお世話の担当です 🕊️\n${assignment.name}さん、よろしくお願いします。\n担当を交代する場合は、鳩係へ連絡してください。`}]};
            await query(env,"INSERT OR IGNORE INTO notifications(id,date,member_id,publication_id,payload,status,created_at) VALUES(?,?,?,?,?,'pending',?)",crypto.randomUUID(),t.date,assignment.memberId,base.id,JSON.stringify(payload),now).run();
            const job=await query(env,"SELECT * FROM notifications WHERE date=? AND member_id=? AND status='pending' AND next_attempt<=?",t.date,assignment.memberId,now).first();
            if(job) {
              try {
                await push(env,JSON.parse(job.payload),job.id);
                await query(env,"UPDATE notifications SET status='accepted',accepted_at=?,error=NULL WHERE id=?",now,job.id).run();
              }catch(e) {
                const retry=e.retryable!==false && ![400,401,403,404].includes(e.status);
                await query(env,'UPDATE notifications SET status=?,attempts=attempts+1,next_attempt=?,error=? WHERE id=?',retry?'pending':'failed',now+Math.min(300000,60000*2**Math.min(job.attempts,3)),e.status?e.message:'LINEの受付結果を確認できませんでした',job.id).run();
              }
            }
          }
        }
      }
    }
  }
  if(phase==='ended') await query(env,"UPDATE notifications SET status='skipped',error='自動送信の時間を過ぎました。個別に連絡してください。' WHERE status='pending' AND date<=?",t.date).run();
  if(t.hour===0&&t.minute===0) await env.DB.batch([
    query(env,'DELETE FROM sessions WHERE expires_at<?',now),query(env,'DELETE FROM oauth_states WHERE expires_at<?',now),
    query(env,'DELETE FROM webhook_events WHERE received_at<?',now-30*DAY)
  ]);
}

async function groupForAdmin(env,a,id) {
  const path=`/v2/bot/group/${encodeURIComponent(id)}`;
  try {
    const member=await lineRequest(env,`${path}/member/${encodeURIComponent(a.line_user_id)}`);
    if(member.userId!==a.line_user_id) return null;
    const group=await lineRequest(env,`${path}/summary`);
    return {id,name:group.groupName};
  } catch(error) {
    if(error.status===404) return null;
    throw error;
  }
}

async function groupCandidates(env,a) {
  if(!env.LINE_CHANNEL_ACCESS_TOKEN) return json({groups:[]});
  const {results}=await query(env,'SELECT group_id,event_at FROM line_groups WHERE active=1 ORDER BY event_at DESC LIMIT 15').all();
  const candidates=await Promise.all(results.map(async row=>{
    const group=await groupForAdmin(env,a,row.group_id);
    return group && {...group,joinedAt:row.event_at};
  }));
  return json({groups:candidates.filter(Boolean)});
}

async function confirmGroup(env,a,data) {
  if(typeof data?.groupId!=='string' || !/^C[0-9a-f]{32}$/i.test(data.groupId)) fail('共有先のグループを選んでください');
  const row=await query(env,'SELECT event_at FROM line_groups WHERE group_id=? AND active=1',data.groupId).first();
  if(!row) fail('Botがグループに参加していることを確認してください',409);
  const group=await groupForAdmin(env,a,data.groupId);
  if(!group) fail('ログインしたLINEアカウントとBotが、両方ともグループに参加していることを確認してください',403);
  if(group.name!==data.name) fail('グループ名が変更されました。一覧を更新して確認してください',409);
  const updated=await query(env,`INSERT INTO app_settings(key,value)
    SELECT 'group',? FROM line_groups WHERE group_id=? AND active=1 AND event_at=?
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    JSON.stringify({...group,active:true,eventAt:row.event_at}),group.id,row.event_at).run();
  if(!updated.meta.changes) fail('グループの参加状況が変わりました。一覧を更新してください',409);
  await audit(env,a.line_user_id,'group_linked','LINE group').run();
  return json({ok:true});
}

async function api(r,env) {
  const url=new URL(r.url),path=url.pathname,mutate=!['GET','HEAD'].includes(r.method),a=await admin(r,env,mutate);
  if(path==='/api/state'&&r.method==='GET') return state(r,env,a,url.searchParams.get('month')||jstParts().month);
  if(path==='/api/logout'&&r.method==='POST') {
    await query(env,'DELETE FROM sessions WHERE token_hash=?',await sha256(cookieValue(r,'qmc_session')||'')).run();
    return new Response('{}',{headers:{'Content-Type':'application/json','Set-Cookie':secureCookie(r,'qmc_session','',0)}});
  }
  if(!['owner','editor'].includes(a.role)) fail('閲覧のみのアカウントです。操作には責任者からの権限付与が必要です',403);
  let match=/^\/api\/schedules\/(20\d{2}-\d{2})(\/publish)?$/.exec(path);
  if(match&&r.method==='PUT'&&!match[2]) return saveDraft(env,a,match[1],await body(r));
  if(match&&r.method==='POST'&&match[2]) return publishSchedule(r,env,a,match[1]);
  match=/^\/api\/members\/([a-zA-Z0-9-]+)$/.exec(path);
  if(match&&r.method==='PATCH') {
    const data=await body(r),name=typeof data.name==='string'?data.name.trim():'';
    if(!name || name.length>40 || /[\u0000-\u001f]/.test(name)) fail('名前は1〜40文字で入力してください');
    if(typeof data.approved!=='boolean'||typeof data.archived!=='boolean') fail('登録内容を確認してください');
    await env.DB.batch([query(env,'UPDATE members SET name=?,approved=?,archived=? WHERE id=?',name,+data.approved,+data.archived,match[1]),audit(env,a.line_user_id,'member_updated',match[1])]);
    return json({ok:true});
  }
  if(path==='/api/group/candidates'&&r.method==='GET') return groupCandidates(env,a);
  if(path==='/api/group/confirm'&&r.method==='POST') return confirmGroup(env,a,await body(r));
  if(path==='/api/quota'&&r.method==='GET') {
    const [quota,usage,group]=await Promise.all([lineRequest(env,'/v2/bot/message/quota'),lineRequest(env,'/v2/bot/message/quota/consumption'),setting(env,'group')]);
    let groupSize=null;if(group?.active) try{groupSize=(await lineRequest(env,`/v2/bot/group/${group.id}/members/count`)).count;}catch{/* estimate stays unknown */}
    return json({quota:quota.value??null,used:usage.totalUsage,groupSize});
  }
  if(path==='/api/admins'&&r.method==='POST') {
    if(a.role!=='owner') fail('責任者だけが権限を変更できます',403);
    const data=await body(r);if(!['owner','editor','none'].includes(data.role)) fail('権限を確認してください');
    const m=data.loginId
      ?await query(env,'SELECT id,line_user_id,name FROM login_users WHERE id=?',String(data.loginId)).first()
      :await query(env,'SELECT * FROM members WHERE id=? AND approved=1 AND archived=0',String(data.memberId)).first();
    if(!m) fail('ログイン済みの人、または登録済みの部員を選んでください');
    if(m.line_user_id===a.line_user_id) fail('自分の権限はこの画面から変更できません');
    await env.DB.batch([data.role==='none'?query(env,'DELETE FROM admins WHERE line_user_id=?',m.line_user_id):query(env,'INSERT INTO admins VALUES(?,?,?) ON CONFLICT(line_user_id) DO UPDATE SET role=excluded.role,name=excluded.name',m.line_user_id,data.role,m.name),audit(env,a.line_user_id,'admin_changed',`${m.id}:${data.role}`)]);
    return json({ok:true});
  }
  if(path==='/api/export'&&r.method==='GET') {
    if(a.role!=='owner') fail('責任者だけが書き出せます',403);
    const tables=['members','admins','login_users','schedules','publications','notifications','app_settings'];const result={format:'qmc-backup-v1',exportedAt:new Date().toISOString()};
    for(const table of tables) result[table]=(await env.DB.prepare(`SELECT * FROM ${table}`).all()).results;
    return new Response(JSON.stringify(result,null,2),{headers:{'Content-Type':'application/json','Content-Disposition':`attachment; filename="qmc-backup-${jstParts().date}.json"`,'Cache-Control':'no-store'}});
  }
  fail('ページが見つかりません',404);
}

async function route(r,env) {
  const url=new URL(r.url),path=url.pathname;
  if(path==='/health') return json({ok:true,service:'qmc-pigeon-care'});
  if(path==='/auth/line'&&r.method==='GET') return authStart(r,env);
  if(path==='/auth/callback'&&r.method==='GET') return authCallback(r,env);
  if(path==='/webhooks/line'&&r.method==='POST') return webhook(r,env);
  if(path.startsWith('/api/')) return api(r,env);
  if(!['GET','HEAD'].includes(r.method)) fail('この操作は利用できません',405);
  const image=/^\/line-images\/([0-9a-f]{64})\.png$/.exec(path);
  if(image) return sharedImage(r,env,image[1]);
  const assets={
    '/':{body:html,type:'text/html'},
    '/privacy':{body:html,type:'text/html'},
    '/app.js':{body:client,type:'text/javascript'},
    '/style.css':{body:css,type:'text/css'},
    '/favicon.svg':{body:favicon,type:'image/svg+xml'},
    '/favicon.ico':{body:faviconIco,type:'image/x-icon'},
    '/apple-touch-icon.png':{body:touchIcon,type:'image/png'}
  };
  const asset=assets[path];
  if(!asset) return new Response('Not found',{status:404});
  const contentType=typeof asset.body==='string'?asset.type+'; charset=utf-8':asset.type;
  return new Response(r.method==='HEAD'?null:asset.body,{headers:{'Content-Type':contentType,'Cache-Control':'no-cache'}});
}
export default {
  async fetch(r,env) {
    let response;
    try {response=await route(r,env);}catch(e) {
      const status=e.status>=400&&e.status<600?e.status:500;
      if(status>=500) console.error(JSON.stringify({event:'request_failed',path:new URL(r.url).pathname,status}));
      response=json({error:status>=500?'通信できませんでした。少し待ってもう一度お試しください。':e.message},status);
    }
    const result=new Response(response.body,response);
    result.headers.set('X-Content-Type-Options','nosniff');
    result.headers.set('Referrer-Policy','same-origin');
    result.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://qr-official.line.me data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    result.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    return result;
  },
  async scheduled(controller,env,ctx) {
    ctx.waitUntil(runScheduled(env,controller.scheduledTime).catch(e=>{console.error(JSON.stringify({event:'cron_failed',message:'scheduled task failed'}));throw e;}));
  }
};
