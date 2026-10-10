"use client";
import {useEffect,useMemo,useState} from "react";
import {browserClient,LEVELS,RATINGS,MANAGERS,skillProgress,parseCsv} from "../lib/supabase";
import {LayoutDashboard,ShieldCheck,School,Users,BookOpen,ClipboardCheck,ChartNoAxesCombined,
 BookMarked,Eye,Menu,X,LogOut,Plus,Search,ChevronRight,RefreshCw,LockKeyhole,
 CircleCheck,ArrowRight,AlertCircle,GraduationCap,FileUp} from "lucide-react";

const navigation=[
 {id:"overview",label:"Overview",icon:LayoutDashboard},
 {id:"schools",label:"Schools",icon:School,admin:true},
 {id:"users",label:"User management",icon:Users,manager:true},
 {id:"classes",label:"Classes & students",icon:BookMarked,school:true},
 {id:"assess",label:"Assessments",icon:ClipboardCheck,school:true},
 {id:"competencies",label:"Competency library",icon:BookOpen,school:true},
 {id:"reports",label:"Progress reports",icon:ChartNoAxesCombined,school:true},
 {id:"implementation",label:"Teacher implementation",icon:FileUp,school:true},
 {id:"observations",label:"Classroom observations",icon:Eye,school:true}
];
const formatGrade=(g)=>LEVELS.indexOf(g);
function Btn({children,onClick,disabled=false,kind="",type="button"}){return <button className={"btn "+kind} onClick={onClick} disabled={disabled} type={type}>{children}</button>}
function Notice({message}){return message?<div className="notice"><AlertCircle size={17}/><span>{message}</span></div>:null}
function Empty({title,detail}){return <div className="empty"><BookOpen size={26}/><h3>{title}</h3><p>{detail}</p></div>}
function Box({title,action,children}){return <section className="panel"><div className="panel-head"><h2>{title}</h2>{action}</div>{children}</section>}

