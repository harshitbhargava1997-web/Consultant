import {NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
export const runtime="nodejs";
function send(data,status=200){return NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});}
function text(x){return typeof x==="string"?x.trim():String(x??"").trim();}
function uuid(x){return /^[a-f\d]{8}-[a-f\d]{4}-[1-8a-f\d][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(text(x));}
function strong(p){return p.length>=12&&p.length<=128&&/[a-z]/.test(p)&&/[A-Z]/.test(p)&&/[0-9]/.test(p)&&/[^A-Za-z0-9]/.test(p);}
function connect(key){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}});}
async function context(request){
 const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return {error:"Sign in required.",status:401};
 if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||!process.env.SUPABASE_SERVICE_ROLE_KEY)
  return {error:"Admin service not configured.",status:503};
 const auth=connect(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
 const {data:{user},error}=await auth.auth.getUser(token);
 if(error||!user||!user.email_confirmed_at)return {error:"Sign in with a confirmed account.",status:401};
 const admin=connect(process.env.SUPABASE_SERVICE_ROLE_KEY);
 const [superRes,profileRes]=await Promise.all([
  admin.from("literacy_platform_admins").select("user_id").eq("user_id",user.id).maybeSingle(),
  admin.from("literacy_consultants").select("user_id,display_name").eq("user_id",user.id).maybeSingle()
 ]);
 if(superRes.error||profileRes.error)return {error:"Unable to verify consultant permissions.",status:503};
 return {admin,user,isAdmin:!!superRes.data,profile:profileRes.data};
}
async function assigned(ctx,schoolId){
 if(ctx.isAdmin)return true;
 if(!ctx.profile)return false;
 const {data,error}=await ctx.admin.from("literacy_consultant_assignments")
  .select("school_id").eq("consultant_user_id",ctx.user.id).eq("school_id",schoolId).maybeSingle();
 if(error)throw error;
 return !!data;
}
async function schoolManager(ctx,schoolId){
 const {data,error}=await ctx.admin.from("literacy_memberships")
  .select("role").eq("user_id",ctx.user.id).eq("school_id",schoolId).maybeSingle();
 if(error)throw error;
 return ["owner","principal","coordinator"].includes(data?.role);
}
async function schoolOverview(ctx,schoolId){
 const {data:classes,error:classError}=await ctx.admin.from("literacy_classes")
  .select("id").eq("school_id",schoolId).limit(1000);
 if(classError)throw classError;
 const classIds=(classes||[]).map(c=>c.id);
 const [teacherCount,assessmentCount,activitiesRes]=await Promise.all([
  ctx.admin.from("literacy_memberships").select("id",{count:"exact",head:true})
   .eq("school_id",schoolId).eq("role","teacher"),
  ctx.admin.from("literacy_assessments").select("id",{count:"exact",head:true})
   .eq("school_id",schoolId),
  ctx.admin.from("literacy_consultant_activities")
   .select("id,consultant_user_id,kind,activity_date,topic,duration_minutes,participant_roles,summary,next_action,created_at")
   .eq("school_id",schoolId).order("activity_date",{ascending:false}).limit(100)
 ]);
 const error=teacherCount.error||assessmentCount.error||activitiesRes.error;
 if(error)throw error;
 let studentCount=0;
 if(classIds.length){
  const students=await ctx.admin.from("literacy_students").select("id",{count:"exact",head:true})
   .in("class_id",classIds).eq("active",true);
  if(students.error)throw students.error;
  studentCount=students.count||0;
 }
 const {data:schoolAssignments,error:assignmentError}=await ctx.admin.from("literacy_consultant_assignments")
  .select("consultant_user_id").eq("school_id",schoolId);
 if(assignmentError)throw assignmentError;
 return {
  totals:{classes:classIds.length,teachers:teacherCount.count||0,students:studentCount,
   assessments:assessmentCount.count||0,activities:activitiesRes.data?.length||0},
  activities:activitiesRes.data||[],
  assignedConsultants:(schoolAssignments||[]).map(a=>a.consultant_user_id)
 };
}
export async function GET(request){
 try{
  const ctx=await context(request);if(ctx.error)return send({error:ctx.error},ctx.status);
  const url=new URL(request.url),schoolId=url.searchParams.get("schoolId");
  if(schoolId){
   if(!uuid(schoolId))return send({error:"Invalid school."},400);
   if(!await assigned(ctx,schoolId)&&!await schoolManager(ctx,schoolId))
    return send({error:"School access not permitted."},403);
   return send({overview:await schoolOverview(ctx,schoolId)});
  }
  // A consultant's management directory contains only its assigned schools.
  let consultantSchools=[];
  if(!ctx.isAdmin&&ctx.profile){
   const {data:own,error:ownError}=await ctx.admin.from("literacy_consultant_assignments")
    .select("school_id").eq("consultant_user_id",ctx.user.id).limit(2000);
   if(ownError)throw ownError;
   consultantSchools=(own||[]).map(a=>a.school_id);
  }
  if(!ctx.isAdmin&&!ctx.profile)return send({isConsultant:false,consultantSchools:[]});
  let assignmentQuery=ctx.admin.from("literacy_consultant_assignments")
    .select("consultant_user_id,school_id,assigned_at")
    .order("assigned_at",{ascending:false}).limit(2000);
  if(!ctx.isAdmin){
   // A Consultant with no schools does not see or manage other consultants.
   if(!consultantSchools.length)return send({isConsultant:true,consultantSchools:[],consultants:[],assignments:[]});
   assignmentQuery=assignmentQuery.in("school_id",consultantSchools);
  }
  const {data:assignments,error:assignmentError}=await assignmentQuery;
  if(assignmentError)throw assignmentError;
  let rosterQuery=ctx.admin.from("literacy_consultants")
    .select("user_id,display_name,created_at,created_by")
    .order("created_at",{ascending:false}).limit(1000);
  const {data:roster,error:rosterError}=await rosterQuery;
  if(rosterError)throw rosterError;
  const allowedIds=new Set((assignments||[]).map(a=>a.consultant_user_id));
  const visibleRoster=ctx.isAdmin?roster:(roster||[]).filter(c=>allowedIds.has(c.user_id)||c.created_by===ctx.user.id||c.user_id===ctx.user.id);
  return send({isConsultant:!!ctx.profile,isAdmin:ctx.isAdmin,
    consultantSchools,consultants:visibleRoster.map(({created_by,...c})=>c),
    assignments:assignments||[]});
 }catch(e){return send({error:e.message||"Unable to load consultant data."},500);}
}
export async function POST(request){
 try{
  const ctx=await context(request);if(ctx.error)return send({error:ctx.error},ctx.status);
  if(ctx.user.app_metadata?.must_change_password)return send({error:"Change your initial password first."},403);
  const raw=await request.text();
  if(raw.length>16000)return send({error:"Request too large."},413);
  const body=JSON.parse(raw);
  const action=text(body.action);
  if(["createConsultant","assignConsultant","removeAssignment"].includes(action)){
   if(!ctx.isAdmin){
    if(!ctx.profile)return send({error:"Consultant management requires a Super Admin or Consultant account."},403);
    if(action==="createConsultant"){
     const {data:own,error:ownErr}=await ctx.admin.from("literacy_consultant_assignments")
      .select("school_id").eq("consultant_user_id",ctx.user.id).limit(1);
     if(ownErr)throw ownErr;
     if(!own?.length)return send({error:"A school assignment is required to register Consultants."},403);
    }else{
     const targetSchool=text(body.schoolId);
     if(!uuid(targetSchool)||!await assigned(ctx,targetSchool))
      return send({error:"You may manage Consultant assignments only in your assigned schools."},403);
    }
   }
   if(action==="createConsultant"){
    const email=text(body.email).toLowerCase(),name=text(body.displayName),
     password=typeof body.password==="string"?body.password:"";
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||name.length<2||name.length>160)
     return send({error:"Provide a valid consultant name and login email."},400);
    let user=null;
    for(let page=1;page<=50;page++){
     const {data,error}=await ctx.admin.auth.admin.listUsers({page,perPage:200});
     if(error)throw error;
     user=(data.users||[]).find(u=>u.email?.toLowerCase()===email)||null;
     if(user||(data.users||[]).length<200)break;
    }
    let newAccount=false;
    if(!user){
     if(!strong(password))return send({error:"New consultants need a 12–128 character initial password with uppercase, lowercase, number and symbol."},400);
     const {data,error}=await ctx.admin.auth.admin.createUser({
      email,password,email_confirm:true,user_metadata:{full_name:name},app_metadata:{must_change_password:false}
     });
     if(error)throw error;
     user=data.user;newAccount=true;
    }
    const {error}=await ctx.admin.from("literacy_consultants").upsert({
     user_id:user.id,display_name:name,created_by:ctx.user.id
    },{onConflict:"user_id"});
    if(error){
     if(newAccount)await ctx.admin.auth.admin.deleteUser(user.id).catch(()=>{});
     throw error;
    }
    return send({consultantId:user.id,message:newAccount?"Consultant created. Share the initial password privately.":"Existing account registered as a consultant; password unchanged."});
   }
   const consultantId=text(body.consultantId),schoolId=text(body.schoolId);
   if(!uuid(consultantId)||!uuid(schoolId))return send({error:"Select a consultant and school."},400);
   if(action==="assignConsultant"){
    const [consultant,school]=await Promise.all([
     ctx.admin.from("literacy_consultants").select("user_id").eq("user_id",consultantId).maybeSingle(),
     ctx.admin.from("literacy_schools").select("id").eq("id",schoolId).maybeSingle()
    ]);
    if(consultant.error||school.error||!consultant.data||!school.data)return send({error:"Consultant or school not found."},404);
    const {error}=await ctx.admin.from("literacy_consultant_assignments").upsert({
     school_id:schoolId,consultant_user_id:consultantId,assigned_by:ctx.user.id
    },{onConflict:"consultant_user_id,school_id"});
    if(error)throw error;
    return send({message:"Consultant assigned to the selected school."});
   }
   const {error}=await ctx.admin.from("literacy_consultant_assignments")
    .delete().eq("school_id",schoolId).eq("consultant_user_id",consultantId);
   if(error)throw error;
   return send({message:"Consultant assignment removed. Historical activity records remain."});
  }
  if(action==="logActivity"){
   if(!ctx.profile)return send({error:"An assigned Consultant account is required."},403);
   const schoolId=text(body.schoolId);
   if(!uuid(schoolId)||!await assigned(ctx,schoolId))
    return send({error:"You are not assigned to this school."},403);
   const kind=text(body.kind),topic=text(body.topic),
    date=text(body.activityDate),minutes=Number(body.durationMinutes),
    participantRoles=text(body.participantRoles),summary=text(body.summary),nextAction=text(body.nextAction);
   if(!["school_visit","teacher_training","follow_up","classroom_support"].includes(kind)||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)||date>new Date().toISOString().slice(0,10)||
      topic.length<3||topic.length>200||!Number.isInteger(minutes)||minutes<0||minutes>600||
      participantRoles.length>300||summary.length>4000||nextAction.length>2000)
    return send({error:"Check date, activity type, title, duration and notes."},400);
   const {data,error}=await ctx.admin.from("literacy_consultant_activities").insert({
    consultant_user_id:ctx.user.id,school_id:schoolId,kind,activity_date:date,
    topic,duration_minutes:minutes,participant_roles:participantRoles,summary,next_action:nextAction
   }).select("id").single();
   if(error)throw error;
   return send({id:data.id,message:"School support activity recorded."});
  }
  return send({error:"Unsupported action."},400);
 }catch(e){return send({error:e.message||"Consultant request failed."},500);}
}
