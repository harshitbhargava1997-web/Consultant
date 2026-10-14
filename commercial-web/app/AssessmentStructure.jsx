"use client";
import {useMemo,useState} from "react";
import {BookOpen,Filter,Search,Volume2,GraduationCap} from "lucide-react";
import {LEVELS} from "../lib/supabase";
import {usePhonicsCatalog} from "./PhonicsSoundPicker";
const familyNames={
 letter:"A–Z letter sounds",vc:"VC blending",cvc:"CVC blending",
 "consonant-digraph":"Consonant digraphs","vowel-digraph":"Vowel digraphs",
 "consonant-blend":"Consonant blends",trigraph:"Trigraphs",
 diphthong:"Diphthongs","vowel-length":"Long / short vowels",
 "split-digraph":"Split digraphs","r-controlled":"R-controlled vowels",
 "hard-soft":"Hard / soft sounds","open-syllable":"Open syllables",
 "closed-syllable":"Closed syllables","word-pattern":"Word patterns"
};
function cap(s){return familyNames[s]||s?.replace(/-/g," ")||"Phonics";}
export default function AssessmentStructure({client,competencies=[],onNavigate,canStudentAssess=false,canTeacherReview=false}){
 const {byCompetency,byId,error}=usePhonicsCatalog(client);
 const [grade,setGrade]=useState("all"),[family,setFamily]=useState("all"),[search,setSearch]=useState("");
 const [showAll,setShowAll]=useState(false);
 const all=useMemo(()=>Object.values(byId).sort((a,b)=>a.sequence-b.sequence),[byId]);
 const supportedCompetencies=competencies.filter(c=>c.active&&(byCompetency[c.id]||[]).length);
 const selectedIds=new Set(supportedCompetencies.filter(c=>grade==="all"||c.grade===grade)
  .flatMap(c=>(byCompetency[c.id]||[]).map(item=>item.id)));
 const relevant=all.filter(item=>(grade==="all"||selectedIds.has(item.id))&&
  (family==="all"||item.family===family)&&
  [item.grapheme,item.phoneme,item.example_word,item.teaching_note,item.family,item.code].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
 const shown=showAll?relevant:relevant.slice(0,60);
 const families=[...new Set(all.map(x=>x.family))].sort((a,b)=>cap(a).localeCompare(cap(b)));
 const initialActions=all.filter(item=>item.age_band==="Nursery"&&item.action_cue);
 return <div className="assessment-structure">
  <section className="panel">
   <div className="panel-head">
    <h2><Volume2 size={20}/> Assessment structures · Sound-by-sound</h2>
    <span className="eyebrow">PUBLISHED PHONICS ASSESSMENT CATALOG</span>
   </div>
   <p className="helper">This is the read-only assessment structure used by Teacher Skills Review and Literacy Assessor. The initial Nursery set now includes 26 sound–action demonstrations adapted from your reference PDFs, with the associated phoneme and letter symbol. Assessment outcomes are only recorded when you save a specific teacher or student's observed rating.</p>
   <p className="helper"><strong>Nursery progression:</strong> Sound–action association (NUR001) → sound production (NUR002) → sound–symbol recognition (NUR003). Each is assessed separately for the demonstrated letter sound.</p>
   <div className="assessment-structure-stats">
    <div><small>Individual sounds and patterns</small><strong>{all.length}</strong></div>
    <div><small>Initial A–Z sound actions</small><strong>{initialActions.length}</strong></div>
    <div><small>Linked published competencies</small><strong>{supportedCompetencies.length}</strong></div>
    <div><small>Phonics families</small><strong>{families.length}</strong></div>
   </div>
   <div className="assessment-structure-actions">
    <button className="btn outline" type="button" onClick={()=>{setGrade("Nursery");setFamily("letter");setSearch("");setShowAll(true);}}>
     <Volume2 size={16}/> View all 26 Nursery sound actions
    </button>
    {canStudentAssess&&<button type="button" className="btn primary" onClick={()=>onNavigate("assess")}>
     <GraduationCap size={16}/> Assess a student
    </button>}
    {canTeacherReview&&<button type="button" className="btn outline" onClick={()=>onNavigate("teacher-review")}>
     <BookOpen size={16}/> Review a teacher's skills
    </button>}
   </div>
   <p className="helper">To assess: select a class and teacher or student, choose Nursery Sound–Action Association, select an overall rating, then rate only the individual letter actions actually demonstrated. Other phonics and symbol competencies remain separate.</p>
  </section>
  {error&&<div className="notice" role="status">{error}</div>}
  <section className="panel">
   <div className="panel-head"><h2><Filter size={18}/> Explore the assessment structure</h2></div>
   <div className="assessment-structure-filters">
    <label>Grade<select value={grade} onChange={e=>{setGrade(e.target.value);setShowAll(false);}}>
     <option value="all">All published grades</option>
     {LEVELS.map(g=><option key={g} value={g}>{g}</option>)}</select></label>
    <label>Sound group<select value={family} onChange={e=>{setFamily(e.target.value);setShowAll(false);}}>
     <option value="all">All phonics families</option>
     {families.map(k=><option key={k} value={k}>{cap(k)}</option>)}
    </select></label>
    <label>Search<input type="search" value={search} onChange={e=>{setSearch(e.target.value);setShowAll(false);}}
     placeholder="Try A, sh, /t/, diphthong..."/></label>
   </div>
   <p className="helper">{relevant.length} sound / pattern entries match this filter. Entries with established actions also display the movement cue for teacher demonstration and student assessment.</p>
   <div className="assessment-structure-items">
    {shown.map(item=>{
     const linked=supportedCompetencies.filter(c=>(byCompetency[c.id]||[]).some(x=>x.id===item.id));
     return <div key={item.id} className="assessment-structure-item">
      <span className="assessment-structure-grapheme">{item.grapheme}</span>
      <div>
       <strong>{item.phoneme} · {item.example_word}</strong>
       <small>{cap(item.family)}</small>
       {item.teaching_note&&<small>{item.teaching_note}</small>}
       {item.action_cue&&<p className="assessment-structure-action"><strong>{item.action_name}</strong> — {item.action_cue}</p>}
       {linked.length>0&&<small>Linked to: {linked.map(c=>c.grade+" — "+c.title).join("; ")}</small>}
      </div>
     </div>;
    })}
   </div>
   {!relevant.length&&<p className="helper">No published sounds match this selection. Choose another grade or sound group.</p>}
   {relevant.length>shown.length&&<button type="button" className="btn outline" onClick={()=>setShowAll(true)}>
    Show all {relevant.length} matching sounds
   </button>}
   {!all.length&&!error&&<p className="helper">Loading the published sound assessment structure…</p>}
  </section>
 </div>;
}
