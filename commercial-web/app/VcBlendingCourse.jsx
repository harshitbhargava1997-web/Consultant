"use client";
import {useState} from "react";
import {VC_COLUMNS,VC_UNITS,vcCombinations,getVcItem} from "../lib/vcCourse";

export default function VcBlendingCourse({items,initialItem,onClose,isAdmin}){
 const initial=getVcItem(initialItem);
 const [vowel,setVowel]=useState(initial?.unit.vowel||"a");
 const [panel,setPanel]=useState(initial?.panel||"prepare");
 const [word,setWord]=useState(initial?.unit.core[0]||"am");
 const [step,setStep]=useState(0),[independent,setIndependent]=useState(false),[observations,setObservations]=useState({});
 const available=VC_UNITS.filter(u=>items.some(i=>getVcItem(i)?.unit.vowel===u.vowel&&(isAdmin||i.status==="published")));
 const unit=available.find(u=>u.vowel===vowel)||available[0];
 if(!unit)return <div className="panel"><p>No VC units are available for your account.</p><button className="btn outline" onClick={onClose}>Back to library</button></div>;
 const record=items.find(i=>getVcItem(i)?.unit.vowel===unit.vowel&&i.content_type==="lesson_plan")||items.find(i=>getVcItem(i)?.unit.vowel===unit.vowel);
 const combinations=vcCombinations(unit),core=unit.core;
 const selectUnit=u=>{setVowel(u.vowel);setWord(u.core[0]);setStep(0);setIndependent(false);};
 const selectWord=w=>{setWord(w);setStep(0);};
 const printSheet=(sheet)=>{
  document.body.classList.add("vision-vc-print");document.body.dataset.vcPrint=sheet;
  const cleanup=()=>{document.body.classList.remove("vision-vc-print");delete document.body.dataset.vcPrint;};
  window.addEventListener("afterprint",cleanup,{once:true});
  window.print();
 };
 const criteria=[`Recalls short ${unit.vowel} and the selected consonant sounds`,...core.map(w=>`Reads ${w}${unit.words.includes(w)?" (word)":" (practice chunk)"}`),"Builds a dictated combination in order","Retains reading in a later session"];
 const ratings=["Independent","With help","Not yet","Not observed"];
 return <section className="panel vc-course">
  <div className="vc-controls"><button className="btn outline" onClick={onClose}>← Digital Content Library</button><span className="eyebrow">LKG · VC BLENDING COURSE</span></div>
  <h2>Unit {unit.number} · Short {unit.vowel.toUpperCase()}</h2>
  <p>Hear two sounds, join them in order, then read independently. Start with short {unit.vowel} as in <strong>{unit.anchor}</strong>.</p>
  <nav className="vc-unit-tabs" aria-label="VC vowel units">{VC_UNITS.map(u=><button key={u.vowel} className={u.vowel===unit.vowel?"active":""} disabled={!available.some(a=>a.vowel===u.vowel)} aria-pressed={u.vowel===unit.vowel} onClick={()=>selectUnit(u)}>{u.number} · {u.vowel.toUpperCase()}</button>)}</nav>
  <nav className="vc-section-tabs" aria-label="VC lesson sections">{[["prepare","Prepare"],["demonstrate","Demonstrate"],["worksheets","Worksheets"],["review","Check & review"]].map(([id,label])=><button className="btn outline" aria-pressed={panel===id} key={id} onClick={()=>setPanel(id)}>{label}</button>)}</nav>
  {panel==="prepare"&&<div className="vc-screen-section">
   <h3>Teacher preparation</h3><p className="vc-text">{record?.objective}</p><p className="vc-text">{record?.preparation}</p>
   <div className="vc-two-col"><article><h3>1 · Recall the sounds</h3><p>Check {unit.vowel} and the consonants in {core.join(", ")} in mixed order. Revisit gaps before expecting independent blending.</p></article><article><h3>2 · Model and share</h3><p>Show {core[0][0]} then {core[0][1]}. Model each clean sound. Sweep left to right to join them. Invite a shared response, then one learner alone.</p></article><article><h3>3 · Remove the prompts</h3><p>Read the core examples in a new order without actions, dots or the teacher supplying the first sound.</p></article><article><h3>4 · Build and revisit</h3><p>Dictate a combination and build it with cards. Writing is readiness-based. Recheck reading in a later session.</p></article></div>
   <p><strong>Word meaning:</strong> {unit.meaning}</p><p>{unit.note}</p><p>Optional practice chunks may be used after their consonants are secure. Actions support sound recall; fade them during independent reading.</p>
   <button className="btn primary" onClick={()=>setPanel("demonstrate")}>Start demonstration</button>
  </div>}
  {panel==="demonstrate"&&<div className="vc-screen-section">
   <p>Vowel down the left, consonants across the top. Select a cell to demonstrate. The teacher models phonemes; device speech is not used for isolated sounds.</p>
   <div className="vc-table-wrap"><table className="vc-grid"><caption>Short {unit.vowel} combinations</caption><thead><tr><th scope="col">VC</th>{VC_COLUMNS.map(c=><th scope="col" key={c}>{c}</th>)}</tr></thead><tbody><tr><th scope="row">{unit.vowel}</th>{VC_COLUMNS.map(c=>{const w=unit.vowel+c;return <td key={c}>{combinations.includes(w)?<button onClick={()=>selectWord(w)} aria-pressed={w===word} className={unit.words.includes(w)?"real":"chunk"}>{w}<small>{unit.words.includes(w)?"Word":"Practice chunk"}</small></button>:<span className="helper">Later<br/>s → /z/</span>}</td>;})}</tr></tbody></table></div>
   <div className="vc-demo"><span className="eyebrow">{unit.words.includes(word)?"REAL WORD":"PRACTICE CHUNK"}</span><label><input type="checkbox" checked={independent} onChange={e=>setIndependent(e.target.checked)}/> Independent reading</label>
    <div className="vc-big-word" aria-live="polite">{independent||step===2?word:<><span className={step===0?"vc-current":""}>{word[0]}</span><span className="vc-arrow">→</span><span className={step===1?"vc-current":""}>{word[1]}</span></>}</div>
    <p>{independent?"Ask the learner to read without a sound or action prompt.":step===0?`Point to ${word[0]}. Model short ${unit.vowel}.`:step===1?`Point to ${word[1]}. Model its sound without an added uh.`:`Join both sounds and reread ${word}.`}</p>
    <button className="btn primary" disabled={independent} onClick={()=>setStep((step+1)%3)}>{step===0?"Next sound":step===1?"Join and read":"Start again"}</button>
   </div><h3>Core practice</h3><div className="vc-word-cards">{[...core].reverse().map(w=><button key={w} onClick={()=>selectWord(w)}>{w}</button>)}</div><p>{unit.meaning}</p>
   <h3>CVC transfer when ready</h3><p>{unit.bridge}. Revisit all three individual sounds. A two-letter chunk is not one phoneme. The full CVC course follows separately.</p>
  </div>}
  <div className={panel==="worksheets"?"vc-worksheets":"vc-worksheets vc-print-only"}>
   <div className="vc-controls"><p>Use oral responses, pointing, letter cards or writing. Print all sheets, or choose one.</p><button className="btn primary" onClick={()=>printSheet("all")}>Print all 3 worksheets</button><button className="btn outline" onClick={()=>printSheet("guide")}>Print teacher answer guide</button></div>
   <article className="vc-sheet" data-sheet="1"><div className="vc-controls"><span>LKG · VC · SHORT {unit.vowel.toUpperCase()}</span><button className="btn outline" onClick={()=>printSheet("1")}>Print sheet 1</button></div><h2>1 · Hear and find</h2><p>Name __________________ Date ______________</p><p>Listen to the teacher. Point to or circle the matching letter.</p>{[unit.vowel,"m","n","t"].map((target,i)=>{const choices=[unit.vowel,"m","n","t"].filter(x=>x!==target).slice(0,2);choices.splice(i%3,0,target);return <div className="vc-choice" key={i}><small>{i+1}</small>{choices.map(c=><strong key={c}>{c}</strong>)}</div>;})}<h3>Point and say each sound</h3><p className="vc-print-words">m &nbsp; {unit.vowel} &nbsp; t &nbsp; n</p><p>Adult records independent sound recall ____ / 4</p></article>
   <article className="vc-sheet" data-sheet="2"><div className="vc-controls"><span>LKG · VC · SHORT {unit.vowel.toUpperCase()}</span><button className="btn outline" onClick={()=>printSheet("2")}>Print sheet 2</button></div><h2>2 · Touch, join and read</h2><p>Name __________________ Date ______________</p><p>Say each sound. Sweep your finger under both letters and blend.</p>{core.map(w=><div className="vc-blend-row" key={w}><span>{w[0]}<small>●</small></span><span>{w[1]}<small>●</small></span><span>→</span><strong>{w}</strong><em>{unit.words.includes(w)?"Word":"Practice chunk"}</em></div>)}<h3>Read without the dots</h3><p className="vc-print-words">{[...core].reverse().join("   ")}</p><p>Independent ____ / 3 &nbsp; With help ____ / 3</p></article>
   <article className="vc-sheet" data-sheet="3"><div className="vc-controls"><span>LKG · VC · SHORT {unit.vowel.toUpperCase()}</span><button className="btn outline" onClick={()=>printSheet("3")}>Print sheet 3</button></div><h2>3 · Read, listen and build</h2><p>Name __________________ Date ______________</p><h3>A · Read to your teacher</h3><p className="vc-print-words">{[core[1],core[2],core[0]].join("   ")}</p><h3>B · Listen and choose</h3>{core.map((w,i)=><div className="vc-choice" key={w}><small>{i+1}</small>{[...core.slice(i+1),...core.slice(0,i+1)].map(c=><strong key={c}>{c}</strong>)}</div>)}<h3>C · Listen and build</h3><p>Use letter cards, or write if ready.</p><div className="vc-boxes">{core.map((w,i)=><div key={w}><small>{i+1}</small><span/><span/></div>)}</div><p>Record reading and building separately. Handwriting is not a requirement for blending.</p></article>
  </div>
  {panel==="review"&&<div className="vc-screen-section"><h3>Teacher readiness</h3><p>Check accurate sound models, left-to-right joining, word/chunk distinction, individual response checks and separate evidence for reading and writing.</p><h3>Individual practice checklist</h3><p>This checklist helps plan practice. Enter official teacher or student assessments through Vision’s assessment module.</p><div className="vc-table-wrap"><table className="vc-review"><thead><tr><th>Observe</th>{ratings.map(r=><th key={r}>{r}</th>)}</tr></thead><tbody>{criteria.map((c,i)=><tr key={c}><th scope="row">{c}</th>{ratings.map(r=><td key={r}><input type="radio" name={`vc-${unit.vowel}-${i}`} aria-label={`${c}: ${r}`} checked={observations[unit.vowel+":"+i]===r} onChange={()=>setObservations({...observations,[unit.vowel+":"+i]:r})}/></td>)}</tr>)}</tbody></table></div><p className="helper">Practice selections remain only while this course is open.</p><p className="vc-text">{record?.check_understanding}</p></div>}
  <article className={panel==="worksheets"?"vc-answer-guide":"vc-answer-guide vc-print-only"} data-sheet="guide"><h3>Teacher instructions and answer guide · Short {unit.vowel}</h3><p>Sheet 1: dictate {unit.vowel}, /m/, /n/, /t/ in that order. Learner chooses those symbols. Then ask for the four printed sounds.</p><p>Sheet 2: {core.join(", ")}, then {[...core].reverse().join(", ")}. Model only when needed; record prompts.</p><p>Sheet 3 A: {[core[1],core[2],core[0]].join(", ")}. B: dictate {core.join(", ")}. C: dictate {[...core].reverse().join(", ")}. Accept card building.</p><p>{unit.meaning} {unit.note}</p><p>Emerging: sound recall or order is insecure. Developing: joins with help or inconsistently. Proficient for this unit: reads the core combinations independently in mixed order and retains the skill in a later session. These describe this unit, not an automatic overall competency score.</p></article>
 </section>;
}
