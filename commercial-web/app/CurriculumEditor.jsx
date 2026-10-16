"use client";
import {useEffect,useState} from "react";
import {Plus,Save,AlertTriangle,Trash2} from "lucide-react";
import {LEVELS} from "../lib/supabase";
const empty={code:"",grade:"Nursery",strand:"Phonics",title:"",description:"",sequence:1,active:false,version:0};
export default function CurriculumEditor({competencies,session,onSaved}){
 const [selected,setSelected]=useState("new");
 const [form,setForm]=useState({...empty});
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{
  const original=competencies.find(c=>c.id===selected);
  if(original)setForm({
   id:original.id,code:original.code,grade:original.grade,strand:original.strand||"Literacy",
   title:original.title,description:original.description||"",sequence:original.sequence,
   active:!!original.active,version:original.version||1
  });
  else setForm({...empty});
 },[selected,competencies]);
 async function save(e){
  e.preventDefault();
  setBusy(true);setMessage("");
  try{
   const res=await fetch("/api/curriculum",{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
    body:JSON.stringify({...form,action:selected==="new"?"create":"update"})
   });
   const data=await res.json();
   if(!res.ok)throw Error(data.error||"Unable to save competency.");
   setMessage(data.message+" Changes are recorded in the competency history.");
   if(onSaved)await onSaved();
   if(selected==="new")setSelected(data.competency.id);
  }catch(err){setMessage(err.message);}
  finally{setBusy(false);}
 }
 async function remove(){
  const original=competencies.find(c=>c.id===selected);
  if(!original||busy)return;
  if(!window.confirm("Permanently delete competency “"+original.title+"”? This is allowed only when it has no assessment, training or implementation records."))return;
  setBusy(true);setMessage("");
  try{
   const res=await fetch("/api/curriculum",{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
    body:JSON.stringify({action:"delete",id:original.id})
   });
   const data=await res.json();
   if(!res.ok)throw Error(data.error||"Unable to delete competency.");
   setSelected("new");setForm({...empty});setMessage(data.message);
   if(onSaved)await onSaved();
  }catch(err){setMessage(err.message+" Archive it by unchecking Publish if historical records must be preserved.");}
  finally{setBusy(false);}
 }
 return <section className="panel">
  <div className="panel-head"><h2>Super Admin · Curriculum editor</h2><span className="eyebrow">VERSIONED COMPETENCIES</span></div>
  <p className="helper">Add English literacy competencies from Nursery through Grade 5, update published criteria, or delete an unused competency. Editing preserves earlier assessment records. To change its code or grade, create a new competency and archive the old one.</p>
  <form className="stack" onSubmit={save}>
   <label>Choose a competency to edit
    <select value={selected} onChange={e=>{setSelected(e.target.value);setMessage("");}}>
     <option value="new">＋ Create a new competency</option>
     {LEVELS.map(g=><optgroup key={g} label={g}>{competencies.filter(c=>c.grade===g).sort((a,b)=>a.sequence-b.sequence).map(c=>
      <option key={c.id} value={c.id}>{c.code} · {c.title}{c.active?"":" (Draft / archived)"}</option>
     )}</optgroup>)}
    </select>
   </label>
   <div className="three-col">
    <label>Competency code<input required maxLength={25} readOnly={selected!=="new"} value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})} placeholder="G3_001"/></label>
    <label>Grade<select disabled={selected!=="new"} value={form.grade} onChange={e=>setForm({...form,grade:e.target.value})}>{LEVELS.map(g=><option key={g}>{g}</option>)}</select></label>
    <label>Sequence<input type="number" required min="0" max="10000" value={form.sequence} onChange={e=>setForm({...form,sequence:Number(e.target.value)})}/></label>
   </div>
   <div className="two-col">
    <label>Strand<input required minLength={2} maxLength={100} value={form.strand} onChange={e=>setForm({...form,strand:e.target.value})} placeholder="Reading comprehension"/></label>
    <label>Learning outcome / competency title<input required minLength={3} maxLength={160} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Reads grade-level paragraphs"/></label>
   </div>
   <label>Description / observable evidence<textarea rows={3} maxLength={2000} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></label>
   <label className="curriculum-status"><input type="checkbox" checked={!!form.active} onChange={e=>setForm({...form,active:e.target.checked})}/> Publish this competency to assessments</label>
   <div className="notice small"><AlertTriangle size={17}/><span>Unchecking publish hides it from new assessments but does not delete any earlier assessment results. New competencies start as drafts unless you publish them.</span></div>
   <div className="curriculum-actions">
    <button className="btn primary" type="submit" disabled={busy}>{selected==="new"?<Plus size={16}/>:<Save size={16}/>} {busy?"Saving…":selected==="new"?"Add competency":"Save competency · Version "+form.version}</button>
    {selected!=="new"&&<button className="btn danger" type="button" disabled={busy} onClick={remove}><Trash2 size={16}/> Delete competency</button>}
   </div>
  </form>
  {message&&<p className="helper" role="status">{message}</p>}
 </section>;
}
