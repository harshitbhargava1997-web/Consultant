import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { validPassword, PASSWORD_MIN, PASSWORD_MAX } from "@/lib/password-policy";
export const runtime="nodejs";
export async function POST(request){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return NextResponse.json({error:"Not configured"},{status:503});
 const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 const body=await request.json().catch(()=>({}));
 const password=String(body.password||"");
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 if(!validPassword(password))return NextResponse.json({error:"Use a password with "+PASSWORD_MIN+" to "+PASSWORD_MAX+" characters."},{status:400});
 // Backup path for the first-password step: the browser already set the new password through the sign-in service
 // (with the person's own session). Prove it by signing in with that new password, then clear "must change".
 if(body.confirm==="new-password"){
  const login=String(body.login||"").trim();
  if(!login)return NextResponse.json({error:"Sign in again to set your password."},{status:401});
  const verifier=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const proof=await verifier.auth.signInWithPassword({...(login.includes("@")?{email:login}:{phone:login}),password});
  if(proof.error||!proof.data.user){console.warn("password-changed: new password could not be confirmed",proof.error?.status||"",proof.error?.code||"");return NextResponse.json({error:"Your new password could not be confirmed. Sign in again with it."},{status:401});}
  await verifier.auth.signOut({scope:"local"}).catch(()=>{});
  const u=proof.data.user;
  if(u.app_metadata?.must_change_password){
   const {error:flagError}=await admin.auth.admin.updateUserById(u.id,{app_metadata:{...u.app_metadata,must_change_password:false}});
   if(flagError)return NextResponse.json({error:"Password saved, but your account could not be updated. Please try again."},{status:500});
  }
  return NextResponse.json({ok:true,confirmed:true});
 }
 if(!token)return NextResponse.json({error:"Your sign-in has expired. Please sign in again."},{status:401});
 const {data:{user},error}=await admin.auth.getUser(token);
 if(error||!user){console.warn("password-changed: sign-in token not accepted",error?.status||"",error?.code||error?.name||"");return NextResponse.json({error:"Your sign-in could not be verified. Please sign in again."},{status:401});}
 if(!user.app_metadata?.must_change_password){
  if(!body.currentPassword||typeof body.currentPassword!=='string')return NextResponse.json({error:"Enter your current password."},{status:400});
  const verifier=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const proof=await verifier.auth.signInWithPassword({...(user.email?{email:user.email}:{phone:user.phone}),password:body.currentPassword});
  if(proof.error||proof.data.user?.id!==user.id)return NextResponse.json({error:"Current password could not be verified."},{status:403});
  await verifier.auth.signOut({scope:"local"});
 }
 const {error:updateError}=await admin.auth.admin.updateUserById(user.id,{
  password,app_metadata:{...user.app_metadata,must_change_password:false}
 });
 if(updateError)return NextResponse.json({error:"Password could not be saved."},{status:500});
 return NextResponse.json({ok:true});
}