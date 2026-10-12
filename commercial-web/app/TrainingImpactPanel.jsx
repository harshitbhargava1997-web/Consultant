"use client";
import {useEffect,useState} from "react";
import {BookOpen,GraduationCap,Medal,TrendingUp,Users} from "lucide-react";
export default function TrainingImpactPanel({session,schoolId,studentId,enabled=true}){
 const [report,setReport]=useState(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!enabled||!studentId||!schoolId||!session?.access_token){setReport(null);return;}
  let active=true;setReport(null);setError("");setLoading(true);
  fetch("/api/training?schoolId="+encodeURIComponent(schoolId)+
   "&action=studentOutcome&studentId="+encodeURIComponent(studentId),{
   headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"
  }).then(async res=>{
   const data=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(data.error||"Training evidence unavailable.");
   return data.outcome;
  }).then(outcome=>{if(active)setReport(outcome);})
   .catch(e=>{if(active)setError(e.message);})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[session?.access_token,schoolId,studentId,enabled]);
 if(!studentId||!enabled)return null;
 return <section className="training-impact">
  <div className="panel-head"><h2><GraduationCap size={18}/> Teacher development & student outcomes</h2></div>
  <p className="helper">This section connects teachers' completed training, professional development sessions and recorded student assessments. It does not treat attendance as proof of teaching proficiency or attribute learning gains to a course.</p>
  {loading&&<p className="helper">Loading training evidence…</p>}
  {error&&<p className="helper">Training evidence cannot be displayed: {error}</p>}
  {report&&<>
   <h3>Assigned teachers & their training</h3>
   {report.teachers.length?report.teachers.map((teacher,i)=><div className="training-impact-teacher" key={i}>
    <strong><Users size={15}/> {teacher.name}</strong>
    {!teacher.courses.length?<p className="helper">No published training matched to this student's grade.</p>:
    <div className="training-impact-courses">{teacher.courses.map((course,j)=>
     <div key={j}><BookOpen size={15}/>
      <span><strong>{course.title}</strong><small>{course.units_completed}/{course.units_total} training units completed
       {course.certified?" · Certified":""}</small></span>
      {course.certified&&<Medal size={16}/>}</div>)}</div>}
   </div>):<p className="helper">No class teacher assignments are recorded yet.</p>}
   <h3><TrendingUp size={17}/> Dated learner competency assessments</h3>
   {report.assessments.length?<div className="training-impact-timeline">
    {report.assessments.map((a,i)=><div key={i}>
     <strong>{a.date}</strong><span>{a.stage} · {a.assessor_role}</span>
     <small>{a.independent} independent out of {a.observed} observed skill ratings</small>
    </div>)}
   </div>:<p className="helper">No recorded learner assessment sessions for this student.</p>}
   <h3>School training delivery evidence</h3>
   {report.sessions.length?<p className="helper">{report.sessions.length} recent facilitated sessions relate to training assigned to this grade. Session attendance is school-level evidence, not proof that an individual teacher attended.</p>:
    <p className="helper">No corresponding facilitated sessions logged yet.</p>}
  </>}
 </section>;
}
