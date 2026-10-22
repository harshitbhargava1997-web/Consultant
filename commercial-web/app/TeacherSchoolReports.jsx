"use client";
import {useEffect,useMemo,useState} from "react";
import {BookOpen,CheckCircle2,ClipboardCheck,GraduationCap,RefreshCw,Search,School,Users} from "lucide-react";
import SoundProgressPanel from "./SoundProgressPanel";
import {usePhonicsCatalog} from "./PhonicsSoundPicker";

const emptySummary={students:0,teachers:0,classCount:0,student:null,training:null,teacherSkills:null,implementation:null};
function number(value){return value===null||value===undefined?"Not available":value;}
function percentage(top,bottom){return bottom?Math.round(top*100/bottom)+"%":"No observations";}
function TeacherDetail({teacher,available,byId,competencies}){
 if(!teacher)return null;
 const proficiency=teacher.assessments,training=teacher.training,implementation=teacher.implementation;
 const sessions=proficiency?.sessions||[];
 const soundRows=sessions.flatMap(s=>(s.phonicsRatings||[]).map(r=>({...r,assessment_id:s.id})));
 const reviewSessions=sessions.map(s=>({id:s.id,assessment_date:s.assessment_date,created_at:s.created_at}));
 return <div className="progress-teacher-detail">
  <section className="panel">
   <div className="panel-head"><h2><GraduationCap size={19}/> {teacher.name}</h2>
    <span className="eyebrow">TEACHER DEVELOPMENT</span></div>
   <p className="helper">Assigned classes: {teacher.classes.length?teacher.classes.join(", "):"No current class assignments"}</p>
   <div className="progress-unified-stats">
    <div><small>Competency reviews</small><strong>{number(proficiency?.reviews)}</strong></div>
    <div><small>Training units completed</small><strong>{number(training?.unitsCompleted)}</strong></div>
    <div><small>Certificates</small><strong>{number(training?.certificates)}</strong></div>
    <div><small>Implementation periods</small><strong>{number(implementation?.submissions)}</strong></div>
   </div>
   <p className="helper">This is evidence of assessed teaching skills, completed professional development and reported classroom implementation. Counts alone do not determine teaching quality.</p>
  </section>
  {available?.skills&&<section className="panel">
   <div className="panel-head"><h2><ClipboardCheck size={17}/> Teacher competency proficiency</h2></div>
   {proficiency?.reviews>0?<div className="progress-teacher-ratings">
    <p><strong>{proficiency.competenciesObserved}</strong> distinct competencies observed; <strong>{proficiency.competenciesIndependent}</strong> latest ratings at Independent.</p>
    <p className="helper">Most recent review: {proficiency.latest||"Not recorded"} · {proficiency.reviews} dated review sessions.</p>
    <SoundProgressPanel title="Individual phonics progress" subjectLabel="teacher"
     sessions={reviewSessions} soundRows={soundRows} competencies={competencies} itemById={byId}/>
   </div>:<p className="helper">No teacher competency reviews recorded for this school yet. Conduct a review in Teacher Skills Review to establish a baseline.</p>}
  </section>}
  {available?.training&&<section className="panel">
   <div className="panel-head"><h2><BookOpen size={17}/> Training & certification</h2></div>
   {training?.courses?.length?<div className="progress-course-list">
    {training.courses.map(c=><div key={c.id} className="progress-course-row">
     <div><strong>{c.title}</strong><small>{c.completed}/{c.total} units completed</small></div>
     <span>{c.certified?"Certified":c.total&&c.completed===c.total?"Units complete · not certified":"In progress / not started"}</span>
    </div>)}
   </div>:<p className="helper">No published courses currently assigned to this school for teachers.</p>}
   <p className="helper">Latest completed exercise score average: {training?.averageQuiz===null?"No scored exercises yet":training?.averageQuiz+"%"}.</p>
  </section>}
  {available?.implementation&&<section className="panel">
   <div className="panel-head"><h2><ClipboardCheck size={17}/> Classroom implementation evidence</h2></div>
   <div className="progress-small-stats">
    <span><strong>{implementation?.preparationSessions||0}</strong> lesson preparations</span>
    <span><strong>{Number(implementation?.preparationMinutes||0).toFixed(1)}</strong> preparation minutes</span>
    <span><strong>{implementation?.submissions||0}</strong> submitted periods</span>
    <span><strong>{implementation?.reviewed||0}</strong> reviewed</span>
    <span><strong>{implementation?.pending||0}</strong> awaiting review</span>
    <span><strong>{implementation?.needsFollowUp||0}</strong> needing follow-up</span>
   </div>
   {(implementation?.records||[]).length?
    <div className="progress-implementation-list">{implementation.records.map(r=><div key={r.id}>
     <div className="progress-report-line"><strong>{r.lesson_topic}</strong>
      <small>{r.implementation_date} · {r.subject}</small></div>
     <small>{Object.entries(r.files||{}).map(([k,n])=>k.replace(/_/g," ")+": "+n).join(" · ")||"No linked file records"}
      {" · "}{r.review?.status==="reviewed"?"Reviewed":r.review?.status==="needs_follow_up"?"Needs follow-up":"Awaiting review"}</small>
     {r.review?.feedback&&<p className="helper">Review feedback: {r.review.feedback}</p>}
    </div>)}</div>:<p className="helper">No classroom implementation submissions yet. Teachers can upload voice reflections and lesson evidence in Teacher Implementation.</p>}
   <p className="helper">Open Teacher Portal to review Vision literacy preparations, attachments and feedback. Earlier records remain in Implementation history. Preparation and evidence counts do not establish competency proficiency.</p>
  </section>}
 </div>;
}
function GradeOverview({student}){
 if(!student)return <p className="helper">Student progress metrics are not accessible with your current role permissions.</p>;
 return <>
  <div className="progress-unified-stats">
   <div><small>Registered students</small><strong>{student.students}</strong></div>
   <div><small>Students with assessments</small><strong>{student.assessedStudents}</strong></div>
   <div><small>Assessment sessions</small><strong>{student.sessions}</strong></div>
   <div><small>Independent ratings</small><strong>{percentage(student.independentRatings,student.ratings)}</strong></div>
  </div>
  <div className="table-wrap"><table className="progress-unified-table">
   <thead><tr><th>Grade</th><th>Students</th><th>Assessed</th><th>Assessment sessions</th><th>Independently demonstrated ratings</th></tr></thead>
   <tbody>{student.byGrade.map(g=><tr key={g.grade}><td>{g.grade}</td><td>{g.students}</td>
    <td>{g.assessedStudents} ({percentage(g.assessedStudents,g.students)})</td>
    <td>{g.sessions}</td><td>{g.independent} of {g.ratings} ({percentage(g.independent,g.ratings)})</td>
   </tr>)}</tbody></table></div>
  <p className="helper">Coverage is the number of students with at least one recorded session. Independent ratings are a share of observed competency ratings—not the percentage of students proficient, and not evidence of causal improvement.</p>
 </>;
}
export default function TeacherSchoolReports({session,client,schoolId,mode,competencies=[]}){
 const [overview,setOverview]=useState(null),[teacherId,setTeacherId]=useState("");
 const [detail,setDetail]=useState(null),[loading,setLoading]=useState(true),[loadingTeacher,setLoadingTeacher]=useState(false);
 const [error,setError]=useState(""),[needle,setNeedle]=useState(""),[updated,setUpdated]=useState(0);
 const {byId}=usePhonicsCatalog(client);
 async function request(mode,teacher){
  const params=new URLSearchParams({schoolId,mode});
  if(teacher)params.set("teacherId",teacher);
  const res=await fetch("/api/progress?"+params.toString(),{
   headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"
  });
  const json=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(json.error||"Progress reporting unavailable.");
  return json;
 }
 useEffect(()=>{
  if(!schoolId||!session?.access_token){setOverview(null);setDetail(null);return;}
  let active=true;setLoading(true);setError("");setOverview(null);setDetail(null);setTeacherId("");
  request("school").then(data=>{if(active)setOverview(data);})
   .catch(e=>{if(active)setError(e.message);})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[schoolId,session?.access_token,updated]);
 useEffect(()=>{
  if(!schoolId||!session?.access_token||!teacherId){setDetail(null);return;}
  let active=true;setLoadingTeacher(true);setDetail(null);
  request("teacher",teacherId).then(data=>{if(active){setDetail(data);setError("");}})
   .catch(e=>{if(active)setError(e.message);})
   .finally(()=>{if(active)setLoadingTeacher(false);});
  return()=>{active=false;};
 },[schoolId,teacherId,session?.access_token,updated]);
 const list=(overview?.teachers||[]).filter(t=>
  [t.name,...t.classes].join(" ").toLowerCase().includes(needle.toLowerCase()));
 const sum=overview?.summary||emptySummary;
 return <div className="progress-report-combined">
  <div className="progress-report-toolbar">
   <p className="helper">{mode==="school"?"Consolidated school implementation and teaching–learning evidence":"Teacher learning, proficiency and classroom implementation in one report."}</p>
   <button type="button" className="btn outline" onClick={()=>setUpdated(x=>x+1)} disabled={loading||loadingTeacher}>
    <RefreshCw size={15}/> Refresh report</button>
  </div>
  {loading&&<p className="helper">Compiling school-scoped reporting data…</p>}
  {error&&<div className="notice" role="status">{error}</div>}
  {!loading&&sum.dataLimited&&<div className="notice">Some reporting tables reached their retrieval limit. Metrics are incomplete; reduce data scope or enable paginated report export for an exhaustive historical report.</div>}
  {!loading&&mode==="school"&&overview&&<>
   <section className="panel">
    <div className="panel-head"><h2><School size={19}/> School learning & implementation snapshot</h2></div>
    <div className="progress-unified-stats">
     <div><small>Classes</small><strong>{sum.classCount}</strong></div>
     <div><small>Registered students</small><strong>{sum.students}</strong></div>
     <div><small>Teachers</small><strong>{sum.teachers}</strong></div>
     <div><small>Teachers competency-reviewed</small><strong>{number(sum.teacherSkills?.reviewed)}</strong></div>
    </div>
    <GradeOverview student={sum.student}/>
   </section>
   <section className="panel">
    <div className="panel-head"><h2><GraduationCap size={19}/> Professional development & teacher implementation</h2></div>
    <div className="progress-unified-stats">
     <div><small>Published teacher courses</small><strong>{number(sum.training?.publishedCourses)}</strong></div>
     <div><small>Teachers with certificates</small><strong>{number(sum.training?.teachersCertified)}</strong></div>
     <div><small>Implementation periods</small><strong>{number(sum.implementation?.submissions)}</strong></div>
     <div><small>Implementation follow-ups needed</small><strong>{number(sum.implementation?.needsFollowUp)}</strong></div>
    </div>
    <p className="helper">School-level totals do not imply that an individual teacher attended every training session, nor that training caused student proficiency changes.</p>
   </section>
   <section className="panel">
    <div className="panel-head"><h2><Users size={19}/> Teacher development comparison</h2></div>
    <div className="table-wrap"><table className="progress-unified-table">
     <thead><tr><th>Teacher</th><th>Classes</th><th>Competency reviews</th><th>Training units</th><th>Certificates</th><th>Implementation periods</th><th>Follow-ups</th></tr></thead>
     <tbody>{overview.teachers.map(t=><tr key={t.id}><td>{t.name}</td><td>{t.classes.join(", ")||"—"}</td>
      <td>{number(t.reviews)}</td><td>{number(t.trainingUnits)}</td><td>{number(t.certificates)}</td>
      <td>{number(t.implementationPeriods)}</td><td>{number(t.followUp)}</td></tr>)}</tbody>
    </table></div>
   </section>
  </>}
  {!loading&&mode==="teacher"&&overview&&<>
   <section className="panel">
    <div className="panel-head"><h2><Users size={19}/> Select a teacher</h2></div>
    <div className="two-col">
     <label>Teacher<select value={teacherId} onChange={e=>setTeacherId(e.target.value)}>
      <option value="">Choose a teacher</option>{overview.teachers.map(t=><option key={t.id} value={t.id}>
       {t.name}{t.classes.length?" · "+t.classes.join(", "):""}</option>)}</select></label>
     <label>Find teacher<input type="search" value={needle} onChange={e=>setNeedle(e.target.value)}
      placeholder="Search name or class"/></label>
    </div>
    {!teacherId&&<div className="progress-teacher-directory">
     {list.map(t=><button key={t.id} type="button" className="progress-teacher-choice" onClick={()=>setTeacherId(t.id)}>
      <strong>{t.name}</strong><small>{t.classes.join(", ")||"No class assignment"}
       {" · "}{number(t.reviews)} skill reviews{" · "}{number(t.implementationPeriods)} implementation periods</small>
     </button>)}
     {!list.length&&<p className="helper">No teachers match this search.</p>}
    </div>}
   </section>
   {loadingTeacher&&<p className="helper">Compiling selected teacher's assessment, training and classroom implementation evidence…</p>}
   {detail?.teacher&&<TeacherDetail teacher={detail.teacher}
    available={detail.available} competencies={competencies} byId={byId}/>}
  </>}
 </div>;
}
