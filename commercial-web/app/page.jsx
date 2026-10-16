"use client";
import {useEffect,useMemo,useState} from "react";
import {browserClient,LEVELS,RATINGS,MANAGERS,skillProgress,parseCsv} from "../lib/supabase";
import BulkWorkspace from "./BulkWorkspace";
import AssessorWorkspace from "./AssessorWorkspace";
import AssessmentStructure from "./AssessmentStructure";
import TeacherSkillsReview from "./TeacherSkillsReview";
import RolePermissions from "./RolePermissions";
import SchoolManagementWorkspace from "./SchoolManagementWorkspace";
import TrainingWorkspace from "./TrainingWorkspace";
import TrainingImpactPanel from "./TrainingImpactPanel";
import StudentSoundReport from "./StudentSoundReport";
import StudentAssessmentEvidence from "./StudentAssessmentEvidence";
import TeacherSchoolReports from "./TeacherSchoolReports";
import ImplementationWorkspace from "./ImplementationWorkspace";
import CurriculumEditor from "./CurriculumEditor";
import ConsultantWorkspace,{ConsultantManagement} from "./ConsultantWorkspace";
import {isEmail,loginLabel,normalizePhone} from "../lib/auth";
import {LayoutDashboard,ShieldCheck,School,Users,BookOpen,ClipboardCheck,ChartNoAxesCombined,
 BookMarked,Eye,Menu,X,LogOut,Plus,Trash2,Search,ChevronRight,RefreshCw,LockKeyhole,
 CircleCheck,ArrowRight,AlertCircle,GraduationCap,FileUp} from "lucide-react";

