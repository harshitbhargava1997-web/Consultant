"use client";
import {useEffect,useMemo,useState} from "react";
import {BookOpen,CheckCircle2,ChevronDown,ClipboardCheck,FileText,GraduationCap,Medal,Play,Plus,RefreshCw,School,ShieldCheck,Trash2,Upload,Users,Video} from "lucide-react";
import {LEVELS} from "../lib/supabase";
const KINDS=[
 {id:"reading",label:"Reading lesson"},
 {id:"pdf",label:"PDF / handbook"},
 {id:"video",label:"Video demonstration"},
 {id:"mooc",label:"MOOC / external course"},
 {id:"exercise",label:"Knowledge-check quiz"},
 {id:"interactive",label:"Interactive practice"}
];
const ROLE_LABELS={owner:"School Owner",principal:"Principal",coordinator:"Coordinator",teacher:"Teacher",consultant:"Consultant"};
const ROLES=Object.keys(ROLE_LABELS);
const newCourse=()=>({title:"",description:"",grade:"All Grades",competencyId:"",
 targetRoles:["teacher","principal","coordinator","consultant","owner"],
 schoolIds:[],minutes:30,passPercent:70});
const newUnit=()=>({title:"",kind:"reading",description:"",externalUrl:"",content:"",
 filePath:"",questions:[{prompt:"",options:["","","",""],correctIndex:0}]});
