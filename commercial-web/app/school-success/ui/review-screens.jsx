'use client';
// Lesson review screens (owner decision, 26 November 2026), for School Success staff and for principals and
// coordinators of their own school:
//   Day-wise       — a date and a teacher: that day's periods in order, each reviewed on the spot;
//   Weekly         — teacher → subject (with class) → week: one weekly review (Planning, Execution, focus);
//   Week overview  — every teacher's class-and-subject weeks in the school, reviewed or awaiting review.
// The three share one selection, so the overview opens a teacher's day or a subject's week directly.
import {Fragment,useEffect,useRef,useState} from 'react';
import {ArrowUpRight,CircleCheck,ClipboardCheck,RefreshCw,ChevronLeft,ChevronRight,Pencil,Highlighter} from 'lucide-react';
import {successFetch} from '@/lib/school-success/client';
import {formatDay,formatStamp} from '@/lib/school-success/lesson-records';
import {reviewCriteria,reviewLevels,weekLabel,reviewerLabel,mayEditReview} from '@/lib/school-success/lesson-reviews';
import {sentences,markKey,toggleMark,lessonMarks} from '@/lib/school-success/highlights';
import {weekRange} from '@/lib/school-success/day-periods';
import './lesson-records.css';

const istToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const weekday=day=>new Date(day+'T00:00:00Z').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
const longDay=day=>new Date(day+'T00:00:00Z').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const classOf=g=>[[g.grade,g.section].filter(Boolean).join(' '),g.subject].filter(Boolean).join(' · ');
const subjectOf=g=>g.subject+' · '+[g.grade,g.section].filter(Boolean).join(' ');
async function post(url,body){
 const r=await successFetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d.error||'Could not load. Please try again.');return d;
}
const weeklyApi=body=>post('/api/school-success/weekly-reviews',body);
const lessonApi=body=>post('/api/school-success/lesson-reviews',body);
const hasEvidence=l=>l.activities.length||l.writing.length||(l.remedial||[]).length||(l.portfolio||[]).length;
const hasReflection=l=>l.reflections.length||(l.writtenReflections||[]).length;
function Files({title,files}){if(!files?.length)return null;return <div className="wr-files"><span>{title}</span>{files.map(f=><a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer">{f.label}<ArrowUpRight size={13}/></a>)}</div>;}
function Ratings({draft,edit,disabled}){
 return Object.entries(reviewCriteria).map(([key,c])=><fieldset key={key} className="review-criterion" disabled={disabled}><legend>{c.label}</legend><p>{c.question}</p>
  <label className="field"><span>{c.label} rating</span><select value={draft[key]?.level||''} onChange={e=>edit(key,'level',e.target.value)}><option value="">Not reviewed</option>{Object.entries(reviewLevels).map(([level,label])=><option key={level} value={level}>{level} · {label}</option>)}</select></label>
  {draft[key]?.level&&<><p className="hint">{c[draft[key].level]}</p><label className="field"><span>{c.label} feedback</span><textarea rows={2} maxLength={500} required value={draft[key].note||''} onChange={e=>edit(key,'note',e.target.value)}/></label></>}
 </fieldset>);
}
const ratingsReady=d=>Object.values(d).some(v=>v.level)&&!Object.values(d).some(v=>v.level&&!v.note?.trim());
const ratingsOf=d=>Object.fromEntries(Object.entries(d).filter(([,v])=>v.level).map(([k,v])=>[k,{level:v.level,note:v.note.trim()}]));
function useDraft(){const [draft,setDraft]=useState({}),[marks,setMarks]=useState([]),requestId=useRef(null);
 return {draft,marks,requestId,reset(){setDraft({});setMarks([]);requestId.current=null;},edit(key,field,value){requestId.current=null;setDraft(o=>({...o,[key]:{...o[key],[field]:value}}));},
  mark(m){requestId.current=null;setMarks(list=>toggleMark(list,m));},
  // Start from a saved review (editing): its ratings, remarks and highlights.
  load(review,highlights){requestId.current=null;setDraft(Object.fromEntries(Object.keys(reviewCriteria).filter(k=>review?.[k]).map(k=>[k,{level:review[k].level,note:review[k].note}])));setMarks(highlights||[]);}};}
const withMarks=(review,marks)=>marks.length?{...review,highlights:marks}:review;
// Sentences of a plan field or reflection answer. When onMark is given, each sentence can be tapped to mark it
// yellow (and tapped again to remove it); otherwise saved highlights are shown.
function MarkText({record,field,text,marks,onMark,saved}){
 const list=sentences(text);
 return <p className="hl-text">{list.map((t,i)=>{const k=markKey({record,field,text:t}),on=marks.has(k),old=!on&&saved?.has(k);
  return <span key={i}>{onMark?<button type="button" className={'hl-line'+(on?' on':old?' saved':'')} aria-pressed={on} onClick={()=>onMark({record,field,text:t})}>{t}</button>:on?<mark className="hl-mark">{t}</mark>:t}{i<list.length-1?' ':''}</span>;})}</p>;
}
const reviewLabel=r=>(r.weekly?'Weekly review':'Review')+(r.date?' · '+formatDay(String(r.date).slice(0,10)):'')+(r.by?' · '+r.by:'');

// One period: plan, evidence, reflection, its saved reviews (each editable by those allowed), and (on request) its
// review form. Sentences of the plan and written reflection can be tapped to highlight them while a review of this
// period is open; "outside" lets the weekly review use those taps when no period review is open.
function PeriodCard({l,showClass,open,onOpen,onClose,onSaved,actor,outside,onEditWeekly}){
 const d=useDraft(),[saving,setSaving]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState(null);
 const formOpen=open||Boolean(editing);
 const saved=lessonMarks(l),draftMarks=new Set(d.marks.map(markKey));
 const marking=formOpen?{marks:draftMarks,onMark:d.mark}:outside?{marks:outside.marks,onMark:outside.onMark,saved}:{marks:saved};
 const reviews=l.reviews||[];
 function startEdit(r){setEditing(r);d.load(r.review,r.highlights);setError('');}
 function close(){d.reset();setEditing(null);setError('');onClose?.();}
 async function save(e){e.preventDefault();if(saving||!ratingsReady(d.draft))return;setSaving(true);setError('');
  try{d.requestId.current ||= crypto.randomUUID();const review=withMarks(ratingsOf(d.draft),d.marks);
   if(editing)await lessonApi({action:'edit',recordId:l.recordId,reviewKey:editing.key,requestId:d.requestId.current,review});
   else await lessonApi({action:'save',recordId:l.recordId,requestId:d.requestId.current,review});
   const was=editing;d.reset();setEditing(null);onSaved?.(was?'updated':'saved');}catch(e){setError(e.message);}finally{setSaving(false);}}
 return <article className={'wr-period'+(formOpen?' open':'')}>
  <div className="wr-period-head"><span className="ta-pnum">Period {l.dayNumber}</span>{typeName[l.periodType]&&<span className={'wr-ptype '+l.periodType}>{typeName[l.periodType]}</span>}<b>{showClass?classOf(l)+' — ':''}{l.topic}</b>{l.feedback?<span className="pill green">{l.feedback.weekly?'Weekly review':'Reviewed'}</span>:l.periodType==='substitute'?<span className="pill">Substitute · not for review</span>:<span className="pill amber">Awaiting review</span>}{!formOpen&&onOpen&&<button type="button" className="button" onClick={onOpen}><ClipboardCheck size={15}/>{l.feedback?'Add a review':'Review this period'}</button>}</div>
  {reviews.map(r=>{const can=mayEditReview(actor,{by:r.author});return <div className={'wr-done'+(editing?.key===r.key?' editing':'')} key={r.key||r.date}>
   <b>{reviewLabel(r)}</b>{r.editedBy&&<small className="wr-edited"><em>Updated</em>{r.editedBy!==r.by?'by '+r.editedBy:''}</small>}<p>{r.weekly?String(r.text).split('\n\n').slice(1).join('\n\n'):r.text}</p>
   {r.highlights?.filter(h=>String(h.record)===String(l.recordId)).length>0&&<small className="wr-hl-count"><Highlighter size={12}/>{r.highlights.filter(h=>String(h.record)===String(l.recordId)).length} highlighted in this period</small>}
   {can&&!formOpen&&(r.weekly?onEditWeekly&&<button type="button" className="text-button" onClick={()=>onEditWeekly(r)}><Pencil size={13}/>Edit weekly review</button>
    :<button type="button" className="text-button" onClick={()=>startEdit(r)}><Pencil size={13}/>Edit</button>)}
  </div>;})}
  {formOpen&&<p className="hl-tip"><Highlighter size={14}/><span><b>Tap a line</b> of the plan or reflection to mark it yellow. Tap again to remove it.</span></p>}
  <details open={formOpen||saved.size>0||Boolean(outside&&[...outside.marks].some(k=>k.startsWith(l.recordId+'|')))}><summary>Lesson plan</summary>{l.plan.fields.map(f=><div className="review-plan-field" key={f.key}><b>{f.label}</b><MarkText record={l.recordId} field={f.key} text={f.text} {...marking}/></div>)}{l.plan.notes&&<div className="review-note"><MarkText record={l.recordId} field="notes" text={l.plan.notes} {...marking}/></div>}{!l.plan.fields.length&&!l.plan.notes&&<p className="hint">No written plan.</p>}</details>
  <Files title="Classroom activities" files={l.activities}/><Files title="Student written work" files={l.writing}/><Files title="Remedial support" files={l.remedial}/><Files title="Student portfolio / assessment" files={l.portfolio}/>
  {(l.writtenReflections||[]).map(r=><div className="wr-reflection" key={r.url}><span>After-class reflection</span>{['achievement','nextStep'].filter(k=>r.answers?.[k]).map(k=><MarkText key={k} record={l.recordId} field={'reflection.'+k} text={r.answers[k]} {...marking}/>)}</div>)}
  <Files title="After-class reflection" files={l.reflections}/>
  {!hasEvidence(l)&&!hasReflection(l)&&<p className="hint">No classroom evidence or reflection yet.</p>}
  {formOpen&&<form className="wr-inline" onSubmit={save}><h4>{editing?'Edit review · Period '+l.dayNumber:'Review Period '+l.dayNumber}</h4>{error&&<p className="alert error" role="alert">{error}</p>}
   {editing&&<p className="hint">The earlier version is kept. {l.teacher||'The teacher'} will see this review as updated{editing.notedAt?' and can mark it noted again':''}.</p>}
   <Ratings draft={d.draft} edit={d.edit} disabled={saving}/>
   <p className="wr-hl-count"><Highlighter size={12}/>{d.marks.length?d.marks.length+(d.marks.length===1?' line':' lines')+' highlighted':'No lines highlighted'}</p>
   <div className="modal-actions"><button type="button" className="button" disabled={saving} onClick={close}>Cancel</button><button className="button primary" disabled={saving||!ratingsReady(d.draft)}>{saving?'Saving…':editing?'Save changes':'Save review for Period '+l.dayNumber}</button></div></form>}
 </article>;
}
function Stats({items}){return <div className="wr-stats">{items.map(([n,l])=><div key={l}><strong>{n}</strong><span>{l}</span></div>)}</div>;}

function Pickers({schools,school,setSchool,teachers,teacher,setTeacher,children}){
 return <div className="form-grid wr-pick">
  {schools.length>1&&<label className="field"><span>School</span><select value={school} onChange={e=>setSchool(e.target.value)}><option value="">Choose a school</option>{schools.map(s=><option key={s}>{s}</option>)}</select></label>}
  {setTeacher&&<label className="field"><span>Teacher</span><select value={teacher} disabled={!school} onChange={e=>setTeacher(e.target.value)}><option value="">Choose a teacher</option>{teachers.map(t=><option key={t}>{t}</option>)}</select></label>}
  {children}
 </div>;
}

function useWeek(school,teacher,week,reloadKey){
 const [view,setView]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[n,setN]=useState(0);
 useEffect(()=>{if(!school||!teacher){setView(null);return;}let live=true;setLoading(true);setError('');
  weeklyApi({action:'week',school,teacher,week}).then(d=>{if(live)setView(d);}).catch(e=>{if(live){setError(e.message);setView(null);}}).finally(()=>{if(live)setLoading(false);});
  return ()=>{live=false;};},[school,teacher,week,reloadKey,n]);
 return {view,loading,error,reload:()=>setN(x=>x+1)};
}

function DayWise({sel,set,schools,teachers,reloadKey,onSaved,actor}){
 const {view,loading,error,reload}=useWeek(sel.school,sel.teacher,weekRange(sel.date).from,reloadKey);
 const [open,setOpen]=useState(''),[show,setShow]=useState('all');
 const day=(view?.groups||[]).flatMap(g=>g.lessons).filter(l=>l.plannedDate===sel.date).sort((a,b)=>a.dayNumber-b.dayNumber);
 const shown=show==='awaiting'?day.filter(l=>!l.feedback):day;
 return <>
  <p className="hint">Choose a day and a teacher. Every period of that day, in order, with its plan, evidence and reflection. Review each period here.</p>
  <Pickers {...{schools,teachers}} school={sel.school} setSchool={v=>set({school:v,teacher:''})} teacher={sel.teacher} setTeacher={v=>set({teacher:v})}>
   <label className="field"><span>Date</span><input type="date" value={sel.date} onChange={e=>e.target.value&&set({date:e.target.value})}/><small>{longDay(sel.date)}</small></label>
   <label className="field"><span>Show</span><select value={show} onChange={e=>setShow(e.target.value)}><option value="all">All periods</option><option value="awaiting">Awaiting review</option></select></label>
  </Pickers>
  <div className="ta-filters wr-weeks"><button type="button" className="ta-chip" onClick={()=>set({date:addDays(sel.date,-1)})}><ChevronLeft size={13}/>Previous day</button><button type="button" className={'ta-chip'+(sel.date===istToday()?' on':'')} onClick={()=>set({date:istToday()})}>Today</button><button type="button" className="ta-chip" onClick={()=>set({date:addDays(sel.date,1)})}>Next day<ChevronRight size={13}/></button></div>
  {error&&<p className="alert error" role="alert">{error}</p>}
  {!sel.school||!sel.teacher?<p className="hint">Choose {schools.length>1&&!sel.school?'a school and ':''}a teacher.</p>
  :loading&&!view?<p role="status">Opening the day…</p>
  :!day.length?<p className="hint">{sel.teacher} has no lesson plans for {longDay(sel.date)}.</p>
  :<>
   <Stats items={[[day.length,'Periods planned'],[day.filter(hasEvidence).length,'With classroom evidence'],[day.filter(hasReflection).length,'With after-class reflection'],[day.filter(l=>l.feedback).length,'Reviewed']]}/>
   {shown.map(l=><PeriodCard key={l.key} l={l} showClass actor={actor} open={open===l.key} onOpen={()=>setOpen(l.key)} onClose={()=>setOpen('')} onSaved={how=>{setOpen('');reload();onSaved?.((how==='updated'?'Review updated for Period ':'Review saved for Period ')+l.dayNumber+'. '+sel.teacher+' will see it in their Feedback tab.');}}/>)}
   {!shown.length&&<p className="hint">Every period of this day has been reviewed.</p>}
  </>}
 </>;
}

function WeeklySubject({sel,set,schools,teachers,reloadKey,onSaved,actor}){
 const range=weekRange(sel.week),{view,loading,error,reload}=useWeek(sel.school,sel.teacher,range.from,reloadKey);
 const groups=view?.groups||[],group=groups.find(g=>g.key===sel.group)||groups[0];
 const d=useDraft(),[focus,setFocus]=useState(''),[saving,setSaving]=useState(false),[saveError,setSaveError]=useState(''),[open,setOpen]=useState(''),[editing,setEditing]=useState(null),formRef=useRef(null);
 useEffect(()=>{d.reset();setFocus('');setEditing(null);},[group?.key,range.from,sel.teacher]);
 const weeklyMarks={marks:new Set(d.marks.map(markKey)),onMark:d.mark};
 function startEdit(r){setEditing(r);d.load(r.review,r.highlights);setFocus(r.review?.focus||'');setSaveError('');setTimeout(()=>formRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),50);}
 function cancelEdit(){setEditing(null);d.reset();setFocus('');}
 const thisWeek=weekRange(istToday()).from,lastWeek=weekRange(addDays(istToday(),-7)).from;
 const ready=ratingsReady(d.draft)&&focus.trim();
 async function save(e){e.preventDefault();if(saving||!ready||!group)return;setSaving(true);setSaveError('');
  try{d.requestId.current ||= crypto.randomUUID();const review=withMarks({...ratingsOf(d.draft),focus:focus.trim()},d.marks);
   const r=editing?await lessonApi({action:'edit',recordId:editing.recordId,reviewKey:editing.id,requestId:d.requestId.current,review})
    :await weeklyApi({action:'save',school:sel.school,teacher:sel.teacher,week:range.from,grade:group.grade,section:group.section,subject:group.subject,requestId:d.requestId.current,review});
   const was=editing;d.reset();setFocus('');setEditing(null);reload();onSaved?.((was?'Weekly review updated for ':'Weekly review saved for ')+r.periods+(r.periods===1?' period':' periods')+'. '+sel.teacher+' will see it in their Feedback tab.');
  }catch(e){setSaveError(e.message);}finally{setSaving(false);}}
 const days=group?[...new Set(group.lessons.map(l=>l.plannedDate))]:[];
 return <>
  <p className="hint">Choose the teacher, the subject (with its class) and the week. One review for that subject's week; single periods can still be reviewed below.</p>
  <Pickers {...{schools,teachers}} school={sel.school} setSchool={v=>set({school:v,teacher:'',group:''})} teacher={sel.teacher} setTeacher={v=>set({teacher:v,group:''})}>
   <label className="field"><span>Subject · class</span><select value={group?.key||''} disabled={!groups.length} onChange={e=>set({group:e.target.value})}>{!groups.length&&<option value="">{sel.teacher?'No plans this week':'Choose a teacher first'}</option>}{groups.map(g=><option key={g.key} value={g.key}>{subjectOf(g)} ({g.periods} {g.periods===1?'period':'periods'}){g.reviews.length?' · ✓ reviewed':''}</option>)}</select></label>
   <label className="field"><span>Week</span><input type="date" value={range.from} onChange={e=>e.target.value&&set({week:weekRange(e.target.value).from})}/><small>{weekLabel(range.from,range.to)}</small></label>
  </Pickers>
  <div className="ta-filters wr-weeks" role="group" aria-label="Week">{[[lastWeek,'Last week'],[thisWeek,'This week']].map(([w,l])=><button key={l} type="button" className={'ta-chip'+(range.from===w?' on':'')} aria-pressed={range.from===w} onClick={()=>set({week:w})}>{l}</button>)}<button type="button" className="ta-chip" onClick={()=>set({week:addDays(range.from,-7)})}><ChevronLeft size={13}/>Earlier</button><button type="button" className="ta-chip" onClick={()=>set({week:addDays(range.from,7)})}>Later<ChevronRight size={13}/></button></div>
  {error&&<p className="alert error" role="alert">{error}</p>}
  {!sel.school||!sel.teacher?<p className="hint">Choose {schools.length>1&&!sel.school?'a school and ':''}a teacher to see their week.</p>
  :loading&&!view?<p role="status">Opening the week…</p>
  :!groups.length?<p className="hint">{sel.teacher} has no lesson plans for {weekLabel(range.from,range.to)}.</p>
  :group&&<>
   <Stats items={[[group.periods,'Periods planned'],[group.withEvidence,'With classroom evidence'],[group.reflections,'With after-class reflection'],[group.lessons.filter(l=>l.feedback).length,'Reviewed']]}/>
   {days.map(day=><div className="wr-day" key={day}><h3>{weekday(day)}</h3>{group.lessons.filter(l=>l.plannedDate===day).map(l=><PeriodCard key={l.key} l={l} actor={actor} outside={weeklyMarks} onEditWeekly={r=>{const w=group.reviews.find(x=>x.id===r.key);if(w)startEdit(w);}} open={open===l.key} onOpen={()=>setOpen(l.key)} onClose={()=>setOpen('')} onSaved={how=>{setOpen('');reload();onSaved?.((how==='updated'?'Review updated for Period ':'Review saved for Period ')+l.dayNumber+'.');}}/>)}</div>)}
   {group.reviews.length>0&&<section className="wr-earlier"><h3>Weekly reviews for this week</h3>{group.reviews.map(r=><div className={'lr-review'+(editing?.id===r.id?' editing':'')} key={r.id}><b>{formatDay(String(r.date).slice(0,10))}{r.by?' · '+reviewerLabel(r.by):''}</b>
    {r.editedBy&&<small className="wr-edited"><em>Updated</em>{reviewerLabel(r.editedBy)!==reviewerLabel(r.by)?'by '+reviewerLabel(r.editedBy):''}</small>}<p>{String(r.text).split('\n\n').slice(1).join('\n\n')}</p>
    {r.highlights?.length>0&&<small className="wr-hl-count"><Highlighter size={12}/>{r.highlights.length} {r.highlights.length===1?'line':'lines'} highlighted</small>}
    {mayEditReview(actor,{by:r.by})&&editing?.id!==r.id&&<button type="button" className="text-button" onClick={()=>startEdit(r)}><Pencil size={13}/>Edit</button>}</div>)}</section>}
   <form className="wr-form" ref={formRef} onSubmit={save}><h3>{editing?'Edit weekly review':group.reviews.length?'Add another weekly review':'Weekly review'} · {subjectOf(group)} · {weekLabel(view.from,view.to)}</h3>
    <p className="hint">{editing?'Change the ratings, remarks, focus or highlights. The earlier version is kept, and '+sel.teacher+' will see the review as updated.':'Rate planning, execution or both, with one or two sentences each, and add a focus for next week. It covers the '+group.periods+' '+(group.periods===1?'period':'periods')+' above.'}</p>
    {saveError&&<p className="alert error" role="alert">{saveError}</p>}
    <Ratings draft={d.draft} edit={d.edit} disabled={saving}/>
    <label className="field"><span>Focus for next week</span><textarea rows={2} maxLength={500} required disabled={saving} value={focus} placeholder="One clear focus the teacher can work on next week." onChange={e=>{d.requestId.current=null;setFocus(e.target.value);}}/></label>
    <p className="wr-hl-count"><Highlighter size={12}/>{d.marks.length?d.marks.length+(d.marks.length===1?' line':' lines')+' highlighted in this week\'s plans and reflections':'Tap lines of the plans or reflections above to highlight them'}</p>
    <div className="modal-actions">{editing?<button type="button" className="button" disabled={saving} onClick={cancelEdit}>Cancel</button>:<button type="button" className="button" disabled={loading} onClick={reload}><RefreshCw size={15}/>Refresh week</button>}<button className="button primary" disabled={saving||!ready}>{saving?'Saving…':<><CircleCheck size={16}/>{editing?'Save changes':'Save weekly review'}</>}</button></div>
   </form>
  </>}
 </>;
}

// When a plan was submitted against its planned day: ✓ ahead, = same day, +n days late.
const timingLabel=x=>x.timing==='ahead'?'✓ ahead':x.timing==='same'?'= same day':x.timing==='late'?'+'+x.daysLate+(x.daysLate===1?' day late':' days late'):'—';
// Period number and type on every lesson (owner request, 28 November 2026): "P1 ✓ ahead", "P3 Remedial ✓", "P5 Substitute".
const typeName={remedial:'Remedial',substitute:'Substitute'};
const shortTiming=x=>x.timing==='ahead'?'✓':x.timing==='same'?'=':x.timing==='late'?'+'+x.daysLate:'';
const cellLabel=x=>(x.period?'P'+x.period+' ':'')+(x.periodType==='substitute'?'Substitute':x.periodType==='remedial'?('Remedial '+shortTiming(x)).trim():timingLabel(x));
function WeekOverview({sel,set,schools,roster,reloadKey,openWeekly,openDay}){
 const range=weekRange(sel.week),[view,setView]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[subject,setSubject]=useState(''),[show,setShow]=useState('all');
 useEffect(()=>{if(!sel.school){setView(null);return;}let live=true;setLoading(true);setError('');
  weeklyApi({action:'overview',school:sel.school,week:range.from}).then(d=>{if(live)setView(d);}).catch(e=>{if(live){setError(e.message);setView(null);}}).finally(()=>{if(live)setLoading(false);});return ()=>{live=false;};},[sel.school,range.from,reloadKey]);
 const planned=new Map((view?.teachers||[]).map(t=>[t.teacher,t.groups]));
 const names=[...new Set([...roster.filter(r=>r.school===sel.school).map(r=>r.name),...planned.keys()])].sort((a,b)=>a.localeCompare(b));
 const subjects=[...new Set((view?.teachers||[]).flatMap(t=>t.groups.map(g=>g.subject)))].sort();
 const rows=names.map(name=>({name,groups:(planned.get(name)||[]).filter(g=>!subject||g.subject===subject)})).filter(r=>show==='all'||r.groups.some(g=>!g.weeklyReviewed));
 // Substitute classes are shown but not counted (period types, 28 November 2026).
 const shown=rows.flatMap(r=>r.groups.flatMap(g=>g.lessons||[])),lessons=shown.filter(x=>x.periodType!=='substitute'),count=t=>lessons.filter(x=>x.timing===t).length;
 const substitutes=shown.length-lessons.length,remedial=lessons.filter(x=>x.periodType==='remedial').length;
 // Monday to Saturday, and Sunday too when something is planned for it.
 const days=[0,1,2,3,4,5,6].map(i=>addDays(range.from,i)).filter((d,i)=>i<6||lessons.some(x=>x.day===d));
 const thisWeek=weekRange(istToday()).from,lastWeek=weekRange(addDays(istToday(),-7)).from;
 return <>
  <p className="hint">Every teacher's lessons this week, by class and subject and by day: when each plan was submitted (✓ ahead, = same day, +n days late) and whether it is reviewed. Tap a lesson for the day-wise review; tap the weekly review to open it.</p>
  <Pickers schools={schools} school={sel.school} setSchool={v=>set({school:v})} teachers={[]}>
   <label className="field"><span>Week</span><input type="date" value={range.from} onChange={e=>e.target.value&&set({week:weekRange(e.target.value).from})}/><small>{weekLabel(range.from,range.to)}</small></label>
   <label className="field"><span>Subject</span><select value={subject} onChange={e=>setSubject(e.target.value)}><option value="">All subjects</option>{subjects.map(s=><option key={s}>{s}</option>)}</select></label>
   <label className="field"><span>Show</span><select value={show} onChange={e=>setShow(e.target.value)}><option value="all">All teachers</option><option value="awaiting">With a subject awaiting review</option></select></label>
  </Pickers>
  <div className="ta-filters wr-weeks">{[[lastWeek,'Last week'],[thisWeek,'This week']].map(([w,l])=><button key={l} type="button" className={'ta-chip'+(range.from===w?' on':'')} onClick={()=>set({week:w})}>{l}</button>)}<button type="button" className="ta-chip" onClick={()=>set({week:addDays(range.from,-7)})}><ChevronLeft size={13}/>Earlier</button><button type="button" className="ta-chip" onClick={()=>set({week:addDays(range.from,7)})}>Later<ChevronRight size={13}/></button></div>
  {error&&<p className="alert error" role="alert">{error}</p>}
  {!sel.school?<p className="hint">Choose a school.</p>:loading&&!view?<p role="status">Opening the week…</p>:view&&<>
   <Stats items={[[lessons.length,'Lessons planned this week'+(substitutes?' (+'+substitutes+' substitute)':'')],[count('ahead'),'Planned ahead'],[count('same'),'Planned the same day'],[count('late'),'Written after the lesson'],...(remedial?[[remedial,'Remedial classes']]:[]),[lessons.filter(x=>x.reviewed).length+' of '+lessons.length,'Lessons reviewed']]}/>
   <div className="table-scroll"><table className="wo-grid"><thead><tr><th>Class · subject</th>{days.map(d=><th key={d}>{weekday(d)}</th>)}<th>This week</th><th>Weekly review</th></tr></thead><tbody>
    {rows.map(r=>{const gs=planned.get(r.name)||[];return <Fragment key={r.name}>
     <tr className="wo-t"><td colSpan={days.length+3}><button type="button" className="text-button wo-name" onClick={()=>openDay(r.name)}><b>{r.name}</b></button><small>{gs.length?gs.filter(g=>g.weeklyReviewed).length+' of '+gs.length+(gs.length===1?' subject':' subjects')+' reviewed weekly':'No plans this week'}</small><button type="button" className="text-button wo-open" onClick={()=>openDay(r.name)}>Open day-wise ›</button></td></tr>
     {!r.groups.length?<tr><td colSpan={days.length+3} className="wo-none">{gs.length?'No plans for this subject':'No lesson plans for this week'}</td></tr>
     :r.groups.map(g=>{const all=g.lessons||[],ls=all.filter(x=>x.periodType!=='substitute'),n=ls.length;return <tr key={g.key}><td className="wo-cs">{subjectOf(g)}</td>
      {days.map(d=>{const here=all.filter(x=>x.day===d);return <td key={d}>{here.length?here.map(x=>{const sub=x.periodType==='substitute';return <button type="button" key={x.recordId} className={'wo-pl '+(sub?'sub':(x.timing||'none'))+(x.periodType==='remedial'?' rem':'')} title={[(x.period?'Period '+x.period:'')+' · '+weekday(x.day)+(typeName[x.periodType]?' · '+typeName[x.periodType]:''),x.topic,x.submittedAt?'Plan submitted '+formatStamp(x.submittedAt)+(x.timing&&!sub?' · '+timingLabel(x):''):'',sub?'Substitute class · not for review':x.reviewed?(x.weekly?'Reviewed in the weekly review':'Reviewed'):'Not reviewed yet — click to review'].filter(Boolean).join('\n')} onClick={()=>openDay(r.name,d)}><b>{cellLabel(x)}</b><small className={x.reviewed&&!sub?'ok':''}>{sub?'not for review':x.reviewed?(x.weekly?'● Weekly':'● Reviewed'):'○ Awaiting'}</small></button>;}):<span className="wo-dot">·</span>}</td>;})}
      <td className="wo-sum">{n?<>{ls.filter(x=>x.timing==='ahead').length} of {n} ahead<br/>{ls.filter(x=>x.reviewed).length} of {n} reviewed</>:null}{all.length>n?<>{n?<br/>:null}{all.length-n} substitute</>:null}</td>
      <td>{n?<button type="button" className={'wo-wk '+(g.weeklyReviewed?'ok':'wait')} onClick={()=>openWeekly(r.name,g.key)}>{g.weeklyReviewed?'Weekly review done':'Awaiting weekly review'}</button>:<span className="wo-dot">—</span>}</td></tr>;})}
    </Fragment>;})}
   </tbody></table></div>
   {!rows.length&&<p className="hint">No teacher matches these filters.</p>}
  </>}
 </>;
}

// tab: 'day' | 'weekly' | 'overview'. compact: inside the principal's phone dashboard.
// tab (optional): shown screen, chosen outside (the principal's bottom tabs) — the tab strip is then hidden.
// initial: a starting teacher, date, week or subject group; onSelect: told of every change of selection.
export default function ReviewScreens({data,school:initialSchool='',reloadKey=0,onSaved,compact=false,initialTab='overview',tab:shownTab,initial={},onSelect}){
 const roster=data?.roster||[],schools=[...new Set(roster.map(r=>r.school))].filter(Boolean).sort();
 const [ownTab,setTab]=useState(initialTab),[notice,setNotice]=useState(''),tab=shownTab||ownTab;
 const [sel,setSel]=useState(()=>({school:initialSchool&&schools.includes(initialSchool)?initialSchool:schools.length===1?schools[0]:'',teacher:'',date:istToday(),week:weekRange(istToday()).from,group:'',
  ...Object.fromEntries(Object.entries(initial).filter(([k,v])=>v&&['teacher','date','week','group'].includes(k)))}));
 useEffect(()=>{onSelect?.(sel);},[sel]);
 const set=change=>{setSel(s=>({...s,...change}));setNotice('');};
 const teachers=[...new Set(roster.filter(r=>r.school===sel.school).map(r=>r.name))].sort((a,b)=>a.localeCompare(b));
 const saved=m=>{setNotice(m);onSaved?.(m);};
 const common={sel,set,schools,teachers,reloadKey,onSaved:saved,actor:data?.actor};
 return <section className={'card lesson-records weekly-review review-screens'+(compact?' compact':'')}>
  {!shownTab&&<div className="rs-tabs" role="tablist" aria-label="Review type">{(compact?[['day','Day-wise'],['weekly','Weekly'],['overview','Overview']]:[['day','Day-wise · period by period'],['weekly','Weekly · subject-wise'],['overview','Week overview']]).map(([k,l])=><button key={k} type="button" role="tab" aria-selected={tab===k} className={tab===k?'on':''} onClick={()=>{setTab(k);setNotice('');}}>{l}</button>)}</div>}
  {notice&&<p className="alert success" role="status">{notice}</p>}
  {tab==='day'&&<DayWise {...common}/>}
  {tab==='weekly'&&<WeeklySubject {...common}/>}
  {tab==='overview'&&<WeekOverview sel={sel} set={set} schools={schools} roster={roster} reloadKey={reloadKey}
   openWeekly={(teacher,group)=>{set({teacher,group});setTab('weekly');}} openDay={(teacher,date)=>{set({teacher,date:date||(sel.week<=istToday()&&istToday()<=addDays(sel.week,6)?istToday():sel.week)});setTab('day');}}/>}
 </section>;
}
