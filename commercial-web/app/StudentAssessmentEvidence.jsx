"use client";
import {useEffect,useState} from "react";
import {Camera,Video} from "lucide-react";
export default function StudentAssessmentEvidence({session,schoolId,studentId,competencies=[]}){
 const [items,setItems]=useState([]),[loading,setLoading]=useState(false),[error,setError]=useState("");
 useEffect(()=>{
  if(!session?.access_token||!schoolId||!studentId){setItems([]);return;}
  let active=true;setItems([]);setError("");setLoading(true);
  fetch("/api/assessment-evidence?schoolId="+encodeURIComponent(schoolId)+"&studentId="+encodeURIComponent(studentId),{
   headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"
  }).then(async res=>{
   const data=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(data.error||"Could not load learner evidence.");
   return data.items||[];
  }).then(data=>{if(active)setItems(data);})
   .catch(e=>{if(active)setError(e.message);})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[session?.access_token,schoolId,studentId]);
 return <section className="student-media-report">
  <div className="panel-head"><h2><Camera size={18}/> Student competency photos & videos</h2></div>
  <p className="helper">Files are attached to the individual student's saved competency assessment. They are separate from general teacher classroom implementation evidence.</p>
  {loading&&<p className="helper">Loading student evidence…</p>}
  {error&&<p className="helper">Student evidence unavailable: {error}</p>}
  {!loading&&!error&&!items.length&&<p className="helper">No photos or videos attached to this student's assessments yet. Use Literacy Assessor → Assessment history to attach an optional competency demonstration.</p>}
  <div className="student-media-items">{items.map(item=>{
   const skill=competencies.find(c=>c.id===item.competency_id);
   return <div key={item.id} className="student-media-item">
    <strong>{skill?.title||"Archived competency"} <small>· {skill?.grade||"Previous"}</small></strong>
    {item.url&&item.content_type?.startsWith("image/")&&<a href={item.url} target="_blank" rel="noopener noreferrer"><img src={item.url} loading="lazy" alt={"Competency demonstration: "+item.file_name}/></a>}
    {item.url&&item.content_type?.startsWith("video/")&&<video controls preload="metadata" src={item.url}/>}
    <a href={item.url||"#"} target="_blank" rel="noopener noreferrer" aria-disabled={!item.url}
     onClick={e=>{if(!item.url)e.preventDefault();}}>{item.content_type?.startsWith("video/")?<Video size={13}/>:<Camera size={13}/>} {item.file_name}</a>
    <small>Added {new Date(item.created_at).toLocaleDateString("en-IN")}</small>
   </div>;
  })}</div>
  {items.length===150&&<p className="helper">Showing the latest 150 files. Older attachments remain in Literacy Assessor history.</p>}
 </section>;
}
