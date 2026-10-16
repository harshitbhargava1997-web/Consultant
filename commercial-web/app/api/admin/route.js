import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {isConfirmedUser,isEmail,normalizePhone} from "../../../lib/auth";

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
 if (error || !isConfirmedUser(user))
   return { error: "Invalid or unconfirmed account.", status: 401 };
 const { data: isAdmin, error: checkError } = await userClient.rpc("literacy_current_user_is_admin");
 if (checkError) return { error: "Administrator verification failed.", status: 503 };
 return { user, isAdmin: isAdmin === true };
}
export async function GET(request) {
 try {
  const ctx = await authorize(request);
  if (ctx.error) return response({ error: ctx.error }, ctx.status);
  const url=new URL(request.url);
  if(url.searchParams.get("view")==="stakeholders"){
   if(!ctx.isAdmin)return response({error:"Only Super Admin can review stakeholder accounts."},403);
   const admin=adminClient();
   const memberships=[];
   for(let page=0;page<20;page++){
    const {data,error}=await admin.from("literacy_memberships")
     .select("user_id,school_id,display_name,role")
     .order("school_id").order("user_id").range(page*500,page*500+499);
    if(error)throw error;
    memberships.push(...(data||[]));
    if((data||[]).length<500)break;
    if(page===19)return response({error:"Stakeholder directory exceeds safe listing size. Contact the platform administrator."},413);
   }
   const accounts=new Map();
   for(let page=1;page<=50;page++){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:200});
    if(error)throw error;
    for(const user of data.users||[]){
     accounts.set(user.id,{email:user.email||"",phone:user.phone||"",confirmed:isConfirmedUser(user)});
    }
    if((data.users||[]).length<200)break;
   }
   return response({memberships:memberships.map(row=>({
    ...row,email:accounts.get(row.user_id)?.email||"",phone:accounts.get(row.user_id)?.phone||"",
    confirmed:accounts.get(row.user_id)?.confirmed===true
   }))});
  }
  return response({ isAdmin: ctx.isAdmin });
 } catch { return response({ error: "Administrator verification unavailable." }, 503); }
}
export async function POST(request) {
 try{
  const ctx=await authorize(request);
  if(ctx.error)return response({error:ctx.error},ctx.status);
  if(ctx.user.app_metadata?.must_change_password)return response({error:"Change your initial password first."},403);
  const body=await request.json();
  // Creating a school is reserved exclusively for the Platform Super Admin.
  if(body.action==="createSchool" && !ctx.isAdmin)
   return response({error:"Only the Platform Super Admin may create schools."},403);
  if(!["createSchool","createUser"].includes(body.action))
   return response({error:"Unknown action."},400);
  const admin=adminClient();
  if(body.action==="createSchool"){
   const name=String(body.name||"").trim();
   if(name.length<3||name.length>180)return response({error:"Enter a valid school name."},400);
   const {data,error}=await admin.from("literacy_schools").insert({name}).select("id,name").single();
   if(error)return response({error:error.message},400);return response({school:data});
  }
  if(body.action==="createUser"){
   const email=String(body.email||"").trim().toLowerCase();
   const rawMobile=String(body.mobile||"").trim();
   const phone=normalizePhone(rawMobile);
   const fullName=String(body.fullName||"").trim();
   const schoolId=String(body.schoolId||"");
   const role=String(body.role||"");
   const initialPassword=typeof body.initialPassword==="string"?body.initialPassword:"";
   if((email&&!isEmail(email))||(rawMobile&&!phone)||(!email&&!phone)||
      (role!=="teacher"&&(!email||phone))||fullName.length<2||fullName.length>160||
      !["owner","principal","coordinator","teacher"].includes(role)||
      !/^[0-9a-f-]{36}$/i.test(schoolId))return response({error:role==="teacher"?
       "Enter a valid teacher email or mobile number, role and school.":
       "School owners, principals and coordinators require a valid email login."},400);
   // Tenant-scope the service-role action; UI controls alone cannot enforce permissions.
   let isAssignedConsultant=false;
   if(!ctx.isAdmin){
    const [memberResult,consultantResult]=await Promise.all([
     admin.from("literacy_memberships").select("role")
      .eq("school_id",schoolId).eq("user_id",ctx.user.id).maybeSingle(),
     admin.from("literacy_consultant_assignments").select("school_id")
      .eq("school_id",schoolId).eq("consultant_user_id",ctx.user.id).maybeSingle()
    ]);
    if(memberResult.error||consultantResult.error)return response({error:"School permission check failed."},503);
    isAssignedConsultant=!!consultantResult.data;
    const currentRole=isAssignedConsultant?"consultant":memberResult.data?.role;
    if(!["consultant","owner","principal","coordinator","teacher"].includes(currentRole))
     return response({error:"You are not assigned to this school."},403);
    const {data:setting,error:settingError}=await admin.from("literacy_role_permissions")
      .select("enabled").eq("role",currentRole).eq("feature","users.manage").maybeSingle();
    if(settingError)throw settingError;
    if(!setting?.enabled)
     return response({error:"User management is disabled for your stakeholder role."},403);
    if(!isAssignedConsultant&&role!=="teacher")
     return response({error:"School leaders may create or assign teachers only."},403);
   }
   const {data:school,error:schoolError}=await admin.from("literacy_schools").select("id").eq("id",schoolId).maybeSingle();
   if(schoolError)throw schoolError;
   if(!school)return response({error:"School not found."},400);
   let existing=null;let page=1,emailUser=null,phoneUser=null;
   while(page<=50){
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:200});
    if(error)throw error;
    if(email&&!emailUser)emailUser=(data.users||[]).find(u=>u.email?.toLowerCase()===email)||null;
    if(phone&&!phoneUser)phoneUser=(data.users||[]).find(u=>u.phone===phone)||null;
    if((!email||emailUser)&&(!phone||phoneUser))break;
    if((data.users||[]).length<200)break;page++;
   }
   if(emailUser&&phoneUser&&emailUser.id!==phoneUser.id)
    return response({error:"That email and mobile number belong to different accounts."},409);
   existing=emailUser||phoneUser;
   if(existing&&phone){
    const {data:higherRoles,error:roleError}=await admin.from("literacy_memberships")
     .select("role").eq("user_id",existing.id).neq("role","teacher").limit(1);
    if(roleError)throw roleError;
    if(higherRoles?.length)return response({error:"Mobile login is available only for teacher-only accounts."},403);
   }
   // Protect existing owner/principal/coordinator memberships from being overwritten
   // by delegated teacher creation, including same-email reassignments.
   if(!ctx.isAdmin && !isAssignedConsultant && existing){
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
    const authIdentity={password:initialPassword,
      user_metadata:{full_name:fullName},
      app_metadata:{must_change_password:false}
    };
    if(email){authIdentity.email=email;authIdentity.email_confirm=true;}
    if(phone){authIdentity.phone=phone;authIdentity.phone_confirm=true;}
    const {data,error}=await admin.auth.admin.createUser(authIdentity);
    if(error)throw error;
    existing=data.user;
   }else if(role==="teacher"&&((email&&!existing.email)||(phone&&!existing.phone))){
    const identityUpdate={};
    if(email&&!existing.email){identityUpdate.email=email;identityUpdate.email_confirm=true;}
    if(phone&&!existing.phone){identityUpdate.phone=phone;identityUpdate.phone_confirm=true;}
    const {data,error}=await admin.auth.admin.updateUserById(existing.id,identityUpdate);
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
   return response({created:isNewAccount,email,phone,
     message:isNewAccount
       ?"User created using the initial password you supplied. Share it privately. Email accounts may use Forgot password; mobile-login teachers should contact their school administrator for password help."
       :"Existing account assigned to this school; its password was not changed."});
  }
  if(body.action==="completePasswordChange"){
   return response({error:"Use the password change endpoint."},400);
  }
  return response({error:"Unknown action."},400);
 }catch(e){return response({error:e.message||"Administrator request failed."},500);}
}
