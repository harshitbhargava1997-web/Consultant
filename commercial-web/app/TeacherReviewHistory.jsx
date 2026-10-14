"use client";
import {useEffect,useState} from "react";
import {BookOpen,Clock3} from "lucide-react";
import {soundLabel} from "./PhonicsSoundPicker";
export default function TeacherReviewHistory({client,schoolId,classId,teacherId,itemById={},version=0}){
 const [history,setHistory]=useState([]),[soundRows,setSoundRows]=useState([]);
 const [error,setError]=useState(""),[loading,setLoading]=useState(false);
 useEffect(()=>{
  if(!client||!schoolId||!classId||!teacherId){setHistory([]);setSoundRows([]);return;}
  let active=true;setLoading(true);setError("");
  (async()=>{
   try{
    const [assessments,sounds]=await Promise.all([
     client.from("literacy_assessments").select("id,assessment_date,notes,created_at")
      .eq("school_id",schoolId).eq("class_id",classId).eq("subject_type","teacher").eq("teacher_user_id",teacherId)
      .order("assessment_date",{ascending:false}).order("created_at",{ascending:false}).limit(10),
     client.rpc("literacy_get_assessment_phonics",{p_school_id:schoolId,p_class_id:classId,
      p_subject_type:"teacher",p_subject_id:teacherId})
    ]);
    if(assessments.error||sounds.error)throw assessments.error||sounds.error;
    if(active){setHistory(assessments.data||[]);setSoundRows(sounds.data||[]);}
   }catch(e){if(active){setError(e.message);setHistory([]);setSoundRows([]);}}
   finally{if(active)setLoading(false);}
  })();
  return()=>{active=false;};
 },[client,schoolId,classId,teacherId,version]);
 if(!teacherId)return null;
 return <section className="teacher-sound-review-history">
  <h3><Clock3 size={17}/> Dated teacher review history</h3>
  <p className="helper">What exact sounds and phonics patterns did the teacher demonstrate in each observation? Older assessments without individual sounds remain intact.</p>
  {loading&&<p className="helper">Loading previous teacher evaluations…</p>}
  {error&&<p className="notice" role="status">Teacher history unavailable: {error}</p>}
  {!loading&&!history.length&&<p className="helper">No previous teacher reviews for this class.</p>}
  {history.map(record=>{
   const details=soundRows.filter(row=>row.assessment_id===record.id);
   return <div className="teacher-history-entry" key={record.id}>
    <strong><BookOpen size={15}/> {new Date(record.assessment_date+"T00:00:00").toLocaleDateString("en-IN")}</strong>
    {record.notes&&<p>{record.notes}</p>}
    {details.length?<div className="teacher-history-sounds">
     {details.map(row=><span key={row.competency_id+"-"+row.item_id}>
      {itemById[row.item_id]?soundLabel(itemById[row.item_id]):"Archived sound"} — <b>{row.rating}</b>
     </span>)}</div>:<small>Broad competency rating only; individual sounds were not captured.</small>}
   </div>;
  })}
 </section>;
}
