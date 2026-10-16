import {NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
import {isConfirmedUser} from "../../../lib/auth";

export const runtime="nodejs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRADES=["Nursery","LKG","UKG","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5"];
const TYPES=["demonstration","lesson_plan","activity","worksheet","audio","video","external"];
const ROLES=["consultant","owner","principal","coordinator","teacher"];
const STATUSES=["draft","published","archived"];
const send=(data,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const clean=(value,max=200)=>String(value??"").trim().slice(0,max+1);
const validUrl=value=>value===""||(/^https:\/\/[^\s<>\"]+$/i.test(value)&&value.length<=1500);
const db=key=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}});

async function access(request,schoolId){
 const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!publicKey||!secret||!process.env.NEXT_PUBLIC_SUPABASE_URL)return {error:"Digital content service is unavailable.",status:503};
 const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return {error:"Sign in required.",status:401};
 const signed=db(publicKey);
 const {data:{user},error}=await signed.auth.getUser(token);
 if(error||!isConfirmedUser(user))return {error:"Invalid or expired session.",status:401};
 const admin=db(secret);
 const {data:superUser,error:adminError}=await admin.from("literacy_platform_admins").select("user_id").eq("user_id",user.id).maybeSingle();
 if(adminError)return {error:"Unable to verify platform access.",status:503};
 const isAdmin=!!superUser;
 if(!schoolId&&!isAdmin)return {error:"Select an assigned school.",status:400};
 if(schoolId&&!UUID.test(schoolId))return {error:"Invalid school ID.",status:400};
 let role="super_admin",grants=new Set(),allowedGrades=GRADES;
 if(!isAdmin){
  const [consultant,membership]=await Promise.all([
   admin.from("literacy_consultant_assignments").select("school_id").eq("consultant_user_id",user.id).eq("school_id",schoolId).maybeSingle(),
   admin.from("literacy_memberships").select("role").eq("user_id",user.id).eq("school_id",schoolId).maybeSingle()
  ]);
  if(consultant.error||membership.error)return {error:"Unable to verify school assignment.",status:503};
  role=consultant.data?"consultant":membership.data?.role||"";
  if(!ROLES.includes(role))return {error:"This school is not assigned to you.",status:403};
  const {data:permissionRows,error:permissionError}=await admin.from("literacy_role_permissions")
   .select("feature").eq("role",role).eq("enabled",true);
  if(permissionError)return {error:"Unable to read digital-content permissions.",status:503};
  grants=new Set((permissionRows||[]).map(row=>row.feature));
  if(!grants.has("digital_content.access"))return {error:"Digital content is disabled for your role.",status:403};
  if(role==="teacher"){
   const {data:links,error:linkError}=await admin.from("literacy_teacher_classes").select("class_id").eq("teacher_user_id",user.id);
   if(linkError)return {error:"Unable to load assigned classes.",status:503};
   const ids=(links||[]).map(row=>row.class_id);
   const {data:classes,error:classError}=ids.length?await admin.from("literacy_classes").select("grade").eq("school_id",schoolId).in("id",ids):{data:[],error:null};
   if(classError)return {error:"Unable to load assigned grades.",status:503};
   allowedGrades=[...new Set((classes||[]).map(row=>row.grade).filter(grade=>GRADES.includes(grade)))];
  }
 }
 return {admin,user,isAdmin,role,schoolId,allowedGrades};
}

async function loadContent(ctx){
 let query=ctx.admin.from("literacy_digital_content")
  .select("id,title,summary,grade,competency_id,content_type,objective,preparation,demonstration,practice,check_understanding,resource_url,target_roles,status,sequence,published_at,created_at,updated_at")
  .order("sequence").order("created_at",{ascending:false}).limit(1000);
 if(!ctx.isAdmin){
  query=query.eq("status","published").contains("target_roles",[ctx.role]);
  if(ctx.role==="teacher"){
   if(!ctx.allowedGrades.length)return [];
   query=query.in("grade",ctx.allowedGrades);
  }
 }
 const {data,error}=await query;
 if(error)throw error;
 return data||[];
}

