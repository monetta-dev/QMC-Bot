import {test} from 'node:test';
import assert from 'node:assert/strict';
import {datesInMonth,normalizeDraft,publicationIssues,freezeSchedule,jstParts,canNotify} from '../src/domain.mjs';
import {calendarCard,calendarFlexMessage} from '../src/calendar-flex.mjs';
import {verifySignature} from '../src/line.mjs';
import {createHmac} from 'node:crypto';
const members=[{id:'one',line_user_id:'Uone',name:'佐々木小次郎',approved:1,following:1,archived:0}];
test('month boundaries, leap day and Japan midnight are handled',()=>{
 assert.equal(datesInMonth('2028-02').length,29);
 assert.equal(datesInMonth('2026-11').length,30);
 assert.throws(()=>datesInMonth('2026-13'));
 assert.equal(jstParts(Date.parse('2026-11-30T15:00:00Z')).date,'2026-12-01');
});
test('only approved members and deliberate days off can be saved',()=>{
 assert.throws(()=>normalizeDraft('2026-11',{'2026-12-01':'one'},members));
 assert.throws(()=>normalizeDraft('2026-11',{'2026-11-01':'unknown'},members));
 assert.deepEqual(normalizeDraft('2026-11',{'2026-11-01':'off','2026-11-02':null},members),{'2026-11-01':'off'});
 assert.equal(publicationIssues('2026-11',{},members).length,30);
 assert.equal(publicationIssues('2026-11',Object.fromEntries(datesInMonth('2026-11').map(d=>[d,'off'])),members).length,0);
});
test('LINE shares one seven-column month with aligned weekdays, complete names, and no IDs',()=>{
 const month='2026-08'; // Saturday start, six rows, and an incomplete final week.
 const dates=datesInMonth(month);
 const roster=[...members,{...members[0],id:'two',name:'七文字以上の名前'}];
 const draft=Object.fromEntries(dates.map((date,i)=>[date,i===8?'off':i===2?'two':'one']));
 const calendar=calendarCard(month,freezeSchedule(month,draft,roster),2);
 assert.match(calendar.title,/2026年8月.*更新版/);
 const {weeks}=calendar;
 assert.equal(weeks.length,6);
 assert.ok(weeks.every(week=>week.length===7));
 const cells=weeks.flat();
 assert.equal(cells.findIndex(Boolean),6);
 assert.equal(cells.findLastIndex(Boolean),36);
 assert.deepEqual(cells.filter(Boolean).map(cell=>cell.day),dates.map(date=>Number(date.slice(-2))));
 assert.equal(cells[6].label,members[0].name);
 assert.equal(cells[6].wrap,false);
 assert.equal(cells[6].color,cells[7].color);
 assert.notEqual(cells[6].color,cells[8].color);
 assert.equal(cells[8].wrap,true);
 assert.equal(cells[14].label,'お休み');
 const message=calendarFlexMessage(calendar);
 assert.equal(message.contents.size,'giga');
 assert.ok(!JSON.stringify(message).includes('Uone'));
 assert.ok(new TextEncoder().encode(JSON.stringify(message.contents)).length<30_000);
});
test('reminders are scheduled for 08:00 Japan time and never use late publications',()=>{
 const start=Date.parse('2026-11-08T23:00:00Z'),a={memberId:'one'},p={status:'accepted',accepted_at:start-1};
 assert.equal(canNotify('2026-11-09',a,p,start),true);
 assert.equal(canNotify('2026-11-09',a,p,start-1),false);
 assert.equal(canNotify('2026-11-09',a,p,start+14*60000),true);
 assert.equal(canNotify('2026-11-09',a,p,start+15*60000),false);
 assert.equal(canNotify('2026-11-09',a,{...p,accepted_at:start+1},start+60000),false);
});
test('webhooks require the exact HMAC of unmodified bytes',async()=>{
 const raw='{"events":[]}',sig=createHmac('sha256','test-secret').update(raw).digest('base64');
 assert.equal(await verifySignature(raw,sig,'test-secret'),true);
 assert.equal(await verifySignature(raw+' ',sig,'test-secret'),false);
 assert.equal(await verifySignature(raw,'x','test-secret'),false);
});
