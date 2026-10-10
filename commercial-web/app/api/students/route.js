import {NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";

export const runtime="nodejs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function response(data,status=200){
 return NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});
}
export async function POST(request){
 try{
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return response({error:"Sign in required."},401);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!anon||!secret)return response({error:"Student management is not configured."},503);
  const authClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await authClient.auth.getUser(token);
  if(authError||!user||!user.email_confirmed_at)return response({error:"Invalid or expired login."},401);
  if(user.app_metadata?.must_change_password)return response({error:"Change initial password first."},403);
  const raw=await request.text();
  if(raw.length>4000)return response({error:"Request too large."},413);
  const body=JSON.parse(raw);
  if(!["add","remove"].includes(body.action)||!UUID.test(body.schoolId)||!UUID.test(body.classId))
   return response({error:"Invalid student action or selected school/class."},400);
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:cls,error:classError}=await admin.from("literacy_classes")
    .select("id,school_id").eq("id",body.classId).eq("school_id",body.schoolId).maybeSingle();
  if(classError||!cls)return response({error:"Class not found in the selected school."},404);
  const [superRes,memberRes,consultantRes,teacherRes]=await Promise.all([
   admin.from("literacy_platform_admins").select("user_id").eq("user_id",user.id).maybeSingle(),
   admin.from("literacy_memberships").select("role").eq("school_id",body.schoolId).eq("user_id",user.id).maybeSingle(),
   admin.from("literacy_consultant_assignments").select("school_id")
     .eq("school_id",body.schoolId).eq("consultant_user_id",user.id).maybeSingle(),
   admin.from("literacy_teacher_classes").select("class_id")
     .eq("class_id",body.classId).eq("teacher_user_id",user.id).maybeSingle()
  ]);
  if([superRes,memberRes,consultantRes,teacherRes].some(r=>r.error))
   return response({error:"School permission check failed."},503);
  const role=consultantRes.data?"consultant":memberRes.data?.role;
  const memberAssigned=!!superRes.data||!!consultantRes.data||
   ["owner","principal","coordinator"].includes(role)||
   (role==="teacher"&&!!teacherRes.data);
  if(!memberAssigned)return response({error:"You may manage students only in assigned classes or schools."},403);
  if(!superRes.data){
   const {data:grant,error:grantError}=await admin.from("literacy_role_permissions")
    .select("enabled").eq("role",role).eq("feature","students.manage").maybeSingle();
   if(grantError)throw grantError;
   if(!grant?.enabled)return response({error:"Student management is disabled for your role."},403);
  }
  if(body.action==="add"){
   const name=typeof body.studentName==="string"?body.studentName.trim():"";
   const admission=typeof body.admissionNumber==="string"?body.admissionNumber.trim():"";
   if(name.length<2||name.length>200||admission.length>100)
    return response({error:"Provide a student name (2–200 characters) and valid admission number."},400);
   const {data,error}=await admin.from("literacy_students").insert({
    class_id:body.classId,student_name:name,
    admission_number:admission||("AS-"+randomUUID().slice(0,12).toUpperCase())
   }).select("id").single();
   if(error)return response({error:error.message},400);
   return response({studentId:data.id,message:"Student added to this class."});
  }
  if(!UUID.test(body.studentId))return response({error:"Select a valid student."},400);
  // Soft-remove the learner to protect assessment history and prevent accidental data destruction.
  const {data,error}=await admin.from("literacy_students").update({active:false})
   .eq("id",body.studentId).eq("class_id",body.classId).eq("active",true)
   .select("id").maybeSingle();
  if(error)return response({error:error.message},400);
  if(!data)return response({error:"Student not found or already removed."},404);
  return response({message:"Student removed from active class roster; assessment history retained."});
 }catch(e){return response({error:"Student action failed: "+(e.message||"Unknown error")},500);}
}
