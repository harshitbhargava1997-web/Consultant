import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  if(ctx.user.app_metadata?.must_change_password)return response({error:"Change your initial password first."},403);
  const body=await request.json();
  // Only teacher onboarding is delegated. All other admin actions remain platform-admin-only.
  if(body.action!=="createUser" && !ctx.isAdmin)
   return response({error:"Platform Super Admin permission required."},403);
  const admin=adminClient();
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
   const initialPassword=typeof body.initialPassword==="string"?body.initialPassword:"";
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||fullName.length<2||fullName.length>160||
      !["owner","principal","coordinator","teacher"].includes(role)||
      !/^[0-9a-f-]{36}$/i.test(schoolId))return response({error:"Valid user, role and school required."},400);
   // Use server-side membership checks. Never trust the school or role selected by the browser.
   if(!ctx.isAdmin){
    if(role!=="teacher")return response({error:"School leaders may create or assign teachers only."},403);
    const {data:manager,error:managerError}=await admin.from("literacy_memberships")
      .select("role").eq("school_id",schoolId).eq("user_id",ctx.user.id).maybeSingle();
    if(managerError)throw managerError;
    if(!manager||!["owner","principal","coordinator"].includes(manager.role))
     return response({error:"School owner, principal or coordinator access required for this school."},403);
   }
   const {data:school,error:schoolError}=await admin.from("literacy_schools").select("id").eq("id",schoolId).maybeSingle();
   if(schoolError)throw schoolError;
   if(!school)return response({error:"School not found."},400);
   let existing=null;let page=1;
   while(page<=50&&!existing){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:200});
    if(error)throw error;
    existing=(data.users||[]).find(u=>u.email?.toLowerCase()===email);
    if((data.users||[]).length<200)break;page++;
   }
   // Protect existing owner/principal/coordinator memberships from being overwritten
   // by delegated teacher creation, including same-email reassignments.
   if(!ctx.isAdmin && existing){
    const {data:currentMembership,error:memberError}=await admin.from("literacy_memberships")
      .select("role").eq("school_id",schoolId).eq("user_id",existing.id).maybeSingle();
    if(memberError)throw memberError;
    if(currentMembership && currentMembership.role!=="teacher")
      return response({error:"This account already has a different school role. Contact the Platform Super Admin."},403);
   }
   const isNewAccount=!existing;
   if(isNewAccount){
    // Only the Super Admin sets initial credentials. Never persist or echo the plaintext password.
    // Existing accounts are assigned to additional schools without changing their credentials.
    if(initialPassword.length<12||initialPassword.length>128||
       !/[a-z]/.test(initialPassword)||!/[A-Z]/.test(initialPassword)||
       !/[0-9]/.test(initialPassword)||!(/[^A-Za-z0-9]/.test(initialPassword))){
      return response({error:"For a new account, enter an initial password of 12–128 characters with uppercase, lowercase, a number and a symbol."},400);
    }
    const {data,error}=await admin.auth.admin.createUser({
      email,password:initialPassword,email_confirm:true,
      user_metadata:{full_name:fullName},
      app_metadata:{must_change_password:false}
    });
    if(error)throw error;
    existing=data.user;
   }
   const {error:membershipError}=await admin.from("literacy_memberships")
     .upsert({school_id:schoolId,user_id:existing.id,display_name:fullName,role},
       {onConflict:"school_id,user_id"});
   if(membershipError){
    // Undo a newly provisioned account if its school assignment fails.
    // Do not delete pre-existing accounts.
    if(isNewAccount)await admin.auth.admin.deleteUser(existing.id).catch(()=>{});
    throw membershipError;
   }
   return response({created:isNewAccount,email,
     message:isNewAccount
       ?"User created using the initial password you supplied. Share it privately; they may use Forgot password to change it. Confirm email ownership separately."
       :"Existing account assigned to this school; its password was not changed."});
  }
  if(body.action==="completePasswordChange"){
   return response({error:"Use the password change endpoint."},400);
  }
  return response({error:"Unknown action."},400);
 }catch(e){return response({error:e.message||"Administrator request failed."},500);}
}
