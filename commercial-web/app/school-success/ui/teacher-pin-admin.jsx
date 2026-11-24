'use client';
import {useState,useEffect} from 'react';
import {KeyRound,RefreshCw,RotateCcw,CircleAlert} from 'lucide-react';
import {successFetch} from '@/lib/school-success/client';

const labels={active:['PIN created','green'],default:['Using starting PIN','amber'],locked:['Locked (wrong PINs)','red']};
// Teacher PIN administration: status per teacher, reset ("forgot PIN"), and the school's starting PIN.
export default function TeacherPinAdmin({schools,initialSchool='',open=false}){
 const [school,setSchool]=useState(initialSchool),[data,setData]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[pin,setPin]=useState('');
 async function call(body){
  const res=await successFetch('/api/school-success/teacher-pins',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const out=await res.json().catch(()=>({}));if(!res.ok)throw Error(out.error||'Please try again.');return out;
 }
 async function load(s=school){if(!s)return;setBusy('load');setError('');try{setData(await call({action:'list',school:s}));}catch(e){setError(e.message);setData(null);}finally{setBusy('');}}
 async function reset(teacher){
  if(!window.confirm('Reset the PIN for '+teacher+'? They will sign in with the starting PIN and create a new one. Any phone where they are signed in will be signed out.'))return;
  setBusy(teacher);setError('');setNotice('');
  try{await call({action:'reset',school,teacher});setNotice('PIN reset for '+teacher+'. Tell them to sign in with the starting PIN.');await load();}catch(e){setError(e.message);}finally{setBusy('');}
 }
 async function saveDefault(e){
  e.preventDefault();if(!/^\d{6}$/.test(pin)){setError('The starting PIN needs exactly 6 digits.');return;}
  setBusy('default');setError('');setNotice('');
  try{await call({action:'setDefault',school,pin});setNotice('Starting PIN updated for '+school+'. Teachers who already created their own PIN are not affected.');setPin('');await load();}catch(e){setError(e.message);}finally{setBusy('');}
 }
 const counts=data?Object.fromEntries(['active','default','locked'].map(k=>[k,data.teachers.filter(r=>r.status===k).length])):null;
 // Opened from the school leader dashboard: already expanded on their school.
 useEffect(()=>{if(initialSchool)void load(initialSchool);},[]);
 return <details className="card pin-admin" open={open||undefined}>
  <summary><KeyRound size={16}/> Teacher PINs</summary>
  <p className="hint">Teachers open the school link, choose their name and enter their PIN. The first time, they use the school’s starting PIN (123456 unless you set another) and then create their own. If a teacher forgets their PIN, reset it here.</p>
  <div className="pin-admin-bar"><label className="field"><span>School</span><select value={school} onChange={e=>{setSchool(e.target.value);setData(null);setNotice('');void load(e.target.value);}}><option value="">Select school</option>{schools.map(s=><option key={s}>{s}</option>)}</select></label>{school&&<button type="button" className="button" disabled={!!busy} onClick={()=>load()}><RefreshCw size={14}/>Refresh</button>}</div>
  {error&&<p className="lp-error" role="alert"><CircleAlert size={16}/>{error}</p>}
  {notice&&<div className="alert success" role="status">{notice}</div>}
  {busy==='load'&&<p role="status">Loading teachers…</p>}
  {data&&<>
   <div className="pin-counts"><span><b>{counts.active}</b> created their PIN</span><span><b>{counts.default}</b> still on starting PIN</span><span><b>{counts.locked}</b> locked</span></div>
   <ul className="pin-list">{data.teachers.map(r=><li key={r.teacher}><div><b>{r.teacher}</b><small>{r.status==='active'&&r.updatedAt?'Updated '+new Date(r.updatedAt).toLocaleDateString('en-IN'):r.resetBy?'Reset by '+r.resetBy:''}</small></div><span className={'pill '+labels[r.status][1]}>{labels[r.status][0]}</span><button type="button" className="button" disabled={!!busy} onClick={()=>reset(r.teacher)}><RotateCcw size={14}/>{busy===r.teacher?'Resetting…':'Reset PIN'}</button></li>)}</ul>
   {!data.teachers.length&&<p className="hint">No active teachers are listed for this school. Add teachers in Schools &amp; teachers.</p>}
   <form className="pin-default" onSubmit={saveDefault}><label className="field"><span>Starting PIN for {school} ({data.customDefault?'custom PIN set':'currently 123456'})</span><input inputMode="numeric" pattern="[0-9]*" maxLength={6} value={pin} placeholder="6 digits" onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,6))}/></label><button type="submit" className="button" disabled={!!busy||pin.length!==6}>Save starting PIN</button></form>
  </>}
 </details>;
}
