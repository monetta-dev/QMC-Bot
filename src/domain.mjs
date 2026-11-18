export const JST = 'Asia/Tokyo';
const reminderHour = 8, retryMinutes = 15;
export const reminderTime = `${String(reminderHour).padStart(2,'0')}:00`;
export function reminderStartsAt(date) {
  return Date.parse(`${date}T${reminderTime}:00+09:00`);
}
export function reminderPhase({hour,minute}) {
  if (hour < reminderHour) return 'before';
  if (hour === reminderHour && minute < retryMinutes) return 'sending';
  return 'ended';
}
export function jstParts(now = Date.now()) {
  const d = new Date(now + 9 * 3600000);
  return {date:d.toISOString().slice(0,10), month:d.toISOString().slice(0,7), hour:d.getUTCHours(), minute:d.getUTCMinutes()};
}
export function validMonth(month) { return /^20\d{2}-(0[1-9]|1[0-2])$/.test(month); }
export function datesInMonth(month) {
  if (!validMonth(month)) throw new Error('年月を確認してください');
  const [y,m] = month.split('-').map(Number);
  return Array.from({length:new Date(Date.UTC(y,m,0)).getUTCDate()},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);
}
export const calendarWeekdays = ['日', '月', '火', '水', '木', '金', '土'];

export function calendarWeeks(month) {
  const dates = datesInMonth(month);
  const offset = new Date(`${dates[0]}T00:00:00Z`).getUTCDay();
  return Array.from({length: Math.ceil((offset + dates.length) / 7)}, (_, week) =>
    calendarWeekdays.map((_, day) => dates[week * 7 + day - offset] ?? null));
}

export function lineCalendarTitle(month, updated = false) {
  return `${month.slice(0,4)}年${Number(month.slice(5))}月の鳩当番${updated ? '（更新版）' : ''}`;
}
export function normalizeDraft(month, input, members) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('当番表の形式を確認してください');
  const allowed = new Set(members.filter(m=>m.approved && !m.archived).map(m=>m.id));
  const dates = new Set(datesInMonth(month));
  const result = {};
  for (const [date,entry] of Object.entries(input)) {
    if (!dates.has(date)) throw new Error('月の範囲外の日付が含まれています');
    if (entry === null || entry === '') continue;
    if (entry !== 'off' && (typeof entry !== 'string' || !allowed.has(entry))) throw new Error('登録済みの担当者を選んでください');
    result[date] = entry;
  }
  return result;
}
export function publicationIssues(month,draft,members) {
  const byId = new Map(members.map(m=>[m.id,m]));
  const issues = [];
  for (const date of datesInMonth(month)) {
    const id = draft[date];
    if (!id) issues.push(`${Number(date.slice(-2))}日：担当者が未設定です`);
    else if(id !== 'off') {
      const m=byId.get(id);
      if(!m?.approved || m.archived || !m.following) issues.push(`${Number(date.slice(-2))}日：担当者に通知できません`);
    }
  }
  return issues;
}
export function freezeSchedule(month,draft,members) {
  const byId=new Map(members.map(m=>[m.id,m]));
  return Object.fromEntries(datesInMonth(month).map(date=>{
    const id=draft[date];
    if(id==='off') return [date,{off:true}];
    const m=byId.get(id);
    if(!m) throw new Error('担当者が見つかりません');
    return [date,{memberId:m.id,name:m.name,userId:m.line_user_id}];
  }));
}
export function sameAssignment(a,b) { return !!a && !!b && (a.off ? b.off===true : !b.off && a.memberId===b.memberId && a.userId===b.userId); }
export function canNotify(date,assignment,publication,now=Date.now()) {
  const t=jstParts(now);
  if(t.date!==date || reminderPhase(t)!=='sending' || !assignment || assignment.off) return false;
  return publication.status==='accepted' && publication.accepted_at<=reminderStartsAt(date);
}
