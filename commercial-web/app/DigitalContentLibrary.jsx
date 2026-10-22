"use client";
import {useEffect,useMemo,useState} from "react";
import {BookOpen,Edit3,ExternalLink,Eye,FileText,Plus,Send,Users} from "lucide-react";
import {LEVELS} from "../lib/supabase";
import VcBlendingCourse from "./VcBlendingCourse";
import {getVcItem} from "../lib/vcCourse";

const GRADES=LEVELS.filter(grade=>grade==="Nursery"||grade==="LKG"||grade==="UKG"||/^Grade [1-5]$/.test(grade));
const TYPES=[
 {id:"demonstration",label:"Demonstration"},{id:"lesson_plan",label:"Lesson preparation"},
 {id:"activity",label:"Practice activity"},{id:"worksheet",label:"Worksheet"},
 {id:"audio",label:"Audio"},{id:"video",label:"Video"},{id:"external",label:"External resource"}
];
const ROLE_LABELS={consultant:"Consultant",owner:"School Owner",principal:"Principal",coordinator:"Coordinator",teacher:"Teacher"};
const ROLES=Object.keys(ROLE_LABELS);
const blank=()=>({id:"",title:"",summary:"",grade:"Nursery",competencyId:"",contentType:"demonstration",
 objective:"",preparation:"",demonstration:"",practice:"",checkUnderstanding:"",resourceUrl:"",
 targetRoles:[...ROLES],sequence:0});
const toggle=(list,value)=>list.includes(value)?list.filter(item=>item!==value):[...list,value];