export default function Home(){
 const client=useMemo(()=>browserClient(),[]);
 const [session,setSession]=useState(null),[checked,setChecked]=useState(false);
 const [identity,setIdentity]=useState({admin:false,memberships:[],schools:[]});
 const [schoolId,setSchoolId]=useState(""),[page,setPage]=useState("overview");
 const [isMobile,setIsMobile]=useState(false);
 const [mobileNavOpen,setMobileNavOpen]=useState(false);
 const [desktopNavCollapsed,setDesktopNavCollapsed]=useState(false);
 const [classes,setClasses]=useState([]),[students,setStudents]=useState([]),[assessments,setAssessments]=useState([]),[competencies,setCompetencies]=useState([]),[members,setMembers]=useState([]);
 const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[signMode,setSignMode]=useState("signin");
 const [email,setEmail]=useState(""),[password,setPassword]=useState("");
 const [newSchool,setNewSchool]=useState(""),[newUser,setNewUser]=useState({name:"",email:"",role:"teacher",school:"",initialPassword:"",confirmPassword:""});
 const [teacherClasses,setTeacherClasses]=useState([]),[selectedTeacher,setSelectedTeacher]=useState("");
 const [temporary,setTemporary]=useState(null);
 const [classForm,setClassForm]=useState({grade:"Nursery",section:"A",academic_year:"2026-27"});
 const [activeClass,setActiveClass]=useState(""),[studentName,setStudentName]=useState("");
 const [assessmentSubject,setAssessmentSubject]=useState("student"),[assessmentTarget,setAssessmentTarget]=useState(""),[ratingForm,setRatingForm]=useState({}),[ratingNotes,setRatingNotes]=useState("");
 const [reportStudent,setReportStudent]=useState(""),[reportData,setReportData]=useState(null);
 const [newPassword,setNewPassword]=useState("");
 const school=identity.schools.find(s=>s.id===schoolId);
 const membership=identity.memberships.find(m=>m.school_id===schoolId);
 const role=identity.admin?"owner":(membership?.role||"");
 const isManager=identity.admin||MANAGERS.includes(role);
 const assignedIds=identity.assignedIds||[];
 const visibleClasses=role==="teacher"?classes.filter(c=>assignedIds.includes(c.id)):classes;
 const classObj=visibleClasses.find(c=>c.id===activeClass)||visibleClasses[0];
 const grade=classObj?.grade;
 const criterionList=competencies.filter(c=>c.active&&grade&&formatGrade(c.grade)<=formatGrade(grade))
   .sort((a,b)=>formatGrade(a.grade)-formatGrade(b.grade)||a.sequence-b.sequence);
 const targets=assessmentSubject==="student"
   ?students.filter(s=>s.class_id===classObj?.id&&s.active!==false).map(s=>({id:s.id,name:s.student_name}))
   :members.filter(m=>m.role==="teacher" && teacherClasses.some(tc=>tc.class_id===classObj?.id && tc.teacher_user_id===m.user_id))
      .map(m=>({id:m.user_id,name:m.display_name||"Teacher"}));

 useEffect(()=>{
  const media=window.matchMedia("(max-width: 760px)");
  const update=()=>{setIsMobile(media.matches);setMobileNavOpen(false);};
  update();
  media.addEventListener("change",update);
  return ()=>media.removeEventListener("change",update);
 },[]);
 useEffect(()=>{
  if(!mobileNavOpen)return;
  const handleEscape=e=>{if(e.key==="Escape")setMobileNavOpen(false);};
  window.addEventListener("keydown",handleEscape);
  return ()=>window.removeEventListener("keydown",handleEscape);
 },[mobileNavOpen]);
 useEffect(()=>{
  if(!client){setChecked(true);return;}
  let mounted=true;
  client.auth.getSession().then(({data})=>{if(mounted){setSession(data.session||null);setChecked(true);}});
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,s)=>{if(mounted)setSession(s||null);});
  return ()=>{mounted=false;subscription.unsubscribe();};
 },[client]);
 useEffect(()=>{
  if(!session||!client){setIdentity({admin:false,memberships:[],schools:[]});return;}
  let alive=true;
  (async()=>{
   try{
    const [{data:mem,error:memErr},{data:sch,error:schErr},adminRes]=await Promise.all([
     client.from("literacy_memberships").select("school_id,role,user_id,display_name").eq("user_id",session.user.id),
     client.from("literacy_schools").select("id,name").order("name"),
     fetch("/api/admin",{headers:{Authorization:"Bearer "+session.access_token}}).then(r=>r.json()).catch(()=>({}))
    ]);
    if(memErr)throw memErr;if(schErr)throw schErr;
    const memberships=mem||[];
    if(!alive)return;
    setIdentity({admin:adminRes.isAdmin===true,memberships,schools:sch||[]});
    const ids=memberships.map(x=>x.school_id);
    setSchoolId(old=>(adminRes.isAdmin===true ? (sch||[]).some(s=>s.id===old) : ids.includes(old)) ? old : (adminRes.isAdmin===true ? (sch?.[0]?.id||"") : (ids[0]||"")));
   }catch(e){if(alive)setMessage("Unable to load school access: "+e.message);}
  })();
  return()=>{alive=false;};
 },[client,session?.user?.id,session?.access_token]);
 useEffect(()=>{
  if(!schoolId||!session||!client){setClasses([]);setStudents([]);return;}
  let alive=true;
  (async()=>{
   const [c,m,co,a,tc]=await Promise.all([
    client.from("literacy_classes").select("id,school_id,grade,section,academic_year").eq("school_id",schoolId).order("grade"),
    client.from("literacy_memberships").select("user_id,role,display_name").eq("school_id",schoolId),
    client.from("literacy_competencies").select("id,grade,code,title,description,sequence,active").eq("active",true),
    client.from("literacy_assessments").select("id,school_id,class_id,subject_type,student_id,assessment_date,created_at").eq("school_id",schoolId).order("created_at",{ascending:false}).limit(500),
    client.from("literacy_teacher_classes").select("class_id,teacher_user_id").eq("teacher_user_id",session.user.id)
   ]);
   if(!alive)return;
   const errs=[c,m,co,a,tc].map(x=>x.error).filter(Boolean);
   if(errs.length)setMessage("Some records could not be loaded: "+errs[0].message);
   const cls=c.data||[];setClasses(cls);setMembers(m.data||[]);setCompetencies(co.data||[]);setAssessments(a.data||[]);
   setIdentity(old=>({...old,assignedIds:(tc.data||[]).map(x=>x.class_id)}));
   setActiveClass(old=>cls.some(x=>x.id===old)?old:(cls[0]?.id||""));
   if(cls.length){
    const allAssignments=await client.from("literacy_teacher_classes").select("class_id,teacher_user_id").in("class_id",cls.map(x=>x.id));
    if(alive)setTeacherClasses(allAssignments.data||[]);
    const s=await client.from("literacy_students").select("id,class_id,student_name,admission_number,active").in("class_id",cls.map(x=>x.id)).limit(3000);
    if(alive){setStudents(s.data||[]);if(s.error)setMessage(s.error.message);}
   }else {setStudents([]);setTeacherClasses([]);}
  })();
  return()=>{alive=false;};
 },[client,session?.user?.id,schoolId]);
 useEffect(()=>{setAssessmentTarget("");setRatingForm({});setReportStudent("");setReportData(null);},[activeClass,assessmentSubject,schoolId]);

 async function refresh(){
  if(!client||!schoolId)return;setBusy(true);setMessage("");
  const [c,s,a,m,co]=await Promise.all([
   client.from("literacy_classes").select("*").eq("school_id",schoolId),
   client.from("literacy_classes").select("id").eq("school_id",schoolId),
   client.from("literacy_assessments").select("id,school_id,class_id,subject_type,student_id,assessment_date,created_at").eq("school_id",schoolId).order("created_at",{ascending:false}).limit(500),
   client.from("literacy_memberships").select("user_id,role,display_name").eq("school_id",schoolId),
   client.from("literacy_competencies").select("id,grade,code,title,description,sequence,active").eq("active",true)
  ]);
  const cl=c.data||[];setClasses(cl);setAssessments(a.data||[]);setMembers(m.data||[]);setCompetencies(co.data||[]);
  if(cl.length){
   const res=await client.from("literacy_students").select("id,class_id,student_name,admission_number,active").in("class_id",cl.map(x=>x.id)).limit(3000);
   setStudents(res.data||[]);
   const assignments=await client.from("literacy_teacher_classes").select("class_id,teacher_user_id").in("class_id",cl.map(x=>x.id));
   setTeacherClasses(assignments.data||[]);
  }else {setStudents([]);setTeacherClasses([]);}
  setBusy(false);if(c.error||s.error||a.error)setMessage((c.error||s.error||a.error).message);
 }
 async function callAdmin(action,body){
  const res=await fetch("/api/admin",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},body:JSON.stringify({action,...body})});
  const json=await res.json();if(!res.ok)throw Error(json.error||"Request failed.");return json;
 }
 async function handleLogin(e){
  e.preventDefault();setBusy(true);setMessage("");
  try{
   if(signMode==="forgot"){const {error}=await client.auth.resetPasswordForEmail(email.trim(),{redirectTo:window.location.origin+"/reset"});if(error)throw error;setMessage("If an account exists, a password reset email will arrive.");}
   else{const {error}=await client.auth.signInWithPassword({email:email.trim(),password});if(error)throw error;}
  }catch(e){setMessage(e.message);}finally{setBusy(false);}
 }
 async function changeInitialPassword(e){
  e.preventDefault();if(newPassword.length<12){setMessage("Use a password of at least 12 characters.");return;}
  setBusy(true);setMessage("");
  try{
   const res=await fetch("/api/password-changed",{method:"POST",
    headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
    body:JSON.stringify({password:newPassword})});
   const payload=await res.json();
   if(!res.ok)throw Error(payload.error||"Password could not be changed.");
   const {data:refresh,error:refreshError}=await client.auth.refreshSession();
   if(refreshError)throw refreshError;
   const {data:{user}}=await client.auth.getUser();
   setSession({...refresh.session,user});setNewPassword("");
  }catch(e){setMessage(e.message);}finally{setBusy(false);}
 }
 async function addSchool(e){
  e.preventDefault();setBusy(true);setMessage("");
  try{const data=await callAdmin("createSchool",{name:newSchool});setNewSchool("");setIdentity(old=>({...old,schools:[...old.schools,data.school].sort((a,b)=>a.name.localeCompare(b.name))}));setMessage("School created.");}
  catch(e){setMessage(e.message);}finally{setBusy(false);}
 }
 async function addUser(e){
  e.preventDefault();
  if(newUser.initialPassword!==newUser.confirmPassword){
   setMessage("Initial and confirmation passwords must match.");return;
  }
  if(newUser.initialPassword && (newUser.initialPassword.length<12 || newUser.initialPassword.length>128 ||
   !/[a-z]/.test(newUser.initialPassword)||!/[A-Z]/.test(newUser.initialPassword)||
   !/[0-9]/.test(newUser.initialPassword)||!(/[^A-Za-z0-9]/.test(newUser.initialPassword)))){
   setMessage("Use 12–128 characters with uppercase, lowercase, a number and a symbol.");return;
  }
  const onboardingSchool=identity.admin?newUser.school:schoolId;
  const onboardingRole=identity.admin?newUser.role:"teacher";
  if(!onboardingSchool){setMessage("Select a school before adding a teacher.");return;}
  setBusy(true);setMessage("");setTemporary(null);
  try{
   const data=await callAdmin("createUser",{
    fullName:newUser.name,email:newUser.email,role:onboardingRole,schoolId:onboardingSchool,
    initialPassword:newUser.initialPassword
   });
   setTemporary(data);setMessage(data.message);
   setNewUser(current=>({...current,name:"",email:"",initialPassword:"",confirmPassword:""}));
   if(onboardingSchool===schoolId)await refresh();
  }catch(err){setMessage(err.message);}
  finally{setBusy(false);}
 }
 async function addClass(e){
  e.preventDefault();if(!schoolId||!isManager)return;setBusy(true);setMessage("");
  const {error}=await client.from("literacy_classes").insert({...classForm,school_id:schoolId});
  setBusy(false);if(error)setMessage(error.message);else{setMessage("Class created.");await refresh();}
 }
 async function addStudent(e){
  e.preventDefault();if(!classObj||!isManager)return;setBusy(true);
  const {error}=await client.from("literacy_students").insert({class_id:classObj.id,student_name:studentName.trim(),
   admission_number:"AS-"+crypto.randomUUID().slice(0,12).toUpperCase()});
  setBusy(false);if(error)setMessage(error.message);else{setStudentName("");setMessage("Student registered with an independent ID.");await refresh();}
 }
 async function assignTeacher(e){
  e.preventDefault(); if(!isManager||!classObj||!selectedTeacher)return;
  setBusy(true);setMessage("");
  const {error}=await client.from("literacy_teacher_classes").upsert(
   {class_id:classObj.id,teacher_user_id:selectedTeacher},
   {onConflict:"class_id,teacher_user_id"});
  setBusy(false);
  if(error)setMessage(error.message);
  else {setMessage("Teacher assigned to class.");await refresh();}
 }
 async function uploadRoster(e){
  if(!classObj||!isManager)return;
  try{
   const text=await e.target.files[0]?.text();if(!text)return;
   const rows=parseCsv(text);if(!rows.length||rows.length>1000)throw Error("Upload 1 to 1,000 students per CSV.");
   const incoming=rows.map(r=>({class_id:classObj.id,student_name:r.student_name,
    admission_number:r.admission_number||("AS-"+crypto.randomUUID().slice(0,12).toUpperCase())}));
   if(incoming.some(r=>!r.student_name||r.student_name.length>200||r.admission_number.length>100))throw Error("Invalid student row.");
   if(new Set(incoming.map(r=>r.admission_number)).size!==incoming.length)throw Error("Duplicate assessment IDs in file.");
   if(!confirm("Import "+incoming.length+" students into "+classObj.grade+" "+classObj.section+"? Use the same generated IDs for future uploads."))return;
   setBusy(true);for(let i=0;i<incoming.length;i+=100){const {error}=await client.from("literacy_students").upsert(incoming.slice(i,i+100),{onConflict:"class_id,admission_number"});if(error)throw error;}
   setMessage("Student roster imported. Export and retain independent IDs for future updates.");await refresh();
  }catch(err){setMessage(err.message);}finally{setBusy(false);e.target.value="";}
 }
 async function submitAssessment(e){
  e.preventDefault();if(!assessmentTarget||!classObj)return;
  const rows=Object.entries(ratingForm).filter(([,r])=>r!=="Not Assessed").map(([competency_id,rating])=>({competency_id,rating,evidence_notes:""}));
  if(!rows.length){setMessage("Rate at least one competency.");return;}
  setBusy(true);setMessage("");
  const {error}=await client.rpc("literacy_submit_assessment",{
   p_school_id:schoolId,p_class_id:classObj.id,p_subject_type:assessmentSubject,p_subject_id:assessmentTarget,
   p_assessment_date:new Date().toISOString().slice(0,10),p_notes:ratingNotes,p_results:rows
  });
  setBusy(false);if(error)setMessage(error.message);else{setMessage("Assessment saved.");setRatingForm({});setRatingNotes("");await refresh();}
 }
 async function loadReport(studentId){
  setReportStudent(studentId);setReportData(null);
  if(!studentId)return;
  setBusy(true);
  const student=students.find(s=>s.id===studentId);
  const history=assessments.filter(a=>a.subject_type==="student"&&a.student_id===studentId).map(a=>a.id);
  let results={};
  if(history.length){
   const {data,error}=await client.from("literacy_assessment_results").select("assessment_id,competency_id,rating").in("assessment_id",history.slice(0,300));
   if(error)setMessage(error.message);
   const chronological=[...assessments.filter(a=>history.includes(a.id))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
   for(const a of chronological){(data||[]).filter(r=>r.assessment_id===a.id).forEach(r=>{if(!(r.competency_id in results)&&r.rating!=="Not Assessed")results[r.competency_id]=r.rating;});}
  }
  const cls=classes.find(c=>c.id===student?.class_id);
  const relevant=competencies.filter(c=>c.active&&cls&&formatGrade(c.grade)<=formatGrade(cls.grade));
  setReportData({student,cls,results,progress:skillProgress(relevant,results,cls?.grade||"Nursery"),relevant});
  setBusy(false);
 }
 async function logout(){await client?.auth.signOut();setSession(null);setPage("overview");setMobileNavOpen(false);}
 function toggleNavigation(){
  if(isMobile)setMobileNavOpen(open=>!open);
  else setDesktopNavCollapsed(collapsed=>!collapsed);
 }

 if(!checked)return <main className="splash"><span className="loader"/> Loading secure workspace…</main>;
 if(!client)return <main className="setup"><div className="setup-logo"><GraduationCap size={29}/></div><span className="eyebrow">VISION SCHOOL PLATFORM</span><h1>A connected home for every school.</h1><p>Teacher implementation, literacy assessments and learning progress in one workspace.</p><div className="notice"><LockKeyhole size={19}/><span>Deployment is in setup mode. Configure Supabase public environment variables to enable secure sign-in. No student data is exposed.</span></div><a href="https://github.com/harshitbhargava1997-web/Consultant/tree/commercial-staging/commercial-web" target="_blank" rel="noreferrer" className="btn primary">View staging source <ArrowRight size={16}/></a></main>;
 if(!session)return <main className="auth-outer"><div className="auth-brand"><span className="brand-mark"><GraduationCap size={24}/></span><span>VISION <small>School Platform</small></span></div><div className="auth-card"><div className="eyebrow">SECURE SCHOOL WORKSPACE</div><h1>{signMode==="forgot"?"Reset your password":"Welcome back"}</h1><p>One account for every role, school and learning workflow.</p><Notice message={message}/><form onSubmit={handleLogin}><label>Email address<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@school.edu"/></label>{signMode==="signin"&&<label>Password<input type="password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter password"/></label>}<Btn type="submit" kind="primary wide" disabled={busy}>{busy?"Please wait…":signMode==="forgot"?"Email reset link":"Sign in"} <ArrowRight size={16}/></Btn></form><button className="link-button" onClick={()=>{setSignMode(signMode==="forgot"?"signin":"forgot");setMessage("");}}>{signMode==="forgot"?"Back to sign in":"Forgot password?"}</button></div><div className="auth-note">Built for school leaders, teachers and academic assessors</div></main>;
 if(session.user?.app_metadata?.must_change_password)return <main className="auth-outer"><div className="auth-card"><span className="eyebrow">ACCOUNT SECURITY</span><h1>Set your personal password</h1><p>Replace the temporary password before continuing.</p><Notice message={message}/><form onSubmit={changeInitialPassword}><label>New password<input type="password" minLength={12} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></label><Btn type="submit" kind="primary wide" disabled={busy}>Update password</Btn></form><button className="link-button" onClick={logout}>Sign out</button></div></main>;

 const availableNav=navigation.filter(n=>(!n.admin||identity.admin)&&(!n.manager||(identity.admin||(isManager&&!!schoolId)))&&(!n.school||!!schoolId));
 return <div className={"layout"+(desktopNavCollapsed?" sidebar-collapsed":"")}>
  {mobileNavOpen&&<button type="button" className="nav-backdrop" aria-label="Close navigation" onClick={()=>setMobileNavOpen(false)}/>}
  <aside id="vision-sidebar" className={"sidebar"+(mobileNavOpen?" mobile-open":"")}>
   <div className="brand"><span className="brand-mark"><GraduationCap size={23}/></span><span>VISION <small>School Platform</small></span><button type="button" className="sidebar-close" aria-label="Close menu" onClick={()=>setMobileNavOpen(false)}><X size={20}/></button></div><div className="side-caption">WORKSPACE</div><nav>{availableNav.map(item=>{const Icon=item.icon;return <button key={item.id} onClick={()=>{setPage(item.id);setMessage("");setMobileNavOpen(false);}} className={"nav-item "+(page===item.id?"active":"")}><Icon size={18}/><span>{item.label}</span>{page===item.id&&<ChevronRight size={15}/>}</button>;})}</nav><div className="sidebar-bottom"><div className="profile-dot">{(session.user.email||"U").slice(0,1).toUpperCase()}</div><div className="profile-name"><strong>{session.user.email?.split("@")[0]}</strong><small>{identity.admin?"Platform Admin":role||"Member"}</small></div><button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={logout}><LogOut size={18}/></button></div></aside>
 <main className="main"><header className="topbar"><div className="topbar-title"><button type="button" className="mobile-menu" aria-label={(isMobile?mobileNavOpen:!desktopNavCollapsed)?"Close navigation menu":"Open navigation menu"} aria-controls="vision-sidebar" aria-expanded={isMobile?mobileNavOpen:!desktopNavCollapsed} onClick={toggleNavigation}>{isMobile?mobileNavOpen?<X size={21}/>:<Menu size={21}/>:desktopNavCollapsed?<Menu size={21}/>:<X size={21}/>}</button><span>VISION / <b>{navigation.find(n=>n.id===page)?.label||"Overview"}</b></span></div><div className="topbar-right"><select aria-label="Active school" value={schoolId} onChange={e=>{setSchoolId(e.target.value);setPage("overview");}}><option value="">Select a school</option>{identity.schools.filter(s=>identity.admin||identity.memberships.some(m=>m.school_id===s.id)).map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select><span className="avatar">{(session.user.email||"U").slice(0,1).toUpperCase()}</span></div></header><div className="content"><div className="page-heading"><div><span className="eyebrow">{school?.name||"PLATFORM WORKSPACE"}</span><h1>{navigation.find(n=>n.id===page)?.label||"Overview"}</h1><p>{page==="overview"?"An integrated view of school operations and foundational learning.":"Secure workspace · "+(identity.admin?"Super Admin":role||"Assigned member")}</p></div>{schoolId&&<Btn kind="outline" disabled={busy} onClick={refresh}><RefreshCw size={15}/> Refresh</Btn>}</div><Notice message={message}/>
 {page==="overview"&&<><div className="stats"><div className="stat"><span>Schools assigned</span><strong>{identity.memberships.length}</strong><small>Active memberships</small></div><div className="stat"><span>Classes</span><strong>{visibleClasses.length}</strong><small>Accessible classes</small></div><div className="stat"><span>Students</span><strong>{students.filter(s=>visibleClasses.some(c=>c.id===s.class_id)).length}</strong><small>Registered learners</small></div><div className="stat"><span>Assessment sessions</span><strong>{assessments.filter(a=>visibleClasses.some(c=>c.id===a.class_id)).length}</strong><small>Last 500 loaded</small></div></div><div className="two-col"><Box title="Your learning workflow"><div className="workflow">{["Set up school and staff","Create classes and student rosters","Assess cumulative competencies","Review literacy level and interventions"].map((t,i)=><div key={t} className="workflow-row"><span>{i+1}</span>{t}<CircleCheck size={16}/></div>)}</div></Box><Box title="Product readiness"><div className="readiness"><p><CircleCheck size={17}/> Unified authentication and role-aware interface</p><p><CircleCheck size={17}/> Cumulative student assessment and reports</p><p><AlertCircle size={17}/> Legacy evidence migration requires secure ID mapping</p><p><AlertCircle size={17}/> Production security review and end-to-end testing pending</p></div></Box></div></>}
 {page==="schools"&&identity.admin&&<div className="two-col"><Box title="Registered schools">{identity.schools.length?<div className="rows">{identity.schools.map(s=><div className="record" key={s.id}><School size={17}/><strong>{s.name}</strong></div>)}</div>:<Empty title="No schools yet" detail="Create your first school to begin."/>}</Box><Box title="Register a school"><form onSubmit={addSchool} className="stack"><label>School name<input required maxLength={180} value={newSchool} onChange={e=>setNewSchool(e.target.value)} placeholder="Full registered school name"/></label><Btn kind="primary" type="submit" disabled={busy}><Plus size={16}/> Create school</Btn></form></Box></div>}
 {page==="users"&&(identity.admin||(isManager&&schoolId))&&<div className="two-col">
 <Box title={identity.admin?"Create or assign school user":"Add teacher to your school"}>
  <form onSubmit={addUser} className="stack">
   {identity.admin
    ?<label>School<select required value={newUser.school} onChange={e=>setNewUser({...newUser,school:e.target.value})}><option value="">Choose school</option>{identity.schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    :<label>Assigned school<input value={school?.name||""} readOnly aria-label="Your assigned school"/></label>}
   <label>Full name<input required minLength={2} maxLength={160} value={newUser.name} onChange={e=>setNewUser({...newUser,name:e.target.value})}/></label>
   <label>Login email<input type="email" required value={newUser.email} onChange={e=>setNewUser({...newUser,email:e.target.value})}/></label>
   {identity.admin
    ?<label>Role<select value={newUser.role} onChange={e=>setNewUser({...newUser,role:e.target.value})}>{["owner","principal","coordinator","teacher"].map(r=><option key={r} value={r}>{r}</option>)}</select></label>
    :<label>Role<input value="Teacher" readOnly aria-label="Teacher role"/></label>}
   <label>Initial password (set manually)<input type="password" minLength={12} maxLength={128} autoComplete="new-password" placeholder="Choose a strong initial password" value={newUser.initialPassword} onChange={e=>setNewUser({...newUser,initialPassword:e.target.value})}/></label>
   <label>Confirm initial password<input type="password" minLength={12} maxLength={128} autoComplete="new-password" placeholder="Enter the same password" value={newUser.confirmPassword} onChange={e=>setNewUser({...newUser,confirmPassword:e.target.value})}/></label>
   <p className="helper">For a new account, enter 12–128 characters including uppercase, lowercase, a number and a symbol. Leave both password fields blank when assigning an existing account; its password will not change.</p>
   <div className="notice small">Share the initial password privately and confirm the account holder's email address. Teachers can use “Forgot password” to change it. Only the Platform Super Admin can create school owners, principals or coordinators.</div>
   <Btn kind="primary" type="submit" disabled={busy}>{busy?"Please wait…":identity.admin?"Create / assign user":"Add teacher"}</Btn>
  </form>
 </Box>
 <Box title="School teachers and account provisioning">
  {!identity.admin&&<div className="rows">
   {members.filter(m=>m.role==="teacher").length
     ?members.filter(m=>m.role==="teacher").map(m=><div className="record" key={m.user_id}><Users size={17}/><strong>{m.display_name||"Teacher"}</strong></div>)
     :<Empty title="No teachers assigned yet" detail="Add a teacher to register them with this school."/>}
  </div>}
  {temporary?<div className="credentials"><h3>{temporary.created?"New account created":"Existing account assigned"}</h3><p>Login: {temporary.email}</p><p>{temporary.created?"The initial password you entered has been set and cleared from the form.":"The user's existing password was left unchanged."}</p></div>
   :<p className="helper">School leaders can register teachers for their own school. The Super Admin controls all other account roles.</p>}
 </Box>
</div>}
 {page==="classes"&&schoolId&&<><div className="two-col"><Box title="Your classes"><div className="rows">{visibleClasses.length?visibleClasses.map(c=><button key={c.id} className={"record row-button "+(classObj?.id===c.id?"selected":"")} onClick={()=>setActiveClass(c.id)}><BookMarked size={17}/><strong>{c.grade} · {c.section}</strong><small>{c.academic_year}</small></button>):<Empty title="No classes yet" detail="A school leader can create a class."/>}</div></Box><Box title="Register class">{isManager?<form className="stack" onSubmit={addClass}><label>Grade<select value={classForm.grade} onChange={e=>setClassForm({...classForm,grade:e.target.value})}>{LEVELS.map(g=><option key={g}>{g}</option>)}</select></label><label>Section<input value={classForm.section} required onChange={e=>setClassForm({...classForm,section:e.target.value})}/></label><label>Academic year<input value={classForm.academic_year} required onChange={e=>setClassForm({...classForm,academic_year:e.target.value})}/></label><Btn type="submit" kind="primary" disabled={busy}>Create class</Btn></form>:<Empty title="Read-only access" detail="Class creation is reserved for school leadership."/>}</Box></div>{isManager&&classObj&&<Box title="Assign teacher to class"><form onSubmit={assignTeacher} className="inline-form"><select value={selectedTeacher} onChange={e=>setSelectedTeacher(e.target.value)} required><option value="">Select a teacher</option>{members.filter(m=>m.role==="teacher").map(m=><option key={m.user_id} value={m.user_id}>{m.display_name||m.user_id}</option>)}</select><Btn type="submit" kind="primary" disabled={busy||!selectedTeacher}>Assign teacher</Btn></form><p className="helper">Only assigned teachers can submit student assessments for this class.</p></Box>}{classObj&&<Box title={"Students · "+classObj.grade+" "+classObj.section}><div className="students-head">{isManager&&<><form onSubmit={addStudent} className="inline-form"><input placeholder="Student full name" required value={studentName} onChange={e=>setStudentName(e.target.value)}/><Btn kind="primary" type="submit" disabled={busy}><Plus size={15}/> Add student</Btn></form><label className="upload-label">Import student CSV <input type="file" accept=".csv,text/csv" onChange={uploadRoster} disabled={busy}/></label></>}</div><div className="table-wrap"><table><thead><tr><th>Student</th><th>Assessment ID</th></tr></thead><tbody>{students.filter(s=>s.class_id===classObj.id&&s.active!==false).map(s=><tr key={s.id}><td>{s.student_name}</td><td className="mono">{s.admission_number}</td></tr>)}</tbody></table></div></Box>}</>}
 {page==="assess"&&schoolId&&<Box title="Cumulative competency assessment">{!visibleClasses.length?<Empty title="No classes assigned" detail="Create classes or assign a teacher to begin."/>:<form onSubmit={submitAssessment} className="stack"><div className="three-col"><label>Class<select value={classObj?.id||""} onChange={e=>setActiveClass(e.target.value)}>{visibleClasses.map(c=><option value={c.id} key={c.id}>{c.grade} · {c.section}</option>)}</select></label><label>Assessment type<select value={assessmentSubject} onChange={e=>setAssessmentSubject(e.target.value)}><option value="student">Student</option>{isManager&&<option value="teacher">Teacher</option>}</select></label><label>{assessmentSubject==="student"?"Student":"Teacher"}<select required value={assessmentTarget} onChange={e=>setAssessmentTarget(e.target.value)}><option value="">Select person</option>{targets.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div><div className="skills-head"><h3>Competencies from Nursery to {grade}</h3><span>{criterionList.length} published skills</span></div>{criterionList.length?criterionList.map((c,i)=><div className="skill" key={c.id}><div><small>{c.grade} · {c.code}</small><strong>{c.title}</strong><p>{c.description}</p></div><select aria-label={"Rating for "+c.title} value={ratingForm[c.id]||"Not Assessed"} onChange={e=>setRatingForm({...ratingForm,[c.id]:e.target.value})}>{RATINGS.map(r=><option key={r}>{r}</option>)}</select></div>):<Empty title="No published competencies" detail="Publish competency records before assessing learners."/>}<label>Observations and recommended intervention<textarea value={ratingNotes} onChange={e=>setRatingNotes(e.target.value)} rows={3}/></label><Btn kind="primary" type="submit" disabled={busy||!assessmentTarget||!criterionList.length}>Save assessment <ArrowRight size={16}/></Btn></form>}</Box>}
 {page==="competencies"&&schoolId&&<Box title="Published literacy progression"><div className="level-grid">{LEVELS.map(l=><div key={l} className="level"><strong>{l}</strong><span>{competencies.filter(c=>c.active&&c.grade===l).length} competencies</span></div>)}</div><div className="rows">{competencies.filter(c=>c.active).sort((a,b)=>formatGrade(a.grade)-formatGrade(b.grade)||a.sequence-b.sequence).map(c=><div key={c.id} className="record"><BookOpen size={16}/><strong>{c.title}</strong><small>{c.grade}</small></div>)}</div><div className="helper">Shared curriculum editing is reserved for Platform Super Admin and requires a reviewed database policy.</div></Box>}
 {page==="reports"&&schoolId&&<Box title="Individual literacy progression"><label>Student<select value={reportStudent} onChange={e=>loadReport(e.target.value)}><option value="">Select student</option>{students.filter(s=>visibleClasses.some(c=>c.id===s.class_id)).map(s=><option key={s.id} value={s.id}>{s.student_name}</option>)}</select></label>{reportData&&<><div className="stats report-stats"><div className="stat"><span>Enrolled grade</span><strong>{reportData.cls?.grade}</strong></div><div className="stat"><span>Demonstrated level</span><strong>{reportData.progress.highest||"Not established"}</strong></div></div><div className="rows">{reportData.progress.byLevel.map(l=><div key={l.level} className="progress-row"><strong>{l.level}</strong><div className="progress-bar"><span style={{width:l.independence+"%"}}/></div><small>{l.assessed}/{l.count} assessed · {l.independence}% independent</small></div>)}</div><p className="helper">Provisional threshold: 80% assessed and 80% independent at each consecutive level. This is a screening indicator, not a diagnosis.</p></>}</Box>}
 {["implementation","observations"].includes(page)&&<Box title={page==="implementation"?"Teacher implementation evidence":"Classroom observations"}><Empty title="Historical integration is being prepared" detail="The existing Streamlit workflow remains operational. This commercial workspace will connect only after school IDs, access policies and secure evidence storage are migrated and tested."/></Box>}
 {!schoolId&&!identity.admin&&<Empty title="No school membership found" detail="Ask your Platform Super Admin to assign your account to a school."/>}
 </div></main></div>;
}
