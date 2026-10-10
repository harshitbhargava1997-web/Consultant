import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export const runtime="nodejs";
const ROLES=["owner","principal","coordinator","teacher"];
const GRADES=["Nursery","LKG","UKG","Grade 1","Grade 2","Grade 3","Grade 4"];
const MANAGERS=["owner","principal","coordinator"];

function response(data,status=200){
 return NextResponse.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
function client(key){
 return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,{
  auth:{persistSession:false,autoRefreshToken:false}
 });
}
async function authorized(request,schoolId){
 if(!process.env.SUPABASE_SERVICE_ROLE_KEY||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  return {error:"The bulk service is not configured.",status:503};
 const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return {error:"Sign in required.",status:401};
 const userClient=client(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
 const {data:{user},error:authError}=await userClient.auth.getUser(token);
 if(authError||!user||!user.email_confirmed_at)return {error:"Sign in again.",status:401};
 if(user.app_metadata?.must_change_password)return {error:"Change your initial password first.",status:403};
 const admin=client(process.env.SUPABASE_SERVICE_ROLE_KEY);
 const {data:administrator,error:adminError}=await admin.from("literacy_platform_admins")
   .select("user_id").eq("user_id",user.id).maybeSingle();
 if(adminError)return {error:"Unable to verify platform permissions.",status:503};
 const isAdmin=!!administrator;
 const {data:membership,error:membershipError}=await admin.from("literacy_memberships")
   .select("role").eq("school_id",schoolId).eq("user_id",user.id).maybeSingle();
 if(membershipError)return {error:"Unable to verify school permissions.",status:503};
 if(!isAdmin&&!MANAGERS.includes(membership?.role))
  return {error:"School owner, principal or coordinator access is required.",status:403};
 const {data:school,error:schoolError}=await admin.from("literacy_schools")
   .select("id,name").eq("id",schoolId).maybeSingle();
 if(schoolError||!school)return {error:"Assigned school not found.",status:404};
 return {admin,user,isAdmin,school};
}
async function authUsers(admin){
 const byEmail=new Map(),byId=new Map();
 for(let page=1;page<=50;page++){
  const {data,error}=await admin.auth.admin.listUsers({page,perPage:200});
  if(error)throw error;
  const users=data.users||[];
  for(const user of users){if(user.email)byEmail.set(user.email.toLowerCase(),user);byId.set(user.id,user);}
  if(users.length<200)break;
  if(page===50)throw Error("The authentication directory is too large for bulk onboarding.");
 }
 return {byEmail,byId};
}
async function allRows(queryBuilder){
 const data=[];
 for(let page=0;page<10;page++){
  const {data:part,error}=await queryBuilder(page*1000,page*1000+999);
  if(error)throw error;
  const entries=part||[];
  data.push(...entries);
  if(entries.length<1000)return data;
 }
 throw Error("This export exceeds 10,000 rows. Contact the Platform Super Admin for a segmented export.");
}
function clean(value){return typeof value==="string"?value.trim():String(value??"").trim();}
function strong(value){
 return value.length>=12&&value.length<=128&&/[a-z]/.test(value)&&/[A-Z]/.test(value)&&/[0-9]/.test(value)&&/[^a-zA-Z0-9]/.test(value);
}
function rowResult(row,status,detail){
 return {row_number:Number(row.row_number)||0,status,detail};
}
async function importPeople(ctx,rows){
 const results=[];
 const directory=await authUsers(ctx.admin);
 const {data:members,error:membersErr}=await ctx.admin.from("literacy_memberships")
   .select("user_id,role").eq("school_id",ctx.school.id);
 if(membersErr)throw membersErr;
 const assigned=new Map((members||[]).map(m=>[m.user_id,m.role]));
 const seen=new Set();
 for(const row of rows){
  const name=clean(row.full_name),email=clean(row.email).toLowerCase(),
   role=clean(row.role).toLowerCase(),password=typeof row.initial_password==="string"?row.initial_password:"";
  if(name.length<2||name.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!ROLES.includes(role)){
   results.push(rowResult(row,"error","A valid full_name, email and role are required."));continue;
  }
  if(!ctx.isAdmin&&role!=="teacher"){
   results.push(rowResult(row,"error","Only Platform Super Admins can add non-teacher roles."));continue;
  }
  if(seen.has(email)){results.push(rowResult(row,"error","Duplicate email in this upload batch."));continue;}
  seen.add(email);
  let user=directory.byEmail.get(email);
  if(user&&!ctx.isAdmin&&assigned.has(user.id)&&assigned.get(user.id)!=="teacher"){
   results.push(rowResult(row,"error","This user already has a higher school role."));continue;
  }
  if(!user&&!strong(password)){
   results.push(rowResult(row,"error","New users require a 12–128 character password with upper/lowercase, number and symbol."));continue;
  }
  let wasCreated=false;
  try{
   if(!user){
    const {data,error}=await ctx.admin.auth.admin.createUser({
     email,password,email_confirm:true,user_metadata:{full_name:name},
     app_metadata:{must_change_password:false}
    });
    if(error)throw error;
    user=data.user;wasCreated=true;
    directory.byEmail.set(email,user);directory.byId.set(user.id,user);
   }
   const {error}=await ctx.admin.from("literacy_memberships").upsert({
     user_id:user.id,school_id:ctx.school.id,role,display_name:name
    },{onConflict:"school_id,user_id"});
   if(error)throw error;
   assigned.set(user.id,role);
   results.push(rowResult(row,wasCreated?"created":"assigned",
      wasCreated?"Account created. Share the initial password privately.":"Assigned to this school; existing password unchanged."));
  }catch(e){
   if(wasCreated){
    await ctx.admin.auth.admin.deleteUser(user.id).catch(()=>{});
    directory.byEmail.delete(email);directory.byId.delete(user.id);
   }
   results.push(rowResult(row,"error",e.message||"Account provisioning failed."));
  }
 }
 return results;
}
async function importStudents(ctx,rows){
 const {data:classes,error}=await ctx.admin.from("literacy_classes")
  .select("id,grade,section,academic_year").eq("school_id",ctx.school.id);
 if(error)throw error;
 const classMap=new Map((classes||[]).map(c=>[[c.grade,c.section,c.academic_year].join("|"),c.id]));
 const seen=new Set(),results=[],valid=[];
 for(const row of rows){
  const grade=clean(row.grade),section=clean(row.section)||"A",
   year=clean(row.academic_year),name=clean(row.student_name),
   admission=clean(row.admission_number)||("AS-"+randomUUID().slice(0,12).toUpperCase());
  if(!GRADES.includes(grade)||section.length>30||!section||year.length<5||year.length>20||
     name.length<2||name.length>200||admission.length>100){
   results.push(rowResult(row,"error","Valid grade, section, academic_year, student_name and admission_number are required."));continue;
  }
  const classId=classMap.get([grade,section,year].join("|"));
  if(!classId){results.push(rowResult(row,"error","Class not found. Create the grade/section/year in Classes & students first."));continue;}
  const key=classId+"|"+admission.toLowerCase();
  if(seen.has(key)){results.push(rowResult(row,"error","Duplicate admission number for this class in the upload batch."));continue;}
  seen.add(key);
  valid.push({row,payload:{class_id:classId,admission_number:admission,student_name:name}});
 }
 // One database request per validated upload batch, avoiding per-student API overhead.
 if(valid.length){
  const {error:saveError}=await ctx.admin.from("literacy_students")
   .upsert(valid.map(v=>v.payload),{onConflict:"class_id,admission_number"});
  for(const v of valid){
   results.push(rowResult(v.row,saveError?"error":"saved",
     saveError?(saveError.message||"Student batch could not be saved."):"Student saved to the matched class."));
  }
 }
 return results.sort((a,b)=>a.row_number-b.row_number);
}
async function exportPeople(ctx){
 const memberships=await allRows((from,to)=>ctx.admin.from("literacy_memberships")
  .select("user_id,display_name,role").eq("school_id",ctx.school.id).order("display_name").range(from,to));
 const {byId}=await authUsers(ctx.admin);
 return memberships.map(m=>({
   full_name:m.display_name||"",email:byId.get(m.user_id)?.email||"",role:m.role||""
 }));
}
async function exportStudents(ctx){
 const classes=await allRows((from,to)=>ctx.admin.from("literacy_classes")
  .select("id,grade,section,academic_year").eq("school_id",ctx.school.id).order("grade").range(from,to));
 if(!classes.length)return [];
 const classMap=new Map(classes.map(c=>[c.id,c]));
 const data=[];
 for(let i=0;i<classes.length;i+=100){
  const ids=classes.slice(i,i+100).map(c=>c.id);
  const group=await allRows((from,to)=>ctx.admin.from("literacy_students")
   .select("class_id,admission_number,student_name,active").in("class_id",ids)
   .order("admission_number").range(from,to));
  for(const s of group){
   const c=classMap.get(s.class_id);
   data.push({grade:c.grade,section:c.section,academic_year:c.academic_year,
    admission_number:s.admission_number,student_name:s.student_name,active:s.active===true?"Yes":"No"});
  }
 }
 if(data.length>10000)throw Error("Export exceeds 10,000 students.");
 return data;
}
export async function POST(request){
 try{
  const raw=await request.text();
  if(raw.length>160000)return response({error:"Upload too large: use batches of up to 100 rows."},413);
  let body;
  try{body=JSON.parse(raw);}catch{return response({error:"Invalid JSON request."},400);}
  const schoolId=clean(body.schoolId);
  if(!/^[0-9a-f-]{36}$/i.test(schoolId))return response({error:"Select a school."},400);
  const ctx=await authorized(request,schoolId);
  if(ctx.error)return response({error:ctx.error},ctx.status);
  if(body.action==="exportPeople")return response({rows:await exportPeople(ctx),school:ctx.school.name});
  if(body.action==="exportStudents")return response({rows:await exportStudents(ctx),school:ctx.school.name});
  if(body.action!=="importPeople"&&body.action!=="importStudents")
   return response({error:"Unsupported bulk action."},400);
  if(!Array.isArray(body.rows)||body.rows.length<1||body.rows.length>100)
   return response({error:"Upload 1–100 records per batch."},400);
  const results=body.action==="importPeople"
   ?await importPeople(ctx,body.rows):await importStudents(ctx,body.rows);
  return response({results,school:ctx.school.name});
 }catch(e){
  // Do not reflect request data or password values in errors.
  return response({error:e.message||"Bulk operation failed."},500);
 }
}
