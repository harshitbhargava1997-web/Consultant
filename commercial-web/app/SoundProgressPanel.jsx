"use client";
import {useMemo,useState} from "react";
import {BarChart3,Search,Volume2} from "lucide-react";
import {LEVELS} from "../lib/supabase";

const RATINGS=["Emerging","Developing","Independent"];
const DIMENSION_LABELS={sound:"Sound",action:"Blending action",reading:"Reading",overall:"Overall"};
function niceDate(value){
 if(!value)return "—";
 const date=new Date(value+"T00:00:00");
 return Number.isNaN(date.getTime())?value:date.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
}
export default function SoundProgressPanel({
 sessions=[],soundRows=[],competencies=[],itemById={},title="Individual sound progress",
 subjectLabel="student",limit=160
}){
 const [grade,setGrade]=useState("all"),[rating,setRating]=useState("all"),[search,setSearch]=useState("");
 const [showAll,setShowAll]=useState(false);
 const rows=useMemo(()=>{
  const ordered=[...sessions].sort((a,b)=>String(b.assessment_date||"").localeCompare(String(a.assessment_date||""))||
   String(b.created_at||"").localeCompare(String(a.created_at||"")));
  const sessionById=new Map(ordered.map((x,i)=>[x.id,{...x,order:i}]));
  const grouped=new Map();
  for(const item of soundRows){
   const session=sessionById.get(item.assessment_id);
   if(!session||!RATINGS.includes(item.rating))continue;
   const dimension=item.observation_dimension||"overall";
   const key=item.competency_id+":"+item.item_id+":"+dimension;
   if(!grouped.has(key))grouped.set(key,[]);
   grouped.get(key).push({rating:item.rating,date:session.assessment_date,order:session.order});
  }
  const competencyIndex=new Map(competencies.map(c=>[c.id,c]));
  return [...grouped].map(([key,entries])=>{
   const [competencyId,itemId,dimension]=key.split(":");
   const skill=competencyIndex.get(competencyId),sound=itemById[itemId];
   const sorted=entries.sort((a,b)=>a.order-b.order);
   return {key,competency:skill?.title||"Archived competency",
    grade:skill?.grade||"Other",code:skill?.code||"",
    grapheme:sound?.grapheme||"Archived sound",
    phoneme:sound?.phoneme||"",example:sound?.example_word||"",
    family:sound?.family||"",dimension,latest:sorted[0],previous:sorted[1]||null,
    observations:sorted.length};
  }).sort((a,b)=>{
   const gradeA=LEVELS.indexOf(a.grade),gradeB=LEVELS.indexOf(b.grade);
   return (gradeA<0?99:gradeA)-(gradeB<0?99:gradeB)||
    a.competency.localeCompare(b.competency)||a.grapheme.localeCompare(b.grapheme);
  });
 },[sessions,soundRows,competencies,itemById]);
 const grades=[...new Set(rows.map(x=>x.grade))].sort((a,b)=>LEVELS.indexOf(a)-LEVELS.indexOf(b));
 const matching=rows.filter(row=>(grade==="all"||row.grade===grade)&&
  (rating==="all"||row.latest.rating===rating)&&
  [row.grapheme,row.phoneme,row.example,row.competency,row.family,DIMENSION_LABELS[row.dimension]].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
 const shown=showAll?matching:matching.slice(0,Math.max(1,limit));
 const counts=Object.fromEntries(RATINGS.map(r=>[r,rows.filter(x=>x.latest.rating===r).length]));
 return <section className="sound-progress-panel" aria-label={title}>
  <div className="panel-head"><h2><Volume2 size={18}/>{title}</h2>
   <span className="eyebrow">SOUND-BY-SOUND HISTORY</span></div>
  <p className="helper">Shows the <strong>latest recorded observation</strong> for each sound within each competency. A previous rating appears only if the exact same sound and competency were assessed again. Unobserved sounds are excluded, not counted as unsuccessful.</p>
  <div className="sound-progress-totals">
   <div><small>Observed sound–competency pairs</small><strong>{rows.length}</strong></div>
   {RATINGS.map(value=><div key={value}><small>{value}</small><strong>{counts[value]}</strong></div>)}
  </div>
  {rows.length>0&&<>
   <div className="sound-progress-filters">
    <label>Grade<select value={grade} onChange={e=>{setGrade(e.target.value);setShowAll(false);}}>
     <option value="all">All grades</option>{grades.map(g=><option key={g} value={g}>{g}</option>)}
    </select></label>
    <label>Latest rating<select value={rating} onChange={e=>{setRating(e.target.value);setShowAll(false);}}>
     <option value="all">All ratings</option>{RATINGS.map(r=><option key={r} value={r}>{r}</option>)}
    </select></label>
    <label>Find sound / competency<span className="sound-progress-search">
     <Search size={14}/><input value={search} onChange={e=>{setSearch(e.target.value);setShowAll(false);}}
      placeholder="Try /t/, sh, CVC, blending…" aria-label="Search observed phonics sounds"/></span></label>
   </div>
   <div className="sound-progress-list">
    {shown.map(row=><div key={row.key} className="sound-progress-record">
     <div className="sound-progress-name"><strong>{row.grapheme} <span>{row.phoneme}</span></strong>
      <small>{row.example}</small><small>{row.grade} · {row.competency} · {DIMENSION_LABELS[row.dimension]||"Overall"}</small></div>
     <div className="sound-progress-rating">
      <span className={"sound-progress-state "+row.latest.rating.toLowerCase()}>{row.latest.rating}</span>
      <small>Observed {niceDate(row.latest.date)}</small>
      {row.previous&&<small>Earlier: {row.previous.rating} · {niceDate(row.previous.date)}</small>}
     </div>
    </div>)}
   </div>
   {!matching.length&&<p className="helper">No observations match these filters.</p>}
   {matching.length>shown.length&&<button type="button" className="btn outline" onClick={()=>setShowAll(true)}>
    Show all {matching.length} matching observations
   </button>}
  </>}
  {!rows.length&&<p className="helper">No individual sounds have been recorded for this {subjectLabel} yet. Rate a mapped competency and select the observed sound items during an assessment to begin tracking sound-level progress.</p>}
 </section>;
}
