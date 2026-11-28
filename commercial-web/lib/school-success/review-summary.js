// "Academic reviews" in the Teacher 360° and School 360° PDFs (owner decision, 26 November 2026). A lesson (one
// class period) in the report dates counts as reviewed when it has an Academic Review — a single-period review or
// a weekly review that covers it — whenever the review was given. Weekly reviews are listed once each, with their
// ratings and focus for next week.
import {reviewLevels,weekLabel,weekClass,reviewerLabel} from './lesson-reviews.js';
import {isSubstitute} from './period-types.js';
const recordOf=r=>String(r.recordId||String(r.id||'').split(':')[0]);
// rows: report entries (kind 'submission') already limited to the school, teacher(s) and dates of the report.
export function reviewSummary(rows){
 const lessons=new Map(),weekly=new Map();
 for(const r of rows||[]){
  // A substitute class is not reviewed and not counted (period types, 28 November 2026).
  if(r.kind!=='submission'||!r.stage||isSubstitute(r.reflection))continue;
  const id=recordOf(r),history=r.reviewHistory||[];
  const l=lessons.get(id)||{teacher:r.teacher,school:r.school,reviewed:false,weekly:false,single:false};
  for(const h of history){
   l.reviewed=true;
   if(h.weekly){l.weekly=true;
    if(!weekly.has(h.key))weekly.set(h.key,{key:h.key,teacher:r.teacher,school:r.school,week:weekLabel(h.weekly.weekStart,h.weekly.weekEnd),weekStart:h.weekly.weekStart,cls:weekClass(h.weekly),periods:h.weekly.periods,by:reviewerLabel(h.by),date:h.date,
     planning:h.weekly.review?.planning?h.weekly.review.planning.level+' · '+reviewLevels[h.weekly.review.planning.level]:'—',execution:h.weekly.review?.execution?h.weekly.review.execution.level+' · '+reviewLevels[h.weekly.review.execution.level]:'—',focus:h.weekly.review?.focus||''});}
   else l.single=true;
  }
  lessons.set(id,l);
 }
 const all=[...lessons.values()],reviewed=all.filter(l=>l.reviewed).length;
 return {lessons:all.length,reviewed,awaiting:all.length-reviewed,single:all.filter(l=>l.single).length,weeklyCovered:all.filter(l=>l.weekly).length,
  weekly:[...weekly.values()].sort((a,b)=>a.weekStart.localeCompare(b.weekStart)||a.cls.localeCompare(b.cls))};
}
// One row per teacher (School 360° PDF).
export function reviewSummaryByTeacher(rows,teachers=[]){
 const names=[...new Set([...teachers,...(rows||[]).filter(r=>r.kind==='submission'&&r.stage).map(r=>r.teacher)])].filter(Boolean).sort((a,b)=>a.localeCompare(b));
 return names.map(name=>({teacher:name,...reviewSummary((rows||[]).filter(r=>r.teacher===name))}));
}
