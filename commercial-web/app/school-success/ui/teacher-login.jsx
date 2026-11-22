'use client';
import {useState,useRef} from 'react';
import {Search,ArrowLeft,LockKeyhole,KeyRound,ShieldCheck,CircleAlert,ChevronRight} from 'lucide-react';
import {saveTeacherSession} from '@/lib/school-success/teacher-session';

async function pinRequest(body,headers={}){
 const access=new URLSearchParams(location.search).get('access')||'';
 const res=await fetch('/api/school-success/teacher-pin',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-School-Link':access,...headers},body:JSON.stringify(body)});
 let data={};try{data=await res.json();}catch{}
 if(!res.ok)throw Object.assign(Error(data.error||'Please try again.'),{status:res.status});
 return data;
}
const initials=name=>name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
const pinRule=pin=>!/^\d{6}$/.test(pin)?'digits':(pin==='123456'||/^(\d)\1{5}$/.test(pin)||'01234567890'.includes(pin)||'09876543210'.includes(pin))?'easy':'';

// Six dots that fill as the PIN is typed. A real numeric input sits on top, so phone keyboards, paste and
// password managers work normally.
export function PinInput({value,onChange,label,autoFocus,id,autoComplete='current-password',invalid}){
 const ref=useRef(null);
 return <label className={'pin-input'+(invalid?' invalid':'')} htmlFor={id}>
  <span className="pin-label">{label}</span>
  <span className="pin-dots" onClick={()=>ref.current?.focus()}>
   {Array.from({length:6},(_,i)=><span key={i} className={'pin-dot'+(i<value.length?' filled':'')+(i===value.length?' next':'')}/>)}
   <input ref={ref} id={id} type="password" inputMode="numeric" pattern="[0-9]*" autoComplete={autoComplete} maxLength={6} value={value} autoFocus={autoFocus} aria-label={label} onChange={e=>onChange(e.target.value.replace(/\D/g,'').slice(0,6))}/>
  </span>
 </label>;
}

export default function TeacherLogin({language,school,teachers,onSignedIn}){
 const hi=language==='hi',t=(en,hn)=>hi?hn:en;
 const [step,setStep]=useState('teacher'),[teacher,setTeacher]=useState(''),[query,setQuery]=useState('');
 const [pin,setPin]=useState(''),[newPin,setNewPin]=useState(''),[confirm,setConfirm]=useState(''),[ticket,setTicket]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const shown=teachers.filter(n=>n.toLowerCase().includes(query.trim().toLowerCase()));
 function choose(name){setTeacher(name);setPin('');setError('');setStep('pin');}
 async function login(e){
  e.preventDefault();if(pin.length!==6){setError(t('Enter all 6 digits of your PIN.','अपने PIN के सभी 6 अंक भरें।'));return;}
  setBusy(true);setError('');
  try{const r=await pinRequest({action:'login',teacher,pin});
   if(r.mustChange){setTicket(r.changeTicket);setNewPin('');setConfirm('');setStep('create');}
   else{saveTeacherSession(teacher,r.session);await onSignedIn(teacher);}
  }catch(err){setError(err.message);setPin('');}finally{setBusy(false);}
 }
 async function create(e){
  e.preventDefault();
  const rule=pinRule(newPin);
  if(rule==='digits'){setError(t('Your new PIN needs 6 digits.','नए PIN में 6 अंक होने चाहिए।'));return;}
  if(rule==='easy'){setError(t('This PIN is too easy to guess. Avoid 123456, 000000 and number sequences.','यह PIN आसानी से अनुमान लगाया जा सकता है। 123456, 000000 और क्रम वाले अंक न चुनें।'));return;}
  if(newPin!==confirm){setError(t('The two PINs do not match.','दोनों PIN एक जैसे नहीं हैं।'));setConfirm('');return;}
  setBusy(true);setError('');
  try{const r=await pinRequest({action:'create',teacher,changeTicket:ticket,newPin});saveTeacherSession(teacher,r.session);await onSignedIn(teacher);}
  catch(err){setError(err.message);if(err.status===401){setStep('pin');setPin('');}}finally{setBusy(false);}
 }
 return <section className="tl-card" aria-live="polite">
  <div className="tl-school"><span className="tl-icon"><ShieldCheck size={22}/></span><div><small>{t('School','विद्यालय')}</small><b>{school}</b></div></div>
  {step==='teacher'&&<>
   <h2>{t('Who is signing in?','कौन साइन इन कर रहा है?')}</h2>
   <p>{t('Choose your name.','अपना नाम चुनें।')}</p>
   {teachers.length>6&&<label className="tl-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('Search your name','अपना नाम खोजें')} aria-label={t('Search your name','अपना नाम खोजें')}/></label>}
   <ul className="tl-names">{shown.map(n=><li key={n}><button type="button" onClick={()=>choose(n)}><span className="tl-avatar">{initials(n)}</span><b>{n}</b><ChevronRight size={18}/></button></li>)}</ul>
   {!shown.length&&<p className="hint">{teachers.length?t('No teacher matches this search.','इस खोज से कोई शिक्षक नहीं मिला।'):t('No teachers are listed for this school yet. Ask your school administrator.','इस विद्यालय के लिए अभी कोई शिक्षक नहीं है। अपने विद्यालय प्रशासक से संपर्क करें।')}</p>}
  </>}
  {step==='pin'&&<form onSubmit={login} noValidate>
   <button type="button" className="text-button" onClick={()=>{setStep('teacher');setError('');}}><ArrowLeft size={15}/>{t('Not you? Choose another name','आप नहीं हैं? दूसरा नाम चुनें')}</button>
   <div className="tl-who"><span className="tl-avatar large">{initials(teacher)}</span><h2>{teacher}</h2></div>
   <PinInput id="teacher-pin" value={pin} onChange={v=>{setPin(v);setError('');}} label={t('Enter your 6-digit PIN','अपना 6 अंकों का PIN डालें')} autoFocus invalid={!!error}/>
   <p className="tl-hint"><KeyRound size={14}/>{t('First time? Use the starting PIN from your school administrator. You will then create your own.','पहली बार? विद्यालय प्रशासक द्वारा दिया गया शुरुआती PIN डालें। फिर आप अपना PIN बनाएँगे।')}</p>
   {error&&<p className="lp-error" role="alert"><CircleAlert size={16}/>{error}</p>}
   <button type="submit" className="button primary tl-submit" disabled={busy||pin.length!==6}>{busy?t('Checking…','जाँच हो रही है…'):t('Sign in','साइन इन करें')}</button>
   <p className="tl-foot">{t('Forgot your PIN? Ask your school administrator to reset it.','PIN भूल गए? अपने विद्यालय प्रशासक से इसे रीसेट करवाएँ।')}</p>
  </form>}
  {step==='create'&&<form onSubmit={create} noValidate>
   <div className="tl-who"><span className="tl-icon large"><LockKeyhole size={26}/></span><h2>{t('Create your own PIN','अपना PIN बनाएँ')}</h2><p>{t('Only you will know it. You will use it every time you sign in.','यह केवल आपको पता होगा। हर बार साइन इन के लिए इसका उपयोग करें।')}</p></div>
   <PinInput id="new-pin" value={newPin} onChange={v=>{setNewPin(v);setError('');}} label={t('New 6-digit PIN','नया 6 अंकों का PIN')} autoFocus autoComplete="new-password" invalid={!!error&&error.includes('easy')}/>
   <PinInput id="confirm-pin" value={confirm} onChange={v=>{setConfirm(v);setError('');}} label={t('Enter it again','फिर से डालें')} autoComplete="new-password"/>
   <p className="tl-hint">{t('Avoid 123456, 000000 and simple sequences.','123456, 000000 और आसान क्रम से बचें।')}</p>
   {error&&<p className="lp-error" role="alert"><CircleAlert size={16}/>{error}</p>}
   <button type="submit" className="button primary tl-submit" disabled={busy||newPin.length!==6||confirm.length!==6}>{busy?t('Saving…','सहेजा जा रहा है…'):t('Save PIN and continue','PIN सहेजें और आगे बढ़ें')}</button>
  </form>}
 </section>;
}

export function ChangePin({language,teacher,onDone,onCancel}){
 const hi=language==='hi',t=(en,hn)=>hi?hn:en;
 const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(e){
  e.preventDefault();
  const rule=pinRule(next);
  if(current.length!==6||rule==='digits'){setError(t('Enter 6 digits in each box.','हर खाने में 6 अंक भरें।'));return;}
  if(rule==='easy'){setError(t('This PIN is too easy to guess. Avoid 123456, 000000 and number sequences.','यह PIN आसानी से अनुमान लगाया जा सकता है। 123456, 000000 और क्रम वाले अंक न चुनें।'));return;}
  if(next!==confirm){setError(t('The new PINs do not match.','नए PIN एक जैसे नहीं हैं।'));return;}
  setBusy(true);setError('');
  try{const {teacherSession}=await import('@/lib/school-success/teacher-session');const s=teacherSession();
   const r=await pinRequest({action:'change',teacher,currentPin:current,newPin:next},s?{'X-Teacher-Session':s.token}:{});
   saveTeacherSession(teacher,r.session);onDone();}
  catch(err){setError(err.message);setCurrent('');}finally{setBusy(false);}
 }
 return <form className="ts-card tl-change" onSubmit={save} noValidate>
  <div className="ts-card-head"><div><h3><KeyRound size={18}/>{t('Change your PIN','अपना PIN बदलें')}</h3><p>{t('Your other phones and browsers will be signed out.','आपके दूसरे फ़ोन और ब्राउज़र से साइन आउट हो जाएगा।')}</p></div></div>
  <div className="tl-change-grid">
   <PinInput id="current-pin" value={current} onChange={setCurrent} label={t('Current PIN','वर्तमान PIN')}/>
   <PinInput id="change-new" value={next} onChange={setNext} label={t('New PIN','नया PIN')} autoComplete="new-password"/>
   <PinInput id="change-confirm" value={confirm} onChange={setConfirm} label={t('New PIN again','नया PIN फिर से')} autoComplete="new-password"/>
  </div>
  {error&&<p className="lp-error" role="alert"><CircleAlert size={16}/>{error}</p>}
  <div className="actions"><button type="button" className="button" onClick={onCancel}>{t('Cancel','रद्द करें')}</button><button type="submit" className="button primary" disabled={busy}>{busy?t('Saving…','सहेजा जा रहा है…'):t('Save new PIN','नया PIN सहेजें')}</button></div>
 </form>;
}