export async function GET(request){
 try{
  const schoolId=clean(new URL(request.url).searchParams.get("schoolId"),40);
  const ctx=await access(request,schoolId);
  if(ctx.error)return send({error:ctx.error},ctx.status);
  return send({content:await loadContent(ctx),role:ctx.role,isAdmin:ctx.isAdmin,allowedGrades:ctx.allowedGrades});
 }catch(e){return send({error:"Digital content could not be loaded: "+(e.message||"Unknown error")},500);}
}

export async function POST(request){
 try{
  const schoolId=clean(new URL(request.url).searchParams.get("schoolId"),40);
  const ctx=await access(request,schoolId);
  if(ctx.error)return send({error:ctx.error},ctx.status);
  if(!ctx.isAdmin)return send({error:"Only the Platform Super Admin can publish digital content."},403);
  const raw=await request.text();
  if(raw.length>65000)return send({error:"Digital-content request exceeds the maximum size."},413);
  let body;try{body=JSON.parse(raw);}catch{return send({error:"Invalid request."},400);}
  const action=clean(body.action,30);
  if(action==="save"){
   const id=clean(body.id,40),title=clean(body.title,180),summary=clean(body.summary,1000);
   const grade=clean(body.grade,30),type=clean(body.contentType,30),competencyId=clean(body.competencyId,40);
   const targetRoles=[...new Set(Array.isArray(body.targetRoles)?body.targetRoles:[])];
   const sequence=Number(body.sequence);
   const payload={title,summary,grade,competency_id:competencyId||null,content_type:type,
    objective:clean(body.objective,3000),preparation:clean(body.preparation,12000),
    demonstration:clean(body.demonstration,12000),practice:clean(body.practice,12000),
    check_understanding:clean(body.checkUnderstanding,12000),resource_url:clean(body.resourceUrl,1500),
    target_roles:targetRoles,sequence,status:"draft",published_at:null,updated_at:new Date().toISOString()};
   if(title.length<4||!GRADES.includes(grade)||!TYPES.includes(type)||!targetRoles.length||
      !targetRoles.every(role=>ROLES.includes(role))||!Number.isInteger(sequence)||sequence<0||sequence>10000||!validUrl(payload.resource_url))
    return send({error:"Provide a title, valid grade, format, audience, order and HTTPS resource link."},400);
   if(!payload.objective&&!payload.preparation&&!payload.demonstration&&!payload.practice&&!payload.resource_url)
    return send({error:"Add at least an objective, preparation, demonstration, practice activity or resource link."},400);
   if(competencyId){
    if(!UUID.test(competencyId))return send({error:"Invalid competency."},400);
    const {data:competency,error}=await ctx.admin.from("literacy_competencies").select("id,grade").eq("id",competencyId).maybeSingle();
    if(error||!competency||competency.grade!==grade)return send({error:"Select a competency from the same grade as the content."},400);
   }
   if(id){
    if(!UUID.test(id))return send({error:"Invalid digital-content item."},400);
    const {data,error}=await ctx.admin.from("literacy_digital_content").update(payload).eq("id",id).select("id").maybeSingle();
    if(error)throw error;if(!data)return send({error:"Digital-content item was not found."},404);
    return send({saved:true,id:data.id,message:"Changes saved as a draft. Publish when ready."});
   }
   const {data,error}=await ctx.admin.from("literacy_digital_content").insert({...payload,created_by:ctx.user.id}).select("id").single();
   if(error)throw error;
   return send({saved:true,id:data.id,message:"Digital content saved as a draft."});
  }
  if(action==="status"){
   const id=clean(body.id,40),status=clean(body.status,20);
   if(!UUID.test(id)||!STATUSES.includes(status))return send({error:"Invalid content item or status."},400);
   const changes={status,updated_at:new Date().toISOString(),published_at:status==="published"?new Date().toISOString():null};
   const {data,error}=await ctx.admin.from("literacy_digital_content").update(changes).eq("id",id).select("id").maybeSingle();
   if(error)throw error;if(!data)return send({error:"Digital-content item was not found."},404);
   return send({saved:true,message:status==="published"?"Digital content published to its selected roles.":status==="archived"?"Digital content archived.":"Digital content returned to draft."});
  }
  return send({error:"Unsupported digital-content action."},400);
 }catch(e){return send({error:"Digital content was not saved: "+(e.message||"Unknown error")},500);}
}