const d=()=>{const x=new Date();return [x.getFullYear(),String(x.getMonth()+1).padStart(2,"0"),String(x.getDate()).padStart(2,"0")].join("-");};
function nameOf(role){return ROLE_LABELS[role]||role;}
async function api(session,schoolId,action,fields={}){
 const res=await fetch("/api/training?schoolId="+encodeURIComponent(schoolId||""),{
  method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
  body:JSON.stringify({action,...fields}),cache:"no-store"
 });
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(data.error||"Training operation failed.");
 return data;
}
function toggle(list,value){return list.includes(value)?list.filter(x=>x!==value):[...list,value];}
export default function TrainingWorkspace({
 session,client,schoolId,schoolName,schools=[],competencies=[],isAdmin=false,grants=[]
}){
 const can=key=>isAdmin||grants.includes(key);
 const [data,setData]=useState({courses:[],units:[],progress:[],certificates:[],review:[],sessions:[],trainingStaff:[]});
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [tab,setTab]=useState(isAdmin?"publish":"learn");
 const [newCourseForm,setNewCourseForm]=useState(newCourse);
 const [courseId,setCourseId]=useState(""),[editCourseId,setEditCourseId]=useState("");
 const [unitForm,setUnitForm]=useState(newUnit),[uploadFile,setUploadFile]=useState(null);
 const [answers,setAnswers]=useState({});
 const [sessionForm,setSessionForm]=useState({courseId:"",heldOn:d(),attendeeCount:0,attendeeIds:[],notes:"",nextAction:""});
 const [reviewFilter,setReviewFilter]=useState("");
 const selectedCourse=data.courses.find(c=>c.id===courseId);
 const draft=data.courses.find(c=>c.id===editCourseId);
 const relevantCourses=data.courses.filter(c=>c.status==="published"&&(!schoolId||c.school_ids.includes(schoolId)));
 const selectedUnits=data.units.filter(u=>u.course_id===selectedCourse?.id);
 const draftUnits=data.units.filter(u=>u.course_id===draft?.id);
 const progressMap=new Map(data.progress.map(p=>[p.unit_id,p]));
 const certMap=new Map(data.certificates.map(p=>[p.course_id,p]));
 const sections=[
  ...(isAdmin?[{id:"publish",name:"Super Admin · Course publishing"}]:[]),
  ...(can("training.access")?[{id:"learn",name:"My learning"}]:[]),
  ...(can("training.deliver")&&schoolId?[{id:"sessions",name:"Training sessions"}]:[]),
  ...(can("training.review")&&schoolId?[{id:"review",name:"School training report"}]:[])
 ];
 async function load(){
  setLoading(true);setMessage("");
  try{
   const res=await fetch("/api/training?schoolId="+encodeURIComponent(schoolId||""),{
    headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"
   });
   const json=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(json.error||"Cannot load the course library.");
   setData(json);
   setCourseId(old=>json.courses.some(c=>c.id===old)?old:
    json.courses.find(c=>c.status==="published"&&(!schoolId||c.school_ids.includes(schoolId)))?.id||"");
   setEditCourseId(old=>json.courses.some(c=>c.id===old)?old:json.courses.find(c=>c.status==="draft")?.id||"");
  }catch(e){setMessage(e.message);}finally{setLoading(false);}
 }
 useEffect(()=>{let active=true;setLoading(true);
  fetch("/api/training?schoolId="+encodeURIComponent(schoolId||""),{
   headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"
  }).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Unable to load training.");return j;})
   .then(j=>{if(active){setData(j);setCourseId(old=>j.courses.some(c=>c.id===old)?old:
    j.courses.find(c=>c.status==="published")?.id||"");
    setEditCourseId(old=>j.courses.some(c=>c.id===old)?old:j.courses.find(c=>c.status==="draft")?.id||"");setLoading(false);}})
   .catch(e=>{if(active){setMessage(e.message);setLoading(false);}});
  return()=>{active=false;};
 },[session?.access_token,schoolId]);
 useEffect(()=>{setTab(isAdmin?"publish":"learn");setAnswers({});},[schoolId,isAdmin]);
 async function execute(action,payload={},after){
  setBusy(true);setMessage("");
  try{
   const result=await api(session,schoolId,action,payload);
   if(after)await after(result);
   await load();setMessage(result.message||"Saved successfully.");
   return result;
  }catch(e){setMessage(e.message);}
  finally{setBusy(false);}
  return null;
 }
 async function create(e){
  e.preventDefault();
  const r=await execute("createCourse",newCourseForm);
  if(r?.course){setEditCourseId(r.course.id);setNewCourseForm(newCourse());setUnitForm(newUnit());}
 }
 async function addUnit(e){
  e.preventDefault();if(!editCourseId)return;
  setBusy(true);setMessage("");
  try{
   let filePath=unitForm.filePath;
   if(uploadFile){
    const ticket=await api(session,schoolId,"uploadTicket",{
     courseId:editCourseId,mimeType:uploadFile.type,size:uploadFile.size
    });
    const {error:uploadError}=await client.storage.from("vision-training")
     .uploadToSignedUrl(ticket.path,ticket.token,uploadFile,{contentType:uploadFile.type});
    if(uploadError)throw uploadError;
    filePath=ticket.path;
   }
   const body={...unitForm,courseId:editCourseId,filePath,
    sequence:draftUnits.length+1,
    questions:["exercise","interactive"].includes(unitForm.kind)?unitForm.questions:[]};
   const result=await api(session,schoolId,"saveUnit",body);
   setUnitForm(newUnit());setUploadFile(null);await load();setMessage(result.message);
  }catch(e){setMessage("Resource not saved: "+e.message);}
  finally{setBusy(false);}
 }
 const completed=selectedUnits.filter(u=>progressMap.has(u.id));
 const percent=selectedUnits.length?Math.round(100*completed.length/selectedUnits.length):0;
 function questionChange(index,key,value){
  setUnitForm(u=>({...u,questions:u.questions.map((q,i)=>i===index?{...q,[key]:value}:q)}));
 }
 function optionChange(index,choice,value){
  setUnitForm(u=>({...u,questions:u.questions.map((q,i)=>i===index?{
   ...q,options:q.options.map((o,j)=>j===choice?value:o)}:q)}));
 }
 function changeAnswer(unitId,index,choice){
  setAnswers(prev=>({...prev,[unitId]:{
   ...(prev[unitId]||{}),[index]:Number(choice)
  }}));
 }
 function submitExercise(unit){
  const selections=answers[unit.id]||{};
  const answerArray=unit.questions.map((_,index)=>selections[index]);
  if(answerArray.some(x=>x===undefined)){setMessage("Answer every question before submitting.");return;}
  execute("completeUnit",{unitId:unit.id,answers:answerArray});
 }
 const schoolParticipants=(data.review||[]).filter(p=>
  p.name.toLowerCase().includes(reviewFilter.toLowerCase())||p.role.includes(reviewFilter.toLowerCase()));
 return <div className="training-module">
  <section className="panel">
   <div className="panel-head"><h2><GraduationCap size={20}/> Teacher Training & Certification</h2>
    <span className="eyebrow">{isAdmin?"COURSE DEPLOYMENT":"PROFESSIONAL DEVELOPMENT"}</span></div>
   <p className="helper">Competency-based learning for teachers and school stakeholders. Study course material, practise with exercises, earn certificates and connect training evidence with students' literacy assessment progress.</p>
   <div className="training-stats">
    <div><small>Published courses</small><strong>{data.courses.filter(c=>c.status==="published").length}</strong></div>
    <div><small>My completed units</small><strong>{data.progress.length}</strong></div>
    <div><small>Certificates earned</small><strong>{data.certificates.length}</strong></div>
   </div>
   <div className="management-tabs" role="group" aria-label="Training sections">
    {sections.map(item=><button type="button" key={item.id} aria-pressed={tab===item.id}
     className={"management-tab "+(tab===item.id?"active":"")}
     onClick={()=>{setTab(item.id);setMessage("");}}>{item.name}</button>)}
   </div>
  </section>
  {message&&<div className="notice" role="status">{message}</div>}
  {loading&&<p className="helper">Loading training content…</p>}
  {tab==="publish"&&isAdmin&&<>
   <section className="panel">
    <div className="panel-head"><h2><Plus size={18}/> Publish a new training programme</h2></div>
    <p className="helper">Super Admin creates the course, links a competency if relevant, chooses schools and stakeholders, adds resources and publishes when ready.</p>
    <form className="stack" onSubmit={create}>
     <label>Course / module title<input required maxLength={180} minLength={4}
      placeholder="Phonics: VC blending & early reading" value={newCourseForm.title}
      onChange={e=>setNewCourseForm({...newCourseForm,title:e.target.value})}/></label>
     <label>Learning objectives / description<textarea maxLength={3000} rows={3}
      placeholder="What will teachers understand and demonstrate after the training?"
      value={newCourseForm.description} onChange={e=>setNewCourseForm({...newCourseForm,description:e.target.value})}/></label>
     <div className="three-col">
      <label>Target grade<select value={newCourseForm.grade} onChange={e=>setNewCourseForm({...newCourseForm,grade:e.target.value})}>
       {["All Grades",...LEVELS].map(g=><option key={g} value={g}>{g}</option>)}</select></label>
      <label>Link to literacy competency<select value={newCourseForm.competencyId} onChange={e=>setNewCourseForm({...newCourseForm,competencyId:e.target.value})}>
       <option value="">General training (no single competency)</option>
       {competencies.map(c=><option key={c.id} value={c.id}>{c.grade} · {c.title}</option>)}</select></label>
      <label>Duration (minutes)<input type="number" min={1} max={2000} value={newCourseForm.minutes}
       onChange={e=>setNewCourseForm({...newCourseForm,minutes:Number(e.target.value)})}/></label>
     </div>
     <label>Required quiz score (%)<input type="number" min={0} max={100}
      value={newCourseForm.passPercent} onChange={e=>setNewCourseForm({...newCourseForm,passPercent:Number(e.target.value)})}/></label>
     <div className="two-col">
      <div><strong className="training-label">Publish to schools</strong>
       <div className="training-options">{schools.map(s=><label key={s.id} className="manage-check">
        <input type="checkbox" checked={newCourseForm.schoolIds.includes(s.id)}
         onChange={()=>setNewCourseForm({...newCourseForm,schoolIds:toggle(newCourseForm.schoolIds,s.id)})}/>
        <span><strong>{s.name}</strong></span></label>)}</div></div>
      <div><strong className="training-label">Who can take this training?</strong>
       <div className="training-options">{ROLES.map(r=><label key={r} className="manage-check">
        <input type="checkbox" checked={newCourseForm.targetRoles.includes(r)}
         onChange={()=>setNewCourseForm({...newCourseForm,targetRoles:toggle(newCourseForm.targetRoles,r)})}/>
        <span><strong>{nameOf(r)}</strong></span></label>)}</div></div>
     </div>
     <button type="submit" className="btn primary" disabled={busy||!newCourseForm.schoolIds.length||!newCourseForm.targetRoles.length}>
      <Plus size={16}/> Create course draft
     </button>
    </form>
   </section>
   <section className="panel">
    <div className="panel-head"><h2><BookOpen size={18}/> Course library & content editor</h2></div>
    <label>Choose course to edit<select value={editCourseId} onChange={e=>{setEditCourseId(e.target.value);setUnitForm(newUnit());setUploadFile(null);}}>
     <option value="">Select a course</option>{data.courses.map(c=><option key={c.id} value={c.id}>
      {c.title} · {c.status}</option>)}</select></label>
    {draft&&<div className="training-course-detail">
     <div className="training-course-head"><h3>{draft.title}</h3><span>{draft.status==="published"?"Published":"Draft"}</span></div>
     <p className="helper">{draft.description||"Add materials that help teachers demonstrate the selected learning objective."}</p>
     <p className="helper">Schools: {schools.filter(s=>draft.school_ids.includes(s.id)).map(s=>s.name).join(", ")||"None"} · Audience: {draft.target_roles.map(nameOf).join(", ")}</p>
     <div className="training-unit-list">{draftUnits.map(u=><div className="training-unit-line" key={u.id}>
      <span><strong>{u.sequence}. {u.title}</strong><small>{KINDS.find(t=>t.id===u.kind)?.label}</small></span>
      {draft.status==="draft"&&<button type="button" className="btn outline" disabled={busy} onClick={()=>{
       if(window.confirm("Remove this draft unit?"))execute("deleteUnit",{courseId:draft.id,unitId:u.id});
      }}><Trash2 size={15}/> Remove</button>}</div>)}</div>
     {draft.status==="draft"&&<>
      <form className="training-unit-form" onSubmit={addUnit}>
       <h3>Add learning material</h3>
       <div className="two-col">
        <label>Format<select value={unitForm.kind}
         onChange={e=>{setUnitForm({...newUnit(),kind:e.target.value});setUploadFile(null);}}>
         {KINDS.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
        <label>Resource title<input required minLength={3} maxLength={180} value={unitForm.title}
         onChange={e=>setUnitForm({...unitForm,title:e.target.value})}/></label>
       </div>
       <label>Learning purpose / instructions<textarea rows={2} maxLength={3000}
        value={unitForm.description} onChange={e=>setUnitForm({...unitForm,description:e.target.value})}/></label>
       {["reading","exercise","interactive"].includes(unitForm.kind)&&<label>
        {unitForm.kind==="reading"?"Reading lesson": "Explanation or teacher activity (optional)"}
        <textarea rows={5} maxLength={30000} value={unitForm.content}
         onChange={e=>setUnitForm({...unitForm,content:e.target.value})}
         placeholder="Demonstrations, scripts, reading practice, interactive instructions…"/></label>}
       {["pdf","video","mooc"].includes(unitForm.kind)&&<label>Link to PDF, video or MOOC (HTTPS)
        <input type="url" maxLength={1500} value={unitForm.externalUrl} placeholder="https://..."
         onChange={e=>setUnitForm({...unitForm,externalUrl:e.target.value})}/></label>}
       {["pdf","video"].includes(unitForm.kind)&&<label>Or upload your own PDF / video (maximum 50 MB)
        <input type="file" accept={unitForm.kind==="pdf"?"application/pdf": "video/mp4,video/webm,video/quicktime"}
         onChange={e=>setUploadFile(e.target.files?.[0]||null)}/></label>}
       {["exercise","interactive"].includes(unitForm.kind)&&<div className="training-questions">
        <h3>Interactive multiple-choice practice</h3>
        {unitForm.questions.map((q,index)=><div key={index} className="training-question-editor">
         <label>Question {index+1}<input maxLength={400} value={q.prompt}
          onChange={e=>questionChange(index,"prompt",e.target.value)} placeholder="What should a child do first when blending VC sounds?"/></label>
         {q.options.map((opt,i)=><label key={i}>Option {i+1}<input maxLength={250} value={opt}
          onChange={e=>optionChange(index,i,e.target.value)}/></label>)}
         <label>Correct answer<select value={q.correctIndex} onChange={e=>questionChange(index,"correctIndex",Number(e.target.value))}>
          {q.options.map((_,i)=><option key={i} value={i}>Option {i+1}</option>)}</select></label>
        </div>)}
        {unitForm.questions.length<12&&<button className="btn outline" type="button" onClick={()=>setUnitForm(f=>({...f,questions:[...f.questions,{prompt:"",options:["","","",""],correctIndex:0}]}))}><Plus size={15}/> Add question</button>}
       </div>}
       <button type="submit" className="btn primary" disabled={busy}>
        <Upload size={16}/>{busy?"Uploading / saving…":"Save learning unit"}</button>
      </form>
      <button type="button" className="btn primary" disabled={busy||!draftUnits.length} onClick={()=>{
       if(window.confirm("Publish this training course to the selected schools and stakeholder roles? Published content is locked."))execute("publishCourse",{courseId:draft.id});
      }}><CheckCircle2 size={16}/> Publish course to schools</button>
     </>}
     {draft.status==="published"&&<p className="helper">Published course content is locked to preserve the training and certification history. Create a new version for revisions.</p>}
    </div>}
   </section>
  </>}
  {tab==="learn"&&can("training.access")&&<>
   <section className="panel">
    <div className="panel-head"><h2><BookOpen size={18}/> My assigned learning programmes</h2></div>
    {!schoolId&&!isAdmin&&<p className="helper">Choose your assigned school first.</p>}
    <label>Select published training<select value={courseId} onChange={e=>{setCourseId(e.target.value);setAnswers({});}}>
     <option value="">Choose training programme</option>
     {relevantCourses.map(c=><option key={c.id} value={c.id}>{c.title} · {c.grade}</option>)}
    </select></label>
    {!relevantCourses.length&&<p className="helper">No training has been published to your selected school and role yet.</p>}
    {selectedCourse&&<div className="training-course-detail">
     <div className="training-course-head"><h3>{selectedCourse.title}</h3>
      <span>{selectedCourse.grade} · {selectedCourse.estimated_minutes} min</span></div>
     <p className="helper">{selectedCourse.description}</p>
     <div className="training-progress-summary"><strong>{completed.length} / {selectedUnits.length} learning units complete</strong>
      <div className="progress-bar"><span style={{width:percent+"%"}}/></div><strong>{percent}%</strong></div>
     {certMap.get(selectedCourse.id)&&<div id="training-certificate" className="training-certificate">
      <Medal size={30}/><span>VISION SCHOOL PLATFORM</span><h2>Certificate of Completion</h2>
      <p>This certifies that</p><h3>{data.learnerName||"Programme participant"}</h3><p>has completed</p><h3>{selectedCourse.title}</h3><p>School: {schoolName||"Vision Partner School"}</p>
      <p>Successfully completed with required practice and assessment</p>
      <small>Certificate ID: {certMap.get(selectedCourse.id).code}</small>
      <small>Issued: {new Date(certMap.get(selectedCourse.id).issued_at).toLocaleDateString("en-IN")}</small>
      <button className="btn outline certificate-print" type="button" onClick={()=>window.print()}>Print / save as PDF</button>
     </div>}
     <div className="training-lessons">
      {selectedUnits.map((unit,index)=>{const done=progressMap.get(unit.id),isQuiz=["exercise","interactive"].includes(unit.kind);
       return <article className="training-lesson" key={unit.id}>
        <div className="training-lesson-heading">
         <div><strong>{index+1}. {unit.title}</strong><small>{KINDS.find(x=>x.id===unit.kind)?.label}</small></div>
         {done?<span className="training-done"><CheckCircle2 size={14}/> Complete{done.quiz_percent!==null?" · "+done.quiz_percent+"%":""}</span>:<span className="eyebrow">TO DO</span>}
        </div>
        {unit.description&&<p className="helper">{unit.description}</p>}
        {unit.content&&<div className="training-reading">{unit.content}</div>}
        {unit.resource_url&&<div className="training-material">
         {unit.kind==="video"&&<video controls preload="metadata" src={unit.resource_url} style={{maxWidth:"100%",width:610,borderRadius:10}}/>}
         {unit.kind!=="video"&&<a href={unit.resource_url} target="_blank" rel="noopener noreferrer" className="btn outline">
          {unit.kind==="pdf"?<FileText size={16}/>:<Play size={16}/>} Open {unit.kind==="pdf"?"PDF":unit.kind==="mooc"?"MOOC":"resource"}</a>}
         {unit.kind==="video"&&<a className="helper" target="_blank" rel="noopener noreferrer" href={unit.resource_url}>Open video in another tab</a>}
        </div>}
        {isQuiz&&<div className="training-learner-questions">
         {unit.questions.map((q,i)=><fieldset key={i}><legend>{i+1}. {q.prompt}</legend>
          {q.options.map((option,j)=><label key={j} className="training-answer">
           <input type="radio" name={"q-"+unit.id+"-"+i} checked={answers[unit.id]?.[i]===j}
            onChange={()=>changeAnswer(unit.id,i,j)} disabled={!!done||busy}/>{option}</label>)}
         </fieldset>)}
        </div>}
        {can("training.complete")&&!done&&<button className="btn primary" type="button" disabled={busy}
         onClick={()=>isQuiz?submitExercise(unit):execute("completeUnit",{unitId:unit.id})}>
          {isQuiz?<ClipboardCheck size={16}/>:<CheckCircle2 size={16}/>}
          {isQuiz?"Submit exercise":"I have completed this learning unit"}
        </button>}
       </article>;
      })}
     </div>
     {selectedUnits.length===0&&<p className="helper">No learning units have been published yet.</p>}
    </div>}
   </section>
  </>}
  {tab==="sessions"&&can("training.deliver")&&schoolId&&<>
   <section className="panel">
    <div className="panel-head"><h2><Users size={18}/> Deliver a school training session</h2></div>
    <p className="helper">Consultants and authorized school leaders can record a facilitated workshop, demonstration or coaching session. Attendance records are distinct from individual learner completion.</p>
    <form className="stack" onSubmit={e=>{e.preventDefault();execute("logSession",sessionForm,()=>{
     setSessionForm({courseId:"",heldOn:d(),attendeeCount:0,attendeeIds:[],notes:"",nextAction:""});
    });}}>
     <label>Training programme<select required value={sessionForm.courseId}
      onChange={e=>setSessionForm({...sessionForm,courseId:e.target.value})}>
      <option value="">Choose programme</option>{relevantCourses.map(c=><option value={c.id} key={c.id}>{c.title}</option>)}</select></label>
     <div className="two-col">
      <label>Date held<input type="date" max={d()} required value={sessionForm.heldOn}
       onChange={e=>setSessionForm({...sessionForm,heldOn:e.target.value})}/></label>
      <label>Attendees (count)<input type="number" min={0} max={10000} value={sessionForm.attendeeCount}
       onChange={e=>setSessionForm({...sessionForm,attendeeCount:Number(e.target.value)})}/></label>
     </div>
     <div><strong className="training-label">Teachers attending (optional individual attendance record)</strong>
      <div className="training-options">
       {(data.trainingStaff||[]).map(t=><label key={t.user_id} className="manage-check">
        <input type="checkbox" checked={sessionForm.attendeeIds.includes(t.user_id)}
         onChange={()=>setSessionForm(f=>({...f,attendeeIds:toggle(f.attendeeIds,t.user_id)}))}/>
        <span><strong>{t.display_name||"School teacher"}</strong></span>
       </label>)}
      </div><p className="helper">Tick individual participants when known. If attendees are selected, the individual count overrides the manual count. Attendance alone does not award a completion certificate.</p>
     </div>
     <label>Training observations<textarea rows={3} maxLength={4000} value={sessionForm.notes}
      onChange={e=>setSessionForm({...sessionForm,notes:e.target.value})}/></label>
     <label>Teaching support / follow-up agreed<textarea rows={3} maxLength={2000} value={sessionForm.nextAction}
      onChange={e=>setSessionForm({...sessionForm,nextAction:e.target.value})}/></label>
     <button className="btn primary" disabled={busy||!sessionForm.courseId} type="submit">Record training session</button>
    </form>
   </section>
   <section className="panel"><div className="panel-head"><h2>Recent training sessions</h2></div>
    <div className="rows">{(data.sessions||[]).map(s=><div key={s.id} className="record">
     <Users size={17}/><strong>{data.courses.find(c=>c.id===s.course_id)?.title||"Course"}</strong>
     <small>{s.held_on} · {s.attendee_count} attendees</small>
     {s.next_action&&<small>Follow-up: {s.next_action}</small>}
    </div>)}</div>
    {!data.sessions?.length&&<p className="helper">No facilitated sessions have been recorded.</p>}
   </section>
  </>}
  {tab==="review"&&can("training.review")&&schoolId&&<section className="panel">
   <div className="panel-head"><h2><ShieldCheck size={18}/> School staff training progress</h2></div>
   <p className="helper">Review staff participation, unit completion and certificates for the selected school. This is not an export and does not show private login credentials.</p>
   <label>Find staff member<input type="search" value={reviewFilter} onChange={e=>setReviewFilter(e.target.value)}
    placeholder="Search by name or role"/></label>
   <div className="table-wrap"><table><thead><tr><th>Stakeholder</th><th>Role</th><th>Completed units</th><th>Certificates</th><th>Training sessions attended</th><th>Average quiz score</th><th>Course status</th></tr></thead>
    <tbody>{schoolParticipants.map(p=><tr key={p.user_id}>
     <td>{p.name}</td><td>{nameOf(p.role)}</td>
     <td>{p.units_completed}</td><td>{p.certificates}</td><td>{p.attended_sessions||0}</td><td>{p.average_quiz_score===null?"—":p.average_quiz_score+"%"}</td>
     <td>{p.courses.map(c=>c.title+": "+c.units_completed+"/"+c.units_total+(c.certified?" certified":"")).join(" · ")||"No assigned courses"}</td>
    </tr>)}</tbody></table></div>
   {!schoolParticipants.length&&<p className="helper">No matching staff members or training records.</p>}
  </section>}
 </div>;
}
