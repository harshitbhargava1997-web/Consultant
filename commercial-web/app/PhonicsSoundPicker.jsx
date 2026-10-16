"use client";
import {useEffect,useMemo,useState} from "react";
import {Plus,Trash2,Eye,ChevronDown} from "lucide-react";
import {RATINGS,RATING_LABELS} from "../lib/supabase";

export function soundLabel(item){
 return item.grapheme+" · "+item.phoneme+" · "+item.example_word+(item.action_name?" · "+item.action_name:"");
}
export function usePhonicsCatalog(client){
 const [data,setData]=useState({items:[],links:[]});
 const [error,setError]=useState("");
 useEffect(()=>{
  if(!client)return;
  let active=true;
  (async()=>{
   try{
    const [items,mapping,actions]=await Promise.all([
     client.from("literacy_phonics_items").select("id,code,family,grapheme,phoneme,example_word,teaching_note,sequence")
      .eq("active",true).order("sequence").limit(500),
     client.from("literacy_competency_phonics_items").select("competency_id,item_id").limit(2000),
     client.from("literacy_phonics_actions").select("item_id,action_name,action_cue,age_band,origin_label,source_page").eq("active",true).limit(250)
    ]);
    if(items.error||mapping.error||actions.error)throw items.error||mapping.error||actions.error;
    const actionById=Object.fromEntries((actions.data||[]).map(a=>[a.item_id,a]));
    const enriched=(items.data||[]).map(item=>({...item,...(actionById[item.id]||{})}));
    if(active){setData({items:enriched,links:mapping.data||[]});setError("");}
   }catch(e){if(active)setError("The detailed phonics library could not be loaded: "+e.message);}
  })();
  return()=>{active=false;};
 },[client]);
 const {byCompetency,byId}=useMemo(()=>{
  const byId=Object.fromEntries(data.items.map(item=>[item.id,item]));
  const byCompetency={};
  for(const link of data.links){
   if(!byId[link.item_id])continue;
   (byCompetency[link.competency_id]??=[]).push(byId[link.item_id]);
  }
  for(const items of Object.values(byCompetency))items.sort((a,b)=>a.sequence-b.sequence);
  return {byCompetency,byId};
 },[data]);
 return {byCompetency,byId,error};
}
export function soundDetailPayload(value){
 return Object.entries(value||{}).filter(([,rating])=>rating!=="Not Assessed")
  .map(([item_id,rating])=>({item_id,rating}));
}
export function PhonicsStructurePreview({items=[],personLabel="learner"}){
 const [open,setOpen]=useState(false);
 if(!items.length)return null;
 return <div className="phonics-structure-preview">
  <button className="phonics-structure-toggle" type="button" aria-expanded={open}
   onClick={()=>setOpen(value=>!value)}>
   <Eye size={15}/>
   <span>{open?"Hide":"Preview"} {items.length} linked sounds and patterns</span>
   <ChevronDown size={15} className={open?"rotated":""}/>
  </button>
  {open&&<div className="phonics-structure-content">
   <p className="helper">These are the published assessment items for this competency. This preview does not record a rating. To assess the {personLabel}, select an overall competency rating and then choose only the sounds actually observed.</p>
   <div className="phonics-structure-grid">
    {items.map(item=><div className="phonics-structure-entry" key={item.id}>
     <strong>{item.grapheme} <span>{item.phoneme}</span></strong>
     <small>Example: {item.example_word}</small>
     {item.teaching_note&&<small>{item.teaching_note}</small>}
     {item.action_cue&&<small><strong>Action:</strong> {item.action_cue}</small>}
    </div>)}
   </div>
  </div>}
 </div>;
}
export default function PhonicsSoundPicker({items=[],value={},onChange,disabled=false,personLabel="learner"}){
 const [chosen,setChosen]=useState("");
 if(!items.length)return null;
 const available=items.filter(x=>!Object.prototype.hasOwnProperty.call(value,x.id));
 const selected=items.filter(x=>Object.prototype.hasOwnProperty.call(value,x.id));
 const rated=selected.filter(x=>value[x.id]!=="Not Assessed").length;
 return <div className="phonics-sound-picker">
  <div className="phonics-picker-title">
   <strong>Specific sounds and patterns observed</strong>
   <small>{rated} sound item{rated===1?"":"s"} rated</small>
  </div>
  <p className="helper">Select only the sounds observed from the {personLabel}. For Nursery sound-action association, use the action cue below. Rate sound production and symbol recognition separately under their own competencies. Do not infer a skill that was not observed.</p>
  <div className="phonics-add-row">
   <select aria-label="Select sound or phonics pattern" disabled={disabled||!available.length}
    value={available.some(x=>x.id===chosen)?chosen:""}
    onChange={e=>setChosen(e.target.value)}>
    <option value="">Choose from {items.length} sounds/patterns</option>
    {available.map(item=><option key={item.id} value={item.id}>{soundLabel(item)}</option>)}
   </select>
   <button className="btn outline" type="button" disabled={disabled||!chosen||!available.some(x=>x.id===chosen)}
    onClick={()=>{onChange({...value,[chosen]:"Not Assessed"});setChosen("");}}>
    <Plus size={15}/> Add</button>
  </div>
  {selected.length>0&&<div className="phonics-selected-items">
   {selected.map(item=><div className="phonics-selected-item" key={item.id}>
    <div className="phonics-item-label">
     <strong>{item.grapheme} <span>{item.phoneme}</span></strong>
     <small>Example: {item.example_word}{item.teaching_note?" · "+item.teaching_note:""}</small>
     {item.action_cue&&<small className="phonics-action-cue"><strong>Action demonstration:</strong> {item.action_cue}</small>}
    </div>
    <select disabled={disabled} aria-label={"Sound observation rating for "+soundLabel(item)}
     value={value[item.id]||"Not Assessed"} onChange={e=>onChange({...value,[item.id]:e.target.value})}>
     {RATINGS.map(r=><option key={r} value={r}>{RATING_LABELS[r]}</option>)}
    </select>
    <button className="btn outline" type="button" disabled={disabled} aria-label={"Remove "+soundLabel(item)}
     onClick={()=>{const copy={...value};delete copy[item.id];onChange(copy);}}><Trash2 size={14}/></button>
   </div>)}
  </div>}
  {!selected.length&&<p className="helper">No individual sounds selected yet. Add each demonstrated item and choose a rating.</p>}
 </div>;
}
