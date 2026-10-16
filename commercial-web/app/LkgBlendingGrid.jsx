"use client";

import {useEffect,useMemo,useState} from "react";
import {RefreshCw} from "lucide-react";
import {RATINGS,RATING_LABELS} from "../lib/supabase";

const DIMENSIONS=[
 {key:"sound",student:"Sound",teacher:"Sound modelling"},
 {key:"action",student:"Blending action",teacher:"Action modelling"},
 {key:"reading",student:"Reading",teacher:"Reading demonstration"}
];
const VOWELS=["a","e","i","o","u"];

function shuffledIds(items,count){
 const pool=items.map(item=>item.id);
 for(let i=pool.length-1;i>0;i--){
  const j=Math.floor(Math.random()*(i+1));
  [pool[i],pool[j]]=[pool[j],pool[i]];
 }
 return pool.slice(0,Math.min(count,pool.length));
}

function latestRatings(rows,competencyId){
 const latest={};
 for(const row of rows||[]){
  if(row.competency_id!==competencyId)continue;
  const dimension=row.observation_dimension||"overall";
  if(dimension==="overall")continue;
  const key=row.item_id+"::"+dimension;
  if(!latest[key])latest[key]=row.rating;
 }
 return latest;
}

function overallRating(itemRatings){
 const observed=Object.values(itemRatings||{}).filter(value=>value&&value!=="Not Assessed");
 if(!observed.length)return "Not Assessed";
 if(observed.includes("Emerging"))return "Emerging";
 if(observed.includes("Developing"))return "Developing";
 return "Independent";
}

function vowelFor(item,family){
 const word=(item.grapheme||"").toLowerCase();
 return family==="vc"?word[0]:word[1];
}

