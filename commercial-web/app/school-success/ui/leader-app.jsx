'use client';
// School leader dashboard (principals, coordinators, school management), owner-approved 24 November 2026: one review
// screen instead of the staff workspace. Date, teacher and subject filters; who planned; new evidence to review;
// teachers with no plan yet; every lesson plan with its status; and the feedback already given, with the teacher's
// "Noted". Reads the same school-scoped data as before; reviews use the existing lesson review dialog.
import {useEffect,useMemo,useState} from 'react';
import {ClipboardCheck,Bell,CalendarDays,ChevronRight,CircleCheck,KeyRound,LogOut,X,MessageSquareText,ArrowLeft,RefreshCw,BookOpen} from 'lucide-react';
import {buildLessonRecords,formatDay} from '@/lib/school-success/lesson-records';
import {LessonReviewDialog} from './lesson-review';
import TeacherPinAdmin from './teacher-pin-admin';
import {browserClient} from '@/lib/supabase';

const istToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const weekStart=day=>addDays(day,-((new Date(day+'T00:00:00Z').getUTCDay()+6)%7));
export const MAX_RANGE_DAYS=100;
// The dates a filter covers. "This week" runs Monday to today; "Last week" Monday to Saturday.
export function rangeFor(filter,today,custom={}){
 if(filter==='week')return {from:weekStart(today),to:today};
 if(filter==='last'){const from=addDays(weekStart(today),-7);return {from,to:addDays(from,5)};}
 if(filter==='month')return {from:today.slice(0,8)+'01',to:today};
 let {from='',to=''}=custom;if(from&&to&&from>to)[from,to]=[to,from];return {from,to};
}
export const initials=name=>String(name||'').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
const fileCount=l=>(l.activities?.length||0)+(l.writing?.length||0)+(l.additional?.length||0);
// Everything the dashboard shows, for the chosen teacher and subject, from lessons already limited to the dates.
export function leaderView(lessons,roster,{teacher='',subject=''}={},allLessons=lessons){
 const keep=l=>(!teacher||l.teacher===teacher)&&(!subject||l.subject===subject);
 const list=lessons.filter(keep).sort((a,b)=>(b.plannedDate||b.firstDate||'').localeCompare(a.plannedDate||a.firstDate||'')||a.teacher.localeCompare(b.teacher));
 const staff=[...new Set(roster.map(r=>r.name))].filter(n=>!teacher||n===teacher).sort((a,b)=>a.localeCompare(b));
 const planned=new Set(list.map(l=>l.teacher));
 const lastPlan=name=>allLessons.filter(l=>l.teacher===name&&(!subject||l.subject===subject)).map(l=>l.plannedDate||l.firstDate).filter(Boolean).sort().at(-1)||'';
 return {
  lessons:list,
  teachers:staff.length,planned:staff.filter(n=>planned.has(n)).length,
  files:list.reduce((n,l)=>n+fileCount(l),0),
  reviewed:list.filter(l=>l.feedback).length,
  toReview:list.filter(l=>fileCount(l)>0&&!l.feedback&&!l.reviewOutsidePeriod),
  noPlan:staff.filter(n=>!planned.has(n)).map(name=>({name,lastPlan:lastPlan(name)})),
  feedback:list.filter(l=>l.feedback).sort((a,b)=>String(b.feedback.date).localeCompare(String(a.feedback.date)))
 };
}
function evidenceLine(l){
 const parts=[l.activities?.length?l.activities.length+(l.activities.length===1?' photo / video':' photos / videos'):'',l.writing?.length?l.writing.length+' written work':'',l.additional?.length?l.additional.length+' other':''].filter(Boolean);
 return parts.join(' · ');
}
const classOf=l=>[[l.grade,l.section&&l.section!=='Not Applicable'?l.section:''].filter(Boolean).join(' '),l.subject].filter(Boolean).join(' · ');
const tone=name=>['c1','c2','c3','c4'][[...String(name)].reduce((n,c)=>n+c.charCodeAt(0),0)%4];

