import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

export const runtime = "nodejs";
function response(data, status=200) { return NextResponse.json(data, {status, headers:{"Cache-Control":"no-store"}}); }
function adminClient() {
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error("Admin services are not configured.");
 return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
async function authorize(request) {
 const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
 if (!token) return { error: "Sign in required.", status: 401 };
 const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
 const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if (!url || !publicKey) return { error: "Authentication is not configured.", status: 503 };
 const userClient = createClient(url, publicKey, {
  global: { headers: { Authorization: "Bearer " + token } },
  auth: { persistSession: false, autoRefreshToken: false }
 });
 const { data: { user }, error } = await userClient.auth.getUser(token);
 if (error || !user || !user.email_confirmed_at)
   return { error: "Invalid or unconfirmed account.", status: 401 };
 const { data: isAdmin, error: checkError } = await userClient.rpc("literacy_current_user_is_admin");
 if (checkError) return { error: "Administrator verification failed.", status: 503 };
 return { user, isAdmin: isAdmin === true };
}
export async function GET(request) {
 try {
  const ctx = await authorize(request);
  if (ctx.error) return response({ error: ctx.error }, ctx.status);
  return response({ isAdmin: ctx.isAdmin });
 } catch { return response({ error: "Administrator verification unavailable." }, 503); }
}
export async function POST(request) {
 try{
  const ctx=await authorize(request);
  if(ctx.error)return response({error:ctx.error},ctx.status);
  if(!ctx.isAdmin)return response({error:"Platform Super Admin permission required."},403);
  if(ctx.user.app_metadata?.must_change_password)return response({error:"Change your initial password first."},403);
  const admin=adminClient();
  const body=await request.json();
  if(body.action==="createSchool"){
   const name=String(body.name||"").trim();
   if(name.length<3||name.length>180)return response({error:"Enter a valid school name."},400);
   const {data,error}=await admin.from("literacy_schools").insert({name}).select("id,name").single();
   if(error)return response({error:error.message},400);return response({school:data});
  }
  if(body.action==="createUser"){
   const email=String(body.email||"").trim().toLowerCase();
   const fullName=String(body.fullName||"").trim();
   const schoolId=String(body.schoolId||"");
   const role=String(body.role||"");
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||fullName.length<2||fullName.length>160||
      !["owner","principal","coordinator","teacher"].includes(role)||
      !/^[0-9a-f-]{36}$/i.test(schoolId))return response({error:"Valid user, role and school required."},400);
   const {data:school}=await admin.from("literacy_schools").select("id").eq("id",schoolId).maybeSingle();
   if(!school)return response({error:"School not found."},400);
   let existing=null;let page=1;
   while(page<=50&&!existing){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:200});
    if(error)throw error;
    existing=(data.users||[]).find(u=>u.email?.toLowerCase()===email);
    if((data.users||[]).length<200)break;page++;
   }
   let password=null;
   if(!existing){
    password=randomBytes(20).toString("base64url")+"aA1!";
    const {data,error}=await admin.auth.admin.createUser({
      email,password,email_confirm:true,
      user_metadata:{full_name:fullName},
      app_metadata:{must_change_password:true}
    });
    if(error)throw error;
    existing=data.user;
   }
   const {error:membershipError}=await admin.from("literacy_memberships")
     .upsert({school_id:schoolId,user_id:existing.id,display_name:fullName,role},
       {onConflict:"school_id,user_id"});
   if(membershipError)throw membershipError;
   return response({created:!!password,email,temporaryPassword:password,
     message:password?"Temporary password shown once. Require secure delivery and mailbox verification.":"Existing account assigned; password unchanged."});
  }
  if(body.action==="completePasswordChange"){
   return response({error:"Use the password change endpoint."},400);
  }
  return response({error:"Unknown action."},400);
 }catch(e){return response({error:e.message||"Administrator request failed."},500);}
}
