import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
export const runtime="nodejs";
export async function POST(request){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return NextResponse.json({error:"Not configured"},{status:503});
 const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const body=await request.json().catch(()=>({}));
 const password=String(body.password||"");
 if(password.length<12||password.length>128)return NextResponse.json({error:"Password must contain 12 to 128 characters."},{status:400});
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await admin.auth.getUser(token);
 if(error||!user)return NextResponse.json({error:"Unauthorized"},{status:401});
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