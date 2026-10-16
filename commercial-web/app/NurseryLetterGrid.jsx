"use client";

import {useEffect,useMemo,useState} from "react";
import {RefreshCw} from "lucide-react";
import {RATINGS,RATING_LABELS} from "../lib/supabase";

const DIMENSIONS=[
 {code:"NUR002",key:"sound",student:"Sound",teacher:"Sound accuracy"},
 {code:"NUR001",key:"action",student:"Action",teacher:"Action accuracy"},
 {code:"NUR003",key:"symbol",student:"Letter identification",teacher:"Teaching connection"}
];

function shuffledIds(items,count){
 const pool=items.map(item=>item.id);
 for(let i=pool.length-1;i>0;i--){
  const j=Math.floor(Math.random()*(i+1));
  [pool[i],pool[j]]=[pool[j],pool[i]];
 }
 return pool.slice(0,Math.min(count,pool.length));
}

function latestRatings(rows){
 const latest={};
 for(const row of rows||[]){
  const key=row.competency_id+":"+row.item_id;
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

export default function NurseryLetterGrid({
 competencies=[],itemsByCompetency={},value={},onChange,mode="complete",historyRows=[],
 disabled=false,personType="student",resetKey=""
}){
 const dimensions=useMemo(()=>DIMENSIONS.map(d=>({
  ...d,competency:competencies.find(c=>c.code===d.code)
 })).filter(d=>d.competency),[competencies]);
 const letters=useMemo(()=>{
  const first=dimensions[0]?.competency;
  return [...(itemsByCompetency[first?.id]||[])].sort((a,b)=>(a.sequence||0)-(b.sequence||0));
 },[dimensions,itemsByCompetency]);
 const [selected,setSelected]=useState([]);
 const itemKey=letters.map(item=>item.id).join(",");
 const historyKey=(historyRows||[]).map(row=>row.assessment_id+":"+row.competency_id+":"+row.item_id+":"+row.rating).join("|");
 const prior=useMemo(()=>latestRatings(historyRows),[historyRows]);

 function selectionFor(type){
  if(type==="complete")return letters.map(item=>item.id);
  if(type==="random")return shuffledIds(letters,8);
  return letters.filter(item=>dimensions.some(d=>{
   const rating=prior[d.competency.id+":"+item.id];
   return rating==="Emerging"||rating==="Developing";
  })).map(item=>item.id);
 }
 useEffect(()=>{setSelected(selectionFor(mode));},[mode,resetKey,itemKey,historyKey]);

 if(dimensions.length!==3||!letters.length)return null;
 const selectedSet=new Set(selected);
 const shown=letters.filter(item=>selectedSet.has(item.id));
 const labels=personType==="teacher"?"teacher":"student";

 function updateCell(competencyId,itemId,rating){
  const next={...value,[competencyId]:{...(value[competencyId]||{}),[itemId]:rating}};
  if(rating==="Not Assessed")delete next[competencyId][itemId];
  const overall=Object.fromEntries(dimensions.map(d=>[d.competency.id,overallRating(next[d.competency.id])]));
  onChange(next,overall);
 }
 function toggleLetter(itemId){
  if(mode==="complete")return;
  if(selectedSet.has(itemId)){
   const next={...value};
   for(const d of dimensions){next[d.competency.id]={...(next[d.competency.id]||{})};delete next[d.competency.id][itemId];}
   const overall=Object.fromEntries(dimensions.map(d=>[d.competency.id,overallRating(next[d.competency.id])]));
   onChange(next,overall);setSelected(ids=>ids.filter(id=>id!==itemId));
  }else setSelected(ids=>[...ids,itemId]);
 }
 function chooseAnotherSample(){
  const nextIds=shuffledIds(letters,8);setSelected(nextIds);
  const allowed=new Set(nextIds),next={};
  for(const d of dimensions){
   next[d.competency.id]=Object.fromEntries(Object.entries(value[d.competency.id]||{}).filter(([id])=>allowed.has(id)));
  }
  const overall=Object.fromEntries(dimensions.map(d=>[d.competency.id,overallRating(next[d.competency.id])]));
  onChange(next,overall);
 }

 return <section className="nursery-letter-grid">
  <div className="nursery-grid-head">
   <div><h3>Nursery A–Z observation grid</h3>
    <p>{mode==="complete"?"Check all 26 letters.":mode==="random"?"The software selected 8 letters. You may adjust the selection.":"Previously difficult letters are selected for rechecking."}</p></div>
   <span>{selected.length} letters selected</span>
  </div>
  {mode!=="complete"&&<div className="nursery-letter-selector" aria-label="Select letters to assess">
   {letters.map(item=><button type="button" key={item.id} disabled={disabled}
    aria-pressed={selectedSet.has(item.id)} className={selectedSet.has(item.id)?"selected":""}
    onClick={()=>toggleLetter(item.id)}>{item.grapheme}</button>)}
   {mode==="random"&&<button type="button" className="new-sample" disabled={disabled}
    onClick={chooseAnotherSample}><RefreshCw size={14}/> Another sample</button>}
  </div>}
  {!shown.length?<p className="helper">No letters currently need targeted reassessment. Choose Complete or Random assessment to continue.</p>:
  <div className="nursery-grid-scroll"><table className="nursery-grid-table">
   <thead><tr><th>Letter</th>{dimensions.map(d=><th key={d.key}>{d[labels]}</th>)}</tr></thead>
   <tbody>{shown.map(item=><tr key={item.id}>
    <th><strong>{item.grapheme}</strong><small>{item.phoneme}</small>{item.action_name&&<small>{item.action_name}</small>}</th>
    {dimensions.map(d=>{
     const rating=value[d.competency.id]?.[item.id]||"Not Assessed";
     return <td key={d.key}><select disabled={disabled} value={rating}
      aria-label={d[labels]+" for letter "+item.grapheme}
      className={rating==="Not Assessed"?"":rating.toLowerCase()}
      onChange={event=>updateCell(d.competency.id,item.id,event.target.value)}>
      {RATINGS.map(option=><option value={option} key={option}>{RATING_LABELS[option]}</option>)}
     </select>{d.key==="action"&&item.action_cue&&<small className="nursery-action-help">{item.action_cue}</small>}</td>;
    })}
   </tr>)}</tbody>
  </table></div>}
  <p className="helper">Select only what you directly observe. The overall Nursery competency rating is calculated automatically from the letter-level entries.</p>
 </section>;
}
