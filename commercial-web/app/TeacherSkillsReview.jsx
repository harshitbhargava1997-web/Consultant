"use client";
import {useEffect,useMemo,useState} from "react";
import {ArrowRight,ClipboardCheck,GraduationCap} from "lucide-react";
import {LEVELS,RATINGS} from "../lib/supabase";
import PhonicsSoundPicker,{PhonicsStructurePreview,usePhonicsCatalog,soundDetailPayload} from "./PhonicsSoundPicker";
import TeacherReviewHistory from "./TeacherReviewHistory";

export default function TeacherSkillsReview({client,schoolId,classes=[],members=[],teacherClasses=[],competencies=[],onSaved}){
 const {byCompetency,byId,error:catalogError}=usePhonicsCatalog(client);
 const [classId,setClassId]=useState(""),[teacherId,setTeacherId]=useState("");
 const [ratings,setRatings]=useState({}),[soundRatings,setSoundRatings]=useState({});
 const [notes,setNotes]=useState(""),[busy,setBusy]=useState(false);
 const [message,setMessage]=useState(""),[historyVersion,setHistoryVersion]=useState(0);
 const activeClass=classes.find(c=>c.id===classId)||classes[0];
 const teachers=useMemo(()=>members.filter(m=>m.role==="teacher"&&
  teacherClasses.some(tc=>tc.class_id===activeClass?.id&&tc.teacher_user_id===m.user_id)),
  [members,teacherClasses,activeClass?.id]);
 const gradeIndex=LEVELS.indexOf(activeClass?.grade);
 const skills=competencies.filter(c=>c.active&&
  LEVELS.indexOf(c.grade)>=0&&LEVELS.indexOf(c.grade)<=gradeIndex)
  .sort((a,b)=>LEVELS.indexOf(a.grade)-LEVELS.indexOf(b.grade)||a.sequence-b.sequence);
 const count=Object.values(ratings).filter(r=>r!=="Not Assessed").length;
 useEffect(()=>{
  setClassId("");setTeacherId("");setRatings({});setSoundRatings({});setNotes("");setMessage("");
 },[schoolId]);
 useEffect(()=>{
  setTeacherId("");setRatings({});setSoundRatings({});setNotes("");setMessage("");
 },[activeClass?.id]);
 async function submit(event){
  event.preventDefault();setMessage("");
  if(!teacherId||!activeClass){setMessage("Select an assigned teacher first.");return;}
  const rows=Object.entries(ratings).filter(([,r])=>r!=="Not Assessed").map(([competency_id,rating])=>({
   competency_id,rating,evidence_notes:"",
   sound_items:soundDetailPayload(soundRatings[competency_id])
  }));
  if(!rows.length){setMessage("Assess at least one competency.");return;}
  if(catalogError){setMessage("The sound library must load before you can submit: "+catalogError);return;}
  const missing=rows.filter(r=>(byCompetency[r.competency_id]||[]).length&&!r.sound_items.length);
  if(missing.length){
   const names=missing.slice(0,4).map(r=>competencies.find(c=>c.id===r.competency_id)?.title||"Phonics competency");
   setMessage("Choose and rate at least one demonstrated sound for: "+names.join(", "));return;
  }
  if(!window.confirm("Save the teacher's "+rows.length+" observed competency ratings and detailed sounds?"))return;
  setBusy(true);
  try{
   const {data,error}=await client.rpc("literacy_submit_detailed_assessment",{
    p_school_id:schoolId,p_class_id:activeClass.id,p_subject_type:"teacher",
    p_subject_id:teacherId,p_assessment_date:new Date().toLocaleDateString("en-CA"),
    p_stage:"periodic",p_notes:notes.trim(),p_next_action:"",p_results:rows
   });
   if(error)throw error;
   if(!data)throw Error("The review did not return a saved assessment ID.");
   setRatings({});setSoundRatings({});setNotes("");setHistoryVersion(v=>v+1);
   setMessage("Teacher skills review saved with exact observed sound ratings.");
   if(onSaved)await onSaved();
  }catch(e){setMessage("Teacher review could not be saved: "+e.message);}
  finally{setBusy(false);}
 }
 return <section className="panel">
  <div className="panel-head"><h2><GraduationCap size={19}/> Teacher Skills Review</h2><span className="eyebrow">OBSERVED SKILL EVIDENCE</span></div>
  <p className="helper">Choose a school teacher and the competencies they can demonstrate. For phonics, record exactly which letters, sounds, actions, blends, digraphs or diphthongs were observed. Never infer performance for patterns you have not checked.</p>
  {!classes.length?<p className="helper">Create a class and assign a teacher before reviewing teaching skills.</p>:<>
   <div className="two-col">
    <label>Class / section<select value={activeClass?.id||""} onChange={e=>setClassId(e.target.value)}>
     {classes.map(c=><option key={c.id} value={c.id}>{c.grade} · {c.section} · {c.academic_year}</option>)}</select></label>
    <label>Teacher<select required value={teacherId} onChange={e=>{setTeacherId(e.target.value);setRatings({});setSoundRatings({});}}>
     <option value="">Choose an assigned teacher</option>
     {teachers.map(t=><option key={t.user_id} value={t.user_id}>{t.display_name||"Teacher"}</option>)}
    </select></label>
   </div>
   {!teachers.length&&<p className="helper">No teacher assignments for this class. Use User Management → Teachers & Staff.</p>}
   <form onSubmit={submit} className="stack">
    <div className="skills-head"><h3>Nursery through {activeClass?.grade} competencies</h3>
     <span>{skills.length} available · {count} rated</span></div>
    {skills.map(c=><div key={c.id} className="teacher-phonics-skill">
     <div className="skill"><div><small>{c.grade} · {c.code}</small><strong>{c.title}</strong>
      {c.description&&<p>{c.description}</p>}</div>
      <select aria-label={"Overall teacher rating for "+c.title} value={ratings[c.id]||"Not Assessed"}
       disabled={busy} onChange={e=>{
        setRatings(v=>({...v,[c.id]:e.target.value}));
        if(e.target.value==="Not Assessed")setSoundRatings(v=>({...v,[c.id]:{}}));
       }}>{RATINGS.map(r=><option key={r} value={r}>{r}</option>)}</select></div>
     {(byCompetency[c.id]||[]).length>0&&(!ratings[c.id]||ratings[c.id]==="Not Assessed")&&
      <PhonicsStructurePreview items={byCompetency[c.id]} personLabel="teacher"/>}
     {ratings[c.id]&&ratings[c.id]!=="Not Assessed"&&(byCompetency[c.id]||[]).length>0&&
      <PhonicsSoundPicker items={byCompetency[c.id]} value={soundRatings[c.id]||{}}
       onChange={value=>setSoundRatings(v=>({...v,[c.id]:value}))}
       disabled={busy} personLabel="teacher"/>}
    </div>)}
    <label>Observed strengths, gaps and next steps<textarea rows={3} maxLength={4000}
     value={notes} onChange={e=>setNotes(e.target.value)}
     placeholder="e.g. teacher correctly models the /t/ sound with a physical action; revisit /θ/ blending"/></label>
    <button className="btn primary" type="submit" disabled={busy||!teacherId||!count}>
     <ClipboardCheck size={16}/>{busy?"Saving review…":"Save teacher skill assessment"}
     <ArrowRight size={15}/>
    </button>
   </form>
   {message&&<p role="status" className="notice">{message}</p>}
   {catalogError&&<p role="status" className="notice">{catalogError}</p>}
   <TeacherReviewHistory client={client} schoolId={schoolId}
    classId={activeClass?.id} teacherId={teacherId} itemById={byId} competencies={competencies} version={historyVersion}/>
  </>}
 </section>;
}
