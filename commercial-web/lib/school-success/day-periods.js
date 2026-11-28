// A teacher's saved lesson plans, day by day (owner request, 25 November 2026). A day can be planned in several
// saves (Periods 1–3 in the morning, Period 4 later). Each save is one lesson submission; here every class period
// of the day gets one number in the order it was saved: Period 1, 2, 3, 4. The numbers are the same on Home, on
// the Plan screen (saved periods with a green tick, new periods continue from the next number) and on Add evidence.
// Input: the teacher summary's lessons ({id, plannedOn, order, resumeToken, evidence, periods:[{grade, section,
// subject, topic, evidence}]}); `order` is the first saved record of the lesson (server), else the list order.
import {assignPeriodNumbers} from './period-number.js';
const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function weekRange(today){const d=new Date(today+'T00:00:00Z').getUTCDay(),from=addDays(today,-((d+6)%7));return {from,to:addDays(from,6)};}
export function monthRange(today){const [y,m]=today.split('-').map(Number);return {from:today.slice(0,8)+'01',to:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};}
export const classOf=p=>[p?.grade||'',p?.section&&p.section!=='Not Applicable'?p.section:''].filter(Boolean).join(' ');

// [{date, periods:[{number, key, lesson, index, period}]}], days in date order (oldest first).
export function planDays(lessons){
 const byDay=new Map();
 (lessons||[]).forEach((lesson,position)=>{if(!lesson?.plannedOn)return;if(!byDay.has(lesson.plannedOn))byDay.set(lesson.plannedOn,[]);byDay.get(lesson.plannedOn).push({lesson,position});});
 return [...byDay.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,items])=>{
  items.sort((a,b)=>(Number.isFinite(a.lesson.order)&&Number.isFinite(b.lesson.order)?a.lesson.order-b.lesson.order:0)||a.position-b.position);
  // A period's chosen number (period.number, 1–8) when it has one; older plans keep save order (28 November 2026).
  const list=items.flatMap(({lesson})=>(lesson.periods||[]).map((period,index)=>({key:lesson.id+':'+index,lesson,index,period})));
  const numbers=assignPeriodNumbers(list,x=>x.period.number||0);
  return {date,periods:list.map((x,i)=>({...x,number:numbers.get(x),order:i})).sort((a,b)=>a.number-b.number||a.order-b.order).map(({order,...x})=>x)};
 });
}
export const periodsOn=(lessons,date)=>planDays(lessons).find(d=>d.date===date)?.periods||[];

// Class and subject choices: only what the teacher has planned.
export function planFilterOptions(lessons){
 const all=(lessons||[]).flatMap(l=>l.periods||[]),sort=a=>[...new Set(a.filter(Boolean))].sort((x,y)=>x.localeCompare(y,undefined,{numeric:true}));
 return {classes:sort(all.map(classOf)),subjects:sort(all.map(p=>p.subject))};
}
// Days in [from, to] (newest first) with only the periods that match the class and subject. Period numbers stay
// those of the whole day, so a filtered list still says "Period 4".
export function filterPlanDays(lessons,{from='0000-01-01',to='9999-12-31',cls='',subject=''}={}){
 if(from>to)[from,to]=[to,from];
 return planDays(lessons).filter(d=>d.date>=from&&d.date<=to)
  .map(d=>({...d,periods:d.periods.filter(x=>(!cls||classOf(x.period)===cls)&&(!subject||x.period.subject===subject))}))
  .filter(d=>d.periods.length).reverse();
}
// Ranges for the date chips: Tomorrow, This week (Monday–Sunday, upcoming days included), This month (whole
// month), or a chosen range. Today has its own box on Home ("today" is still accepted here).
export function chipRange(filter,today,range={}){
 if(filter==='today')return {from:today,to:today};
 if(filter==='tomorrow'){const d=addDays(today,1);return {from:d,to:d};}
 if(filter==='week')return weekRange(today);
 if(filter==='month')return monthRange(today);
 return {from:range.from||'0000-01-01',to:range.to||'9999-12-31'};
}
