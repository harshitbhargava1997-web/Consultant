"use client";

import {useEffect,useMemo,useState} from "react";
import {BookMarked,Check,GraduationCap,Plus,Search,Trash2,Users,FileUp} from "lucide-react";
import BulkWorkspace from "./BulkWorkspace";
import SuperAdminStakeholders from "./SuperAdminStakeholders";
import {ConsultantManagement} from "./ConsultantWorkspace";
import {LEVELS} from "../lib/supabase";

const tabs=[
 {id:"leaders",label:"School leadership",icon:Users},
 {id:"consultants",label:"Consultants",icon:Users},
 {id:"classes",label:"Classes",icon:BookMarked},
 {id:"teachers",label:"Teachers & staff",icon:Users},
 {id:"students",label:"Students",icon:GraduationCap}
];
function firstClass(classes){return classes.length?classes[0].id:"";}
function displayClass(c){return [c.grade,c.section,c.academic_year].join(" · ");}
export default function SchoolManagementWorkspace({
 client,session,schoolId,schoolName,schools=[],classes=[],students=[],members=[],teacherClasses=[],
 grants=[],isAdmin=false,canManageAllRoles=false,onChanged
}){
 const can=feature=>isAdmin||grants.includes(feature);
 const availableTabs=tabs.filter(t=>{
  if(t.id==="leaders"||t.id==="consultants")return isAdmin;
  if(!schoolId)return false;
  return t.id==="classes"?(can("classes.view")||can("classes.manage")||can("classes.import")):
   t.id==="teachers"?(can("users.manage")||can("teachers.assign")||can("staff.import")):
    (can("classes.view")||can("students.manage")||can("students.import"));
 });
 const [tab,setTab]=useState(isAdmin?"leaders":"classes"),[expandedBulk,setExpandedBulk]=useState("");
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const [classForm,setClassForm]=useState({grade:"Nursery",section:"A",academic_year:"2026-27"});
 const [staff,setStaff]=useState({name:"",email:"",mobile:"",role:"teacher",initialPassword:"",confirmPassword:""});
 const [selectedTeacher,setSelectedTeacher]=useState(""),[chosenClasses,setChosenClasses]=useState([]);
 const [studentClass,setStudentClass]=useState(""),[studentName,setStudentName]=useState(""),[admission,setAdmission]=useState("");
 const [teacherSearch,setTeacherSearch]=useState(""),[studentSearch,setStudentSearch]=useState("");
 const [rosterFilter,setRosterFilter]=useState("all");
 const [showArchived,setShowArchived]=useState(false);
 const teachers=useMemo(()=>members.filter(m=>m.role==="teacher").sort((a,b)=>
  (a.display_name||"").localeCompare(b.display_name||"")),[members]);
 const studentsInSchool=students.filter(s=>showArchived||s.active!==false);
 const classNames=new Map(classes.map(c=>[c.id,displayClass(c)]));
 const ids=new Set(classes.map(c=>c.id));
 const validTeacherAssignments=teacherClasses.filter(x=>ids.has(x.class_id));
 const teacherCounts=new Map();
 const studentCounts=new Map();
 for(const tc of validTeacherAssignments)teacherCounts.set(tc.class_id,(teacherCounts.get(tc.class_id)||0)+1);
 for(const s of students)if(s.active!==false)studentCounts.set(s.class_id,(studentCounts.get(s.class_id)||0)+1);
 useEffect(()=>{setNotice("");setExpandedBulk("");setTab(availableTabs[0]?.id||(isAdmin?"leaders":"classes"));setSelectedTeacher("");setStudentClass("");},[schoolId]);
 useEffect(()=>{if(availableTabs.length&&!availableTabs.some(t=>t.id===tab))setTab(availableTabs[0].id);},
  [tab,grants.join(","),isAdmin,availableTabs.map(t=>t.id).join("|")]);
 useEffect(()=>{setStudentClass(old=>classes.some(c=>c.id===old)?old:firstClass(classes));},[classes]);
 useEffect(()=>{
  setChosenClasses(validTeacherAssignments.filter(x=>x.teacher_user_id===selectedTeacher).map(x=>x.class_id));
 },[selectedTeacher,teacherClasses,classes]);
 async function reload(){if(onChanged)await onChanged();}
 async function createClass(e){
  e.preventDefault();
  if(!can("classes.manage"))return;
  setBusy(true);setNotice("");
  try{
   const payload={...classForm,school_id:schoolId,section:classForm.section.trim(),
    academic_year:classForm.academic_year.trim()};
   if(!payload.section||payload.section.length>30||!/^\d{4}-\d{2,4}$/.test(payload.academic_year))
    throw Error("Enter a section and academic year such as 2026-27.");
   const {error}=await client.from("literacy_classes").insert(payload);
   if(error)throw error;
   await reload();setNotice("Class created. It is ready for teacher and student assignments.");
  }catch(error){setNotice("Class was not created: "+error.message);}
  finally{setBusy(false);}
 }
 async function createStaff(e){
  e.preventDefault();
  if(!can("users.manage"))return;
  setNotice("");setBusy(true);
  try{
   if(staff.initialPassword!==staff.confirmPassword)throw Error("The initial passwords do not match.");
   const response=await fetch("/api/admin",{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
    body:JSON.stringify({action:"createUser",schoolId,fullName:staff.name.trim(),
     email:staff.email.trim(),mobile:staff.mobile.trim(),role:isAdmin?"teacher":canManageAllRoles?staff.role:"teacher",
     initialPassword:staff.initialPassword})
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(data.error||"Unable to add user.");
   setStaff({name:"",email:"",mobile:"",role:"teacher",initialPassword:"",confirmPassword:""});
   await reload();setNotice(data.message||"Account added. Select the teacher below to assign classes.");
  }catch(error){setNotice("Account was not saved: "+error.message);}
  finally{setBusy(false);}
 }
 function toggleClass(id,checked){
  setChosenClasses(old=>checked?[...new Set([...old,id])]:old.filter(x=>x!==id));
 }
 async function saveTeacherAssignments(){
  if(!can("teachers.assign")||!selectedTeacher)return;
  const teacher=teachers.find(x=>x.user_id===selectedTeacher);
  if(!teacher)return setNotice("Select a registered school teacher.");
  if(!chosenClasses.length&&!window.confirm("Remove all class assignments for "+(teacher.display_name||"this teacher")+"?"))return;
  setBusy(true);setNotice("");
  try{
   const {data,error}=await client.rpc("lit_set_teacher_classes",{
    p_school_id:schoolId,p_teacher_user_id:selectedTeacher,p_class_ids:chosenClasses
   });
   if(error)throw error;
   await reload();setNotice("Saved "+data+" class assignments for "+(teacher.display_name||"the teacher")+".");
  }catch(error){setNotice("Class assignment failed: "+error.message);}
  finally{setBusy(false);}
 }
 async function studentAction(action,values){
  const response=await fetch("/api/students",{
   method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
   body:JSON.stringify({action,schoolId,...values})
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(data.error||"Student operation failed.");
  return data;
 }
 async function createStudent(e){
  e.preventDefault();if(!can("students.manage"))return;
  setBusy(true);setNotice("");
  try{
   if(!classes.some(c=>c.id===studentClass))throw Error("Choose an assigned class.");
   const response=await studentAction("add",{classId:studentClass,studentName:studentName.trim(),admissionNumber:admission.trim()});
   setStudentName("");setAdmission("");await reload();setNotice(response.message||"Student registered.");
  }catch(error){setNotice("Student was not registered: "+error.message);}
  finally{setBusy(false);}
 }
 async function removeStudent(student){
  if(!can("students.manage"))return;
  if(!window.confirm("Remove "+student.student_name+" from the active roster? Existing assessments will be preserved."))return;
  setBusy(true);setNotice("");
  try{
   const result=await studentAction("remove",{classId:student.class_id,studentId:student.id});
   await reload();setNotice(result.message);
  }catch(error){setNotice("Student removal failed: "+error.message);}
  finally{setBusy(false);}
 }
 const visibleTeacherRows=teachers.filter(t=>(t.display_name||"").toLowerCase().includes(teacherSearch.trim().toLowerCase()));
 const visibleStudentRows=studentsInSchool.filter(s=>
  (rosterFilter==="all"||rosterFilter===s.class_id)&&
  (s.student_name+" "+s.admission_number).toLowerCase().includes(studentSearch.trim().toLowerCase())
 ).sort((a,b)=>a.student_name.localeCompare(b.student_name));
 const bulkProps={
  session,schoolId,schoolName,canExport:can("data.export"),canUploadStaff:can("staff.import"),
  canUploadStudents:can("students.import"),canUploadClasses:can("classes.import"),
  canManageRoles:canManageAllRoles,onImported:reload
 };
 function bulkArea(which,title){
  return <section className="manage-bulk-area">
   <button type="button" className="btn outline" onClick={()=>setExpandedBulk(old=>old===which?"":which)}
    aria-expanded={expandedBulk===which}><FileUp size={16}/> {expandedBulk===which?"Close bulk upload":"Bulk upload "+title}</button>
   {expandedBulk===which&&<BulkWorkspace {...bulkProps} fixedKind={which}/>}
  </section>;
 }
 return <div className="management-workspace">
  <section className="panel">
   <div className="panel-head"><h2>School user management</h2><span className="eyebrow">ONE SCHOOL WORKSPACE</span></div>
   <p className="helper">{isAdmin
    ?"Super Admin account management: create School Owner, Principal, Coordinator, Consultant and Teacher logins; manage class assignments, student rosters and Excel uploads in one place."
    :"Create, bulk upload and review classes, teachers and students. A teacher may teach several classes, while each student has one current class."}</p>
   <div className="management-overview">
    <div><small>Classes</small><strong>{classes.length}</strong></div>
    <div><small>Teachers</small><strong>{teachers.length}</strong></div>
    <div><small>Active students</small><strong>{students.filter(s=>s.active!==false).length}</strong></div>
   </div>
   <div className="management-tabs" role="group" aria-label="User management sections">
    {availableTabs.map(t=>{const Icon=t.icon;return <button type="button" key={t.id} aria-pressed={tab===t.id}
     className={"management-tab "+(tab===t.id?"active":"")} onClick={()=>{setTab(t.id);setNotice("");setExpandedBulk("");}}>
     <Icon size={17}/>{t.label}</button>;})}
   </div>
  </section>
  {notice&&<div className="notice" role="status">{notice}</div>}
  {isAdmin&&tab==="leaders"&&<SuperAdminStakeholders
   session={session} schools={schools} selectedSchoolId={schoolId} onChanged={reload}/>}
  {isAdmin&&tab==="consultants"&&<ConsultantManagement session={session} schools={schools} onChanged={reload}/>}
  {tab==="classes"&&availableTabs.some(t=>t.id==="classes")&&<>
   <div className="two-col">
    {can("classes.manage")&&<section className="panel">
     <div className="panel-head"><h2><Plus size={18}/> Create class</h2></div>
     <form onSubmit={createClass} className="stack">
      <label>Grade<select value={classForm.grade} onChange={e=>setClassForm({...classForm,grade:e.target.value})}>
       {LEVELS.map(g=><option value={g} key={g}>{g}</option>)}</select></label>
      <label>Section<input maxLength={30} required value={classForm.section} onChange={e=>setClassForm({...classForm,section:e.target.value})}/></label>
      <label>Academic year<input required maxLength={20} value={classForm.academic_year} onChange={e=>setClassForm({...classForm,academic_year:e.target.value})}/></label>
      <button className="btn primary" type="submit" disabled={busy}>Create class</button>
     </form>
    </section>}
    {can("classes.view")&&<section className="panel">
     <div className="panel-head"><h2>Review classes</h2></div>
     <div className="table-wrap"><table><thead><tr><th>Grade</th><th>Section</th><th>Academic year</th><th>Teachers</th><th>Students</th></tr></thead>
      <tbody>{classes.map(c=><tr key={c.id}><td>{c.grade}</td><td>{c.section}</td><td>{c.academic_year}</td>
       <td>{teacherCounts.get(c.id)||0}</td><td>{studentCounts.get(c.id)||0}</td></tr>)}</tbody></table></div>
     {!classes.length&&<p className="helper">No classes registered yet.</p>}
    </section>}
   </div>
   {(can("classes.import")||can("data.export"))&&bulkArea("classes","classes")}
  </>}
  {tab==="teachers"&&availableTabs.some(t=>t.id==="teachers")&&<>
   <div className="two-col">
    {can("users.manage")&&<section className="panel">
     <div className="panel-head"><h2><Plus size={18}/> Add teacher or school staff</h2></div>
     <form className="stack" onSubmit={createStaff}>
      <label>Name<input required minLength={2} maxLength={160} value={staff.name} onChange={e=>setStaff({...staff,name:e.target.value})}/></label>
      <label>Login email (optional for teachers)<input type="email" value={staff.email} onChange={e=>setStaff({...staff,email:e.target.value})}/></label>
      <label>Teacher mobile login (optional)<input type="tel" inputMode="tel" value={staff.mobile} onChange={e=>setStaff({...staff,mobile:e.target.value})} placeholder="9876543210"/></label>
      {canManageAllRoles&&!isAdmin&&<label>Stakeholder role<select value={staff.role} onChange={e=>setStaff({...staff,role:e.target.value})}>
       {["teacher","owner","principal","coordinator"].map(r=><option value={r} key={r}>{r}</option>)}</select></label>}
      <label>Initial password (new accounts)<input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={staff.initialPassword} onChange={e=>setStaff({...staff,initialPassword:e.target.value})}/></label>
      <label>Confirm password<input type="password" minLength={12} maxLength={128} autoComplete="new-password" value={staff.confirmPassword} onChange={e=>setStaff({...staff,confirmPassword:e.target.value})}/></label>
      <p className="helper">Provide an email, mobile number, or both for a teacher. Indian 10-digit numbers are stored with +91. New accounts require a strong password. Leave passwords blank to assign an existing user without changing their login.</p>
      <button className="btn primary" type="submit" disabled={busy}>Save staff member</button>
     </form>
    </section>}
    <section className="panel">
     <div className="panel-head"><h2>Review teachers</h2></div>
     <label className="manage-search"><Search size={15}/><input aria-label="Search teachers" value={teacherSearch} onChange={e=>setTeacherSearch(e.target.value)} placeholder="Search by teacher name"/></label>
     <div className="table-wrap"><table><thead><tr><th>Teacher</th><th>Classes assigned</th></tr></thead><tbody>
      {visibleTeacherRows.map(t=>{
       const titles=validTeacherAssignments.filter(a=>a.teacher_user_id===t.user_id).map(a=>classNames.get(a.class_id)).filter(Boolean);
       return <tr key={t.user_id}><td>{t.display_name||"Teacher"}</td>
        <td>{titles.length?titles.join(", "):"No classes assigned"}</td></tr>;
      })}</tbody></table></div>
     {!visibleTeacherRows.length&&<p className="helper">No matching teacher accounts in this school.</p>}
    </section>
   </div>
   {can("teachers.assign")&&<section className="panel">
    <div className="panel-head"><h2><Check size={18}/> Assign multiple classes to a teacher</h2></div>
    <p className="helper">Select a teacher and tick every class that they teach. Saving updates all assignments together, including unselected classes.</p>
    <label>Teacher<select value={selectedTeacher} onChange={e=>setSelectedTeacher(e.target.value)}>
     <option value="">Select a teacher</option>{teachers.map(t=><option key={t.user_id} value={t.user_id}>{t.display_name||"Teacher"}</option>)}</select></label>
    {selectedTeacher&&<><div className="manage-class-checks">{classes.map(c=><label key={c.id} className="manage-check">
     <input type="checkbox" checked={chosenClasses.includes(c.id)}
      onChange={e=>toggleClass(c.id,e.target.checked)}/>
     <span><strong>{c.grade} · {c.section}</strong><small>{c.academic_year}</small></span></label>)}</div>
     <button type="button" className="btn primary" disabled={busy} onClick={saveTeacherAssignments}>Save class assignments ({chosenClasses.length})</button>
    </>}
    {!classes.length&&<p className="helper">Create classes before assigning teachers.</p>}
   </section>}
   {(can("staff.import")||can("data.export"))&&bulkArea("stakeholders","teachers")}
  </>}
  {tab==="students"&&availableTabs.some(t=>t.id==="students")&&<>
   <div className="two-col">
    {can("students.manage")&&<section className="panel">
     <div className="panel-head"><h2><Plus size={18}/> Register a student</h2></div>
     <form className="stack" onSubmit={createStudent}>
      <label>Class<select required value={studentClass} onChange={e=>setStudentClass(e.target.value)}>
       <option value="">Choose class</option>{classes.map(c=><option value={c.id} key={c.id}>{displayClass(c)}</option>)}</select></label>
      <label>Student full name<input required minLength={2} maxLength={200} value={studentName} onChange={e=>setStudentName(e.target.value)}/></label>
      <label>Admission number (optional)<input maxLength={100} value={admission} onChange={e=>setAdmission(e.target.value)} placeholder="Generated automatically if blank"/></label>
      <button className="btn primary" type="submit" disabled={busy||!studentClass}>Add student to selected class</button>
     </form>
    </section>}
    <section className="panel">
     <div className="panel-head"><h2>Review students</h2></div>
     <div className="management-filters">
      <label>Class<select value={rosterFilter} onChange={e=>setRosterFilter(e.target.value)}>
       <option value="all">All accessible classes</option>
       {classes.map(c=><option value={c.id} key={c.id}>{displayClass(c)}</option>)}</select></label>
      <label>Search<input aria-label="Search student roster" value={studentSearch} onChange={e=>setStudentSearch(e.target.value)} placeholder="Student name or admission ID"/></label>
     </div>
     <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission ID</th><th>Assigned class</th>{can("students.manage")&&<th>Action</th>}</tr></thead>
      <tbody>{visibleStudentRows.map(s=><tr key={s.id}>
       <td>{s.student_name}{s.active===false?" (inactive)":""}</td><td>{s.admission_number}</td><td>{classNames.get(s.class_id)||"Unknown"}</td>
       {can("students.manage")&&<td>{s.active!==false&&<button type="button" className="btn outline" disabled={busy} onClick={()=>removeStudent(s)}><Trash2 size={15}/> Remove</button>}</td>}
      </tr>)}</tbody></table></div>
     {!visibleStudentRows.length&&<p className="helper">No matching student records.</p>}
     <label className="manage-archived"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/> Show inactive student records</label>
    </section>
   </div>
   {(can("students.import")||can("data.export"))&&bulkArea("students","students")}
  </>}
 </div>;
}
