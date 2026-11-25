// Filters for the teacher's Feedback tab (owner request, 25 November 2026): when the feedback was given (This week,
// This month or a chosen range), the lesson's class and subject, who gave it (for example "Meera Rao, Principal"),
// and whether the teacher has already marked it "Noted". Feedback items come from the teacher summary:
// {date, plannedOn, grade, section, subject, topic, by, text, notedAt}.
import {chipRange,classOf} from './day-periods.js';
const sorted=a=>[...new Set(a.filter(Boolean))].sort((x,y)=>x.localeCompare(y,undefined,{numeric:true}));
export const feedbackDay=f=>String(f?.date||'').slice(0,10);
export function feedbackFilterOptions(items){
 const list=items||[];
 return {classes:sorted(list.map(classOf)),subjects:sorted(list.map(f=>f.subject)),reviewers:sorted(list.map(f=>f.by))};
}
// when: 'all' | 'week' | 'month' | 'range'; status: 'all' | 'new' (not yet noted) | 'noted'.
export function filterFeedback(items,{when='all',today,range={},cls='',subject='',by='',status='all'}={}){
 const span=when==='all'||!today?null:chipRange(when,today,range);
 return (items||[]).filter(f=>{
  const day=feedbackDay(f);
  if(span){const [a,b]=span.from<=span.to?[span.from,span.to]:[span.to,span.from];if(day<a||day>b)return false;}
  if(cls&&classOf(f)!==cls)return false;
  if(subject&&f.subject!==subject)return false;
  if(by&&f.by!==by)return false;
  if(status==='new'&&f.notedAt)return false;
  if(status==='noted'&&!f.notedAt)return false;
  return true;
 });
}
