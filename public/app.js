/* No member data is fetched until the server has checked the administrator session. */
import {calendarWeekdays as weekdays,freezeSchedule,reminderPhase,reminderTime} from '../src/domain.mjs';
import {sha256} from '../src/line.mjs';
import {calendarCard,calendarFlexMessage,calendarColors,memberColorsFor} from '../src/calendar-flex.mjs';

const $=s=>document.querySelector(s);
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHtml;
const icons={
 dove:'<path d="M7 19c3-1 5-3 6-6-4 1-7 0-10-3 0 5 1 7 4 9Zm0 0c5 2 9 0 11-5 1-2 2-3 4-3l-3-2c-1-3-4-4-6-2-1 1-1 3-1 4M5 21l2-2M18 8h.01"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2m4 0h2m-8 3h2"/>',
 users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5"/>',
 settings:'<path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
 left:'<path d="m14 6-6 6 6 6"/>',right:'<path d="m10 6 6 6-6 6"/>',check:'<path d="m5 12 4 4L19 6"/>',
 send:'<path d="m22 2-7 20-4-9L2 9 22 2ZM11 13 22 2"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 leaf:'<path d="M20 3C8 2 2 7 5 15c7 5 16-1 15-12ZM4 21 16 8"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-11v1"/>'
};
const icon=(name,size=20)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.info}</svg>`;
const now=()=>new Date(Date.now()+9*3600000);
const today=()=>now().toISOString().slice(0,10);
const days=m=>new Date(Date.UTC(+m.slice(0,4),+m.slice(5),0)).getUTCDate();
const dates=m=>Array.from({length:days(m)},(_,i)=>`${m}-${String(i+1).padStart(2,'0')}`);
const weekday=d=>new Date(d+'T00:00:00Z').getUTCDay();
const formatTime=v=>v?new Date(v).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const demo=location.pathname==='/demo';
let data=null,month=today().slice(0,7),view='calendar',saving=false,quota=null,toastTimer;
function toast(text){$('#toast').textContent=text;$('#toast').classList.add('toast-visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('toast-visible'),4500);}
async function request(path,method='GET',body){
 const response=await fetch(path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(data?.csrf?{'X-CSRF-Token':data.csrf}:{})},body:body?JSON.stringify(body):undefined});
 const result=await response.json();if(!response.ok){const err=new Error(result.error||'通信に失敗しました');err.status=response.status;throw err;}return result;
}
function sample(){
 const members=['田中','佐藤','鈴木','山本','高橋','渡辺'].map((name,i)=>({id:'demo-'+i,name,display_name:name+'（サンプル）',approved:1,following:1,archived:0}));
 const saved=JSON.parse(localStorage.getItem('qmc-demo-'+month)||'null');
 return {user:{name:'鳩係の体験用',role:'owner'},csrf:'demo',month,members,publications:[],notifications:[],admins:[],schedule:saved||{draft:Object.fromEntries(dates(month).filter((d,i)=>i<days(month)-5).map((d,i)=>[d,i%9===8?'off':members[i%6].id])),version:0,publishedId:null},group:{name:'QMC 鳩当番グループ（サンプル）',active:true},connection:{messaging:true,login:true},officialId:'@788fjcfb',cron:null};
}
async function load(){
 if(demo){data=sample();render();return;}
 const requestedMonth=month;
 try{const result=await request('/api/state?month='+requestedMonth);if(month!==requestedMonth)return;data=result;render();}
 catch(err){if(err.status===401){landing();}else{landing(err.message);}}
}
function brand() {
 return `<a class="brand" href="${demo ? '/demo' : '/'}">
   <span class="brand-icon">${icon('dove', 19)}</span><span>QMC 鳩当番</span>
 </a>`;
}
function landing(error) {
 const notices = {
  'login-not-ready': 'LINEログインの設定が完了していません。',
  'not-admin': '管理権限がありません。鳩係の責任者にお問い合わせください。',
  'login-failed': 'ログインできませんでした。もう一度お試しください。'
 };
 const notice = error || notices[new URLSearchParams(location.search).get('notice')];
 $('#app').innerHTML = `
   <div class="login-page">
     <header class="login-header">${brand()}<a class="btn btn-small" href="/demo">体験版を見る ${icon('right', 14)}</a></header>
     <main id="main" class="login-main">
       <section class="panel login-card">
         <h1>ログイン</h1>
         <p>鳩係・責任者はLINEアカウントでログインしてください。</p>
         ${notice ? `<div class="notice" role="alert">${e(notice)}</div>` : ''}
         <a class="btn btn-primary login-button" href="/auth/line">LINEでログイン ${icon('right', 16)}</a>
         <div class="login-member">
           <h2>部員の方</h2>
           <p>担当日の通知を受け取るには、公式LINEを友だち追加してください。</p>
           <a href="https://line.me/R/ti/p/@788fjcfb">公式LINEを開く ${icon('right', 14)}</a>
         </div>
       </section>
       <a class="privacy-link" href="/privacy">プライバシーについて</a>
     </main>
   </div>`;
}
function privacy(){
 $('#app').innerHTML=`<main class="privacy" id="main">${brand()}<h1>プライバシーについて</h1><p>このアプリは、QMCの鳩当番の管理とLINEでのリマインドに使用します。</p><h2>保存する情報</h2><p>LINEのユーザーID・表示名、鳩係が設定した名前、友だち登録の状態、担当日、管理権限、配信履歴を保存します。グループの通常の会話や、個別トークの通常の本文は保存しません。</p><h2>利用目的と閲覧者</h2><p>担当者への通知と当番表の作成に使用します。管理画面は登録された鳩係・責任者のみ利用できます。当番表の名前と担当日は、連携したLINEグループに共有されます。過去に共有した画像は、専用リンクを知っている人が閲覧できます。</p><h2>外部サービス</h2><p>ログインとメッセージ送信にLINE、アプリの実行とデータ保存にCloudflareを利用します。</p><h2>退会・変更・削除</h2><p>退会時は鳩係に連絡してください。今後の当番から外し、個人情報の削除が必要な場合は技術担当者が対応します。すでにLINEグループに送られた当番表は、アプリから回収できません。</p><h2>お問い合わせ</h2><p>サークルの鳩係・責任者にお問い合わせください。</p><p><a href="/">トップへ戻る</a></p></main>`;
}
function activeMembers(){return data.members.filter(m=>m.approved&&!m.archived);}
function published(){return data.published||data.publications.find(p=>p.id===data.schedule.publishedId);}
function isPending(){return data.publications.some(p=>p.status==='pending');}
function nameOf(id){return data.members.find(m=>m.id===id)?.name||'登録解除された人';}
function counts(){return activeMembers().map(m=>({...m,count:Object.values(data.schedule.draft).filter(id=>id===m.id).length}));}
function unassigned(){return dates(month).filter(d=>!data.schedule.draft[d]);}
function changed(){const p=published();return !p||dates(month).some(d=>{const v=data.schedule.draft[d],old=p.snapshot[d];return v==='off'?!old?.off:v!==old?.memberId;});}
function shell(content) {
 const navigation = [['calendar', 'calendar', '当番表'], ['members', 'users', 'メンバー'], ['settings', 'settings', '配信・設定']];
 return `<div class="shell">
   <header class="topbar">
     <div class="topbar-inner">
       ${brand()}
       <nav class="nav" aria-label="メインメニュー">
         ${navigation.map(([id, glyph, label]) => `
           <button data-view="${id}" class="${view === id ? 'active' : ''}" ${view === id ? 'aria-current="page"' : ''}>
             ${icon(glyph, 17)}<span>${label}</span>
           </button>`).join('')}
       </nav>
       <div class="account">
         <span class="account-name">${e(data.user.name)}</span>
         ${demo ? '<a class="btn btn-small" href="/">ログイン</a>' : '<button class="btn btn-small" data-action="logout">ログアウト</button>'}
       </div>
     </div>
   </header>
   <main id="main" class="content">
     ${demo ? '<div class="demo-bar">体験版のデータは、このブラウザに保存されます。</div>' : ''}
     ${content}
   </main>
 </div>`;
}
function calendarPage() {
 const list = counts();
 const missing = unassigned().length;
 const off = Object.values(data.schedule.draft).filter(id => id === 'off').length;
 const assigned = days(month) - missing - off;
 const publishedSchedule = published();
 const pending = isPending();
 const currentDate = today();
 const date = now();
 const demoAssignment = data.schedule.draft[currentDate];
 const todayEntry = demo && demoAssignment
  ? demoAssignment === 'off' ? { off: true } : { name: nameOf(demoAssignment) }
  : publishedSchedule?.snapshot[currentDate];
 const todayLabel = month !== currentDate.slice(0, 7) ? '今月の当番表で確認'
  : todayEntry?.off ? 'お休み'
  : todayEntry?.name ? todayEntry.name : demo ? '未設定' : '共有前';
 const blankDay = '<div class="day empty" aria-hidden="true"></div>';
 const monthDates = dates(month);
 const memberColors = memberColorsFor(monthDates.map(date => data.schedule.draft[date]));
 const memberTint = id => memberColors.has(id) ? ` style="--member-color:${memberColors.get(id)}"` : '';
 const cells = Array.from({ length: weekday(month + '-01') }, () => blankDay);
 for (const date of monthDates) {
  const id = data.schedule.draft[date];
  const day = Number(date.slice(-2));
  const dayOfWeek = weekday(date);
  const assignment = id === 'off' ? 'お休み' : id ? nameOf(id) : '未設定';
  const assignmentClass = id === 'off' ? 'off' : id ? 'assigned' : 'unset';
  cells.push(`
    <button class="day ${date === currentDate ? 'today' : ''} ${dayOfWeek === 0 ? 'sunday' : dayOfWeek === 6 ? 'saturday' : ''}"
      data-day="${date}" aria-label="${day}日 ${weekdays[dayOfWeek]}曜日、${e(assignment)}。担当者を選択"
      ${date === currentDate ? 'aria-current="date"' : ''} ${pending ? 'disabled' : ''}>
      <span class="day-number">${day}</span>
      <span class="assignment ${assignmentClass}"${memberTint(id)}>${e(assignment)}</span>
    </button>`);
 }
 while (cells.length % 7) cells.push(blankDay);
 const shareStatus = pending ? '送信結果を確認中' : publishedSchedule ? changed() ? '未共有の変更あり' : '共有済み' : '下書き';
 return `
   <div class="page-heading">
     <h2>当番表</h2>
     <button class="btn btn-primary" data-action="preview" ${pending ? 'disabled' : ''}>${icon('send', 16)}LINE共有</button>
   </div>
   ${!demo && !data.connection.messaging ? '<div class="notice">LINE連携を設定すると当番表を共有できます。<button class="text-link" data-view="settings">配信・設定を開く</button></div>' : ''}
   ${data.todayStatus === 'needs_attention' ? '<div class="notice" role="alert"><strong>今日の通知の受付を確認できませんでした</strong>担当者へ個別に連絡し、配信履歴を確認してください。</div>' : ''}
   ${pending ? '<div class="notice" role="status">LINEへの送信結果を確認中です。確認が終わると、この月を編集できます。</div>' : ''}
   ${data.publications[0]?.error ? `<div class="notice" role="alert">${e(data.publications[0].error)}</div>` : ''}
   <div class="workspace">
     <section class="panel calendar-panel" aria-label="月間当番表">
       <div class="calendar-toolbar">
         <div class="month-control">
           <button class="icon-btn" data-month="-1" aria-label="前の月">${icon('left')}</button>
           <h3>${month.slice(0, 4)}年${Number(month.slice(5))}月</h3>
           <button class="icon-btn" data-month="1" aria-label="次の月">${icon('right')}</button>
         </div>
         <div class="calendar-tools">
           <button class="btn btn-small" data-action="this-month">今月</button>
           <span class="pill ${publishedSchedule && !changed() ? '' : 'neutral'}" id="save-state">${shareStatus}</span>
         </div>
       </div>
       <div class="weekdays">${weekdays.map(label => `<span>${label}</span>`).join('')}</div>
       <div class="calendar">${cells.join('')}</div>
       <div class="calendar-footer">
         <div class="calendar-totals"><span>担当あり <b>${assigned}</b>日</span><span>お休み <b>${off}</b>日</span><span class="${missing ? 'unassigned-count' : ''}">未設定 <b>${missing}</b>日</span></div>
         ${publishedSchedule ? `<span>${e(formatTime(publishedSchedule.accepted_at))} 共有</span>` : '<span>編集は自動保存</span>'}
       </div>
     </section>
     <aside class="side-panel">
       <section class="panel padded today-panel">
         <div class="panel-title"><h3>今日の担当</h3><span class="hint">${date.getUTCMonth() + 1}/${date.getUTCDate()}（${weekdays[date.getUTCDay()]}）</span></div>
         <p class="today-value">${e(todayLabel)}</p>
         ${month !== currentDate.slice(0, 7) ? '<button class="text-link" data-action="this-month">今月へ移動</button>' : `<p class="hint">個別通知 ${reminderTime}</p>`}
       </section>
       <section class="panel">
         <div class="panel-title panel-heading"><h3>担当回数</h3><span class="hint">${Number(month.slice(5))}月</span></div>
         ${list.length ? `<ul class="count-list">${list.map(member => `<li><span${memberTint(member.id)}>${e(member.name)}</span><strong>${member.count}<small>回</small></strong></li>`).join('')}</ul>` : '<p class="panel-empty">担当を割り当てるには、メンバーを登録してください。</p>'}
         <div class="panel-footer"><button class="text-link" data-view="members">メンバーを開く ${icon('right', 14)}</button></div>
       </section>
     </aside>
   </div>`;
}
function membersPage(){
 const pending=data.members.filter(m=>!m.approved&&!m.archived).length;
 return `<div class="page-heading"><div><h2>メンバー</h2></div><button class="btn" data-action="reload">一覧を更新</button></div><div class="section-grid"><section class="panel"><div class="padded"><h3>部員の一覧 <span class="badge">${data.members.filter(m=>!m.archived).length}人</span></h3><p>${pending?`${pending}人が確認待ちです。知っている部員か確認してから登録してください。`:''}</p></div>${data.members.length?data.members.map(m=>`<div class="member-row"><span class="avatar">${e(m.name.slice(0,1))}</span><div class="member-info"><strong>${e(m.name)}</strong><small>LINE表示名：${e(m.display_name)}</small></div><div class="actions"><span class="pill ${m.archived?'neutral':!m.following?'danger':!m.approved?'warn':''}">${m.archived?'担当から除外':!m.following?'通知できません':!m.approved?'確認待ち':'登録済み'}</span><button class="btn btn-small" data-member="${e(m.id)}">${m.approved?'編集':'確認する'}</button></div></div>`).join(''):`<div class="empty-state">${icon('users',35)}<h3>メンバーは未登録です</h3><p>公式LINEを友だち追加すると、確認待ちのメンバーが表示されます。</p></div>`}</section><aside class="panel padded side-qr"><h3>LINE友だち追加</h3><img class="qr" src="https://qr-official.line.me/gs/M_788fjcfb_GW.png" alt="QMC 鳩当番リマインダーの友だち追加QRコード" width="160" height="160"><p class="friend-id">${e(data.officialId)}</p><button class="btn btn-soft" data-action="copy-friend">友だち追加リンクをコピー</button><p class="hint">追加済みなのに表示されない場合は、Botの個別トークに「登録」と送ってから一覧を更新してください。</p></aside></div>`;
}
function settingsPage(){
 const approved=activeMembers();
 return `<div class="page-heading"><div><h2>配信・設定</h2></div><button class="btn" data-action="reload">最新の状態に更新</button></div><div class="section-grid"><div><section class="panel padded"><h3>LINEとの接続</h3><div class="settings-row"><div><strong>公式アカウント</strong><small>QMC 鳩当番リマインダー · ${e(data.officialId)}</small></div><span class="pill ${data.connection.messaging?'':'warn'}">${data.connection.messaging?'接続済み':'設定中'}</span></div><div class="settings-row"><div><strong>共有するグループ</strong><small>${e(data.group?.name||'まだ連携していません')}${data.group&&!data.group.active?' · Botが退出しています':''}</small></div><button class="btn btn-small" data-action="link-group">${data.group?.active?'連携を変更':'連携する'}</button></div><div class="settings-row"><div><strong>今日の配信</strong><small>共有済みの当番表をもとにしています。</small></div><span class="pill">${({not_shared:'まだ未共有',off:'お休み',accepted:'LINE受付済み',pending:'確認中',failed:'要確認',skipped:'要確認',needs_attention:'個別に連絡してください',scheduled:`${reminderTime}に配信予定`,waiting:'配信処理中'})[data.todayStatus]||'—'}</span></div><div class="settings-row"><div><strong>リマインドの時間</strong><small>日本時間 · 共有済みの当番表を使用</small></div><strong>毎日 ${reminderTime}</strong></div><div class="settings-row"><div><strong>自動配信の最終確認</strong><small>時刻を過ぎても更新されない場合は技術担当へご連絡ください。</small></div><span class="hint">${demo?'体験版では実行しません':data.cron?e(formatTime(data.cron.at)):'まだ実行されていません'}</span></div></section><p class="small-heading">${+month.slice(5)}月の配信結果</p><section class="panel table-wrap">${data.notifications.length?`<table class="status-table"><thead><tr><th>担当日</th><th>担当者</th><th>結果</th><th>受付時刻</th></tr></thead><tbody>${data.notifications.map(n=>`<tr><td>${+n.date.slice(-2)}日</td><td>${e(nameOf(n.member_id))}</td><td><span class="pill ${n.status==='accepted'?'':n.status==='pending'?'warn':'danger'}">${{accepted:'LINE受付済み',pending:'確認中',failed:'失敗',skipped:'要確認'}[n.status]}</span>${n.error?`<div class="hint">${e(n.error)}</div>`:''}</td><td>${e(formatTime(n.accepted_at))}</td></tr>`).join('')}</tbody></table>`:`<div class="empty-state">${icon('clock',30)}<h3>まだ配信履歴はありません</h3><p>当番表を共有すると、担当日の${reminderTime}から自動配信されます。</p></div>`}</section><p class="hint">「LINE受付済み」はLINEが送信要求を受け付けた状態です。到着や既読を確認する表示ではありません。</p></div><aside><section class="panel padded"><h3>今月のメッセージ通数</h3><p>${quota?`${quota.used} / ${quota.quota??'上限なし'} 通を使用中`:'共有前に残り通数を確認しましょう。'}</p>${quota?`<p class="hint">${quota.groupSize?`${quota.groupSize}人のグループへの共有は、1回につき${quota.groupSize}通を使います。`:'グループ共有は、1回につき送信先の人数分の通数を使います。'}</p>`:''}<button class="btn btn-soft btn-small" data-action="quota">通数を確認</button></section>${data.user.role==='owner'?`<section class="panel padded" style="margin-top:20px"><h3>鳩係の引き継ぎ</h3><p>次の鳩係をメンバーに登録してから、権限を追加します。</p>${approved.map(m=>{const a=data.admins.find(x=>x.id===m.id);return `<div class="permissions"><strong>${e(m.name)}</strong><select aria-label="${e(m.name)}の権限" data-role="${e(m.id)}" ${a?.is_self?'disabled':''}><option value="none" ${!a?'selected':''}>部員</option><option value="editor" ${a?.role==='editor'?'selected':''}>鳩係</option><option value="owner" ${a?.role==='owner'?'selected':''}>責任者</option></select></div>`;}).join('')||'<p class="hint">まだ登録メンバーがいません。</p>'}<p class="hint">責任者は、他の人への管理権限の追加・解除とバックアップの取得ができます。</p></section><section class="panel padded" style="margin-top:20px"><h3>データのバックアップ</h3><p>LINEのユーザーIDを含みます。責任者だけで大切に保管してください。</p><a class="btn btn-small" href="${demo?'#':'/api/export'}" ${demo?'data-action="demo-export"':''}>${icon('download',15)}データを書き出す</a></section>`:''}<p class="hint"><a href="/privacy">プライバシーについて</a></p></aside></div>`;
}
function render(){
 $('#app').innerHTML=shell(view==='calendar'?calendarPage():view==='members'?membersPage():settingsPage());
 bindCommon();
}
function openModal(content,wide=false){const d=$('#modal');d.className=wide?'modal-wide':'';d.innerHTML=content;d.showModal();d.querySelector('[data-close]')?.addEventListener('click',()=>d.close());d.querySelectorAll('[data-cancel]').forEach(b=>b.addEventListener('click',()=>d.close()));}
const modalHeader=(title,subtitle='')=>`<div class="modal-head"><div><h2 id="modal-title">${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div><button class="icon-btn" data-close aria-label="閉じる">${icon('close',15)}</button></div>`;
function modalError(error){let p=$('#modal .modal-error');if(!p){p=document.createElement('p');p.className='modal-error';$('#modal .modal-body').append(p);}p.textContent=error.message;}
async function saveDay(date,id){
 const draft={...data.schedule.draft};if(id)draft[date]=id;else delete draft[date];
 saving=true;$('#modal').querySelectorAll('button').forEach(b=>b.disabled=true);
 try{
  if(demo){data.schedule.draft=draft;data.schedule.version++;localStorage.setItem('qmc-demo-'+month,JSON.stringify(data.schedule));}
  else{const result=await request('/api/schedules/'+month,'PUT',{draft,version:data.schedule.version});data.schedule.draft=draft;data.schedule.version=result.version;}
  $('#modal').close();saving=false;render();toast('当番表を保存しました');
 }catch(err){saving=false;$('#modal').querySelectorAll('button').forEach(b=>b.disabled=false);modalError(err);}
}
function chooseDay(date){
 const current=data.schedule.draft[date],list=activeMembers();
 const japanNow=now(),dateToday=japanNow.toISOString().slice(0,10);
 const afterReminder=date<dateToday || (date===dateToday && reminderPhase({hour:japanNow.getUTCHours(),minute:japanNow.getUTCMinutes()})!=='before');
 openModal(modalHeader(`${+date.slice(5,7)}月${+date.slice(-2)}日（${weekdays[weekday(date)]}）の担当`,'担当者を選ぶと、自動で保存されます。')+`<div class="modal-body">${afterReminder?`<p class="hint">当日${reminderTime}以降の変更は、新しい担当者へ個別に連絡してください。すでに送った通知は取り消せません。</p>`:''}<div class="choices">${list.map(m=>`<button class="choice ${current===m.id?'selected':''}" data-choose="${e(m.id)}" ${!m.following?'disabled':''}><span class="avatar">${e(m.name.slice(0,1))}</span>${e(m.name)}${!m.following?'<small>通知できません</small>':''}${current===m.id?'<span class="choice-check">'+icon('check',15)+'</span>':''}</button>`).join('')}${!list.length?'<p class="hint">先にメンバー画面で部員を登録してください。</p>':''}<button class="choice ${current==='off'?'selected':''}" data-choose="off">${icon('leaf',20)}お休み（通知しない）</button><button class="choice" data-choose="">未設定に戻す</button></div></div>`);
 $('#modal').querySelectorAll('[data-choose]').forEach(b=>b.addEventListener('click',()=>saveDay(date,b.dataset.choose)));
}
function flexPreview(card){
 const colors=Object.entries(calendarColors).map(([key,value])=>`--flex-${key}:${value}`).join(';');
 const rows=card.weeks.map(week=>`<tr>${week.map(entry=>entry
  ? `<td><b>${entry.day}</b><span class="${entry.wrap?'flex-wrap':''} ${entry.off?'flex-off':''}" style="background:${entry.color};font-size:${entry.size}px">${e(entry.label)}</span></td>`
  : '<td class="flex-empty"></td>').join('')}</tr>`).join('');
 return `<article class="flex-preview" style="${colors}">
  <h3>${e(card.title)}</h3>
  <table aria-label="月間当番表">
   <colgroup><col span="7"></colgroup>
   <thead><tr>${weekdays.map(day=>`<th scope="col">${day}</th>`).join('')}</tr></thead>
   <tbody>${rows}</tbody>
  </table>
  <p>${e(card.footer)}</p>
 </article>`;
}
function preview(){
 const missing=unassigned();
 if(missing.length){openModal(modalHeader('未設定の日があります')+`<div class="modal-body"><div class="warning-list">${missing.map(d=>+d.slice(-2)+'日').join('、')}</div><p class="hint">お世話をしない日は「お休み」を選んでください。</p></div><div class="modal-foot"><button class="btn btn-primary" data-cancel>当番表に戻る</button></div>`);return;}
 const blocked=dates(month).filter(d=>data.schedule.draft[d]!=='off'&&!activeMembers().find(m=>m.id===data.schedule.draft[d]&&m.following));
 if(blocked.length){toast('通知できない担当者がいます。メンバーの状態を確認してください。');return;}
 const previewMonth=month,version=data.schedule.version,group=data.group;
 const revision=(data.publications[0]?.revision||0)+1,updated=revision>1;
 const card=calendarCard(previewMonth,freezeSchedule(previewMonth,data.schedule.draft,data.members),revision);
 const usage = demo ? '体験版のため、実際には送信されません。'
  : quota?.groupSize ? `1回の共有で約${quota.groupSize}通を使用します。`
  : 'グループ共有は、宛先の人数分のメッセージ通数を使います。';
 openModal(modalHeader('LINE共有のプレビュー', `共有先：${e(group?.name||'未連携')}`) + `
  <div class="modal-body">
   ${flexPreview(card)}
   <p class="hint">LINEでの文字サイズや表示幅は端末によって異なります。</p>
   <p class="hint">${usage}${updated?'<br>更新版を新しく送ります。過去の当番表は置き換わりません。':''}</p>
  </div>
  <div class="modal-foot">
   <button class="btn" data-cancel>戻る</button>
   <button class="btn btn-primary" id="confirm-publish" ${!group?.active?'disabled':''}>${icon('send',15)}この当番表をLINEに送る</button>
  </div>`);
 $('#confirm-publish').addEventListener('click',async()=>{
  const b=$('#confirm-publish');b.disabled=true;b.textContent='送信しています…';
  try{if(demo){$('#modal').close();toast('体験版のプレビューです。LINEには送信していません。');return;}
   const result=await request('/api/schedules/'+previewMonth+'/publish','POST',{
    version,groupId:group.id,previewHash:await sha256(JSON.stringify([revision,calendarFlexMessage(card)]))
   });
   $('#modal').close();await load();
   toast(result.status==='accepted'?'LINEへの送信を受け付けました':result.status==='pending'?'受付結果を確認しています':result.error||'LINEへ送信できませんでした');
  }catch(err){b.disabled=err.status===409;b.textContent='この当番表をLINEに送る';modalError(err);}
 });
}
function editMember(id){
 const m=data.members.find(m=>m.id===id);
 openModal(modalHeader(m.approved?'メンバーを編集':'部員を確認して登録',`LINEの表示名：${e(m.display_name)}`)+`<form id="member-form"><div class="modal-body"><label class="field">当番表に載せる名前<input id="member-name" maxlength="40" required value="${e(m.name)}" autocomplete="off"></label><label class="field"><span><input type="checkbox" id="member-approved" ${m.approved?'checked':''}> サークルの部員であることを確認した</span></label>${m.approved?`<label class="field"><span><input type="checkbox" id="member-archived" ${m.archived?'checked':''}> 今後の担当者の候補から外す</span></label><p class="hint">外した人の既存の担当日は、自動では変更されません。当番表を確認してください。</p>`:''}</div><div class="modal-foot"><button type="button" class="btn" data-cancel>戻る</button><button class="btn btn-primary" type="submit">${m.approved?'保存する':'メンバーに登録'}</button></div></form>`);
 $('#member-form').addEventListener('submit',async event=>{event.preventDefault();const b=event.submitter;b.disabled=true;const changes={name:$('#member-name').value.trim(),approved:$('#member-approved').checked,archived:$('#member-archived')?.checked||false};
  try{if(!changes.name)throw new Error('名前を入力してください');if(demo){Object.assign(m,changes);render();}else{await request('/api/members/'+id,'PATCH',changes);await load();}$('#modal').close();toast('メンバーを保存しました');}catch(err){b.disabled=false;modalError(err);}
 });
}
function groupModal(){
 openModal(modalHeader('共有するグループを連携')+`<form id="group-form">
   <div class="modal-body">
     <p>公式LINEを共有先のグループに招待し、ここでグループを選んでください。連携のためのメッセージ投稿は不要です。</p>
     <fieldset class="group-candidates"><legend>共有先の候補</legend><div id="group-options" class="choices"></div></fieldset>
   </div>
   <div class="modal-foot"><button class="btn" type="button" id="refresh-groups">一覧を更新</button><button class="btn btn-primary" type="submit" id="confirm-group" disabled>このグループに決定</button></div>
 </form>`);
 const modal=$('#modal'),form=$('#group-form'),options=$('#group-options');
 const refresh=$('#refresh-groups'),confirm=$('#confirm-group');
 let groups=[];
 const current=()=>modal.open&&form.isConnected;
 const selected=()=>groups[form.querySelector('input:checked')?.value];
 async function refreshGroups(){
   confirm.disabled=true;
   refresh.disabled=true;
   form.querySelector('.modal-error')?.remove();
   options.innerHTML='<p class="hint" role="status">グループを確認中…</p>';
   try {
     const result=demo?{groups:[{id:'sample',name:data.group.name,joinedAt:Date.now()}]}:await request('/api/group/candidates');
     if(!current()) return;
     groups=result.groups;
     options.innerHTML=groups.length?groups.map((group,index)=>`<label class="choice">
       <input type="radio" name="group" value="${index}"><span><strong>${e(group.name)}</strong><small class="hint">Bot参加 ${e(formatTime(group.joinedAt))}</small></span>
     </label>`).join(''):'<p class="hint">候補がありません。ログインしたLINEアカウントで参加しているグループにBotを招待し、一覧を更新してください。</p>';
   } catch(error) {
     if(current()){options.replaceChildren();modalError(error);}
   } finally {
     refresh.disabled=false;
   }
 }
 refresh.addEventListener('click',refreshGroups);
 options.addEventListener('change',()=>{confirm.disabled=!selected();});
 form.addEventListener('submit',async event=>{
   event.preventDefault();
   const group=selected();
   if(!group||confirm.disabled) return;
   confirm.disabled=true;
   refresh.disabled=true;
   options.querySelectorAll('input').forEach(input=>{input.disabled=true;});
   try {
     if(!demo) await request('/api/group/confirm','POST',{groupId:group.id,name:group.name});
     if(current()) modal.close();
     await load();
     toast(demo?'体験版で共有先を確認しました':'共有先グループを連携しました');
   } catch(error) {
     if(current()) {
       options.querySelectorAll('input').forEach(input=>{input.disabled=false;});
       confirm.disabled=false;
       refresh.disabled=false;
       modalError(error);
     }
   }
 });
 void refreshGroups();
}
function bindCommon(){
 document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{if(saving)return;view=b.dataset.view;render();window.scrollTo({top:0});}));
 document.querySelectorAll('[data-month]').forEach(b=>b.addEventListener('click',async()=>{if(saving)return;const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+Number(b.dataset.month));month=d.toISOString().slice(0,7);await load();}));
 document.querySelectorAll('[data-day]').forEach(b=>b.addEventListener('click',()=>chooseDay(b.dataset.day)));
 document.querySelectorAll('[data-member]').forEach(b=>b.addEventListener('click',()=>editMember(b.dataset.member)));
 document.querySelectorAll('[data-action]').forEach(b=>b.addEventListener('click',async event=>{
  const action=b.dataset.action;
  try{
   if(action==='preview')preview();
   if(action==='reload'){await load();toast('最新の状態に更新しました');}
   if(action==='this-month'){month=today().slice(0,7);await load();}
   if(action==='copy-friend'){await navigator.clipboard.writeText('https://line.me/R/ti/p/'+data.officialId);toast('友だち追加リンクをコピーしました');}
   if(action==='link-group')groupModal();
   if(action==='quota'){quota=demo?{used:31,quota:200,groupSize:30}:await request('/api/quota');render();}
   if(action==='logout'){await request('/api/logout','POST',{});location.href='/';}
   if(action==='demo-export'){event.preventDefault();toast('体験版ではデータの書き出しは行いません。');}
  }catch(err){toast(err.message);}
 }));
 document.querySelectorAll('[data-role]').forEach(select=>select.addEventListener('change',async()=>{
  const m=data.members.find(x=>x.id===select.dataset.role),role=select.value;
  openModal(modalHeader('管理権限を変更')+`<div class="modal-body"><p>${e(m.name)}さんを「${{none:'部員',editor:'鳩係',owner:'責任者'}[role]}」に変更します。</p><p class="hint">${role==='none'?'管理画面へのアクセスを解除します。':'当番表やメンバーを編集できます。'+(role==='owner'?'責任者は、他の人の権限変更とデータ書き出しもできます。':'')}</p></div><div class="modal-foot"><button class="btn" data-cancel>戻る</button><button class="btn btn-primary" id="apply-role">権限を変更する</button></div>`);
  $('#apply-role').addEventListener('click',async()=>{try{if(demo)toast('体験版では権限は変更されません');else{await request('/api/admins','POST',{memberId:m.id,role});await load();toast('管理権限を変更しました');}$('#modal').close();}catch(err){modalError(err);}});
 }));
}
$('#modal').addEventListener('click',event=>{if(event.target===$('#modal'))$('#modal').close();});
if(location.pathname==='/privacy')privacy();else load();
setInterval(async()=>{if(!demo&&data&&!saving&&!$('#modal').open&&isPending())try{data=await request('/api/state?month='+month);render();}catch{/* keep the last saved screen visible */}},15000);
