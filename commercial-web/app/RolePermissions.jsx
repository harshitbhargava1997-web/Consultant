"use client";
import {useEffect,useState} from "react";
import {AlertTriangle,CheckCircle2,LockKeyhole,RefreshCw,Shield,ShieldCheck} from "lucide-react";
import {PERMISSION_ROLES,PERMISSION_GROUPS} from "../lib/permissions";
const ROLE_LABELS={consultant:"Consultant",owner:"School Owner",principal:"Principal",coordinator:"Coordinator",teacher:"Teacher"};
export default function RolePermissions({session}){
 const [role,setRole]=useState("consultant");
 const [matrix,setMatrix]=useState([]),[busy,setBusy]=useState(""),[status,setStatus]=useState("");
 const [loading,setLoading]=useState(true);
 async function load(){
  setLoading(true);setStatus("");
  try{
   const response=await fetch("/api/permissions",{headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||"Unable to load permissions.");
   if(!result.isAdmin)throw Error("Super Admin access is required.");
   setMatrix(result.matrix||[]);
  }catch(e){setStatus(e.message);}finally{setLoading(false);}
 }
 useEffect(()=>{load();},[session?.access_token]);
 async function toggle(feature,enabled){
  if(busy)return;
  if(["competencies.edit","data.export","consultants.manage"].includes(feature)&&enabled){
   const message=feature==="competencies.edit"
    ?"This grants permission to change the shared competency library across every school. Continue?"
    :feature==="data.export"
    ?"This allows downloading existing student and stakeholder data for authorized schools. Continue?"
    :"This allows managing Consultant assignments within schools that the role already accesses. Continue?";
   if(!window.confirm(message))return;
  }
  setBusy(role+feature);setStatus("");
  try{
   const response=await fetch("/api/permissions",{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
    body:JSON.stringify({role,feature,enabled})
   });
   const json=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(json.error||"Unable to save permission.");
   setMatrix(current=>current.map(row=>row.role===role&&row.feature===feature?{...row,enabled}:row));
   setStatus(ROLE_LABELS[role]+": "+feature+" "+(enabled?"enabled":"disabled")+". Changes apply at the next permission check.");
  }catch(e){setStatus(e.message);}finally{setBusy("");}
 }
 const rows=matrix.filter(x=>x.role===role);
 const current=rowKey=>rows.find(x=>x.feature===rowKey)?.enabled===true;
 const count=rows.filter(x=>x.enabled).length;
 return <div className="role-permissions">
  <section className="panel">
   <div className="panel-head"><h2><ShieldCheck size={20}/> Stakeholder role permissions</h2><span className="eyebrow">SUPER ADMIN CONTROL</span></div>
   <p className="helper">Set platform-wide defaults for each role. Changes apply to all schools where that role has an existing membership or Consultant assignment. Permissions do not grant access to an unrelated school or class.</p>
   <div className="role-picker" role="group" aria-label="Select stakeholder role">
    {PERMISSION_ROLES.map(item=><button key={item} type="button" disabled={loading||!!busy}
     className={"btn "+(role===item?"primary":"outline")} onClick={()=>{setRole(item);setStatus("");}} aria-pressed={role===item}>
     {ROLE_LABELS[item]}</button>)}
   </div>
   <div className="role-summary">
    <span><Shield size={17}/> {ROLE_LABELS[role]} permissions</span>
    <strong>{loading?"Loading…":count+" of "+rows.length+" enabled"}</strong>
    <button type="button" className="btn outline" disabled={loading||!!busy} onClick={load}><RefreshCw size={15}/> Refresh</button>
   </div>
  </section>
  {PERMISSION_GROUPS.map(group=><section className="panel" key={group.title}>
   <div className="panel-head"><h2>{group.title}</h2></div>
   <div className="role-setting-list">{group.items.map(item=><label className="role-setting" key={item.key}>
    <span className="role-setting-info"><strong>{item.label}</strong><small>{item.description}</small></span>
    <input aria-label={ROLE_LABELS[role]+" · "+item.label} type="checkbox"
     disabled={loading||!!busy||!rows.some(row=>row.feature===item.key)}
     checked={current(item.key)} onChange={e=>toggle(item.key,e.target.checked)}/>
   </label>)}</div>
  </section>)}
  <section className="panel">
   <div className="panel-head"><h2><LockKeyhole size={18}/> Protected Super Admin powers</h2></div>
   <div className="role-setting-list">
    <div className="role-setting"><span className="role-setting-info"><strong>Create a new school</strong><small>Only the Super Admin can create schools, regardless of other toggles.</small></span><span className="role-locked"><LockKeyhole size={14}/> Locked</span></div>
    <div className="role-setting"><span className="role-setting-info"><strong>Manage role permissions</strong><small>Only the Super Admin may modify these access settings or grant export privileges.</small></span><span className="role-locked"><LockKeyhole size={14}/> Locked</span></div>
   </div>
   <div className="notice small"><AlertTriangle size={16}/><span>Powerful features such as record exports and shared curriculum editing start disabled for all other roles. Enabling them changes access for all users of the chosen role. Existing student assessment history is preserved.</span></div>
  </section>
  {status&&<div role="status" className="notice"><CheckCircle2 size={17}/>{status}</div>}
 </div>;
}
