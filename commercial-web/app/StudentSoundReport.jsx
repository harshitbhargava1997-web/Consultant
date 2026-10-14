"use client";
import {useEffect,useState} from "react";
import SoundProgressPanel from "./SoundProgressPanel";
import {usePhonicsCatalog} from "./PhonicsSoundPicker";
export default function StudentSoundReport({client,schoolId,student,competencies=[],enabled=true}){
 const [sessions,setSessions]=useState([]),[soundRows,setSoundRows]=useState([]);
 const [loading,setLoading]=useState(false),[error,setError]=useState("");
 const {byId,error:catalogError}=usePhonicsCatalog(client);
 useEffect(()=>{
  if(!enabled||!client||!student?.id||!student?.class_id||!schoolId){
   setSessions([]);setSoundRows([]);setError("");setLoading(false);return;
  }
  let active=true;setSessions([]);setSoundRows([]);setLoading(true);setError("");
  (async()=>{
   try{
    const [history,sounds]=await Promise.all([
     client.from("literacy_assessments")
      .select("id,assessment_date,created_at").eq("school_id",schoolId)
      .eq("class_id",student.class_id).eq("student_id",student.id)
      .eq("subject_type","student").order("assessment_date",{ascending:false})
      .order("created_at",{ascending:false}).limit(150),
     client.rpc("literacy_get_assessment_phonics",{
      p_school_id:schoolId,p_class_id:student.class_id,
      p_subject_type:"student",p_subject_id:student.id
     })
    ]);
    if(history.error||sounds.error)throw history.error||sounds.error;
    if(active){setSessions(history.data||[]);setSoundRows(sounds.data||[]);}
   }catch(e){if(active)setError("Sound observations could not be loaded: "+e.message);}
   finally{if(active)setLoading(false);}
  })();
  return()=>{active=false;};
 },[client,schoolId,student?.id,student?.class_id,enabled]);
 if(!student||!enabled)return null;
 return <div className="student-sound-report">
  {loading&&<p className="helper">Loading individual phonics history…</p>}
  {(error||catalogError)&&<p className="notice" role="status">{error||catalogError}</p>}
  {!loading&&!error&&<SoundProgressPanel sessions={sessions} soundRows={soundRows}
   competencies={competencies} itemById={byId}
   title="Individual phonics sound progress" subjectLabel="student"/>}
 </div>;
}
