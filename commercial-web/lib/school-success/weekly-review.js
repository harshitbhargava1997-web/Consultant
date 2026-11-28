// The weekly review screen's view of one teacher's week (owner decision, 26 November 2026): their lessons planned
// Monday–Sunday, grouped by class and subject. Every period keeps the number it has on the teacher's own day
// (Period 1, 2, 3… in save order), and each group lists the weekly reviews already given for it.
import {weekRange} from './day-periods.js';
import {assignPeriodNumbers} from './period-number.js';
const sectionOf=s=>s&&s!=='Not Applicable'?s:'';
export const groupKey=l=>JSON.stringify([l.grade||'',sectionOf(l.section),l.subject||'']);
const numeric=id=>/^\d+$/.test(String(id))?Number(id):Number.MAX_SAFE_INTEGER;
// lessons: lesson records (buildLessonRecords, scope 'all'); reviewRows: the review rows read for them.
export function weekGroups(lessons,reviewRows,week){
 const {from,to}=weekRange(week);
 const inWeek=(lessons||[]).filter(l=>l.plannedDate>=from&&l.plannedDate<=to)
  .sort((a,b)=>a.plannedDate.localeCompare(b.plannedDate)||numeric(a.recordId)-numeric(b.recordId));
 // The chosen period number (1–8) when the plan has one; older plans keep save order (28 November 2026).
 const perDay=new Map();
 for(const l of inWeek){if(!perDay.has(l.plannedDate))perDay.set(l.plannedDate,[]);perDay.get(l.plannedDate).push(l);}
 const numbers=new Map([...perDay.values()].flatMap(list=>[...assignPeriodNumbers(list,l=>l.periodNumber||0)]));
 const numbered=inWeek.map(l=>({...l,dayNumber:numbers.get(l)})).sort((a,b)=>a.plannedDate.localeCompare(b.plannedDate)||a.dayNumber-b.dayNumber||numeric(a.recordId)-numeric(b.recordId));
 const groups=new Map();
 for(const l of numbered){const key=groupKey(l);if(!groups.has(key))groups.set(key,{key,grade:l.grade,section:sectionOf(l.section),subject:l.subject,lessons:[]});groups.get(key).lessons.push(l);}
 // A weekly review belongs to a group only through the periods it covers (never by class and subject alone, which
 // another teacher can share).
 const groupOfRecord=new Map(numbered.map(l=>[String(l.recordId),groupKey(l)])),weekly=new Map();
 for(const r of reviewRows||[]){
  const w=r.weekly,key=groupOfRecord.get(String(r.record_id));if(!w||w.weekStart!==from||!key)continue;
  if(!weekly.has(key))weekly.set(key,new Map());
  weekly.get(key).set(r.review_id,{id:r.review_id,root:r.root||r.review_id,recordId:String(r.record_id),date:r.updated_at,by:r.by||null,periods:w.periods,review:w.review,text:r.feedback,highlights:r.highlights||[],
   ...(r.edited?{editedBy:r.edited.by||null,givenAt:r.given_at||''}:{})});
 }
 return {from,to,groups:[...groups.values()].map(g=>({...g,periods:g.lessons.length,withEvidence:g.lessons.filter(l=>l.activities.length||l.writing.length||(l.remedial||[]).length||(l.portfolio||[]).length).length,
  reflections:g.lessons.filter(l=>l.reflections.length||(l.writtenReflections||[]).length).length,
  reviews:[...(weekly.get(g.key)||new Map()).values()].sort((a,b)=>String(b.date).localeCompare(String(a.date)))}))
  .sort((a,b)=>a.grade.localeCompare(b.grade,undefined,{numeric:true})||a.section.localeCompare(b.section)||a.subject.localeCompare(b.subject))};
}

// When a lesson's plan was submitted against the day it was planned for (owner decision, 28 November 2026):
// timing 'ahead' (before that day), 'same' (on it) or 'late' (after it, with the number of days); null when unknown.
const istDay=iso=>{const t=Date.parse(iso);return Number.isFinite(t)?new Date(t+330*60000).toISOString().slice(0,10):'';};
export function planningOf(l){
 const submitted=istDay(l.submittedAt),day=l.plannedDate;
 const gap=submitted&&day?Math.round((Date.parse(submitted+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000):null;
 return {recordId:l.recordId,day,period:l.dayNumber||0,topic:l.topic,submittedAt:l.submittedAt||'',timing:gap===null?null:gap<0?'ahead':gap===0?'same':'late',daysLate:gap>0?gap:0,
  reviewed:Boolean(l.feedback),weekly:Boolean(l.feedback?.weekly)||(l.reviews||[]).some(r=>r.weekly),periodType:l.periodType||'regular'};
}

// Week overview (owner decision, 26 November 2026): every teacher's class-and-subject weeks in one school, with the
// number of periods, how many have an Academic Review, and whether the weekly review is done.
export function weekOverview(lessons,reviewRows,week){
 const teachers=[...new Set((lessons||[]).map(l=>l.teacher))].sort((a,b)=>a.localeCompare(b));
 let from='',to='';
 const rows=teachers.map(teacher=>{const v=weekGroups(lessons.filter(l=>l.teacher===teacher),reviewRows,week);from=v.from;to=v.to;
  return {teacher,groups:v.groups.map(g=>({key:g.key,grade:g.grade,section:g.section,subject:g.subject,periods:g.periods,reviewedPeriods:g.lessons.filter(l=>l.feedback).length,weeklyReviewed:g.reviews.length>0,substitutes:g.lessons.filter(l=>l.periodType==='substitute').length,
   lessons:g.lessons.map(l=>planningOf(l))}))};}).filter(t=>t.groups.length);
 if(!from)({from,to}=weekRange(week));
 return {from,to,teachers:rows};
}