export default function LeaderApp({data,refresh}){
 const today=istToday(),actor=data.actor,school=[...new Set((data.roster||[]).map(r=>r.school).concat((data.entries||[]).filter(e=>e.kind==='school').map(e=>e.school||e.name)))].filter(Boolean).sort()[0]||'';
 const [filter,setFilter]=useState('week'),[custom,setCustom]=useState({from:'',to:''}),[teacher,setTeacher]=useState(''),[subject,setSubject]=useState('');
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[reviewId,setReviewId]=useState(''),[notice,setNotice]=useState(''),[sheet,setSheet]=useState(false),[view,setView]=useState('home'),[showAll,setShowAll]=useState(false);
 const range=rangeFor(filter,today,custom),ready=Boolean(range.from&&range.to);
 const days=ready?Math.round((Date.parse(range.to)-Date.parse(range.from))/86400000)+1:0,tooLong=days>MAX_RANGE_DAYS;
 const loaded=data.period&&ready&&range.from>=data.period.from&&range.to<=data.period.to;
 // Load the chosen dates when they fall outside the period already loaded (at most 100 days).
 useEffect(()=>{if(!ready||tooLong||loaded)return;let live=true;setLoading(true);setError('');
  refresh({from:range.from,to:range.to}).catch(e=>{if(live)setError(e.message||'Could not load these dates.');}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};},[range.from,range.to]);
 const all=useMemo(()=>buildLessonRecords(data.entries||[],data.period?.from||'0001-01-01',data.period?.to||'9999-12-31'),[data.entries,data.period]);
 const inRange=useMemo(()=>ready&&loaded?buildLessonRecords(data.entries||[],range.from,range.to):[],[data.entries,range.from,range.to,loaded]);
 const subjects=[...new Set(all.map(l=>l.subject).filter(Boolean))].sort();
 const teachers=[...new Set((data.roster||[]).map(r=>r.name))].sort((a,b)=>a.localeCompare(b));
 const v=leaderView(inRange,data.roster||[],{teacher,subject},all);
 const label={week:'This week',last:'Last week',month:'This month',range:'Selected dates'}[filter];
 const span=ready?(formatDay(range.from)+(range.from===range.to?'':' – '+formatDay(filter==='week'?addDays(weekStart(today),5):range.to))):'Choose dates';
 const role=actor.title||'School leader';
 async function signOut(){try{await browserClient()?.auth.signOut();}catch{}location.href='/';}
 const top=<div className="ta-top"><div className="ta-brand"><i>S</i>School Success</div><button type="button" className="ta-avatar la-avatar" aria-label="Your profile" onClick={()=>setSheet(true)}>{initials(actor.name)}</button></div>;
 const sheetEl=sheet&&<><div className="ta-sheet-bg" onClick={()=>setSheet(false)}/><div className="ta-sheet" role="dialog" aria-modal="true" aria-label="Your profile"><div className="ta-grab"/><button type="button" className="ta-sheet-x icon" aria-label="Close" onClick={()=>setSheet(false)}><X size={18}/></button>
  <div className="ta-me"><span className="ta-avatar big la-avatar">{initials(actor.name)}</span><div><b>{actor.name}</b><small>{role} · {school}</small></div></div>
  <button type="button" className="ta-opt" onClick={()=>{setSheet(false);setView('pins');}}><span className="ta-opt-icon"><KeyRound size={18}/></span><span className="ta-opt-label">Teacher PINs</span><ChevronRight size={18}/></button>
  <button type="button" className="ta-opt danger" onClick={()=>void signOut()}><span className="ta-opt-icon"><LogOut size={18}/></span><span className="ta-opt-label">Sign out</span></button></div></>;
 if(view==='pins')return <div className="teacher-workspace tp ta-app leader-app">{top}<div className="ta-title"><button type="button" className="ta-back" aria-label="Back" onClick={()=>setView('home')}><ArrowLeft size={18}/></button><h2>Teacher PINs</h2></div><TeacherPinAdmin schools={school?[school]:[]} initialSchool={school} open/>{sheetEl}</div>;
 const shownLessons=showAll?v.lessons:v.lessons.slice(0,8);
 return <div className="teacher-workspace tp ta-app leader-app">
  {top}
  <div className="ta-hello"><small>{role} · {school}</small><h1>{label}</h1><p>{span}</p></div>
  <section className="la-filters" aria-label="Filters">
   <div className="ta-filters" role="group" aria-label="Dates">{[['week','This week'],['last','Last week'],['month','This month'],['range','Dates']].map(([k,l])=><button type="button" key={k} aria-pressed={filter===k} className={'ta-chip'+(filter===k?' on':'')} onClick={()=>{setFilter(k);setShowAll(false);}}>{k==='range'&&<CalendarDays size={13}/>}{l}</button>)}</div>
   {filter==='range'&&<div className="ta-range"><label><span>From</span><input type="date" max={today} value={custom.from} onChange={e=>setCustom(c=>({...c,from:e.target.value}))}/></label><label><span>To</span><input type="date" max={today} value={custom.to} onChange={e=>setCustom(c=>({...c,to:e.target.value}))}/></label></div>}
   <div className="la-selects"><label className="field"><span>Teacher</span><select value={teacher} onChange={e=>setTeacher(e.target.value)}><option value="">All teachers</option>{teachers.map(n=><option key={n}>{n}</option>)}</select></label>
    <label className="field"><span>Subject</span><select value={subject} onChange={e=>setSubject(e.target.value)}><option value="">All subjects</option>{subjects.map(s=><option key={s}>{s}</option>)}</select></label></div>
  </section>
  {notice&&<div className="alert success" role="status">{notice}</div>}
  {error&&<div className="alert error" role="alert">{error} <button type="button" className="text-button" onClick={()=>{setError('');setLoading(true);refresh({from:range.from,to:range.to}).catch(e=>setError(e.message)).finally(()=>setLoading(false));}}><RefreshCw size={14}/>Try again</button></div>}
  {tooLong?<div className="ta-card ta-empty"><p>Choose at most {MAX_RANGE_DAYS} days.</p></div>
  :!ready?<div className="ta-card ta-empty"><p>Choose a start and end date.</p></div>
  :loading||!loaded?<div className="ts-skeleton" aria-busy="true"><span/><span/></div>
  :<>
   <div className="la-stats">
    <div className="ta-stat"><b>{v.planned}<small> / {v.teachers}</small></b><span>Teachers planned</span><span className="la-bar"><i style={{width:(v.teachers?v.planned/v.teachers*100:0)+'%'}}/></span></div>
    <div className="ta-stat"><b>{v.files}</b><span>Evidence files shared</span><span className="la-bar blue"><i style={{width:Math.min(100,v.files/Math.max(1,v.lessons.length*3)*100)+'%'}}/></span></div>
    <div className="ta-stat"><b>{v.reviewed}<small> / {v.lessons.length}</small></b><span>Lessons reviewed</span><span className="la-bar violet"><i style={{width:(v.lessons.length?v.reviewed/v.lessons.length*100:0)+'%'}}/></span></div>
   </div>
   <section className="ta-card"><div className="ta-card-head"><h3><ClipboardCheck size={17}/> New evidence to review</h3>{v.toReview.length>0&&<span className="la-count">{v.toReview.length}</span>}</div>
    <p className="ta-sub">Open a lesson to see the plan and evidence, and record your feedback.</p>
    {!v.toReview.length?<p className="ta-empty">Nothing waiting for review.</p>:<ul className="la-list">{v.toReview.map(l=><li key={l.key}><span className={'la-face '+tone(l.teacher)}>{initials(l.teacher)}</span><span className="la-text"><b>{l.teacher}</b><small>{evidenceLine(l)} · {classOf(l)}</small><small>{l.topic} · {formatDay(l.plannedDate||l.firstDate)}</small></span><button type="button" className="button primary la-btn" onClick={()=>setReviewId(l.recordId)}>Review</button></li>)}</ul>}
   </section>
   <section className="ta-card"><div className="ta-card-head"><h3><Bell size={17}/> No plan yet</h3></div>
    <p className="ta-sub">Teachers without a lesson plan {filter==='week'?'this week':filter==='last'?'last week':'in these dates'}{subject?' for '+subject:''}. A gentle reminder may help.</p>
    {!v.noPlan.length?<p className="ta-empty">Every teacher has planned.</p>:<ul className="la-list">{v.noPlan.map(t=><li key={t.name}><span className={'la-face '+tone(t.name)}>{initials(t.name)}</span><span className="la-text"><b>{t.name}</b><small>{t.lastPlan?'Last plan: '+formatDay(t.lastPlan):'No plan in the loaded dates'}</small></span></li>)}</ul>}
   </section>
   <section className="ta-card"><div className="ta-card-head"><h3><BookOpen size={17}/> Lesson plans</h3><span className="la-count soft">{v.lessons.length}</span></div>
    <p className="ta-sub">Every lesson in these dates, with its review status.</p>
    {!v.lessons.length?<p className="ta-empty">No lesson plans in these dates.</p>:<ul className="la-list">{shownLessons.map(l=>{const files=fileCount(l);return <li key={l.key}><span className="la-date"><b>{(l.plannedDate||l.firstDate||'').slice(8,10)}</b><small>{formatDay(l.plannedDate||l.firstDate).split(' ')[1]||''}</small></span><span className="la-text"><b>{l.teacher}</b><small>{classOf(l)} · {l.topic}</small><span className="la-pills"><em className="ok">Plan</em>{files?<em className="ok">{files} evidence</em>:<em>No evidence yet</em>}{l.feedback?<em className="ok">Reviewed</em>:<em className="wait">Awaiting review</em>}{l.feedbackNoted&&<em className="ok">Teacher noted</em>}</span></span><button type="button" className="button la-btn" onClick={()=>setReviewId(l.recordId)}>{l.feedback?'Open':'Review'}</button></li>;})}</ul>}
    {v.lessons.length>8&&!showAll&&<button type="button" className="text-button" onClick={()=>setShowAll(true)}>Show all {v.lessons.length}<ChevronRight size={14}/></button>}
   </section>
   <section className="ta-card"><div className="ta-card-head"><h3><MessageSquareText size={17}/> Feedback given</h3></div>
    <p className="ta-sub">Planning and execution reviews and remarks, and whether the teacher has noted them.</p>
    {!v.feedback.length?<p className="ta-empty">No feedback recorded in these dates.</p>:<ul className="la-feed">{v.feedback.map(l=><li key={l.key}><div className="la-feed-head"><b>{l.teacher}</b><small>{formatDay(String(l.feedback.date).slice(0,10))}</small></div><small className="la-feed-class">{classOf(l)} · {l.topic}</small><p>{l.feedback.text}</p><div className="la-feed-foot">{l.feedbackNoted?<span className="la-noted"><CircleCheck size={13}/>Teacher noted {formatDay(String(l.feedbackNoted.notedAt).slice(0,10))}</span>:<span className="la-noted wait">Not noted yet</span>}<button type="button" className="text-button" onClick={()=>setReviewId(l.recordId)}>Open lesson<ChevronRight size={14}/></button></div></li>)}</ul>}
   </section>
  </>}
  {reviewId&&<LessonReviewDialog key={reviewId} recordId={reviewId} onClose={()=>setReviewId('')} onSaved={async()=>{setReviewId('');setNotice('Feedback saved. The teacher will see it in their Feedback tab.');try{await refresh({from:data.period.from,to:data.period.to});}catch{setError('Feedback was saved. Refresh to see it here.');}}}/>}
  {sheetEl}
 </div>;
}
