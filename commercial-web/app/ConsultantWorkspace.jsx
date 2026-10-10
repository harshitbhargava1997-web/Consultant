"use client";
import {useEffect,useState} from "react";
import {BookOpen,CalendarDays,CheckCircle2,ClipboardCheck,GraduationCap,Plus,School,Users} from "lucide-react";

const kinds=[
 {value:"school_visit",label:"School implementation visit"},
 {value:"teacher_training",label:"Professional development / training"},
 {value:"follow_up",label:"Review & follow-up"},
 {value:"classroom_support",label:"Classroom support / observation"}
];
const today=()=>new Date().toLocaleDateString("en-CA");
const newActivity=()=>({kind:"teacher_training",activityDate:today(),topic:"",durationMinutes:60,participantRoles:"Teachers",summary:"",nextAction:""});
async function api(session,method,path,body){
 const res=await fetch("/api/consultants"+path,{
  method,headers:{Authorization:"Bearer "+session.access_token,...(body?{"Content-Type":"application/json"}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),cache:"no-store"
 });
 const json=await res.json().catch(()=>({}));
 if(!res.ok)throw Error(json.error||"Request failed.");
 return json;
}
export function ConsultantManagement({session,schools}){
 const [roster,setRoster]=useState([]),[assignments,setAssignments]=useState([]);
 const [newPerson,setNewPerson]=useState({displayName:"",email:"",password:"",confirm:""});
 const [choice,setChoice]=useState({consultantId:"",schoolId:""});
 const [message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 async function reload(){
  const data=await api(session,"GET","");
  setRoster(data.consultants||[]);setAssignments(data.assignments||[]);
 }
 useEffect(()=>{let alive=true;api(session,"GET","").then(d=>{if(alive){setRoster(d.consultants||[]);setAssignments(d.assignments||[]);}}).catch(e=>{if(alive)setMessage(e.message);});return()=>{alive=false;};},[session?.access_token]);
 async function provision(e){
  e.preventDefault();
  if(newPerson.password!==newPerson.confirm){setMessage("Passwords must match.");return;}
  setBusy(true);setMessage("");
  try{
   const data=await api(session,"POST","",{action:"createConsultant",...newPerson});
   setMessage(data.message);setNewPerson({displayName:"",email:"",password:"",confirm:""});
   await reload();
  }catch(e){setMessage(e.message);}finally{setBusy(false);}
 }
 async function assign(e){
  e.preventDefault();setBusy(true);setMessage("");
  try{const data=await api(session,"POST","",{action:"assignConsultant",...choice});setMessage(data.message);await reload();}
  catch(e){setMessage(e.message);}finally{setBusy(false);}
 }
 async function unassign(consultantId,schoolId){
  if(!window.confirm("Remove this consultant from the school? Existing training records remain."))return;
  setBusy(true);setMessage("");
  try{const data=await api(session,"POST","",{action:"removeAssignment",consultantId,schoolId});setMessage(data.message);await reload();}
  catch(e){setMessage(e.message);}finally{setBusy(false);}
 }
 const nameFor=id=>roster.find(c=>c.user_id===id)?.display_name||"Consultant";
 const schoolFor=id=>schools.find(c=>c.id===id)?.name||"School";
 return <div>
  <div className="two-col">
   <section className="panel"><div className="panel-head"><h2>Create Consultant account</h2></div>
    <form className="stack" onSubmit={provision}>
     <label>Consultant full name<input required maxLength={160} value={newPerson.displayName} onChange={e=>setNewPerson({...newPerson,displayName:e.target.value})}/></label>
     <label>Consultant login email<input required type="email" value={newPerson.email} onChange={e=>setNewPerson({...newPerson,email:e.target.value})}/></label>
     <label>Initial password (new accounts)<input type="password" minLength={12} maxLength={128} value={newPerson.password} onChange={e=>setNewPerson({...newPerson,password:e.target.value})} autoComplete="new-password"/></label>
     <label>Confirm initial password<input type="password" minLength={12} maxLength={128} value={newPerson.confirm} onChange={e=>setNewPerson({...newPerson,confirm:e.target.value})} autoComplete="new-password"/></label>
     <p className="helper">A new account needs a strong initial password. For an existing login, leave both password fields blank; its password will remain unchanged. Share initial passwords privately.</p>
     <button className="btn primary" type="submit" disabled={busy}><Plus size={15}/> Register consultant</button>
    </form>
   </section>
   <section className="panel"><div className="panel-head"><h2>Assign Consultant to school</h2></div>
    <form className="stack" onSubmit={assign}>
     <label>Consultant<select required value={choice.consultantId} onChange={e=>setChoice({...choice,consultantId:e.target.value})}>
      <option value="">Choose Consultant</option>{roster.map(c=><option key={c.user_id} value={c.user_id}>{c.display_name}</option>)}
     </select></label>
     <label>School<select required value={choice.schoolId} onChange={e=>setChoice({...choice,schoolId:e.target.value})}>
      <option value="">Choose school</option>{schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
     </select></label>
     <button className="btn primary" type="submit" disabled={busy||!choice.consultantId||!choice.schoolId}>Assign school</button>
    </form>
   </section>
  </div>
  <section className="panel">
   <div className="panel-head"><h2>School assignments</h2><span className="eyebrow">{assignments.length} ACTIVE ASSIGNMENTS</span></div>
   {assignments.length?<div className="rows">{assignments.map(a=>
    <div className="record" key={a.consultant_user_id+":"+a.school_id}>
     <Users size={17}/><strong>{nameFor(a.consultant_user_id)}</strong>
     <small>{schoolFor(a.school_id)}</small>
     <button type="button" className="btn outline" disabled={busy} onClick={()=>unassign(a.consultant_user_id,a.school_id)}>Remove</button>
    </div>
   )}</div>:<p className="helper">No Consultants assigned yet. Register a Consultant and assign them to a school.</p>}
  </section>
  {message&&<div className="notice" role="status">{message}</div>}
 </div>;
}
export default function ConsultantWorkspace({session,schoolId,schoolName,isConsultant}){
 const [overview,setOverview]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [activity,setActivity]=useState(newActivity);
 async function load(){
  if(!schoolId)return;
  const data=await api(session,"GET","?schoolId="+encodeURIComponent(schoolId));
  setOverview(data.overview);
 }
 useEffect(()=>{let alive=true;setOverview(null);setMessage("");if(schoolId)
  api(session,"GET","?schoolId="+encodeURIComponent(schoolId))
   .then(d=>{if(alive)setOverview(d.overview);}).catch(e=>{if(alive)setMessage(e.message);});
  return()=>{alive=false;};
 },[session?.access_token,schoolId]);
 async function submit(e){
  e.preventDefault();setBusy(true);setMessage("");
  try{
   const data=await api(session,"POST","",{action:"logActivity",schoolId,...activity});
   setMessage(data.message);setActivity(newActivity());await load();
  }catch(e){setMessage(e.message);}
  finally{setBusy(false);}
 }
 return <div>
  <section className="panel">
   <div className="panel-head"><h2><School size={19}/> School implementation & training</h2><span className="eyebrow">{schoolName}</span></div>
   <p className="helper">A Consultant monitors school implementation, teacher development and follow-up actions. The counts are school-level summaries and do not reveal individual student assessment records.</p>
   {overview?<div className="stats">
    {[["Classes",overview.totals.classes],["Teachers",overview.totals.teachers],["Active learners",overview.totals.students],["Assessment sessions",overview.totals.assessments]].map(([title,value])=>
     <div className="stat" key={title}><span>{title}</span><strong>{value}</strong></div>)}
   </div>:<p className="helper">Loading school summary…</p>}
  </section>
  {isConsultant&&<section className="panel">
   <div className="panel-head"><h2><CalendarDays size={18}/> Record school support</h2></div>
   <form className="stack" onSubmit={submit}>
    <div className="three-col">
     <label>Activity<select value={activity.kind} onChange={e=>setActivity({...activity,kind:e.target.value})}>{kinds.map(k=><option key={k.value} value={k.value}>{k.label}</option>)}</select></label>
     <label>Activity date<input type="date" required max={today()} value={activity.activityDate} onChange={e=>setActivity({...activity,activityDate:e.target.value})}/></label>
     <label>Duration (minutes)<input type="number" min={0} max={600} required value={activity.durationMinutes} onChange={e=>setActivity({...activity,durationMinutes:Number(e.target.value)})}/></label>
    </div>
    <label>Workshop / visit topic<input required minLength={3} maxLength={200} value={activity.topic} onChange={e=>setActivity({...activity,topic:e.target.value})} placeholder="Phonics demonstration and lesson-plan review"/></label>
    <label>Stakeholder groups trained / supported<input maxLength={300} value={activity.participantRoles} onChange={e=>setActivity({...activity,participantRoles:e.target.value})} placeholder="Nursery–Grade 2 teachers, coordinator"/></label>
    <label>Observations and support provided<textarea maxLength={4000} rows={3} value={activity.summary} onChange={e=>setActivity({...activity,summary:e.target.value})}/></label>
    <label>Next follow-up action<textarea maxLength={2000} rows={2} value={activity.nextAction} onChange={e=>setActivity({...activity,nextAction:e.target.value})}/></label>
    <button type="submit" disabled={busy} className="btn primary"><ClipboardCheck size={16}/> {busy?"Saving…":"Record activity"}</button>
   </form>
  </section>}
  <section className="panel">
   <div className="panel-head"><h2><BookOpen size={18}/> Training & visit history</h2><span className="eyebrow">{overview?.activities?.length||0} RECENT ACTIVITIES</span></div>
   {overview?.activities?.length?<div className="rows">{overview.activities.map(a=>
    <div className="consultant-activity" key={a.id}>
     <div className="consultant-activity-top"><strong>{a.topic}</strong><small>{a.activity_date} · {kinds.find(k=>k.value===a.kind)?.label||a.kind} · {a.duration_minutes} min</small></div>
     {a.participant_roles&&<p><b>Stakeholders:</b> {a.participant_roles}</p>}
     {a.summary&&<p><b>Support:</b> {a.summary}</p>}
     {a.next_action&&<p><b>Next action:</b> {a.next_action}</p>}
    </div>
   )}</div>:<p className="helper">No Consultant activities logged for this school yet.</p>}
  </section>
  {message&&<div className="notice" role="status"><CheckCircle2 size={17}/>{message}</div>}
 </div>;
}
