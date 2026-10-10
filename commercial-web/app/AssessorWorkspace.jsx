"use client";

import {useEffect,useMemo,useState} from "react";
import {BookOpen,CalendarDays,CheckCircle2,ClipboardCheck,Clock3,GraduationCap,RotateCcw,Search,TrendingUp} from "lucide-react";
import {LEVELS,RATINGS,skillProgress} from "../lib/supabase";

const STAGES=[
 {value:"baseline",name:"Baseline",detail:"Starting-point evidence"},
 {value:"follow_up",name:"Follow-up",detail:"Review after teaching support"},
 {value:"periodic",name:"Periodic",detail:"Regular competency check"},
 {value:"endline",name:"Endline",detail:"End-of-cycle review"}
];
const RATE_LABELS={"Emerging":"Emerging","Developing":"Developing","Independent":"Independent"};
const ROLE_LABELS={super_admin:"Super Admin",consultant:"Consultant",owner:"School owner",
 principal:"Principal",coordinator:"Coordinator",teacher:"Teacher",legacy:"School assessor"};
function localToday(){
 const d=new Date();
 return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
}
function sortSkills(a,b){
 return LEVELS.indexOf(a.grade)-LEVELS.indexOf(b.grade) ||
  (a.strand||"").localeCompare(b.strand||"") ||
  (a.sequence||0)-(b.sequence||0);
}
function formatDay(day){
 if(!day)return "—";
 const [year,month,date]=day.split("-").map(Number);
 return new Date(year,month-1,date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
}
function historyBySession(sessions,results){
 const grouped={};
 for(const item of results){
  if(!grouped[item.assessment_id])grouped[item.assessment_id]=[];
  grouped[item.assessment_id].push(item);
 }
 const previous={};
 for(const session of sessions){
  for(const r of grouped[session.id]||[]){
   if(!previous[r.competency_id]&&r.rating!=="Not Assessed"){
    previous[r.competency_id]={rating:r.rating,date:session.assessment_date,stage:session.assessment_stage};
   }
  }
 }
 return {grouped,previous};
}
function gradeBuckets(skills){
 const map=new Map();
 for(const c of skills){
  const key=c.grade+" / "+(c.strand||"Literacy");
  if(!map.has(key))map.set(key,{key,grade:c.grade,strand:c.strand||"Literacy",items:[]});
  map.get(key).items.push(c);
 }
 return [...map.values()];
}
function ProgressSummary({skills,previous,student}){
 const completed=skills.filter(c=>!!previous[c.id]),independent=completed.filter(c=>previous[c.id]?.rating==="Independent");
 const ratings=Object.fromEntries(Object.entries(previous).map(([key,val])=>[key,val.rating]));
 const report=skillProgress(skills,ratings,student?.grade||"Nursery");
 return <section className="panel assessor-panel">
  <div className="panel-head"><h2><TrendingUp size={18}/> Existing learning evidence</h2></div>
  <div className="assessor-kpis">
   <div><small>Competencies assessed</small><strong>{completed.length} / {skills.length}</strong></div>
   <div><small>Demonstrated independently</small><strong>{independent.length}</strong></div>
   <div><small>Provisional demonstrated level</small><strong>{report.highest||"Not established"}</strong></div>
  </div>
  <p className="helper">This reflects the latest recorded rating for each skill, not a new assessment. Unassessed skills remain unassessed; the provisional level is an internal screening indicator, not a diagnosis.</p>
  {report.byLevel.filter(g=>g.count>0).length>0&&<div className="assessor-mini-progress">
   {report.byLevel.filter(g=>g.count>0).map(g=><div key={g.level} className="assessor-progress-row">
    <span>{g.level}</span><div className="progress-bar"><span style={{width:g.coverage+"%"}}/></div>
    <small>{g.assessed}/{g.count} assessed</small>
   </div>)}
  </div>}
 </section>;
}
export default function AssessorWorkspace({client,schoolId,classes,students,competencies,onSaved}){
 const [classId,setClassId]=useState(""),[studentId,setStudentId]=useState("");
 const [scope,setScope]=useState("cumulative"),[stage,setStage]=useState("baseline");
 const [assessmentDate,setAssessmentDate]=useState(localToday);
 const [ratings,setRatings]=useState({}),[evidence,setEvidence]=useState({});
 const [observations,setObservations]=useState(""),[nextAction,setNextAction]=useState("");
 const [search,setSearch]=useState(""),[gradeFilter,setGradeFilter]=useState("all");
 const [saving,setSaving]=useState(false),[loadingHistory,setLoadingHistory]=useState(false);
 const [message,setMessage]=useState(""),[error,setError]=useState("");
 const [sessions,setSessions]=useState([]),[results,setResults]=useState([]);
 const [historyVersion,setHistoryVersion]=useState(0),[expanded,setExpanded]=useState("");
 const [historyTruncated,setHistoryTruncated]=useState(false);
 const activeClass=classes.find(c=>c.id===classId)||classes[0];
 const eligibleStudents=students.filter(s=>s.class_id===activeClass?.id&&s.active!==false)
  .sort((a,b)=>a.student_name.localeCompare(b.student_name));
 const chosenStudent=eligibleStudents.find(s=>s.id===studentId);
 const enrolledGrade=activeClass?.grade||"Nursery";
 const availableGradeIndex=LEVELS.indexOf(enrolledGrade);
 const availableSkills=useMemo(()=>competencies.filter(c=>c.active&&
   LEVELS.indexOf(c.grade)>=0&&LEVELS.indexOf(c.grade)<=availableGradeIndex).sort(sortSkills),
   [competencies,availableGradeIndex]);
 const selectableGrades=LEVELS.slice(0,Math.max(0,availableGradeIndex)+1);
 const scoped=availableSkills.filter(c=>(scope==="cumulative"||c.grade===enrolledGrade)&&
   (gradeFilter==="all"||c.grade===gradeFilter));
 const needle=search.trim().toLowerCase();
 const visibleSkills=scoped.filter(c=>!needle||[c.title,c.code,c.strand,c.description,c.grade].join(" ").toLowerCase().includes(needle));
 const selectedCount=Object.values(ratings).filter(r=>RATINGS.includes(r)&&r!=="Not Assessed").length;
 const buckets=gradeBuckets(visibleSkills);
 const {grouped,previous}=useMemo(()=>historyBySession(sessions,results),[sessions,results]);
 const chosenGrade=chosenStudent?{...chosenStudent,grade:enrolledGrade}:null;
 const latest=sessions[0];
 useEffect(()=>{setClassId("");setStudentId("");setMessage("");setError("");setSearch("");setGradeFilter("all");},[schoolId]);
 useEffect(()=>{setStudentId("");setRatings({});setEvidence({});setObservations("");setNextAction("");
  setMessage("");setError("");setSearch("");setGradeFilter("all");},[activeClass?.id]);
 useEffect(()=>{setRatings({});setEvidence({});setObservations("");setNextAction("");setMessage("");setError("");
  setExpanded("");},[studentId]);
 useEffect(()=>{
  if(!client||!activeClass?.id||!studentId||!eligibleStudents.some(s=>s.id===studentId)){
   setSessions([]);setResults([]);setLoadingHistory(false);return;
  }
  let alive=true;setLoadingHistory(true);setError("");
  (async()=>{
   try{
    const {data:list,error:listError}=await client.from("literacy_assessments")
     .select("id,assessment_date,assessment_stage,next_action,notes,assessor_role,created_at")
     .eq("school_id",schoolId).eq("class_id",activeClass.id).eq("student_id",studentId)
     .eq("subject_type","student")
     .order("assessment_date",{ascending:false}).order("created_at",{ascending:false})
     .limit(12);
    if(listError)throw listError;
    const history=list||[],saved=[];
    let incomplete=false;
    if(history.length){
     const ids=history.map(a=>a.id);
     for(let page=0;page<4;page++){
      const {data:part,error:rowError}=await client.from("literacy_assessment_results")
       .select("assessment_id,competency_id,rating,evidence_notes")
       .in("assessment_id",ids).order("id",{ascending:true}).range(page*1000,page*1000+999);
      if(rowError)throw rowError;
      saved.push(...(part||[]));
      if((part||[]).length<1000)break;
      if(page===3)incomplete=true;
     }
    }
    if(alive){setSessions(history);setResults(saved);setHistoryTruncated(incomplete);}
   }catch(e){if(alive){setSessions([]);setResults([]);setError("Assessment history could not be loaded: "+e.message);}}
   finally{if(alive)setLoadingHistory(false);}
  })();
  return()=>{alive=false;};
 },[client,schoolId,activeClass?.id,studentId,historyVersion]);
 function rate(id,rating){
  setRatings(previous=>({...previous,[id]:rating}));
  if(rating==="Not Assessed")setEvidence(previous=>({...previous,[id]:""}));
 }
 async function saveAssessment(e){
  e.preventDefault();setMessage("");setError("");
  if(!activeClass||!chosenStudent){setError("Select a class and student first.");return;}
  if(!selectedCount){setError("Rate at least one observed competency before saving.");return;}
  if(assessmentDate>localToday()){setError("The assessment date cannot be in the future.");return;}
  if(!window.confirm("Save "+selectedCount+" competency ratings for "+chosenStudent.student_name+"? Recorded assessment sessions cannot be overwritten."))return;
  const payload=Object.entries(ratings).filter(([,v])=>v!=="Not Assessed"&&RATINGS.includes(v))
   .map(([competency_id,rating])=>({competency_id,rating,evidence_notes:(evidence[competency_id]||"").trim()}));
  setSaving(true);
  try{
   const {data,error:rpcError}=await client.rpc("literacy_submit_assessor_session",{
    p_school_id:schoolId,p_class_id:activeClass.id,p_student_id:chosenStudent.id,
    p_assessment_date:assessmentDate,p_stage:stage,p_notes:observations.trim(),
    p_next_action:nextAction.trim(),p_results:payload
   });
   if(rpcError)throw rpcError;
   if(!data)throw Error("The server returned no assessment ID.");
   setRatings({});setEvidence({});setObservations("");setNextAction("");
   setExpanded(data);setHistoryVersion(v=>v+1);
   setStage("follow_up");setMessage("Assessment saved successfully. The completed session has been added to this student's history.");
   if(onSaved)await onSaved();
  }catch(e){setError("Assessment was not saved: "+e.message);}
  finally{setSaving(false);}
 }
 function resetDraft(){
  if(selectedCount&&!window.confirm("Clear unsaved ratings and notes for this student?"))return;
  setRatings({});setEvidence({});setObservations("");setNextAction("");setMessage("");setError("");
 }
 const missingGrade=availableGradeIndex>=0&&availableSkills.filter(c=>c.grade===enrolledGrade).length===0;
 return <div className="assessor-stack">
  <section className="panel assessor-panel">
   <div className="panel-head"><h2><GraduationCap size={19}/> Literacy Assessor · Student evaluations</h2><span className="eyebrow">NURSERY – GRADE 3 PROGRESSION</span></div>
   <p className="helper">Assess observable reading, phonics, comprehension and writing competencies. Consultants, school leaders and teachers have access only to their authorized schools or classes. Each saved session is retained for longitudinal progress tracking.</p>
   {!classes.length?<div className="empty"><BookOpen size={26}/><h3>No accessible classes</h3><p>A school leader must create a class, and teachers need a class assignment, before assessments can begin.</p></div>:
   <div className="three-col">
    <label>Class / grade<select value={activeClass?.id||""} onChange={e=>setClassId(e.target.value)}>
     {classes.map(c=><option key={c.id} value={c.id}>{c.grade} · {c.section} · {c.academic_year}</option>)}
    </select></label>
    <label>Student<select value={studentId} onChange={e=>setStudentId(e.target.value)}>
     <option value="">Choose a student</option>{eligibleStudents.map(s=><option key={s.id} value={s.id}>{s.student_name} · {s.admission_number}</option>)}
    </select></label>
    <label>Assessment stage<select value={stage} onChange={e=>setStage(e.target.value)}>
     {STAGES.map(s=><option key={s.value} value={s.value}>{s.name}</option>)}
    </select></label>
   </div>}
   {classes.length>0&&!eligibleStudents.length&&<p className="helper">No active students in this class. Use Classes & students to register or bulk-upload a roster first.</p>}
  </section>
  {chosenStudent&&<>
   <ProgressSummary skills={availableSkills} previous={previous} student={chosenGrade}/>
   <section className="panel assessor-panel">
    <div className="panel-head"><h2><ClipboardCheck size={18}/> Assess observable learning</h2>
     <span className="eyebrow">{selectedCount} NEW RATINGS</span></div>
    <div className="three-col">
     <label>Assessment date<input type="date" required max={localToday()} value={assessmentDate}
      onChange={e=>setAssessmentDate(e.target.value)}/></label>
     <label>Competency scope<select value={scope} onChange={e=>{setScope(e.target.value);setGradeFilter("all");}}>
      <option value="cumulative">Cumulative Nursery → {enrolledGrade}</option>
      <option value="current">Current grade only ({enrolledGrade})</option>
     </select></label>
     <label>Grade filter<select value={gradeFilter} onChange={e=>setGradeFilter(e.target.value)}>
      <option value="all">All included grades</option>{selectableGrades.filter(g=>scope==="cumulative"||g===enrolledGrade).map(g=><option key={g} value={g}>{g}</option>)}
     </select></label>
    </div>
    <div className="assessor-toolbar">
     <label className="assessor-search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)}
      placeholder="Find a sound, reading or writing competency…" aria-label="Search competencies"/></label>
     <button type="button" className="btn outline" onClick={resetDraft} disabled={saving}><RotateCcw size={15}/> Clear draft</button>
    </div>
    <div className="notice small">Choose a rating only after observing the skill. Leave unobserved skills as Not Assessed. Previous ratings are reference evidence and are not prefilled as new results.</div>
    {missingGrade&&<div className="notice small">No competencies have been published specifically for {enrolledGrade}. You can assess earlier published levels cumulatively until the Super Admin publishes the {enrolledGrade} progression.</div>}
    {!availableSkills.length?<div className="empty"><BookOpen size={25}/><h3>Competencies not published</h3><p>Ask the Super Admin to publish literacy skills before starting assessment.</p></div>:
    <form onSubmit={saveAssessment} className="assessor-form">
     {buckets.length===0&&<p className="helper">No competencies match the selected filter.</p>}
     {buckets.map(bucket=><div className="assessor-bucket" key={bucket.key}>
      <div className="assessor-bucket-heading"><span>{bucket.grade} · {bucket.strand}</span><small>{bucket.items.length} competencies</small></div>
      {bucket.items.map(c=>{
       const current=ratings[c.id]||"Not Assessed",before=previous[c.id];
       return <div className="assessor-skill" key={c.id}>
        <div className="assessor-skill-heading">
         <div><small>{c.code}</small><strong>{c.title}</strong>
          {c.description&&<p>{c.description}</p>}</div>
         {before&&<span className="assessor-prior">Last: {before.rating} · {formatDay(before.date)}</span>}
        </div>
        <div className="assessor-rate-group" role="group" aria-label={"Rating for "+c.title}>
         {RATINGS.map(r=><button type="button" key={r} onClick={()=>rate(c.id,r)} disabled={saving}
          aria-pressed={current===r} className={"assessor-rate "+(current===r?"assessor-selected":"")}>
          {r==="Not Assessed"?"Not assessed":RATE_LABELS[r]}</button>)}
        </div>
        {current!=="Not Assessed"&&<label className="assessor-evidence">Observed evidence (optional)
          <input type="text" maxLength={500} value={evidence[c.id]||""} onChange={e=>setEvidence(old=>({...old,[c.id]:e.target.value}))}
           placeholder="e.g. independently blended 4 out of 5 words"/>
         </label>}
       </div>;
      })}
     </div>)}
     <div className="assessor-notes two-col">
      <label>Assessment observations<textarea rows={4} maxLength={4000} value={observations}
       onChange={e=>setObservations(e.target.value)} placeholder="What was demonstrated? Which specific difficulties appeared?"/></label>
      <label>Recommended teaching action / follow-up<textarea rows={4} maxLength={2000} value={nextAction}
       onChange={e=>setNextAction(e.target.value)} placeholder="e.g. three phoneme-blending sessions, then reassess in two weeks"/></label>
     </div>
     <div className="assessor-save-row">
      <p><strong>{selectedCount}</strong> new skills rated · <strong>{STAGES.find(s=>s.value===stage)?.name}</strong> session
       <small>Saving creates an immutable dated assessment record.</small></p>
      <button className="btn primary" type="submit" disabled={saving||selectedCount===0||!assessmentDate}>
       <CheckCircle2 size={16}/>{saving?"Saving assessment…":"Save assessment"}
      </button>
     </div>
    </form>}
   </section>
   <section className="panel assessor-panel">
    <div className="panel-head"><h2><Clock3 size={18}/> Assessment history & follow-up</h2><span className="eyebrow">LATEST 12 SESSIONS</span></div>
    {loadingHistory?<p className="helper">Loading previous assessment evidence…</p>:
     sessions.length?<div className="assessor-history">
      {sessions.map(item=>{
       const details=grouped[item.id]||[];
       const independence=details.filter(r=>r.rating==="Independent").length;
       const isOpen=expanded===item.id;
       return <div className="assessor-session" key={item.id}>
        <button type="button" aria-expanded={isOpen} className="assessor-session-head" onClick={()=>setExpanded(isOpen?"":item.id)}>
         <span><CalendarDays size={15}/><strong>{formatDay(item.assessment_date)}</strong>
          <span>{STAGES.find(s=>s.value===item.assessment_stage)?.name||"Periodic"}</span></span>
         <small>{ROLE_LABELS[item.assessor_role]||"School assessor"} · {details.length} rated · {independence} independent</small>
        </button>
        {isOpen&&<div className="assessor-session-body">
         {item.notes&&<p><b>Observation:</b> {item.notes}</p>}
         {item.next_action&&<p><b>Follow-up:</b> {item.next_action}</p>}
         {!details.length?<p>No ratings recorded in this session.</p>:
          <div className="assessor-history-ratings">{details.map(r=>{
           const c=competencies.find(skill=>skill.id===r.competency_id);
           return <div key={r.competency_id}><span><strong>{c?.title||"Archived competency"}</strong>
            <small>{c?.grade||""}{r.evidence_notes?" · "+r.evidence_notes:""}</small></span>
            <em>{r.rating}</em></div>;
          })}</div>}
        </div>}
       </div>;
      })}
     </div>:<p className="helper">No recorded assessments for this student yet. Begin with a Baseline session to establish a starting point.</p>}
    {historyTruncated&&<p className="helper">Some older competency details exceed the recent-history limit. Use the student progress report for cumulative trends.</p>}
   </section>
  </>}
  {(error||message)&&<div className={"notice assessor-feedback"} role="status">{error||message}</div>}
 </div>;
}
