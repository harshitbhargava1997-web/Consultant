'use client';
import {useState,useEffect} from 'react';
import {UserPlus,RotateCcw,UserMinus,CircleAlert,ShieldCheck} from 'lucide-react';
import {successFetch} from '@/lib/school-success/client';

const STARTING_PASSWORD='123456';
// Super Admin: principals and coordinators of one school. Adding a leader creates their mobile-number sign-in (or
// reuses an existing one) with School leader access to that school; they set their own password at first sign-in.
export default function SchoolLeaders({schools,initialSchool=''}){
 const [school,setSchool]=useState(initialSchool),[data,setData]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [form,setForm]=useState({name:'',title:'Principal',mobile:'',password:STARTING_PASSWORD});
 async function call(body){
  const res=await successFetch('/api/school-success/school-leaders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const out=await res.json().catch(()=>({}));if(!res.ok)throw Error(out.error||'Please try again.');return out;
 }
 async function load(s=school){if(!s){setData(null);return;}setBusy('load');setError('');try{setData(await call({action:'list',school:s}));}catch(e){setError(e.message);setData(null);}finally{setBusy('');}}
 async function add(e){
  e.preventDefault();setBusy('add');setError('');setNotice('');
  try{const r=await call({action:'add',school,...form});
   setNotice(form.name+' can now sign in at schoolsuccess.in/school-success with mobile '+form.mobile+(r.created?' and the starting password '+form.password+'. They will set their own password at first sign-in.':' using their existing password.'));
   setForm(f=>({...f,name:'',mobile:'',password:STARTING_PASSWORD}));await load();}
  catch(err){setError(err.message);}finally{setBusy('');}
 }
 async function reset(l){
  if(!window.confirm('Reset the password for '+l.name+' to '+STARTING_PASSWORD+'? They will set a new password at their next sign-in.'))return;
  setBusy(l.userId);setError('');setNotice('');
  try{await call({action:'reset',school,userId:l.userId,password:STARTING_PASSWORD});setNotice('Password reset for '+l.name+'. Starting password: '+STARTING_PASSWORD+'.');await load();}catch(e){setError(e.message);}finally{setBusy('');}
 }
 async function remove(l){
  if(!window.confirm('Remove '+l.name+' as '+(l.title||'school leader')+' of '+school+'? Their sign-in is kept but they will no longer see this school.'))return;
  setBusy(l.userId);setError('');setNotice('');
  try{await call({action:'remove',school,userId:l.userId});setNotice(l.name+' no longer has access to '+school+'.');await load();}catch(e){setError(e.message);}finally{setBusy('');}
 }
 useEffect(()=>{if(initialSchool)void load(initialSchool);},[]);
 const set=k=>e=>setForm(f=>({...f,[k]:e.target.value}));
 return <section className="card leaders-admin">
  <div className="card-head"><div><h2><ShieldCheck size={18}/> School leaders</h2><p>Principals, coordinators and school management sign in with their mobile number and see only their school: School 360°, Teacher 360°, lesson reviews and classroom visits.</p></div></div>
  <label className="field"><span>School</span><select value={school} onChange={e=>{setSchool(e.target.value);setNotice('');void load(e.target.value);}}><option value="">Select school</option>{schools.map(s=><option key={s}>{s}</option>)}</select></label>
  {error&&<p className="lp-error" role="alert"><CircleAlert size={16}/>{error}</p>}
  {notice&&<div className="alert success" role="status">{notice}</div>}
  {school&&<>
   {busy==='load'&&<p role="status">Loading school leaders…</p>}
   {data&&(data.leaders.length?<ul className="pin-list">{data.leaders.map(l=><li key={l.userId}><div><b>{l.name||'(no name)'}</b><small>{[l.title,l.mobile||l.email].filter(Boolean).join(' · ')}</small></div><span className={'pill '+(l.status==='Active'?'green':'amber')}>{l.status}</span>
     {l.managed&&<button type="button" className="button" disabled={!!busy} onClick={()=>reset(l)}><RotateCcw size={14}/>{busy===l.userId?'…':'Reset password'}</button>}
     <button type="button" className="button" disabled={!!busy} onClick={()=>remove(l)}><UserMinus size={14}/>Remove</button></li>)}</ul>
    :<p className="hint">No school leader has access to {school} yet.</p>)}
   <form className="leaders-form" onSubmit={add}>
    <h3><UserPlus size={16}/> Add principal, coordinator or school management</h3>
    <div className="form-grid">
     <label className="field"><span>Full name</span><input required minLength={2} maxLength={160} value={form.name} onChange={set('name')}/></label>
     <label className="field"><span>Role</span><select value={form.title} onChange={set('title')}><option>Principal</option><option>Coordinator</option><option>School management</option></select></label>
     <label className="field"><span>Mobile number</span><input required inputMode="tel" placeholder="10-digit mobile number" value={form.mobile} onChange={set('mobile')}/></label>
     <label className="field"><span>Starting password</span><input required minLength={6} maxLength={128} value={form.password} onChange={set('password')}/><small>They must replace it with their own password at first sign-in.</small></label>
    </div>
    <button type="submit" className="button primary" disabled={!!busy||!form.name.trim()||!form.mobile.trim()}>{busy==='add'?'Saving…':'Add school leader'}</button>
   </form>
  </>}
 </section>;
}
