// The weekly review screen's view of one teacher's week (owner decision, 26 November 2026): their lessons planned
// Monday–Sunday, grouped by class and subject. Every period keeps the number it has on the teacher's own day
// (Period 1, 2, 3… in save order), and each group lists the weekly reviews already given for it.
import {weekRange} from './day-periods.js';
const sectionOf=s=>s&&s!=='Not Applicable'?s:'';
export const groupKey=l=>JSON.stringify([l.grade||'',sectionOf(l.section),l.subject||'']);
const numeric=id=>/^\d+$/.test(String(id))?Number(id):Number.MAX_SAFE_INTEGER;
// lessons: lesson records (buildLessonRecords, scope 'all'); reviewRows: the review rows read for them.
export function weekGroups(lessons,reviewRows,week){
 const {from,to}=weekRange(week);
 const inWeek=(lessons||[]).filter(l=>l.plannedDate>=from&&l.plannedDate<=to)
  .sort((a,b)=>a.plannedDate.localeCompare(b.plannedDate)||numeric(a.recordId)-numeric(b.recordId));
 const perDay=new Map();
 const numbered=inWeek.map(l=>{const n=(perDay.get(l.plannedDate)||0)+1;perDay.set(l.plannedDate,n);return {...l,dayNumber:n};});
 const groups=new Map();
 for(const l of numbered){const key=groupKey(l);if(!groups.has(key))groups.set(key,{key,grade:l.grade,section:sectionOf(l.section),subject:l.subject,lessons:[]});groups.get(key).lessons.push(l);}
 const weekly=new Map();
 for(const r of reviewRows||[]){
  const w=r.weekly;if(!w||w.weekStart!==from)continue;
  const key=JSON.stringify([w.grade||'',sectionOf(w.section),w.subject||'']);
  if(!weekly.has(key))weekly.set(key,new Map());
  weekly.get(key).set(r.review_id,{id:r.review_id,date:r.updated_at,by:r.by||null,periods:w.periods,review:w.review,text:r.feedback});
 }
 return {from,to,groups:[...groups.values()].map(g=>({...g,periods:g.lessons.length,withEvidence:g.lessons.filter(l=>l.activities.length||l.writing.length||(l.remedial||[]).length||(l.portfolio||[]).length).length,
  reflections:g.lessons.filter(l=>l.reflections.length||(l.writtenReflections||[]).length).length,
  reviews:[...(weekly.get(g.key)||new Map()).values()].sort((a,b)=>String(b.date).localeCompare(String(a.date)))}))
  .sort((a,b)=>a.grade.localeCompare(b.grade,undefined,{numeric:true})||a.section.localeCompare(b.section)||a.subject.localeCompare(b.subject))};
}