function PatternSelector({family,items,selectedSet,toggle,disabled,mode}){
 if(family==="vc"){
  const consonants=[...new Set(items.map(item=>(item.grapheme||"")[1]).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const byPattern=Object.fromEntries(items.map(item=>[item.grapheme.toLowerCase(),item]));
  return <div className="lkg-pattern-scroll"><table className="lkg-pattern-matrix">
   <thead><tr><th>Vowel ↓ / Consonant →</th>{consonants.map(c=><th key={c}>{c}</th>)}</tr></thead>
   <tbody>{VOWELS.map(v=><tr key={v}><th>{v}</th>{consonants.map(c=>{
    const item=byPattern[v+c];
    return <td key={c}>{item?<button type="button" disabled={disabled||mode==="complete"}
     className={selectedSet.has(item.id)?"selected":""} aria-pressed={selectedSet.has(item.id)}
     onClick={()=>toggle(item.id)}>{item.grapheme}</button>:<span>—</span>}</td>;
   })}</tr>)}</tbody>
  </table></div>;
 }
 return <div className="lkg-cvc-families">{VOWELS.map(v=>{
  const words=items.filter(item=>vowelFor(item,"cvc")===v);
  if(!words.length)return null;
  return <div className="lkg-cvc-row" key={v}><strong>{v}</strong><div>{words.map(item=><button
   type="button" key={item.id} disabled={disabled||mode==="complete"}
   className={selectedSet.has(item.id)?"selected":""} aria-pressed={selectedSet.has(item.id)}
   onClick={()=>toggle(item.id)}>{item.grapheme}</button>)}</div></div>;
 })}</div>;
}

function PatternGrid({competency,items,value,onChange,mode,historyRows,disabled,personType,resetKey}){
 const family=competency.code==="LKG001"?"vc":"cvc";
 const [selected,setSelected]=useState([]);
 const itemKey=items.map(item=>item.id).join(",");
 const historyKey=(historyRows||[]).map(row=>row.assessment_id+":"+row.competency_id+":"+row.item_id+":"+(row.observation_dimension||"overall")+":"+row.rating).join("|");
 const prior=useMemo(()=>latestRatings(historyRows,competency.id),[historyRows,competency.id]);

 function selectionFor(type){
  if(type==="complete")return items.map(item=>item.id);
  if(type==="random")return shuffledIds(items,Math.min(5,items.length));
  return items.filter(item=>DIMENSIONS.some(d=>{
   const rating=prior[item.id+"::"+d.key];
   return rating==="Emerging"||rating==="Developing";
  })).map(item=>item.id);
 }
 useEffect(()=>{setSelected(selectionFor(mode));},[mode,resetKey,itemKey,historyKey]);

 const selectedSet=new Set(selected);
 const shown=items.filter(item=>selectedSet.has(item.id));
 const labels=personType==="teacher"?"teacher":"student";

 function update(itemId,dimension,rating){
  const key=itemId+"::"+dimension,next={...value};
  if(rating==="Not Assessed")delete next[key];else next[key]=rating;
  onChange(next,overallRating(next));
 }
 function toggle(itemId){
  if(mode==="complete")return;
  if(selectedSet.has(itemId)){
   const next=Object.fromEntries(Object.entries(value).filter(([key])=>!key.startsWith(itemId+"::")));
   setSelected(ids=>ids.filter(id=>id!==itemId));onChange(next,overallRating(next));
  }else setSelected(ids=>[...ids,itemId]);
 }
 function anotherSample(){
  const nextIds=shuffledIds(items,Math.min(5,items.length)),allowed=new Set(nextIds);
  const next=Object.fromEntries(Object.entries(value).filter(([key])=>allowed.has(key.split("::")[0])));
  setSelected(nextIds);onChange(next,overallRating(next));
 }

 return <section className="lkg-pattern-grid">
  <div className="nursery-grid-head"><div><h3>{family==="vc"?"VC vowel–consonant grid":"CVC word-family grid"}</h3>
   <p>{family==="vc"?"Choose a vowel from the left and join it with a consonant across the top.":"Words are grouped by their middle vowel for systematic blending."}</p></div>
   <span>{selected.length} {family==="vc"?"combinations":"words"} selected</span></div>
  <PatternSelector family={family} items={items} selectedSet={selectedSet} toggle={toggle} disabled={disabled} mode={mode}/>
  {mode==="random"&&<button type="button" className="btn outline lkg-another-sample" disabled={disabled}
   onClick={anotherSample}><RefreshCw size={14}/> Another sample</button>}
  {!shown.length?<p className="helper">No previously difficult {family.toUpperCase()} items need targeted reassessment. Choose Complete or Random assessment.</p>:
  <div className="nursery-grid-scroll lkg-observation-scroll"><table className="nursery-grid-table lkg-observation-table">
   <thead><tr><th>{family==="vc"?"Combination":"Word"}</th>{DIMENSIONS.map(d=><th key={d.key}>{d[labels]}</th>)}</tr></thead>
   <tbody>{shown.map(item=><tr key={item.id}><th><strong>{item.grapheme}</strong><small>{item.phoneme}</small></th>
    {DIMENSIONS.map(d=>{const key=item.id+"::"+d.key,rating=value[key]||"Not Assessed";
     return <td key={d.key}><select disabled={disabled} value={rating}
      aria-label={d[labels]+" for "+item.grapheme} className={rating==="Not Assessed"?"":rating.toLowerCase()}
      onChange={event=>update(item.id,d.key,event.target.value)}>
      {RATINGS.map(option=><option value={option} key={option}>{RATING_LABELS[option]}</option>)}</select></td>;
    })}</tr>)}</tbody>
  </table></div>}
 </section>;
}

export default function LkgBlendingGrid({competencies=[],itemsByCompetency={},value={},onChange,mode="complete",historyRows=[],disabled=false,personType="student",resetKey=""}){
 const targets=competencies.filter(c=>c.code==="LKG001"||c.code==="LKG002").sort((a,b)=>a.sequence-b.sequence);
 if(targets.length!==2)return null;
 return <div className="lkg-blending-grids">{targets.map(competency=><PatternGrid key={competency.id}
  competency={competency} items={itemsByCompetency[competency.id]||[]} value={value[competency.id]||{}}
  mode={mode} historyRows={historyRows} disabled={disabled} personType={personType} resetKey={resetKey}
  onChange={(next,overall)=>onChange({...value,[competency.id]:next},{[competency.id]:overall})}/>)}</div>;
}
