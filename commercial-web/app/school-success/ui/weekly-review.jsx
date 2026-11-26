'use client';
// Weekly review (owner decision, 26 November 2026): one teacher, one class and subject, one week (Monday–Sunday).
// The reviewer sees the week day by day, period by period (plan, classroom evidence and reflections), can still
// review any single period, and gives one weekly review: Planning and Execution ratings plus a focus for next week.
// Used by School Success staff (Lesson reviews) and by principals and coordinators (their dashboard).
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,CalendarRange,CircleCheck,ClipboardCheck,RefreshCw} from 'lucide-react';
import {successFetch} from '@/lib/school-success/client';
import {formatDay} from '@/lib/school-success/lesson-records';
import {reviewCriteria,reviewLevels,weekLabel,reviewerLabel} from '@/lib/school-success/lesson-reviews';
import {weekRange} from '@/lib/school-success/day-periods';
import './lesson-records.css';

const istToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const classOf=g=>[[g.grade,g.section].filter(Boolean).join(' '),g.subject].filter(Boolean).join(' · ');
async function weeklyApi(body){
 const r=await successFetch('/api/school-success/weekly-reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Could not open the week.');return d;
}
function Files({title,files}){if(!files?.length)return null;return <div className="wr-files"><span>{title}</span>{files.map(f=><a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer">{f.label}<ArrowUpRight size={13}/></a>)}</div>;}

const weekday=day=>new Date(day+'T00:00:00Z').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
// compact: inside the principal's phone dashboard, which already shows the title.
export default function WeeklyReview({data,school:initialSchool='',onReviewLesson,onSaved,reloadKey=0,compact=false}){
 const roster=data?.roster||[],schools=[...new Set(roster.map(r=>r.school))].filter(Boolean).sort();
 const [school,setSchool]=useState(initialSchool&&schools.includes(initialSchool)?initialSchool:schools.length===1?schools[0]:'');
 const [teacher,setTeacher]=useState(''),[week,setWeek]=useState(()=>weekRange(addDays(istToday(),-7)).from);
 const [view,setView]=useState(null),[groupKey,setGroupKey]=useState(''),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [draft,setDraft]=useState({}),[focus,setFocus]=useState(''),[saving,setSaving]=useState(false),[notice,setNotice]=useState('');
 const requestId=useRef(null);
 const teachers=[...new Set(roster.filter(r=>r.school===school).map(r=>r.name))].sort((a,b)=>a.localeCompare(b));
 const range=weekRange(week),thisWeek=weekRange(istToday()).from,lastWeek=weekRange(addDays(istToday(),-7)).from;
 async function load(keep=false){
  if(!school||!teacher)return;
  setLoading(true);setError('');if(!keep)setNotice('');
  try{const d=await weeklyApi({action:'week',school,teacher,week:range.from});setView(d);setGroupKey(k=>d.groups.some(g=>g.key===k)?k:d.groups[0]?.key||'');}
  catch(e){setError(e.message);setView(null);}finally{setLoading(false);}
 }
 useEffect(()=>{setView(null);void load();},[school,teacher,range.from,reloadKey]);
 useEffect(()=>{setDraft({});setFocus('');requestId.current=null;},[groupKey,range.from,teacher]);
 const group=view?.groups.find(g=>g.key===groupKey);
 const days=group?[...new Set(group.lessons.map(l=>l.plannedDate))]:[];
 function edit(key,field,value){requestId.current=null;setDraft(old=>({...old,[key]:{...old[key],[field]:value}}));}
 const ready=Object.values(draft).some(v=>v.level)&&!Object.values(draft).some(v=>v.level&&!v.note?.trim())&&focus.trim();
 async function save(e){
  e.preventDefault();if(saving||!ready||!group)return;
  const review={...Object.fromEntries(Object.entries(draft).filter(([,v])=>v.level).map(([k,v])=>[k,{level:v.level,note:v.note.trim()}])),focus:focus.trim()};
  setSaving(true);setError('');
  try{
   requestId.current ||= crypto.randomUUID();
   const r=await weeklyApi({action:'save',school,teacher,week:range.from,grade:group.grade,section:group.section,subject:group.subject,requestId:requestId.current,review});
   const message='Weekly review saved for '+r.periods+(r.periods===1?' period':' periods')+'. '+teacher+' will see it in their Feedback tab.';
   setNotice(message);setDraft({});setFocus('');requestId.current=null;await load(true);onSaved?.(message);
  }catch(e){setError(e.message);}finally{setSaving(false);}
 }
 return <section className="card lesson-records weekly-review">
  {compact?<p className="hint">One teacher, one class and subject, one week. You can also review single periods below.</p>
  :<div className="card-head"><div><h2>Weekly review</h2><p>One teacher, one class and subject, one week. You can also review single periods below.</p></div><CalendarRange size={22}/></div>}
  <div className="form-grid wr-pick">
   {schools.length>1&&<label className="field"><span>School</span><select value={school} onChange={e=>{setSchool(e.target.value);setTeacher('');}}><option value="">Choose a school</option>{schools.map(s=><option key={s}>{s}</option>)}</select></label>}
   <label className="field"><span>Teacher</span><select value={teacher} disabled={!school} onChange={e=>setTeacher(e.target.value)}><option value="">Choose a teacher</option>{teachers.map(t=><option key={t}>{t}</option>)}</select></label>
   <label className="field"><span>Week of</span><input type="date" value={range.from} onChange={e=>e.target.value&&setWeek(weekRange(e.target.value).from)}/><small>{weekLabel(range.from,range.to)}</small></label>
  </div>
  <div className="ta-filters wr-weeks" role="group" aria-label="Week">{[[lastWeek,'Last week'],[thisWeek,'This week']].map(([w,l])=><button key={l} type="button" className={'ta-chip'+(range.from===w?' on':'')} aria-pressed={range.from===w} onClick={()=>setWeek(w)}>{l}</button>)}<button type="button" className="ta-chip" onClick={()=>setWeek(addDays(range.from,-7))}>← Earlier</button><button type="button" className="ta-chip" onClick={()=>setWeek(addDays(range.from,7))}>Later →</button></div>
  {error&&<p className="alert error" role="alert">{error}</p>}{notice&&<p className="alert success" role="status">{notice}</p>}
  {!school||!teacher?<p className="hint">Choose {schools.length>1&&!school?'a school and ':''}a teacher to see their week.</p>
  :loading&&!view?<p role="status">Opening the week…</p>
  :view&&!view.groups.length?<p className="hint">{teacher} has no lesson plans for {weekLabel(range.from,range.to)}.</p>
  :view&&<>
   <div className="wr-groups" role="tablist" aria-label="Class and subject">{view.groups.map(g=><button type="button" role="tab" key={g.key} aria-selected={g.key===groupKey} className={'wr-group'+(g.key===groupKey?' on':'')} onClick={()=>setGroupKey(g.key)}><b>{classOf(g)}</b><small>{g.periods} {g.periods===1?'period':'periods'}{g.reviews.length?' · ✓ weekly review':''}</small></button>)}</div>
   {group&&<>
    <div className="wr-stats"><div><strong>{group.periods}</strong><span>Periods planned</span></div><div><strong>{group.withEvidence}</strong><span>With classroom evidence</span></div><div><strong>{group.reflections}</strong><span>With after-class reflection</span></div><div><strong>{group.lessons.filter(l=>l.feedback).length}</strong><span>Periods with feedback</span></div></div>
    {days.map(day=><div className="wr-day" key={day}><h3>{weekday(day)}</h3>
     {group.lessons.filter(l=>l.plannedDate===day).map(l=><article className="wr-period" key={l.key}>
      <div className="wr-period-head"><span className="ta-pnum">Period {l.dayNumber}</span><b>{l.topic}</b>{l.feedback?<span className="pill green">{l.feedback.weekly?'Weekly review':'Feedback recorded'}</span>:<span className="pill amber">Awaiting review</span>}</div>
      <details><summary>Lesson plan</summary>{l.plan.fields.map(f=><div className="review-plan-field" key={f.key}><b>{f.label}</b><p>{f.text}</p></div>)}{l.plan.notes&&<p className="review-note">{l.plan.notes}</p>}{!l.plan.fields.length&&!l.plan.notes&&<p className="hint">No written plan.</p>}</details>
      <Files title="Classroom activities" files={l.activities}/><Files title="Student written work" files={l.writing}/><Files title="Remedial support" files={l.remedial}/><Files title="Student portfolio / assessment" files={l.portfolio}/>
      {(l.writtenReflections||[]).map(r=><div className="wr-reflection" key={r.url}><span>After-class reflection</span>{['achievement','nextStep'].filter(k=>r.answers?.[k]).map(k=><p key={k}>{r.answers[k]}</p>)}</div>)}
      <Files title="After-class reflection" files={l.reflections}/>
      {!l.activities.length&&!l.writing.length&&!(l.remedial||[]).length&&!(l.portfolio||[]).length&&!l.reflections.length&&!(l.writtenReflections||[]).length&&<p className="hint">No classroom evidence or reflection yet.</p>}
      {onReviewLesson&&<button type="button" className="text-button" onClick={()=>onReviewLesson(l.recordId)}><ClipboardCheck size={15}/>Review this period</button>}
     </article>)}
    </div>)}
    {group.reviews.length>0&&<section className="wr-earlier"><h3>Weekly reviews for this week</h3>{group.reviews.map(r=><div className="lr-review" key={r.id}><b>{formatDay(String(r.date).slice(0,10))}{r.by?' · '+reviewerLabel(r.by):''}</b><p>{r.text}</p></div>)}</section>}
    <form className="wr-form" onSubmit={save}><h3>{group.reviews.length?'Add another weekly review':'Weekly review'} · {classOf(group)} · {weekLabel(view.from,view.to)}</h3>
     <p className="hint">Rate planning, execution or both, with one or two sentences each, and add a focus for next week. It covers the {group.periods} {group.periods===1?'period':'periods'} above.</p>
     {Object.entries(reviewCriteria).map(([key,c])=><fieldset key={key} className="review-criterion" disabled={saving}><legend>{c.label}</legend><p>{c.question}</p>
      <label className="field"><span>{c.label} rating</span><select value={draft[key]?.level||''} onChange={e=>edit(key,'level',e.target.value)}><option value="">Not reviewed</option>{Object.entries(reviewLevels).map(([level,label])=><option key={level} value={level}>{level} · {label}</option>)}</select></label>
      {draft[key]?.level&&<><p className="hint">{c[draft[key].level]}</p><label className="field"><span>{c.label} feedback</span><textarea rows={2} maxLength={500} required value={draft[key].note||''} onChange={e=>edit(key,'note',e.target.value)}/></label></>}
     </fieldset>)}
     <label className="field"><span>Focus for next week</span><textarea rows={2} maxLength={500} required disabled={saving} value={focus} placeholder="One clear focus the teacher can work on next week." onChange={e=>{requestId.current=null;setFocus(e.target.value);}}/></label>
     <div className="modal-actions"><button type="button" className="button" disabled={loading} onClick={()=>void load(true)}><RefreshCw size={15}/>Refresh week</button><button className="button primary" disabled={saving||!ready}>{saving?'Saving…':<><CircleCheck size={16}/>Save weekly review</>}</button></div>
    </form>
   </>}
  </>}
 </section>;
}
