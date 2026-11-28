// Principal and coordinator home (owner decision, 26 November 2026): one "This week" card per teacher instead of
// separate "New evidence to review", "No plan yet", "Lesson plans" and "Feedback given" lists. Each teacher shows
// their subjects (class and subject, per week) as reviewed or awaiting review; the Feedback tab lists every weekly
// and period review on its own, with the teacher's "Noted".
import {groupKey} from './weekly-review.js';
import {weekRange} from './day-periods.js';
import {istDay,formatDay} from './lesson-records.js';
import {weekLabel,weekClass} from './lesson-reviews.js';

const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const MAX_RANGE_DAYS=100;
// The dates a filter covers. "This week" runs Monday to today; "Last week" Monday to Saturday.
export function rangeFor(filter,today,custom={}){
 const monday=weekRange(today).from;
 if(filter==='week')return {from:monday,to:today};
 if(filter==='last'){const from=addDays(monday,-7);return {from,to:addDays(from,5)};}
 if(filter==='month')return {from:today.slice(0,8)+'01',to:today};
 let {from='',to=''}=custom;if(from&&to&&from>to)[from,to]=[to,from];return {from,to};
}
export const initials=name=>String(name||'').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
const sectionOf=s=>s&&s!=='Not Applicable'?s:'';
export const classLabel=g=>[[g.grade,sectionOf(g.section)].filter(Boolean).join(' '),g.subject].filter(Boolean).join(' · ');
export const subjectLabel=g=>[g.subject,[g.grade,sectionOf(g.section)].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
const dayOf=l=>l.plannedDate||l.firstDate||'';
const fileCount=l=>(l.activities?.length||0)+(l.writing?.length||0)+(l.remedial?.length||0)+(l.portfolio?.length||0);
const numeric=id=>/^\d+$/.test(String(id))?Number(id):Number.MAX_SAFE_INTEGER;
const byName=(a,b)=>a.localeCompare(b);

// Period 1, 2, 3… on a teacher's day, in save order (the same numbering as the review screens).
export function dayNumbers(lessons){
 const days=new Map();
 for(const l of lessons){const d=dayOf(l);if(!d)continue;const k=l.teacher+'|'+d;if(!days.has(k))days.set(k,[]);days.get(k).push(l);}
 const out=new Map();
 for(const list of days.values())list.sort((a,b)=>numeric(a.recordId)-numeric(b.recordId)).forEach((l,i)=>out.set(l.key,i+1));
 return out;
}

// lessons: lesson records for every loaded date; {from,to}: the chosen dates (by planned date).
export function leaderHome(lessons,roster,{from,to},{teacher='',subject=''}={}){
 const keep=l=>(!teacher||l.teacher===teacher)&&(!subject||l.subject===subject);
 // Substitute classes are not reviewed or counted here (period types, 28 November 2026).
 const inRange=(lessons||[]).filter(l=>{const d=dayOf(l);return d&&d>=from&&d<=to&&keep(l)&&l.periodType!=='substitute';});
 const names=[...new Set((roster||[]).map(r=>r.name).concat(inRange.map(l=>l.teacher)))].filter(n=>n&&(!teacher||n===teacher));
 const rows=names.map(name=>{
  const mine=inRange.filter(l=>l.teacher===name),groups=new Map();
  for(const l of mine){const week=weekRange(dayOf(l)).from,id=groupKey(l)+'|'+week;
   if(!groups.has(id))groups.set(id,{id,group:groupKey(l),week,grade:l.grade||'',section:sectionOf(l.section),subject:l.subject||'',lessons:[]});
   groups.get(id).lessons.push(l);}
  const subjects=[...groups.values()].map(g=>{const reviewed=g.lessons.filter(l=>l.feedback).length;
   return {id:g.id,group:g.group,week:g.week,grade:g.grade,section:g.section,subject:g.subject,periods:g.lessons.length,reviewed,
    weekly:g.lessons.some(l=>(l.reviews||[]).some(r=>r.weekly?.weekStart===g.week)),
    files:g.lessons.reduce((n,l)=>n+fileCount(l),0),done:reviewed===g.lessons.length,lastDate:g.lessons.map(dayOf).sort().at(-1)};})
   .sort((a,b)=>b.week.localeCompare(a.week)||a.grade.localeCompare(b.grade,undefined,{numeric:true})||a.section.localeCompare(b.section)||a.subject.localeCompare(b.subject));
  const lastPlan=(lessons||[]).filter(l=>l.teacher===name&&(!subject||l.subject===subject)).map(dayOf).filter(Boolean).sort().at(-1)||'';
  return {name,periods:mine.length,reviewed:subjects.reduce((n,s)=>n+s.reviewed,0),lastDate:mine.map(dayOf).sort().at(-1)||'',lastPlan,subjects};
 }).sort((a,b)=>(b.periods>0)-(a.periods>0)||byName(a.name,b.name));
 const all=rows.flatMap(r=>r.subjects.map(s=>({teacher:r.name,...s}))),awaiting=all.filter(s=>!s.done);
 return {
  teachers:rows,
  staff:rows.length,planned:rows.filter(r=>r.periods).length,
  files:inRange.reduce((n,l)=>n+fileCount(l),0),
  subjects:all.length,awaiting:awaiting.length,
  // "Review now" opens the oldest week first, then teachers by name.
  next:awaiting.sort((a,b)=>a.week.localeCompare(b.week)||byName(a.teacher,b.teacher))[0]||null,
  multiWeek:weekRange(from).from!==weekRange(to).from
 };
}

const stripHeading=text=>String(text||'').replace(/^Weekly review ·[^\n]*\n+/,'');
// Every review given in the chosen dates (by review date), newest first. A weekly review covers several periods and
// is listed once. type: 'all' | 'weekly' | 'period'; noted: 'all' | 'noted' | 'waiting'.
export function feedbackItems(lessons,{from,to},{teacher='',subject='',type='all',noted='all'}={}){
 const numbers=dayNumbers(lessons||[]),items=new Map();
 for(const l of lessons||[]){
  if((teacher&&l.teacher!==teacher)||(subject&&l.subject!==subject))continue;
  for(const r of l.reviews||[]){
   const day=istDay(r.date);if(!day||day<from||day>to)continue;
   if(r.weekly){
    const id='weekly|'+(r.key||r.date+l.teacher),seen=items.get(id);
    if(seen){if(r.notedAt>seen.notedAt)seen.notedAt=r.notedAt;continue;}
    items.set(id,{id,type:'weekly',teacher:l.teacher,subject:l.subject,title:'Weekly review',
     detail:weekClass(r.weekly)+' · '+weekLabel(r.weekly.weekStart,r.weekly.weekEnd)+' · '+r.weekly.periods+(r.weekly.periods===1?' period':' periods'),
     text:stripHeading(r.text),date:r.date,by:r.by,notedAt:r.notedAt,week:r.weekly.weekStart,group:groupKey(l),day:dayOf(l)});
   }else{
    const id='period|'+l.key+'|'+(r.key||r.date),n=numbers.get(l.key);
    items.set(id,{id,type:'period',teacher:l.teacher,subject:l.subject,title:(n?'Period '+n:'Period review')+(dayOf(l)?' · '+formatDay(dayOf(l)):''),
     detail:classLabel(l)+' · '+l.topic,text:r.text,date:r.date,by:r.by,notedAt:r.notedAt,week:weekRange(dayOf(l)||day).from,group:groupKey(l),day:dayOf(l)});
   }
  }
 }
 return [...items.values()].filter(i=>(type==='all'||i.type===type)&&(noted==='all'||(noted==='noted'?Boolean(i.notedAt):!i.notedAt)))
  .sort((a,b)=>String(b.date).localeCompare(String(a.date))||a.id.localeCompare(b.id));
}
