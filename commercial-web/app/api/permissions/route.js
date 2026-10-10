import {NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
import {PERMISSION_ROLES,PERMISSION_KEYS} from "../../../lib/permissions";

export const runtime="nodejs";
function respond(data,status=200){return NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});}
const UUID=/^[a-f0-9-]{36}$/i;
async function context(request){
 const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return {error:"Sign in required.",status:401};
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!anon||!secret)return {error:"Permission service not configured.",status:503};
 const signed=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:"Bearer "+token}}});
 const {data:{user},error}=await signed.auth.getUser(token);
 if(error||!user||!user.email_confirmed_at)return {error:"Invalid or expired session.",status:401};
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:superRow,error:superError}=await admin.from("literacy_platform_admins").select("user_id").eq("user_id",user.id).maybeSingle();
 if(superError)return {error:"Unable to check administrator role.",status:503};
 return {user,isAdmin:!!superRow,signed,admin};
}
export async function GET(request){
 try{
  const ctx=await context(request);if(ctx.error)return respond({error:ctx.error},ctx.status);
  const schoolId=new URL(request.url).searchParams.get("schoolId")||"";
  if(ctx.isAdmin){
   const {data,error}=await ctx.admin.from("literacy_role_permissions")
    .select("role,feature,enabled,updated_at").order("role").order("feature");
   if(error)throw error;
   return respond({isAdmin:true,grants:PERMISSION_KEYS,matrix:data||[],role:"super_admin"});
  }
  if(!UUID.test(schoolId))return respond({isAdmin:false,role:null,grants:[]});
  const [consultantResult,memberResult]=await Promise.all([
   ctx.admin.from("literacy_consultant_assignments").select("school_id")
    .eq("consultant_user_id",ctx.user.id).eq("school_id",schoolId).maybeSingle(),
   ctx.admin.from("literacy_memberships").select("role").eq("user_id",ctx.user.id).eq("school_id",schoolId).maybeSingle()
  ]);
  if(consultantResult.error||memberResult.error)return respond({error:"Unable to check school role."},503);
  const role=consultantResult.data?"consultant":memberResult.data?.role||null;
  if(!PERMISSION_ROLES.includes(role))return respond({isAdmin:false,role:null,grants:[]});
  const {data,error}=await ctx.admin.from("literacy_role_permissions")
    .select("feature").eq("role",role).eq("enabled",true);
  if(error)throw error;
  return respond({isAdmin:false,role,grants:(data||[]).map(x=>x.feature)});
 }catch(e){return respond({error:"Unable to load permissions: "+(e.message||"Unknown error")},500);}
}
export async function POST(request){
 try{
  const ctx=await context(request);if(ctx.error)return respond({error:ctx.error},ctx.status);
  if(!ctx.isAdmin)return respond({error:"Only the Super Admin may change role permissions."},403);
  const raw=await request.text();if(raw.length>2000)return respond({error:"Invalid request."},413);
  const body=JSON.parse(raw);
  if(!PERMISSION_ROLES.includes(body.role)||!PERMISSION_KEYS.includes(body.feature)||typeof body.enabled!=="boolean")
   return respond({error:"Invalid role, feature or setting."},400);
  const {data,error}=await ctx.signed.rpc("lit_set_role_permission",{
   p_role:body.role,p_feature:body.feature,p_enabled:body.enabled
  });
  if(error)throw error;
  return respond({saved:!!data,role:body.role,feature:body.feature,enabled:body.enabled});
 }catch(e){return respond({error:"Role permission was not saved: "+(e.message||"Unknown error")},500);}
}
