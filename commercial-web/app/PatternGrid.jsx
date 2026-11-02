'use client';
import {useState} from 'react';
import {fiveSets,gridFamilies} from '../lib/taught-word-grids';
import {RATINGS,RATING_LABELS} from '../lib/supabase';
export default function PatternGrid({code,items,competencyId,history=[],mode,teacher,disabled,value={},onChange}){
 const families=Object.keys(gridFamilies).filter(f=>items.some(w=>w.family===f));
 const [family,choose]=useState(families[0]),[index,setIndex]=useState(0);
 const sets=fiveSets(items.filter(w=>w.family===family)),shown=sets[index]||[],locked=disabled||Object.keys(value).length>0;
 const dims=code==='UKG008'?['sound','reading']:[code==='UKG001'?'sound':'reading'];
 const previous=new Map();for(const row of history){if(row.competency_id!==competencyId)continue;const k=row.item_id+'::'+(row.observation_dimension||'overall');if(!previous.has(k))previous.set(k,row.rating);}
 const needsHelp=(w,d)=>['Emerging','Developing'].includes(previous.get(w.id+'::'+d)??previous.get(w.id+'::overall'));
 const visible=shown.filter(w=>mode!=='targeted'||dims.some(d=>needsHelp(w,d)));
 function rate(key,r){const next={...value};if(r==='Not Assessed')delete next[key];else next[key]=r;const all=Object.values(next);onChange(next,all.includes('Emerging')?'Emerging':all.includes('Developing')?'Developing':all.length?'Independent':'Not Assessed');}
 return <section><h4>{code==='UKG008'?'Consonant blend':'Digraph'} observation grid</h4><label>Pattern family <select disabled={locked} value={family} onChange={e=>{choose(e.target.value);setIndex(0);}}>{families.map(f=><option key={f} value={f}>{gridFamilies[f]}</option>)}</select></label> <label>Taught set <select disabled={locked} value={index} onChange={e=>setIndex(+e.target.value)}>{sets.map((s,i)=><option key={i} value={i}>Set {i+1}: {s.map(w=>w.example_word).join(', ')}</option>)}</select></label>
 <p>{teacher?'Observe how the teacher models the pattern and prompts reading.':'Show the pattern or word first. Give help only after the child tries.'} {code==='UKG008'?'Listen for both consonants, then check reading of the whole word.':code==='UKG001'?'Check the sound made by the letter pair in the example word.':'Ask for the whole word to be blended and read.'}</p>
 <div className="nursery-grid-scroll"><table className="nursery-grid-table"><thead><tr><th>Pattern</th><th>Word</th>{dims.map(d=><th key={d}>{d==='reading'?(teacher?'Models word reading':'Reads word'):(teacher?'Models sound(s)':code==='UKG008'?'Says both sounds':'Says the sound')}</th>)}</tr></thead><tbody>{visible.map(w=><tr key={w.id}><th scope="row">{w.grapheme}</th><td>{w.example_word}</td>{dims.map(d=><td key={d}><select aria-label={w.example_word+' '+d} disabled={disabled} value={value[w.id+'::'+d]||'Not Assessed'} onChange={e=>rate(w.id+'::'+d,e.target.value)}>{RATINGS.map(r=><option key={r} value={r}>{RATING_LABELS[r]}</option>)}</select></td>)}</tr>)}</tbody></table></div>
 {!visible.length&&<p>No previously observed patterns needing support in this set.</p>}{Object.keys(value).length>0&&<button type="button" disabled={disabled} onClick={()=>onChange({},'Not Assessed')}>Clear draft pattern ratings</button>}</section>;
}
