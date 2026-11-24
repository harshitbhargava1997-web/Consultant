'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowUpRight,ClipboardCheck,X} from 'lucide-react';
import {successFetch} from '@/lib/school-success/client';
import {buildLessonRecords,classLine,formatDay} from '@/lib/school-success/lesson-records';
import {reviewCriteria,reviewLevels} from '@/lib/school-success/lesson-reviews';
import './lesson-records.css';

const pageSize=20;
export default function LessonReviewWorkspace({data,school,from,to,setFrom,setTo,onApply,busy,query='',onReview}) {
 const [teacher,setTeacher]=useState(''),[status,setStatus]=useState('all'),[page,setPage]=useState(0);
 const lessons=useMemo(()=>buildLessonRecords(data.entries,from,to).filter(l=>!school||l.school===school),[data.entries,from,to,school]);
 const teachers=[...new Map(lessons.map(l=>[l.teacherKey,school?l.teacher:l.teacher+' · '+l.school])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
 const visible=lessons.filter(l=>{
  const reviewed=Boolean(l.feedback || l.reviewOutsidePeriod);
  return (!teacher||l.teacherKey===teacher) && (status==='all'||(status==='reviewed')===reviewed) &&
   [l.school,l.teacher,l.grade,l.section,l.subject,l.topic].join(' ').toLowerCase().includes(query.trim().toLowerCase());
 });
 const current=Math.min(page,Math.max(0,Math.ceil(visible.length/pageSize)-1));
 const fresh=from===data.period?.from&&to===data.period?.to;
 return <section className="card lesson-records"><div className="card-head"><div><h2>Lessons to review</h2><p>{formatDay(from)} – {formatDay(to)}</p></div><ClipboardCheck size={22}/></div>
  <form className="report-filter-grid" onSubmit={e=>{e.preventDefault();setPage(0);onApply();}}>
   <label className="field"><span>From</span><input type="date" required max={to} value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label className="field"><span>To</span><input type="date" required min={from} value={to} onChange={e=>setTo(e.target.value)}/></label>
   <button className="button" disabled={busy}>Apply period</button>
  </form>
  {!fresh?<p role="status">Apply the selected dates to review lessons.</p>:<>
  <div className="form-grid">
   <label className="field"><span>Teacher</span><select value={teacher} onChange={e=>{setTeacher(e.target.value);setPage(0);}}><option value="">All teachers</option>{teachers.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
   <label className="field"><span>Review status</span><select value={status} onChange={e=>{setStatus(e.target.value);setPage(0);}}><option value="all">All lessons</option><option value="pending">Awaiting feedback</option><option value="reviewed">Feedback recorded</option></select></label>
  </div>
  {visible.slice(current*pageSize,(current+1)*pageSize).map(l=><article className="teacher-period review-list-row" key={l.key}><div>
   <b>{l.topic}</b><p>{[l.teacher,l.school,classLine(l),formatDay(l.plannedDate||l.firstDate)].filter(Boolean).join(' · ')}</p><small>{l.feedback||l.reviewOutsidePeriod?'Feedback recorded':'Awaiting feedback'}{l.feedbackNoted?' · '+(l.feedbackNoted.all?'Teacher noted':'Teacher noted earlier feedback')+' '+formatDay(String(l.feedbackNoted.notedAt).slice(0,10)):''}</small></div>
   <button className="button" onClick={()=>onReview(l)}>Review lesson</button></article>)}
  {!visible.length&&<p role="status">No lessons match these filters.</p>}
  {visible.length>pageSize&&<div className="actions"><button className="button" disabled={!current} onClick={()=>setPage(current-1)}>Previous</button><span>Page {current+1} of {Math.ceil(visible.length/pageSize)}</span><button className="button" disabled={(current+1)*pageSize>=visible.length} onClick={()=>setPage(current+1)}>Next</button></div>}
 </>}</section>;
}
async function reviewApi(body,signal) {
 const response=await successFetch('/api/school-success/lesson-reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'Could not open the lesson review.');
 return data;
}
function EvidenceLinks({title,files}) {
 if(!files.length)return null;
 return <section><h4>{title}</h4><div className="evidence-files">{files.map(f=><a className="file" key={f.url} href={f.url} target="_blank" rel="noopener noreferrer">{f.label}{f.addedOn?' · '+formatDay(f.addedOn):''}<ArrowUpRight size={14}/></a>)}</div></section>;
}
export function LessonReviewDialog({recordId,onClose,onSaved}) {
 const dialog=useRef(null),requestId=useRef(null);
 const [lesson,setLesson]=useState(null),[draft,setDraft]=useState({}),[saving,setSaving]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);
 useEffect(()=>{const el=dialog.current;el.showModal();return ()=>el.close();},[]);
 useEffect(()=>{
  const ctrl=new AbortController();setError('');
  reviewApi({action:'open',recordId},ctrl.signal).then(r=>{if(!ctrl.signal.aborted)setLesson(r.lesson);})
   .catch(e=>{if(!ctrl.signal.aborted)setError(e.message);});
  return ()=>ctrl.abort();
 },[recordId,reload]);
 function edit(key,field,value){
  requestId.current=null;
  setDraft(old=>({...old,[key]:{...old[key],[field]:value}}));
 }
 async function save(e){
  e.preventDefault();if(saving)return;
  const review=Object.fromEntries(Object.entries(draft).filter(([,value])=>value.level).map(([key,v])=>[key,{level:v.level,note:(v.note||'').trim()}]));
  if(!Object.keys(review).length)return;
  setSaving(true);setError('');
  try{
   requestId.current ||= crypto.randomUUID();
   await reviewApi({action:'save',recordId,requestId:requestId.current,review});
  }catch(e){setError(e.message);setSaving(false);return;}
  onSaved();
 }
 return <dialog ref={dialog} className="modal lesson-review-dialog" aria-labelledby="lesson-review-title" onCancel={e=>{e.preventDefault();if(!saving)onClose();}}>
  <div className="card-head"><div><h2 id="lesson-review-title">{lesson?.topic||'Lesson review'}</h2>{lesson&&<p>{[lesson.teacher,lesson.school,classLine(lesson),formatDay(lesson.plannedDate||lesson.firstDate)].filter(Boolean).join(' · ')}</p>}</div><button className="icon" type="button" disabled={saving} aria-label="Close review" onClick={onClose}><X/></button></div>
  {error&&<p className="alert error" role="alert">{error}</p>}
  {!lesson&&(error?<button className="button" onClick={()=>setReload(n=>n+1)}>Reload lesson</button>:<p role="status">Loading lesson…</p>)}
  {lesson&&<>
   <section><h3>Lesson plan</h3>{lesson.plan.fields.map(f=><div className="review-plan-field" key={f.key}><b>{f.label}</b><p>{f.text}</p></div>)}{lesson.plan.notes&&<p className="review-note">{lesson.plan.notes}</p>}
    <EvidenceLinks title="Lesson plan files" files={lesson.planFiles}/>{!lesson.plan.fields.length&&!lesson.plan.notes&&!lesson.planFiles.length&&<p>No written plan or plan file has been submitted.</p>}</section>
   <EvidenceLinks title="Classroom activities" files={lesson.activities}/><EvidenceLinks title="Student work" files={lesson.writing}/><EvidenceLinks title="Recordings" files={lesson.audio}/><EvidenceLinks title="Other classroom evidence" files={lesson.additional}/>
   {!lesson.activities.length&&!lesson.writing.length&&<p className="hint">No classroom activity or student work has been submitted yet.</p>}
   {lesson.feedback&&<section className="feedback"><h4>Earlier feedback</h4><p className="review-note">{lesson.feedback.text}</p><p className="hint">{lesson.feedbackNoted?(lesson.feedbackNoted.all?'✓ The teacher noted this feedback on ':'✓ The teacher noted earlier feedback on ')+formatDay(String(lesson.feedbackNoted.notedAt).slice(0,10))+'.':'The teacher has not marked this feedback as noted yet.'}</p></section>}
   <form onSubmit={save}><h3>Academic review</h3><p className="hint">Review either area or both. Add one or two sentences for each rating.</p>
    {Object.entries(reviewCriteria).map(([key,c])=><fieldset key={key} className="review-criterion" disabled={saving}><legend>{c.label}</legend><p>{c.question}</p>
     <label className="field"><span>{c.label} rating</span><select value={draft[key]?.level||''} onChange={e=>edit(key,'level',e.target.value)}><option value="">Not reviewed</option>{Object.entries(reviewLevels).map(([level,label])=><option key={level} value={level}>{level} · {label}</option>)}</select></label>
     {draft[key]?.level&&<><p className="hint">{c[draft[key].level]}</p><label className="field"><span>{c.label} feedback</span><textarea rows={2} maxLength={500} required value={draft[key].note||''} onChange={e=>edit(key,'note',e.target.value)}/></label></>}
    </fieldset>)}
    <div className="modal-actions"><button type="button" className="button" disabled={saving} onClick={onClose}>Cancel</button><button className="button primary" disabled={saving||!Object.values(draft).some(v=>v.level)||Object.values(draft).some(v=>v.level&&!v.note?.trim())}>{saving?'Saving…':'Save feedback'}</button></div>
   </form>
  </>}
 </dialog>;
}
