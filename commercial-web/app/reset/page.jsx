"use client";
import {useEffect,useMemo,useState} from "react";
import {browserClient} from "../../lib/supabase";
import Link from "next/link";
export default function Reset(){
 const client=useMemo(()=>browserClient(),[]);
 const [ready,setReady]=useState(false),[password,setPassword]=useState(""),[confirm,setConfirm]=useState(""),[message,setMessage]=useState("");
 useEffect(()=>{
  if(!client)return;
  client.auth.getSession().then(({data})=>setReady(!!data.session));
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,s)=>setReady(!!s));
  return ()=>subscription.unsubscribe();
 },[client]);
 async function submit(e){
  e.preventDefault();if(password!==confirm||password.length<12){setMessage("Passwords must match and contain at least 12 characters.");return;}
  const {error}=await client.auth.updateUser({password});
  if(error){setMessage(error.message);return;}
  await client.auth.signOut();setMessage("Password updated. Return to sign in.");setReady(false);
 }
 return <main className="auth-outer"><div className="auth-card"><span className="eyebrow">ACCOUNT RECOVERY</span><h1>Create a new password</h1><p>Open this page using the password recovery email from Supabase.</p>{message&&<div className="notice">{message}</div>}{ready?<form onSubmit={submit}><label>New password<input type="password" minLength={12} value={password} onChange={e=>setPassword(e.target.value)} required/></label><label>Confirm new password<input type="password" minLength={12} value={confirm} onChange={e=>setConfirm(e.target.value)} required/></label><button type="submit" className="btn primary">Save new password</button></form>:<p>Waiting for a valid recovery session. If the link expired, request another from Sign in.</p>}<Link href="/" className="link-button">Back to sign in</Link></div></main>;
}