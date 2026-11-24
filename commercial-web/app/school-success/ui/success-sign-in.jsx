'use client';
// School Success's own sign-in (owner decision, 24 November 2026): principals, coordinators, school management and
// consultants sign in here, at /school-success, and stay in School Success. Accounts and access come from School
// Success (School leaders panel and module access); the shared sign-in service only checks the password. Teachers
// keep using their school link and PIN. Vision's own sign-in page is unchanged.
import {useEffect,useState} from 'react';
import {GraduationCap,Eye,EyeOff,LogIn,KeyRound,CircleAlert,LogOut} from 'lucide-react';
import {browserClient} from '@/lib/supabase';
import {isEmail,normalizePhone,mobileLoginEmail} from '@/lib/auth';
import {PASSWORD_MIN,validPassword} from '@/lib/password-policy';

// Friendly text for the sign-in service's messages.
export function signInMessage(error){
 const m=String(error?.message||error||'');
 if(/invalid login|invalid credentials|invalid grant/i.test(m))return 'The sign-in details are not correct. Check your mobile number (or email) and password.';
 if(/not confirmed/i.test(m))return 'This account is not active yet. Ask your School Success administrator.';
 if(/rate|too many/i.test(m))return 'Too many attempts. Wait a minute and try again.';
 return m||'Could not sign in. Please try again.';
}
export async function signInWithLogin(client,login,password){
 const value=String(login||'').trim();
 if(isEmail(value)){const {error}=await client.auth.signInWithPassword({email:value.toLowerCase(),password});if(error)throw Error(signInMessage(error));return;}
 const phone=normalizePhone(value);
 if(!phone)throw Error('Enter your 10-digit mobile number (or your email).');
 // Mobile numbers sign in through their internal sign-in address (no SMS); older phone-only accounts use phone sign-in.
 const viaMobile=await client.auth.signInWithPassword({email:mobileLoginEmail(phone),password});
 if(!viaMobile.error)return;
 const viaPhone=await client.auth.signInWithPassword({phone,password});
 if(viaPhone.error)throw Error(signInMessage(/disabled/i.test(viaPhone.error.message||'')?viaMobile.error:viaPhone.error));
}
function Brand(){return <div className="ss-brand"><span><GraduationCap size={26}/></span><div><b>School Success</b><small>Supporting people. Strengthening practice.</small></div></div>;}

export default function SuccessSignIn({mode='signin',message='',onDone}){
 const client=browserClient();
 const [step,setStep]=useState(mode),[login,setLogin]=useState(''),[password,setPassword]=useState(''),[show,setShow]=useState(false);
 const [next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[name,setName]=useState('');
 useEffect(()=>{if(step==='change'&&client)client.auth.getSession().then(({data})=>setName(data.session?.user?.user_metadata?.full_name||'')).catch(()=>{});},[step]);
 async function signIn(e){
  e.preventDefault();if(busy)return;setError('');
  if(!client){setError('Sign-in is not available right now.');return;}
  setBusy(true);
  try{
   await signInWithLogin(client,login,password);
   const {data}=await client.auth.getSession();
   if(data.session?.user?.app_metadata?.must_change_password){setName(data.session.user.user_metadata?.full_name||'');setStep('change');setPassword('');}
   else onDone();
  }catch(err){setError(err.message);}finally{setBusy(false);}
 }
 async function setOwnPassword(e){
  e.preventDefault();if(busy)return;setError('');
  if(!validPassword(next)){setError('Use at least '+PASSWORD_MIN+' characters (6 digits are fine).');return;}
  if(next!==confirm){setError('The two passwords do not match.');return;}
  setBusy(true);
  try{
   // Use a fresh sign-in for the save.
   let {data:{session}}=await client.auth.getSession();
   if(!session){setStep('signin');throw Error('Your sign-in has expired. Please sign in again with your starting password.');}
   const fresh=await client.auth.refreshSession();if(fresh.data?.session)session=fresh.data.session;
   const save=body=>fetch('/api/password-changed',{method:'POST',headers:{'Content-Type':'application/json',...(session?.access_token?{Authorization:'Bearer '+session.access_token}:{})},body:JSON.stringify(body)});
   let res=await save({password:next}),out=await res.json().catch(()=>({}));
   if(res.status===401){
    // Backup path: set the password with the person's own session, then confirm it on the server.
    const up=await client.auth.updateUser({password:next});
    if(up.error)throw Error(/same|different from the old/i.test(up.error.message||'')?'Choose a password different from your starting password.':signInMessage(up.error));
    res=await save({password:next,confirm:'new-password',login:session.user?.email||session.user?.phone||''});out=await res.json().catch(()=>({}));
   }
   if(!res.ok)throw Error(out.error||'Your password could not be saved.');
   await client.auth.refreshSession().catch(()=>{});
   onDone();
  }catch(err){setError(err.message);}finally{setBusy(false);}
 }
 async function signOut(){try{await client?.auth.signOut();}catch{}location.reload();}
 if(step==='noaccess')return <main className="ss-auth"><div className="ss-card"><Brand/><h1>No School Success access</h1>
  <p className="ss-lead">{message||'This account is not set up for School Success.'} Ask your School Success administrator to add you, then sign in again.</p>
  <button type="button" className="ss-btn" onClick={()=>void signOut()}><LogOut size={18}/>Sign out</button></div></main>;
 if(step==='change')return <main className="ss-auth"><form className="ss-card" onSubmit={setOwnPassword}><Brand/><h1>Set your own password</h1>
  <p className="ss-lead">{name?'Welcome, '+name+'. ':''}Replace the starting password before you continue. Use at least {PASSWORD_MIN} characters; 6 digits are fine.</p>
  {error&&<p className="ss-error" role="alert"><CircleAlert size={16}/>{error}</p>}
  <label className="ss-field"><span>New password</span><input type="password" inputMode="text" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={128} required value={next} onChange={e=>setNext(e.target.value)}/></label>
  <label className="ss-field"><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={PASSWORD_MIN} maxLength={128} required value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
  <button className="ss-btn" disabled={busy}><KeyRound size={18}/>{busy?'Saving…':'Save and continue'}</button>
  <button type="button" className="ss-link" onClick={()=>void signOut()}>Sign out</button></form></main>;
 return <main className="ss-auth"><form className="ss-card" onSubmit={signIn}><Brand/><h1>Sign in</h1>
  <p className="ss-lead">For principals, coordinators, school management and School Success consultants.</p>
  {error&&<p className="ss-error" role="alert"><CircleAlert size={16}/>{error}</p>}
  <label className="ss-field"><span>Mobile number or email</span><input autoComplete="username" inputMode="email" placeholder="10-digit mobile number or email" required value={login} onChange={e=>setLogin(e.target.value)}/></label>
  <label className="ss-field"><span>Password</span><span className="ss-pass"><input type={show?'text':'password'} autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/><button type="button" aria-label={show?'Hide password':'Show password'} onClick={()=>setShow(v=>!v)}>{show?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>
  <button className="ss-btn" disabled={busy}><LogIn size={18}/>{busy?'Signing in…':'Sign in'}</button>
  <p className="ss-note">Forgot your password? Ask your School Success administrator to reset it.</p>
  <p className="ss-note">Teachers: open your school link and sign in with your PIN.</p></form></main>;
}
