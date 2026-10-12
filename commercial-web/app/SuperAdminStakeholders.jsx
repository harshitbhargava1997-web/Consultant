"use client";
import {useEffect,useMemo,useState} from "react";
import {CheckCircle2,RefreshCw,School,ShieldCheck,UserRoundPlus,Users} from "lucide-react";

const ROLES=[
 {id:"owner",title:"School Owner"},
 {id:"principal",title:"Principal"},
 {id:"coordinator",title:"Coordinator"}
];
const labelForRole={owner:"School Owner",principal:"Principal",coordinator:"Coordinator",teacher:"Teacher"};
const blank=()=>({name:"",email:"",role:"owner",initialPassword:"",confirmPassword:""});

export default function SuperAdminStakeholders({session,schools=[],selectedSchoolId="",onChanged}){
 const [schoolId,setSchoolId]=useState("");
 const [form,setForm]=useState(blank);
 const [people,setPeople]=useState([]);
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [notice,setNotice]=useState(""),[search,setSearch]=useState("");
 const [filterRole,setFilterRole]=useState("all");
 useEffect(()=>{
  setSchoolId(current=>schools.some(s=>s.id===current)?current:
   schools.find(s=>s.id===selectedSchoolId)?.id||schools[0]?.id||"");
 },[schools,selectedSchoolId]);
 async function reload(){
  setLoading(true);
  try{
   const res=await fetch("/api/admin?view=stakeholders",{
    headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"
   });
   const data=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(data.error||"Unable to load the school user directory.");
   setPeople(data.memberships||[]);
  }catch(error){setNotice("Unable to review stakeholder accounts: "+error.message);}
  finally{setLoading(false);}
 }
 useEffect(()=>{let alive=true;
  fetch("/api/admin?view=stakeholders",{headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"})
   .then(async res=>{const data=await res.json().catch(()=>({}));if(!res.ok)throw Error(data.error||"Account listing unavailable.");return data;})
   .then(data=>{if(alive){setPeople(data.memberships||[]);setLoading(false);}})
   .catch(error=>{if(alive){setNotice(error.message);setLoading(false);}});
  return()=>{alive=false;};
 },[session?.access_token]);
 async function create(e){
  e.preventDefault();
  if(busy)return;
  if(!schoolId){setNotice("Select the school for this account.");return;}
  if(form.initialPassword!==form.confirmPassword){setNotice("Both initial passwords must match.");return;}
  if(!ROLES.some(r=>r.id===form.role)){setNotice("Select a valid school leadership role.");return;}
  setBusy(true);setNotice("");
  try{
   const res=await fetch("/api/admin",{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
    body:JSON.stringify({action:"createUser",schoolId,role:form.role,
     fullName:form.name.trim(),email:form.email.trim(),initialPassword:form.initialPassword})
   });
   const result=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(result.error||"Unable to create school leader account.");
   setForm(blank());
   await reload();
   if(onChanged)await onChanged();
   setNotice((result.created?"Login created. ":"Account assigned. ")+
    "The selected stakeholder is registered in the school. "+(result.created?
    "Share the initial password securely; it is not included in account lists.":
    "The existing password has not been changed."));
  }catch(error){setNotice("Account was not saved: "+error.message);}
  finally{setBusy(false);}
 }
 const schoolName=new Map(schools.map(s=>[s.id,s.name]));
 const leaders=people.filter(p=>ROLES.some(r=>r.id===p.role));
 const filtered=useMemo(()=>leaders.filter(p=>(!schoolId||p.school_id===schoolId)&&
  (filterRole==="all"||p.role===filterRole)&&
  [p.display_name,p.email,labelForRole[p.role],schoolName.get(p.school_id)].join(" ")
    .toLowerCase().includes(search.trim().toLowerCase())
 ).sort((a,b)=>a.role.localeCompare(b.role)||(a.display_name||"").localeCompare(b.display_name||"")),
 [people,schoolId,filterRole,search,schools]);
 return <div className="management-admin-leaders">
  <section className="panel">
   <div className="panel-head">
    <h2><ShieldCheck size={19}/> School leadership accounts</h2>
    <span className="eyebrow">SUPER ADMIN ONLY</span>
   </div>
   <p className="helper">Create and review login IDs for School Owners, Principals and Coordinators. Each account is assigned to a specific school; the user's permissions are set through Super Admin → Role Permissions.</p>
   <div className="management-role-types">
    {ROLES.map(role=><div key={role.id} className="management-role-type">
     <Users size={17}/><strong>{role.title}</strong>
     <span>{leaders.filter(p=>p.role===role.id&&(!schoolId||p.school_id===schoolId)).length} registered</span>
    </div>)}
   </div>
  </section>
  <div className="two-col">
   <section className="panel">
    <div className="panel-head"><h2><UserRoundPlus size={18}/> Create school leadership login</h2></div>
    <form className="stack" onSubmit={create}>
     <label>School<select value={schoolId} required onChange={e=>setSchoolId(e.target.value)}>
      <option value="">Select school</option>
      {schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
     </select></label>
     <label>Stakeholder role<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
      {ROLES.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}
     </select></label>
     <label>Full name<input minLength={2} maxLength={160} required value={form.name}
      onChange={e=>setForm({...form,name:e.target.value})} placeholder="Name of school owner, principal or coordinator"/></label>
     <label>Login email<input required type="email" value={form.email}
      onChange={e=>setForm({...form,email:e.target.value})} placeholder="person@school.edu"/></label>
     <label>Initial password (new account)<input type="password" autoComplete="new-password"
      minLength={12} maxLength={128} value={form.initialPassword}
      onChange={e=>setForm({...form,initialPassword:e.target.value})} placeholder="Choose strong initial password"/></label>
     <label>Confirm initial password<input type="password" autoComplete="new-password"
      minLength={12} maxLength={128} value={form.confirmPassword}
      onChange={e=>setForm({...form,confirmPassword:e.target.value})} placeholder="Enter the same password"/></label>
     <p className="helper">New accounts need 12–128 characters including upper- and lowercase letters, a number, and a symbol. To assign an existing email to this school, leave both password fields blank. Existing passwords are never shown or changed.</p>
     <button className="btn primary" type="submit" disabled={busy||!schoolId}>
      <UserRoundPlus size={16}/>{busy?"Creating account…":"Create / assign login"}
     </button>
    </form>
   </section>
   <section className="panel">
    <div className="panel-head"><h2><School size={18}/> Review school leadership accounts</h2></div>
    <div className="management-filters">
     <label>Role<select value={filterRole} onChange={e=>setFilterRole(e.target.value)}>
      <option value="all">All leadership roles</option>
      {ROLES.map(r=><option key={r.id} value={r.id}>{r.title}</option>)}
     </select></label>
     <label>Search<input type="search" value={search} onChange={e=>setSearch(e.target.value)}
      placeholder="Name or login email"/></label>
    </div>
    <div className="table-wrap">
     <table><thead><tr><th>Full name</th><th>Role</th><th>Login email</th><th>School</th></tr></thead>
      <tbody>{filtered.map(p=><tr key={p.school_id+":"+p.user_id}>
       <td><strong>{p.display_name||"Unnamed account"}</strong></td>
       <td>{labelForRole[p.role]}</td><td>{p.email||"Not available"}</td>
       <td>{schoolName.get(p.school_id)||"Assigned school"}</td>
      </tr>)}</tbody></table>
    </div>
    {loading?<p className="helper">Loading registered school leaders…</p>:
     !filtered.length?<p className="helper">No registered leaders match this school and filter.</p>:null}
    <button type="button" className="btn outline" disabled={loading||busy} onClick={reload}>
     <RefreshCw size={15}/> Refresh account directory
    </button>
    <p className="helper">Login credentials are never exported here. A listed email is a login identifier; it does not confirm ownership of the email address.</p>
   </section>
  </div>
  {notice&&<div className="notice" role="status"><CheckCircle2 size={17}/>{notice}</div>}
 </div>;
}