const navigation=[
 {id:"overview",label:"Overview",icon:LayoutDashboard},
 {id:"schools",label:"Schools",icon:School,admin:true},
 {id:"users",label:"User management",icon:Users,school:true},
 {id:"consultants",label:"Consultant assignments",icon:Users,admin:true},
 {id:"permissions",label:"Role permissions",icon:ShieldCheck,admin:true},
 {id:"consultant",label:"Consultant support",icon:GraduationCap,consultant:true,school:true},
 {id:"assessment-structure",label:"Assessment Structure",icon:BookMarked,school:true},
 {id:"training",label:"Teacher training",icon:BookOpen,school:true},
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
 const [identity,setIdentity]=useState({admin:false,isConsultant:false,consultantSchools:[],memberships:[],schools:[]});
 const [schoolId,setSchoolId]=useState(""),[page,setPage]=useState("overview");
 const [assessmentView,setAssessmentView]=useState("structure");
 const [roleGrants,setRoleGrants]=useState([]);
 const [isMobile,setIsMobile]=useState(false);
 const [mobileNavOpen,setMobileNavOpen]=useState(false);
 const [desktopNavCollapsed,setDesktopNavCollapsed]=useState(false);
 const [classes,setClasses]=useState([]),[students,setStudents]=useState([]),[assessments,setAssessments]=useState([]),[competencies,setCompetencies]=useState([]),[members,setMembers]=useState([]);
 const [message,setMessage]=useState(""),[busy,setBusy]=useState(false),[signMode,setSignMode]=useState("signin");
 const [login,setLogin]=useState(""),[password,setPassword]=useState("");
 const [newSchool,setNewSchool]=useState(""),[newUser,setNewUser]=useState({name:"",email:"",role:"teacher",school:"",initialPassword:"",confirmPassword:""});
 const [teacherClasses,setTeacherClasses]=useState([]),[selectedTeacher,setSelectedTeacher]=useState("");
 const [temporary,setTemporary]=useState(null);
 const [classForm,setClassForm]=useState({grade:"Nursery",section:"A",academic_year:"2026-27"});
 const [activeClass,setActiveClass]=useState(""),[studentName,setStudentName]=useState("");
 const [assessmentSubject,setAssessmentSubject]=useState("student"),[assessmentTarget,setAssessmentTarget]=useState(""),[ratingForm,setRatingForm]=useState({}),[ratingNotes,setRatingNotes]=useState("");
 const [reportStudent,setReportStudent]=useState(""),[reportData,setReportData]=useState(null);
 const [reportsTab,setReportsTab]=useState("student");
 const [newPassword,setNewPassword]=useState("");
 const school=identity.schools.find(s=>s.id===schoolId);
 const membership=identity.memberships.find(m=>m.school_id===schoolId);
 const consultantAssigned=identity.consultantSchools.includes(schoolId);
 const role=identity.admin?"owner":(consultantAssigned?"consultant":(membership?.role||""));
 const isManager=identity.admin||consultantAssigned||MANAGERS.includes(role);
 const can=(feature)=>identity.admin||roleGrants.includes(feature);
 const canManageAllRoles=identity.admin||(consultantAssigned&&can("users.manage"));
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
  if(!session||!client){setIdentity({admin:false,isConsultant:false,consultantSchools:[],memberships:[],schools:[]});return;}
  let alive=true;
  (async()=>{
   try{
    const [{data:mem,error:memErr},{data:sch,error:schErr},adminRes,consultantRes]=await Promise.all([
     client.from("literacy_memberships").select("school_id,role,user_id,display_name").eq("user_id",session.user.id),
     client.from("literacy_schools").select("id,name").order("name"),
     fetch("/api/admin",{headers:{Authorization:"Bearer "+session.access_token}}).then(r=>r.json()).catch(()=>({})),
     fetch("/api/consultants",{headers:{Authorization:"Bearer "+session.access_token}}).then(r=>r.json()).catch(()=>({}))
    ]);
    if(memErr)throw memErr;if(schErr)throw schErr;
    const memberships=mem||[];
    if(!alive)return;
    const consultantSchools=Array.isArray(consultantRes.consultantSchools)?consultantRes.consultantSchools:[];
    const permitted=adminRes.isAdmin===true?(sch||[]).map(s=>s.id):[...new Set([...memberships.map(x=>x.school_id),...consultantSchools])];
    setIdentity({admin:adminRes.isAdmin===true,isConsultant:consultantRes.isConsultant===true,
     consultantSchools,memberships,schools:sch||[]});
    setSchoolId(old=>permitted.includes(old)?old:(permitted[0]||""));
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
    client.from("literacy_competencies").select("id,grade,code,strand,title,description,sequence,active,version"),
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
 useEffect(()=>{
  if(!session||!schoolId){setRoleGrants([]);return;}
  let alive=true;
  setRoleGrants([]);
  fetch("/api/permissions?schoolId="+encodeURIComponent(schoolId),{
   headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"
  }).then(async r=>{
   const data=await r.json();if(!r.ok)throw Error(data.error||"Permissions unavailable.");
   if(alive)setRoleGrants(data.grants||[]);
  }).catch(e=>{if(alive){setRoleGrants([]);setMessage("Unable to load permissions: "+e.message);}});
  return()=>{alive=false;};
 },[session?.access_token,schoolId]);
 useEffect(()=>{setAssessmentTarget("");setRatingForm({});setReportStudent("");setReportData(null);},[activeClass,assessmentSubject,schoolId]);

 async function refresh(){
  if(!client||!schoolId)return;setBusy(true);setMessage("");
  const [c,s,a,m,co]=await Promise.all([
   client.from("literacy_classes").select("*").eq("school_id",schoolId),
   client.from("literacy_classes").select("id").eq("school_id",schoolId),
   client.from("literacy_assessments").select("id,school_id,class_id,subject_type,student_id,assessment_date,created_at").eq("school_id",schoolId).order("created_at",{ascending:false}).limit(500),
   client.from("literacy_memberships").select("user_id,role,display_name").eq("school_id",schoolId),
   client.from("literacy_competencies").select("id,grade,code,strand,title,description,sequence,active,version")
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
   const value=login.trim();
   if(signMode==="forgot"){
    if(!isEmail(value))throw Error("Mobile-login teachers should ask their school administrator to reset their password. Email accounts can request a reset link here.");
    const {error}=await client.auth.resetPasswordForEmail(value,{redirectTo:window.location.origin+"/reset"});if(error)throw error;
    setMessage("If an account exists, a password reset email will arrive.");
   }else{
    const credentials=isEmail(value)?{email:value.toLowerCase(),password}:{phone:normalizePhone(value),password};
    if(!credentials.email&&!credentials.phone)throw Error("Enter a valid email address or 10-digit teacher mobile number.");
    const {error}=await client.auth.signInWithPassword(credentials);if(error)throw error;
   }
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
  if(!can("users.manage")){setMessage("User management is not enabled for your role.");return;}
  const onboardingSchool=identity.admin?newUser.school:schoolId;
  const onboardingRole=canManageAllRoles?newUser.role:"teacher";
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
  e.preventDefault();if(!schoolId||!can("classes.manage"))return;setBusy(true);setMessage("");
  const {error}=await client.from("literacy_classes").insert({...classForm,school_id:schoolId});
  setBusy(false);if(error)setMessage(error.message);else{setMessage("Class created.");await refresh();}
 }
 async function manageStudent(action,values){
  const response=await fetch("/api/students",{
   method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
   body:JSON.stringify({action,schoolId,classId:classObj.id,...values})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||"Student record could not be updated.");
  return result;
 }
 async function addStudent(e){
  e.preventDefault();if(!classObj)return;
  setBusy(true);setMessage("");
  try{
   const result=await manageStudent("add",{studentName:studentName.trim()});
   setStudentName("");await refresh();setMessage(result.message);
  }catch(error){setMessage(error.message);}finally{setBusy(false);}
 }
 async function removeStudent(student){
  if(!classObj||!window.confirm("Remove "+student.student_name+" from the active class roster? Assessment history will be retained."))return;
  setBusy(true);setMessage("");
  try{
   const result=await manageStudent("remove",{studentId:student.id});
   await refresh();setMessage(result.message);
  }catch(error){setMessage(error.message);}finally{setBusy(false);}
 }
 async function assignTeacher(e){
  e.preventDefault(); if(!can("teachers.assign")||!classObj||!selectedTeacher)return;
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
 if(!session)return <main className="auth-outer"><div className="auth-brand"><span className="brand-mark"><GraduationCap size={24}/></span><span>VISION <small>School Platform</small></span></div><div className="auth-card"><div className="eyebrow">SECURE SCHOOL WORKSPACE</div><h1>{signMode==="forgot"?"Reset your password":"Welcome back"}</h1><p>{signMode==="forgot"?"Email accounts can request a reset link. Mobile-login teachers should contact their school administrator.":"School leaders use email. Teachers may use email or mobile number."}</p><Notice message={message}/><form onSubmit={handleLogin}><label>{signMode==="forgot"?"Email address":"Email or teacher mobile number"}<input type={signMode==="forgot"?"email":"text"} inputMode={signMode==="forgot"?"email":"text"} autoComplete="username" required value={login} onChange={e=>setLogin(e.target.value)} placeholder={signMode==="forgot"?"you@school.edu":"you@school.edu or 9876543210"}/></label>{signMode==="signin"&&<label>Password<input type="password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Enter password"/></label>}<Btn type="submit" kind="primary wide" disabled={busy}>{busy?"Please wait…":signMode==="forgot"?"Email reset link":"Sign in"} <ArrowRight size={16}/></Btn></form><button className="link-button" onClick={()=>{setSignMode(signMode==="forgot"?"signin":"forgot");setMessage("");}}>{signMode==="forgot"?"Back to sign in":"Forgot password?"}</button></div><div className="auth-note">Built for school leaders, teachers and academic assessors</div></main>;
 if(session.user?.app_metadata?.must_change_password)return <main className="auth-outer"><div className="auth-card"><span className="eyebrow">ACCOUNT SECURITY</span><h1>Set your personal password</h1><p>Replace the temporary password before continuing.</p><Notice message={message}/><form onSubmit={changeInitialPassword}><label>New password<input type="password" minLength={12} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/></label><Btn type="submit" kind="primary wide" disabled={busy}>Update password</Btn></form><button className="link-button" onClick={logout}>Sign out</button></div></main>;

 const navFeature={
  schools:"schools.view",users:"users.manage",consultants:"consultants.manage",
  consultant:"consultants.support",classes:"classes.view",
  competencies:"competencies.view",
  reports:"reports.view",implementation:"implementation.view",observations:"observations.view"
 };
 const availableNav=navigation.filter(n=>{
  if(n.id==="permissions")return identity.admin;
  if(n.id==="training")return identity.admin||!!schoolId&&
   (can("training.access")||can("training.complete")||can("training.deliver")||can("training.review"));
  if(n.id==="overview")return true;
  if(n.id==="users")return identity.admin||!!schoolId&&
   (can("users.manage")||can("classes.view")||can("classes.manage")||can("classes.import")||
    can("staff.import")||can("students.import")||can("students.manage")||
    can("teachers.assign")||can("data.export"));
  if(n.id==="schools")return can("schools.view");
  if(!schoolId)return false;
  if(n.id==="bulk")return can("staff.import")||can("students.import")||can("data.export");
  if(n.id==="assessment-structure")return can("competencies.view")||can("teacher_reviews.create")||can("assessments.create")||can("assessments.view");
  if(n.id==="consultant")return can("consultants.support")||can("consultants.log");
  if(n.id==="competencies")return can("competencies.view")||can("competencies.edit");
  if(n.id==="implementation")return can("implementation.view")||can("implementation.submit")||can("implementation.review");
  return can(navFeature[n.id]);
 });
 return <div className={"layout"+(desktopNavCollapsed?" sidebar-collapsed":"")}>
  {mobileNavOpen&&<button type="button" className="nav-backdrop" aria-label="Close navigation" onClick={()=>setMobileNavOpen(false)}/>}
  <aside id="vision-sidebar" className={"sidebar"+(mobileNavOpen?" mobile-open":"")}>
   <div className="brand"><span className="brand-mark"><GraduationCap size={23}/></span><span>VISION <small>School Platform</small></span><button type="button" className="sidebar-close" aria-label="Close menu" onClick={()=>setMobileNavOpen(false)}><X size={20}/></button></div><div className="side-caption">WORKSPACE</div><nav>{availableNav.map(item=>{const Icon=item.icon;return <button key={item.id} onClick={()=>{setPage(item.id);if(item.id==="assessment-structure")setAssessmentView("structure");setMessage("");setMobileNavOpen(false);}} className={"nav-item "+(page===item.id?"active":"")}><Icon size={18}/><span>{item.label}</span>{page===item.id&&<ChevronRight size={15}/>}</button>;})}</nav><div className="sidebar-bottom"><div className="profile-dot">{loginLabel(session.user).slice(0,1).toUpperCase()}</div><div className="profile-name"><strong>{session.user.email?.split("@")[0]||session.user.phone}</strong><small>{identity.admin?"Platform Admin":role||"Member"}</small></div><button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={logout}><LogOut size={18}/></button></div></aside>
 <main className="main"><header className="topbar"><div className="topbar-title"><button type="button" className="mobile-menu" aria-label={(isMobile?mobileNavOpen:!desktopNavCollapsed)?"Close navigation menu":"Open navigation menu"} aria-controls="vision-sidebar" aria-expanded={isMobile?mobileNavOpen:!desktopNavCollapsed} onClick={toggleNavigation}>{isMobile?mobileNavOpen?<X size={21}/>:<Menu size={21}/>:desktopNavCollapsed?<Menu size={21}/>:<X size={21}/>}</button><span>VISION / <b>{navigation.find(n=>n.id===page)?.label||"Overview"}</b></span></div><div className="topbar-right"><select aria-label="Active school" value={schoolId} onChange={e=>{setSchoolId(e.target.value);setPage("overview");setAssessmentView("structure");}}><option value="">Select a school</option>{identity.schools.filter(s=>identity.admin||identity.memberships.some(m=>m.school_id===s.id)||identity.consultantSchools.includes(s.id)).map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select><span className="avatar">{loginLabel(session.user).slice(0,1).toUpperCase()}</span></div></header><div className="content"><div className="page-heading"><div><span className="eyebrow">{school?.name||"PLATFORM WORKSPACE"}</span><h1>{navigation.find(n=>n.id===page)?.label||"Overview"}</h1><p>{page==="overview"?"An integrated view of school operations and foundational learning.":"Secure workspace · "+(identity.admin?"Super Admin":role||"Assigned member")}</p></div>{schoolId&&<Btn kind="outline" disabled={busy} onClick={refresh}><RefreshCw size={15}/> Refresh</Btn>}</div><Notice message={message}/>
 {page==="overview"&&<><div className="stats"><div className="stat"><span>Schools assigned</span><strong>{new Set([...identity.memberships.map(m=>m.school_id),...identity.consultantSchools]).size}</strong><small>School access</small></div><div className="stat"><span>Classes</span><strong>{visibleClasses.length}</strong><small>Accessible classes</small></div><div className="stat"><span>Students</span><strong>{students.filter(s=>s.active!==false&&visibleClasses.some(c=>c.id===s.class_id)).length}</strong><small>Registered learners</small></div><div className="stat"><span>Assessment sessions</span><strong>{assessments.filter(a=>visibleClasses.some(c=>c.id===a.class_id)).length}</strong><small>Last 500 loaded</small></div></div><div className="two-col"><Box title="Your learning workflow"><div className="workflow">{["Set up school and staff","Create classes and student rosters","Assess cumulative competencies","Review literacy level and interventions"].map((t,i)=><div key={t} className="workflow-row"><span>{i+1}</span>{t}<CircleCheck size={16}/></div>)}</div></Box><Box title="Product readiness"><div className="readiness"><p><CircleCheck size={17}/> Unified authentication and role-aware interface</p><p><CircleCheck size={17}/> Cumulative student assessment and reports</p><p><AlertCircle size={17}/> Legacy evidence migration requires secure ID mapping</p><p><AlertCircle size={17}/> Production security review and end-to-end testing pending</p></div></Box></div></>}
 {page==="permissions"&&identity.admin&&<RolePermissions session={session}/>}
 {page==="schools"&&can("schools.view")&&<div className="two-col"><Box title="Registered schools">{identity.schools.length?<div className="rows">{identity.schools.map(s=><div className="record" key={s.id}><School size={17}/><strong>{s.name}</strong></div>)}</div>:<Empty title="No schools yet" detail="Create your first school to begin."/>}</Box>{identity.admin&&<Box title="Register a school"><form onSubmit={addSchool} className="stack"><label>School name<input required maxLength={180} value={newSchool} onChange={e=>setNewSchool(e.target.value)} placeholder="Full registered school name"/></label><Btn kind="primary" type="submit" disabled={busy}><Plus size={16}/> Create school</Btn></form></Box>}</div>}
 {page==="users"&&(identity.admin||schoolId)&&
  (can("users.manage")||can("classes.view")||can("classes.manage")||can("classes.import")||
   can("teachers.assign")||can("staff.import")||can("students.manage")||
   can("students.import")||can("data.export"))&&
  <SchoolManagementWorkspace client={client} session={session} schoolId={schoolId}
   schoolName={school?.name||"Selected school"} schools={identity.schools} classes={visibleClasses}
   students={students.filter(s=>visibleClasses.some(c=>c.id===s.class_id))}
   members={members} teacherClasses={teacherClasses}
   grants={roleGrants} isAdmin={identity.admin} canManageAllRoles={canManageAllRoles}
   onChanged={refresh}/>}
 {page==="consultants"&&can("consultants.manage")&&<ConsultantManagement session={session} schools={identity.schools.filter(x=>identity.admin||identity.consultantSchools.includes(x.id)||identity.memberships.some(m=>m.school_id===x.id))}/>} 
 {page==="consultant"&&schoolId&&(can("consultants.support")||can("consultants.log"))&&
  <ConsultantWorkspace session={session} schoolId={schoolId} schoolName={school?.name||"Selected school"}
   isConsultant={can("consultants.log")}/>}

 {page==="training"&&(identity.admin||schoolId)&&
  <TrainingWorkspace session={session} client={client} schoolId={schoolId}
   schoolName={school?.name||"Selected school"} schools={identity.schools}
   competencies={competencies} grants={roleGrants} isAdmin={identity.admin}/>}
 {page==="assessment-structure"&&schoolId&&
  (can("competencies.view")||can("teacher_reviews.create")||can("assessments.create")||can("assessments.view"))&&<>
  {assessmentView!=="structure"&&<section className="panel">
   <button className="btn outline" type="button" onClick={()=>setAssessmentView("structure")}>← Back to Assessment Structure</button>
   <p className="helper">{assessmentView==="student"?"Student competency assessment and assessment history.":"Teacher skills observation and review."} Both assessment workflows are accessible from Assessment Structure.</p>
  </section>}
  {assessmentView==="structure"&&<AssessmentStructure client={client} competencies={competencies}
   onNavigate={view=>setAssessmentView(view==="assess"?"student":"teacher")}
   canStudentAssess={can("assessments.create")||can("assessments.view")}
   canTeacherReview={can("teacher_reviews.create")}/>}
  {assessmentView==="student"&&(can("assessments.create")||can("assessments.view"))&&<AssessorWorkspace
   client={client} session={session} schoolId={schoolId} classes={visibleClasses}
   students={students} competencies={competencies} canCreate={can("assessments.create")} canViewHistory={can("assessments.view")}
   canUploadEvidence={can("assessments.evidence.upload")} canViewEvidence={can("assessments.evidence.view")} onSaved={refresh}/>}
  {assessmentView==="teacher"&&can("teacher_reviews.create")&&
   <TeacherSkillsReview client={client} schoolId={schoolId}
    classes={visibleClasses} members={members} teacherClasses={teacherClasses}
    competencies={competencies} onSaved={refresh}/>}
 </>}
 {page==="competencies"&&schoolId&&can("competencies.edit")&&<CurriculumEditor competencies={competencies} session={session} onSaved={refresh}/>}
 {page==="competencies"&&schoolId&&(can("competencies.view")||can("competencies.edit"))&&<Box title="Published literacy progression"><div className="level-grid">{LEVELS.map(l=><div key={l} className="level"><strong>{l}</strong><span>{competencies.filter(c=>c.active&&c.grade===l).length} competencies</span></div>)}</div><div className="rows">{competencies.filter(c=>c.active).sort((a,b)=>formatGrade(a.grade)-formatGrade(b.grade)||a.sequence-b.sequence).map(c=><div key={c.id} className="record"><BookOpen size={16}/><strong>{c.title}</strong><small>{c.grade}</small></div>)}</div><div className="helper">Only the Platform Super Admin can create, edit or publish competencies. Consultants and school stakeholders can view published learning progressions.</div></Box>}
 {page==="reports"&&schoolId&&can("reports.view")&&<section className="panel progress-reports-navigation">
  <div className="panel-head"><h2><ChartNoAxesCombined size={19}/> Consolidated Progress Reports</h2>
   <span className="eyebrow">STUDENT · TEACHER · SCHOOL</span></div>
  <p className="helper">Review learner competencies, teacher development and school implementation using the records already captured in Vision. Only permitted sections are available for your role and assigned school.</p>
  <div className="management-tabs" role="group" aria-label="Progress report type">
   <button type="button" className={"management-tab "+(reportsTab==="student"?"active":"")}
    aria-pressed={reportsTab==="student"} onClick={()=>setReportsTab("student")}>Student Progress</button>
   {(identity.admin||isManager)&&<button type="button" className={"management-tab "+(reportsTab==="teacher"?"active":"")}
    aria-pressed={reportsTab==="teacher"} onClick={()=>setReportsTab("teacher")}>Teacher Progress</button>}
   {(identity.admin||isManager)&&<button type="button" className={"management-tab "+(reportsTab==="school"?"active":"")}
    aria-pressed={reportsTab==="school"} onClick={()=>setReportsTab("school")}>School Progress</button>}
  </div>
 </section>}
 {page==="reports"&&schoolId&&can("reports.view")&&reportsTab==="student"&&<Box title="Individual literacy progression"><label>Student<select value={reportStudent} onChange={e=>loadReport(e.target.value)}><option value="">Select student</option>{students.filter(s=>s.active!==false&&visibleClasses.some(c=>c.id===s.class_id)).map(s=><option key={s.id} value={s.id}>{s.student_name}</option>)}</select></label>{reportData&&<><div className="stats report-stats"><div className="stat"><span>Enrolled grade</span><strong>{reportData.cls?.grade}</strong></div><div className="stat"><span>Demonstrated level</span><strong>{reportData.progress.highest||"Not established"}</strong></div></div><div className="rows">{reportData.progress.byLevel.map(l=><div key={l.level} className="progress-row"><strong>{l.level}</strong><div className="progress-bar"><span style={{width:l.independence+"%"}}/></div><small>{l.assessed}/{l.count} assessed · {l.independence}% independent</small></div>)}</div><p className="helper">Provisional threshold: 80% assessed and 80% independent at each consecutive level. This is a screening indicator, not a diagnosis.</p><StudentSoundReport client={client} schoolId={schoolId}
   student={students.find(row=>row.id===reportStudent)} competencies={competencies}
   enabled={can("assessments.view")}/>
   {can("assessments.evidence.view")&&<StudentAssessmentEvidence
    session={session} schoolId={schoolId} studentId={reportStudent}
    competencies={competencies}/>}
   <TrainingImpactPanel session={session} schoolId={schoolId}
   studentId={reportStudent} enabled={!!reportStudent}/></>}</Box>}
 {page==="reports"&&schoolId&&can("reports.view")&&(identity.admin||isManager)&&
  (reportsTab==="teacher"||reportsTab==="school")&&
  <TeacherSchoolReports client={client} session={session} schoolId={schoolId}
   mode={reportsTab} competencies={competencies}/>}
 {page==="implementation"&&schoolId&&
   (can("implementation.view")||can("implementation.submit")||can("implementation.review"))&&
   <ImplementationWorkspace client={client} session={session} schoolId={schoolId}
     schoolName={school?.name||"Selected school"} competencies={competencies}
     isAdmin={identity.admin} grants={roleGrants}/>}
 {page==="observations"&&can("observations.view")&&
   <Box title="Classroom observations"><Empty title="Historical observation integration is being prepared" detail="The existing Streamlit observation workflow remains operational. Observation rubric and legacy record migration are separate from Teacher Implementation evidence."/></Box>}
 {!schoolId&&!identity.admin&&<Empty title="No school membership found" detail="Ask your Platform Super Admin to assign your account to a school."/>}
 </div></main></div>;
}
