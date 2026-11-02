'use client';
import {useState} from 'react';
import {RATINGS,RATING_LABELS} from '../lib/supabase';
export default function DolchGrid({items,value={},onChange,disabled,teacher=false,mode,history=[],competencyId}){
 const words=items.filter(x=>x.family==='sight-word');
 const groups=[];for(let i=0;i<words.length;i+=5)groups.push(words.slice(i,i+5));
 const [setIndex,choose]=useState(0);
 const current=Math.min(setIndex,groups.length-1),group=groups[current]||[];
 const shown=[...group,...words.slice(0,Math.max(0,5-group.length))];
 const [order,setOrder]=useState(null);
 const latest=new Map();for(const row of history)if(row.competency_id===competencyId&&!latest.has(row.item_id))latest.set(row.item_id,row.rating);
 let visible=order?shown.slice().sort((a,b)=>order.indexOf(a.id)-order.indexOf(b.id)):shown;
 if(mode==='targeted')visible=visible.filter(w=>['Emerging','Developing'].includes(latest.get(w.id)));
 function shuffle(){const ids=shown.map(w=>w.id);for(let i=ids.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[ids[i],ids[j]]=[ids[j],ids[i]];}setOrder(ids);}
 function rate(id,r){const next={...value};if(r==='Not Assessed')delete next[id];else next[id]=r;const ratings=Object.values(next);onChange(next,ratings.includes('Emerging')?'Emerging':ratings.includes('Developing')?'Developing':ratings.length?'Independent':'Not Assessed');}
 return <section><h4>Dolch sight words · five at a time</h4><label>Choose a set already taught <select disabled={disabled||Object.keys(value).length>0} value={current} onChange={e=>{choose(Number(e.target.value));setOrder(null);}}>{groups.map((g,i)=><option key={i} value={i}>Set {i+1}: {g.map(w=>w.grapheme).join(', ')}{g.length<5?' + review':''}</option>)}</select></label>
 <p>{teacher?'Ask the teacher to model reading each word and explain how they would teach any unexpected spelling.':'Show one word at a time and ask “Read this word.” Accept independent sounding out. Give a cue only after the first attempt.'}</p><button type="button" disabled={disabled} onClick={shuffle}>Shuffle this taught set</button>
 {visible.map(w=><label className="skill" key={w.id}><strong>{w.grapheme}{!group.includes(w)?' (review)':''}</strong><select aria-label={'Observation for '+w.grapheme} value={value[w.id]||'Not Assessed'} disabled={disabled} onChange={e=>rate(w.id,e.target.value)}>{RATINGS.map(r=><option key={r} value={r}>{RATING_LABELS[r]}</option>)}</select></label>)}
 {!visible.length&&<p>No words needing support from a previous observation in this set.</p>}{Object.keys(value).length>0&&<div><small>Save this assessment before choosing another taught set.</small> <button type="button" disabled={disabled} onClick={()=>onChange({},'Not Assessed')}>Clear draft word ratings</button></div>}</section>;
}
