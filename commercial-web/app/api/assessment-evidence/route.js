import {activeSchoolError} from "../../../lib/school-lifecycle";
import {NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
import {isConfirmedUser} from "../../../lib/auth";
import {randomUUID} from "node:crypto";
export const runtime="nodejs";
const BUCKET="vision-assessment-evidence";
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const EXT={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov","video/x-m4v":"m4v","video/x-msvideo":"avi"};
const reply=(v,status=200)=>NextResponse.json(v,{status,headers:{"Cache-Control":"no-store"}});
const clean=(v,max=250)=>String(v??"").trim().slice(0,max+1);
function client(key){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}});}
async function session(request,schoolId){
 const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!anon||!secret||!process.env.NEXT_PUBLIC_SUPABASE_URL)return {error:"Assessment media storage unavailable.",status:503};
 const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return {error:"Sign in to access student evidence.",status:401};
 const signed=client(anon),admin=client(secret);
 const {data:{user},error}=await signed.auth.getUser(token);
 if(error||!isConfirmedUser(user))return {error:"Session expired.",status:401};
 if(user.app_metadata?.must_change_password)return {error:"Change your initial password first.",status:403};
 if(!UUID.test(schoolId))return {error:"Select a valid school.",status:400};
 const unavailable=await activeSchoolError(admin,schoolId);if(unavailable)return unavailable;
 const [superUser,assigned,member]=await Promise.all([
  admin.from("literacy_platform_admins").select("user_id").eq("user_id",user.id).maybeSingle(),
  admin.from("literacy_consultant_assignments").select("school_id").eq("school_id",schoolId).eq("consultant_user_id",user.id).maybeSingle(),
  admin.from("literacy_memberships").select("role").eq("school_id",schoolId).eq("user_id",user.id).maybeSingle()
 ]);
 if(superUser.error||assigned.error||member.error)return {error:"Unable to verify school authorization.",status:503};
 const isAdmin=!!superUser.data,role=isAdmin?"super_admin":assigned.data?"consultant":member.data?.role||"";
 if(!isAdmin&&!["teacher","owner","principal","coordinator","consultant"].includes(role))
  return {error:"Not assigned to this school.",status:403};
 let permissions=new Set();
 if(!isAdmin){
  const {data:grants,error:grantError}=await admin.from("literacy_role_permissions")
   .select("feature,enabled").eq("role",role).eq("enabled",true)
   .in("feature",["assessments.view","assessments.create","assessments.evidence.upload","assessments.evidence.view"]);
  if(grantError)return {error:"Cannot verify assessment permissions.",status:503};
  permissions=new Set((grants||[]).map(x=>x.feature));
 }
 return {admin,user,schoolId,role,isAdmin,
  can:key=>isAdmin||permissions.has(key)};
}
async function target(ctx,studentId,assessmentId,competencyId){
 if(!UUID.test(studentId))throw Error("Select a valid student.");
 const {data:student,error:se}=await ctx.admin.from("literacy_students")
  .select("id,class_id").eq("id",studentId).maybeSingle();
 if(se||!student)throw Error("Student not found.");
 const {data:schoolClass,error:ce}=await ctx.admin.from("literacy_classes")
  .select("id").eq("id",student.class_id).eq("school_id",ctx.schoolId).maybeSingle();
 if(ce||!schoolClass)throw Error("Student is not in the selected school.");
 if(ctx.role==="teacher"){
  const {data:assignment,error:te}=await ctx.admin.from("literacy_teacher_classes")
   .select("class_id").eq("class_id",student.class_id).eq("teacher_user_id",ctx.user.id).maybeSingle();
  if(te||!assignment)throw Error("Student is not in an assigned class.");
 }
 if(assessmentId){
  if(!UUID.test(assessmentId))throw Error("Invalid assessment session.");
  const {data:a,error:ae}=await ctx.admin.from("literacy_assessments")
   .select("id").eq("id",assessmentId).eq("student_id",studentId).eq("class_id",student.class_id)
   .eq("school_id",ctx.schoolId).eq("subject_type","student").maybeSingle();
  if(ae||!a)throw Error("Assessment session does not match this student.");
 }
 if(competencyId){
  if(!UUID.test(competencyId)||!assessmentId)throw Error("Select a saved competency rating.");
  const {data:rating,error:re}=await ctx.admin.from("literacy_assessment_results")
   .select("id").eq("assessment_id",assessmentId).eq("competency_id",competencyId).maybeSingle();
  if(re||!rating)throw Error("Competency was not assessed in this session.");
 }
 return student;
}
export async function GET(request){
 try{
  const url=new URL(request.url),schoolId=clean(url.searchParams.get("schoolId"),40),
   studentId=clean(url.searchParams.get("studentId"),40);
  const ctx=await session(request,schoolId);if(ctx.error)return reply({error:ctx.error},ctx.status);
  if(!ctx.can("assessments.view")||!ctx.can("assessments.evidence.view"))
   return reply({error:"Assessment media review is disabled."},403);
  await target(ctx,studentId,null,null);
  const {data:rows,error}=await ctx.admin.from("literacy_assessment_evidence")
   .select("id,student_id,assessment_id,competency_id,object_path,file_name,content_type,size_bytes,created_at")
   .eq("school_id",schoolId).eq("student_id",studentId).order("created_at",{ascending:false}).limit(150);
  if(error)throw error;
  const items=await Promise.all((rows||[]).map(async item=>{
   const {object_path,...rest}=item;
   const {data}=await ctx.admin.storage.from(BUCKET).createSignedUrl(object_path,600);
   return {...rest,url:data?.signedUrl||""};
  }));
  return reply({items});
 }catch(e){return reply({error:e.message||"Cannot load assessment evidence."},400);}
}
export async function POST(request){
 try{
  const schoolId=clean(new URL(request.url).searchParams.get("schoolId"),40);
  const ctx=await session(request,schoolId);if(ctx.error)return reply({error:ctx.error},ctx.status);
  if(!ctx.can("assessments.create")||!ctx.can("assessments.evidence.upload"))
   return reply({error:"Student assessment media upload is disabled."},403);
  const raw=await request.text();
  if(raw.length>12000)return reply({error:"Request is too large."},413);
  let body;try{body=JSON.parse(raw);}catch{return reply({error:"Invalid evidence submission."},400);}
  const action=clean(body.action,40),studentId=clean(body.studentId,40),
   assessmentId=clean(body.assessmentId,40),competencyId=clean(body.competencyId,40);
  const student=await target(ctx,studentId,assessmentId,competencyId);
  if(action==="uploadTicket"){
   const mime=clean(body.contentType,80),name=clean(body.name,240),size=Number(body.size);
   if(!EXT[mime]||!name||name.length>240||!Number.isInteger(size)||size<1||size>50*1024*1024)
    return reply({error:"Choose a photo or video up to 50 MB."},400);
   const path=[schoolId,studentId,assessmentId,randomUUID()+"."+EXT[mime]].join("/");
   const {data,error}=await ctx.admin.storage.from(BUCKET).createSignedUploadUrl(path);
   if(error)throw error;
   return reply({path,token:data.token});
  }
  if(action==="attach"){
   const path=clean(body.path,350),name=clean(body.name,240),
    mime=clean(body.contentType,80),size=Number(body.size);
   const prefix=schoolId+"/"+studentId+"/"+assessmentId+"/";
   if(!path.startsWith(prefix)||!/^[-a-f0-9]{36}\.[a-z0-9]+$/i.test(path.slice(prefix.length))||
    !path.endsWith("."+EXT[mime])||!name||name.length>240||
    !Number.isInteger(size)||size<1||size>50*1024*1024)
    return reply({error:"Invalid attached assessment evidence."},400);
   const {data:stored,error:infoError}=await ctx.admin.storage.from(BUCKET).info(path);
   if(infoError||!stored)return reply({error:"Finish uploading the file before attaching it."},400);
   const actual=Number(stored.metadata?.size??stored.size);
   if(Number.isFinite(actual)&&actual!==size)return reply({error:"Uploaded file size mismatch."},400);
   const {error}=await ctx.admin.from("literacy_assessment_evidence").insert({
    school_id:ctx.schoolId,class_id:student.class_id,student_id:studentId,
    assessment_id:assessmentId,competency_id:competencyId,uploaded_by:ctx.user.id,
    object_path:path,file_name:name,content_type:mime,size_bytes:size
   });
   if(error)throw error;
   return reply({message:"Photo or video attached to this student's assessed competency."});
  }
  return reply({error:"Unknown assessment evidence action."},400);
 }catch(e){return reply({error:e.message||"Assessment evidence operation failed."},400);}
}
