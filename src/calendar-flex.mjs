import {calendarWeeks,calendarWeekdays,lineCalendarTitle,reminderTime} from './domain.mjs';

export const calendarColors = {
  paper:'#FFFFFF', ink:'#000000', black:'#000000', shadow:'#C6C6C6',
  grid:'#848484', edge:'#000000', weekday:'#FFFFFF', sunday:'#000000',
  sundayPaper:'#F1F1F1', empty:'#F5F5F5', muted:'#4D4D4D', off:'#F5F5F5'
};
const memberColors = [
  '#C7DDFF','#F7C4D5','#D1EBB8','#FFDBAB','#DFCCF8','#BCEBE4',
  '#FFF09F','#F9BDB4','#CEE6FA','#E9CCDF','#DBDFC2','#F1D0BA'
];
const graphemes = new Intl.Segmenter('ja', {granularity:'grapheme'});
const nameWidth = 39;

export function memberColorsFor(assignedIds) {
  const colorByMember = new Map();
  for (const id of assignedIds) {
    if (id && id !== 'off' && !colorByMember.has(id)) {
      colorByMember.set(id, memberColors[colorByMember.size % memberColors.length]);
    }
  }
  return colorByMember;
}

export function calendarCard(month, snapshot, revision) {
  const datesByWeek = calendarWeeks(month);
  const colorByMember = memberColorsFor(datesByWeek.flat().map(date => snapshot[date]?.memberId));
  const weeks = datesByWeek.map(week => week.map(date => {
    if (!date) return null;
    const day = Number(date.slice(-2));
    const entry = snapshot[date];
    if (entry.off) return {day, label:'お休み', color:calendarColors.off, off:true, size:9, wrap:false};
    const length = Array.from(graphemes.segment(entry.name)).length;
    const wrap = length > 6;
    const size = wrap ? 9 : Math.min(11, Math.floor(nameWidth * 10 / Math.max(length, 1)) / 10);
    return {day, label:entry.name, color:colorByMember.get(entry.memberId), off:false, size, wrap};
  }));
  return {title:lineCalendarTitle(month, revision > 1), weeks, footer:`担当日の ${reminderTime} に個別リマインド`};
}

const box = (layout, contents, style = {}) => ({type:'box',layout,contents,...style});
const text = (value, size, color, style = {}) => ({type:'text',text:value,size:`${size}px`,color,...style});
const rule = (color, height) => box('vertical', [], {height:`${height}px`,backgroundColor:color});

export function calendarFlexMessage(card) {
  const c = calendarColors;
  // Keep horizontal padding inside each cell so it cannot affect the outer column widths.
  const column = (contents, backgroundColor) =>
    box('vertical', contents, {flex:1, paddingAll:'0px', backgroundColor});
  const row = cells => box('horizontal', cells, {width:'100%', paddingAll:'0px', spacing:'1px'});
  const weekdays = row(calendarWeekdays.map((day, index) =>
    column([box('vertical', [
      text(day, 11, c.black, {weight:'bold',align:'center'})
    ], {paddingTop:'4px', paddingBottom:'4px'})], index === 0 ? c.sundayPaper : c.weekday)
  ));
  const weeks = card.weeks.map(week => row(week.map(entry => {
    if (!entry) return column([], c.empty);
    const name = text(entry.label, entry.size, entry.off ? c.muted : c.ink, {
      align:'center', weight:entry.off?'regular':'bold',
      wrap:entry.wrap, ...(entry.wrap ? {} : {adjustMode:'shrink-to-fit'})
    });
    return column([box('vertical', [
      text(String(entry.day), 12, c.black, {weight:'bold',align:'center'}),
      box('vertical', [name], {
        backgroundColor:entry.color, paddingStart:'1px', paddingEnd:'1px',
        ...(entry.wrap
          ? {paddingTop:'3px', paddingBottom:'3px'}
          : {height:'20px', paddingTop:'0px', paddingBottom:'0px', justifyContent:'center'})
      })
    ], {paddingTop:'4px',paddingBottom:'4px',paddingStart:'1px',paddingEnd:'1px',spacing:'3px'})], c.paper);
  })));
  const grid = box('vertical', [weekdays,...weeks], {backgroundColor:c.grid,paddingAll:'1px',spacing:'1px'});
  return {
    type:'flex',
    altText:card.title,
    contents:{
      type:'bubble',size:'giga',
      body:box('vertical', [
        rule(c.black,4),
        rule(c.shadow,2),
        box('vertical',[text(card.title,18,c.black,{weight:'bold',wrap:true})],{paddingAll:'9px'}),
        grid,
        box('vertical',[text(card.footer,10,c.muted,{wrap:true})],{paddingAll:'8px',backgroundColor:c.off})
      ], {paddingAll:'0px',backgroundColor:c.paper})
    }
  };
}