export default function DigitalContentLibrary({session,schoolId,competencies=[],isAdmin=false}){
 const [items,setItems]=useState([]),[allowedGrades,setAllowedGrades]=useState(GRADES);
 const [grade,setGrade]=useState("Nursery"),[form,setForm]=useState(blank);
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [courseItem,setCourseItem]=useState(null);
 const grades=useMemo(()=>isAdmin?GRADES:GRADES.filter(value=>allowedGrades.includes(value)),[allowedGrades,isAdmin]);
 const gradeKey=grades.join("|");
 const gradeItems=items.filter(item=>item.grade===grade&&item.status!=="archived");
 const gradeCompetencies=competencies.filter(item=>item.grade===form.grade&&item.active!==false);
 async function load(){
  setLoading(true);setMessage("");
  try{
   const response=await fetch("/api/digital-content?schoolId="+encodeURIComponent(schoolId||""),{
    headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"
   });
   const json=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(json.error||"Unable to load digital content.");
   setItems(json.content||[]);setAllowedGrades(json.allowedGrades||[]);
  }catch(e){setMessage(e.message);}finally{setLoading(false);}
 }
 useEffect(()=>{load();},[session?.access_token,schoolId]);
 useEffect(()=>{setCourseItem(null);},[schoolId,session?.access_token,grade]);
 useEffect(()=>{if(grades.length&&!grades.includes(grade))setGrade(grades[0]);},[gradeKey,grade]);
 async function execute(action,payload){
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/digital-content?schoolId="+encodeURIComponent(schoolId||""),{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
    body:JSON.stringify({action,...payload})
   });
   const json=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(json.error||"Digital content was not saved.");
   await load();setMessage(json.message||"Saved.");return true;
  }catch(e){setMessage(e.message);return false;}finally{setBusy(false);}
 }
 async function save(event){
  event.preventDefault();
  if(await execute("save",form))setForm(blank());
 }
 function edit(item){
  setForm({id:item.id,title:item.title,summary:item.summary||"",grade:item.grade,competencyId:item.competency_id||"",
   contentType:item.content_type,objective:item.objective||"",preparation:item.preparation||"",
   demonstration:item.demonstration||"",practice:item.practice||"",checkUnderstanding:item.check_understanding||"",
   resourceUrl:item.resource_url||"",targetRoles:item.target_roles||[...ROLES],sequence:item.sequence||0});
  window.scrollTo({top:0,behavior:"smooth"});
 }
 return <div className="digital-content-library">
  <section className="panel digital-content-heading">
   <div className="panel-head"><h2><BookOpen size={20}/> Grade-wise Digital Content Library</h2><span className="eyebrow">CLASSROOM PREPARATION</span></div>
   <p className="helper">Select a grade to access published demonstrations, lesson preparation, practice resources and checks for understanding linked to the literacy progression.</p>
   <div className="digital-grade-tabs" role="group" aria-label="Select digital content grade">
    {grades.map(value=><button type="button" key={value} className={grade===value?"active":""} aria-pressed={grade===value} onClick={()=>setGrade(value)}>{value}</button>)}
   </div>
  </section>
  {message&&<div className="notice" role="status">{message}</div>}
  {!loading&&grade==="LKG"&&gradeItems.some(item=>getVcItem(item))&&<section className="panel vc-course-entry">
   <h2>VC Blending Course · A → E → I → O → U</h2>
   <p>Open the vowel units for preparation, interactive blending, printable worksheets and review inside Vision.</p>
   <button type="button" className="btn primary" onClick={()=>setCourseItem(gradeItems.find(item=>getVcItem(item)))}>Open VC course</button>
  </section>}
  {!loading&&courseItem&&gradeItems.some(item=>item.id===courseItem.id)&&<VcBlendingCourse key={courseItem.id} items={gradeItems.filter(item=>getVcItem(item))} initialItem={courseItem} isAdmin={isAdmin} onClose={()=>setCourseItem(null)}/>}
  {isAdmin&&<section className="panel digital-content-publisher">
   <div className="panel-head"><h2><Plus size={18}/> {form.id?"Edit digital content":"Create digital content"}</h2><span className="eyebrow">SUPER ADMIN PUBLISHING</span></div>
   <p className="helper">Saving creates a draft. Review it in the library below, then publish it to the selected stakeholder roles.</p>
   <form className="stack" onSubmit={save}>
    <div className="three-col">
     <label>Grade<select value={form.grade} onChange={event=>setForm({...form,grade:event.target.value,competencyId:""})}>{GRADES.map(value=><option key={value}>{value}</option>)}</select></label>
     <label>Content format<select value={form.contentType} onChange={event=>setForm({...form,contentType:event.target.value})}>{TYPES.map(type=><option value={type.id} key={type.id}>{type.label}</option>)}</select></label>
     <label>Display order<input type="number" min={0} max={10000} value={form.sequence} onChange={event=>setForm({...form,sequence:Number(event.target.value)})}/></label>
    </div>
    <label>Content title<input required minLength={4} maxLength={180} value={form.title} onChange={event=>setForm({...form,title:event.target.value})} placeholder="VC blending: modelling two sounds together"/></label>
    <label>Short summary<textarea rows={2} maxLength={1000} value={form.summary} onChange={event=>setForm({...form,summary:event.target.value})} placeholder="What this preparation helps the teacher demonstrate."/></label>
    <label>Linked competency<select value={form.competencyId} onChange={event=>setForm({...form,competencyId:event.target.value})}><option value="">General grade content</option>{gradeCompetencies.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
    <div className="two-col">
     <label>Understand · objective<textarea rows={4} maxLength={3000} value={form.objective} onChange={event=>setForm({...form,objective:event.target.value})}/></label>
     <label>Prepare · materials and setup<textarea rows={4} maxLength={12000} value={form.preparation} onChange={event=>setForm({...form,preparation:event.target.value})}/></label>
     <label>Demonstrate · teacher modelling steps<textarea rows={5} maxLength={12000} value={form.demonstration} onChange={event=>setForm({...form,demonstration:event.target.value})}/></label>
     <label>Practise · child activity<textarea rows={5} maxLength={12000} value={form.practice} onChange={event=>setForm({...form,practice:event.target.value})}/></label>
    </div>
    <label>Check understanding · observable evidence<textarea rows={4} maxLength={12000} value={form.checkUnderstanding} onChange={event=>setForm({...form,checkUnderstanding:event.target.value})}/></label>
    <label>Optional HTTPS resource link<input type="url" maxLength={1500} value={form.resourceUrl} onChange={event=>setForm({...form,resourceUrl:event.target.value})} placeholder="https://..."/></label>
    <div><strong className="training-label">Publish to stakeholder roles</strong><div className="digital-role-options">{ROLES.map(role=><label className="manage-check" key={role}><input type="checkbox" checked={form.targetRoles.includes(role)} onChange={()=>setForm({...form,targetRoles:toggle(form.targetRoles,role)})}/><span><strong>{ROLE_LABELS[role]}</strong></span></label>)}</div></div>
    <div className="digital-publisher-actions"><button className="btn primary" type="submit" disabled={busy||!form.targetRoles.length}><FileText size={16}/>{busy?"Saving…":"Save draft"}</button>{form.id&&<button className="btn outline" type="button" onClick={()=>setForm(blank())}>Cancel editing</button>}</div>
   </form>
  </section>}
  <section className="panel">
   <div className="panel-head"><h2><Eye size={18}/> {grade} preparation</h2><span className="eyebrow">{gradeItems.length} ITEMS</span></div>
   {loading&&<p className="helper">Loading digital content…</p>}
   {!loading&&!grades.length&&<p className="helper">No assigned class grades are available for this teacher account.</p>}
   {!loading&&grades.length&&!gradeItems.length&&<p className="helper">No digital content has been published for {grade} yet.</p>}
   <div className="digital-content-grid">{gradeItems.map(item=>{
    const competency=competencies.find(value=>value.id===item.competency_id);
    return <article className="digital-content-card" key={item.id}>
     <div className="digital-content-card-head"><span>{TYPES.find(type=>type.id===item.content_type)?.label||"Content"}</span>{isAdmin&&<em className={item.status}>{item.status}</em>}</div>
     <h3>{item.title}</h3>{item.summary&&<p>{item.summary}</p>}{competency&&<small>Competency: {competency.title}</small>}
     <div className="digital-content-sections">
      {item.objective&&<details open><summary>Understand</summary><div>{item.objective}</div></details>}
      {item.preparation&&<details><summary>Prepare</summary><div>{item.preparation}</div></details>}
      {item.demonstration&&<details><summary>Demonstrate</summary><div>{item.demonstration}</div></details>}
      {item.practice&&<details><summary>Practise</summary><div>{item.practice}</div></details>}
      {item.check_understanding&&<details><summary>Check understanding</summary><div>{item.check_understanding}</div></details>}
     </div>
     {getVcItem(item)?<button className="btn outline" type="button" onClick={()=>setCourseItem(item)}>Open in Vision <BookOpen size={15}/></button>:item.resource_url&&<a className="btn outline" href={item.resource_url} target="_blank" rel="noopener noreferrer">Open resource <ExternalLink size={15}/></a>}
     {isAdmin&&<div className="digital-content-admin-actions"><button className="btn outline" type="button" disabled={busy} onClick={()=>edit(item)}><Edit3 size={14}/> Edit</button>{item.status!=="published"?<button className="btn primary" type="button" disabled={busy} onClick={()=>execute("status",{id:item.id,status:"published"})}><Send size={14}/> Publish</button>:<button className="btn outline" type="button" disabled={busy} onClick={()=>execute("status",{id:item.id,status:"draft"})}>Unpublish</button>}<button className="btn outline" type="button" disabled={busy} onClick={()=>execute("status",{id:item.id,status:"archived"})}>Archive</button></div>}
     <footer><Users size={13}/>{(item.target_roles||[]).map(role=>ROLE_LABELS[role]).join(", ")}</footer>
    </article>;
   })}</div>
  </section>
 </div>;
}
