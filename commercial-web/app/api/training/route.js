import {NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
import {isConfirmedUser} from "../../../lib/auth";
import {randomUUID} from "node:crypto";
export const runtime="nodejs";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES=["pdf","video","mooc","reading","exercise","interactive"];
const ROLES=["consultant","owner","principal","coordinator","teacher"];
const GRADES=["All Grades","Nursery","LKG","UKG","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5"];
const BUCKET="vision-training";
const send=(data,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const clean=(value,max=200)=>String(value??"").trim().slice(0,max+1);
const validUrl=value=>value===""||(/^https:\/\/[^\s<>"]+$/i.test(value)&&value.length<=1500);
function supabase(key){
 return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,
  {auth:{persistSession:false,autoRefreshToken:false}});
}
async function access(request,schoolId){
 const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!publicKey||!secret||!process.env.NEXT_PUBLIC_SUPABASE_URL)
  return {error:"Training platform authentication is unavailable.",status:503};
 const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return {error:"Sign in first.",status:401};
 const signed=supabase(publicKey);
 const {data:{user},error:authError}=await signed.auth.getUser(token);
 if(authError||!isConfirmedUser(user))return {error:"Session expired. Sign in again.",status:401};
 if(user.app_metadata?.must_change_password)return {error:"Change initial password first.",status:403};
 const admin=supabase(secret);
 const {data:administrator,error:adminError}=await admin.from("literacy_platform_admins")
  .select("user_id").eq("user_id",user.id).maybeSingle();
 if(adminError)return {error:"Unable to check platform access.",status:503};
 const isAdmin=!!administrator;
 if(!schoolId&&!isAdmin)return {error:"Select an assigned school.",status:400};
 if(schoolId&&!UUID.test(schoolId))return {error:"Invalid school ID.",status:400};
 let role="super_admin";
 let grants=new Set();
 if(!isAdmin){
  const [assigned,member]=await Promise.all([
   admin.from("literacy_consultant_assignments").select("school_id")
    .eq("consultant_user_id",user.id).eq("school_id",schoolId).maybeSingle(),
   admin.from("literacy_memberships").select("role")
    .eq("user_id",user.id).eq("school_id",schoolId).maybeSingle()
  ]);
  if(assigned.error||member.error)return {error:"Unable to verify school assignment.",status:503};
  role=assigned.data?"consultant":member.data?.role||"";
  if(!ROLES.includes(role))return {error:"Not assigned to this school.",status:403};
  const {data,error}=await admin.from("literacy_role_permissions")
   .select("feature").eq("role",role).eq("enabled",true);
  if(error)return {error:"Unable to read training permissions.",status:503};
  grants=new Set((data||[]).map(x=>x.feature));
 }
 return {admin,user,isAdmin,role,schoolId,grants,
  can:(key)=>isAdmin||grants.has(key)};
}
async function coursesFor(ctx){
 let query=ctx.admin.from("literacy_training_courses")
  .select("id,title,description,grade,competency_id,target_roles,status,pass_percent,estimated_minutes,created_at,updated_at")
  .order("created_at",{ascending:false}).limit(300);
 if(!ctx.isAdmin)query=query.eq("status","published").contains("target_roles",[ctx.role]);
 const [courseResult,schoolResult]=await Promise.all([
  query,ctx.admin.from("literacy_training_course_schools").select("course_id,school_id").limit(2000)
 ]);
 if(courseResult.error||schoolResult.error)throw courseResult.error||schoolResult.error;
 const links=schoolResult.data||[];
 let courses=(courseResult.data||[]).filter(course=>ctx.isAdmin||links.some(l=>l.course_id===course.id&&l.school_id===ctx.schoolId));
 if(!ctx.isAdmin&&courses.length&&ctx.role==="teacher"){
  // Teacher audience is always school-scoped; no cross-tenant enrollments.
  courses=courses.filter(course=>course.target_roles.includes("teacher"));
 }
 return {courses:courses.map(c=>({...c,school_ids:links.filter(l=>l.course_id===c.id).map(l=>l.school_id)})),
  links};
}
async function safeUnits(ctx,courses,exposeMedia){
 const ids=courses.map(c=>c.id);
 if(!ids.length)return [];
 const {data,error}=await ctx.admin.from("literacy_training_units")
  .select("id,course_id,title,kind,description,external_url,file_path,content,questions,sequence")
  .in("course_id",ids).order("sequence").limit(1500);
 if(error)throw error;
 const all=data||[];
 const enriched=await Promise.all(all.map(async unit=>{
  const questions=(Array.isArray(unit.questions)?unit.questions:[]).map((q,i)=>({
   id:i,prompt:q.prompt,options:q.options
  }));
  let resource_url=exposeMedia?(unit.external_url||""):"";
  if(unit.file_path&&exposeMedia){
   const {data:link,error:linkError}=await ctx.admin.storage.from(BUCKET).createSignedUrl(unit.file_path,3600);
   if(!linkError)resource_url=link?.signedUrl||"";
  }
  const {file_path,questions:answers,...other}=unit;
  return {...other,questions:exposeMedia?questions:[],content:exposeMedia?other.content:"",description:exposeMedia?other.description:"",external_url:exposeMedia?other.external_url:"",resource_url};
 }));
 return enriched;
}
async function ownLearning(ctx,units,courses){
 if(!ctx.schoolId)return {progress:[],certificates:[]};
 const unitIds=units.map(u=>u.id);
 const ids=courses.map(c=>c.id);
 const p=unitIds.length?ctx.admin.from("literacy_training_progress")
  .select("unit_id,completed_at,quiz_percent").eq("school_id",ctx.schoolId)
  .eq("user_id",ctx.user.id).in("unit_id",unitIds):
  Promise.resolve({data:[],error:null});
 const c=ctx.can("training.certificates")&&ids.length?ctx.admin.from("literacy_training_certificates")
  .select("id,code,course_id,issued_at").eq("school_id",ctx.schoolId)
  .eq("user_id",ctx.user.id).in("course_id",ids):
  Promise.resolve({data:[],error:null});
 const [progress,certificates]=await Promise.all([p,c]);
 if(progress.error||certificates.error)throw progress.error||certificates.error;
 return {progress:progress.data||[],certificates:certificates.data||[]};
}
async function reviewSchool(ctx,courses,units){
 if(!ctx.schoolId||!ctx.can("training.review"))return null;
 const peopleRes=await ctx.admin.from("literacy_memberships")
  .select("user_id,role,display_name").eq("school_id",ctx.schoolId).limit(1500);
 if(peopleRes.error)throw peopleRes.error;
 const people=peopleRes.data||[];
 const allUnitIds=units.map(u=>u.id);
 const progressRes=allUnitIds.length?await ctx.admin.from("literacy_training_progress")
  .select("user_id,unit_id,quiz_percent").eq("school_id",ctx.schoolId)
  .in("unit_id",allUnitIds).limit(5000):{data:[],error:null};
 if(progressRes.error)throw progressRes.error;
 const certRes=await ctx.admin.from("literacy_training_certificates")
  .select("user_id,course_id,issued_at").eq("school_id",ctx.schoolId).limit(4000);
 if(certRes.error)throw certRes.error;
 const attendanceRes=await ctx.admin.from("literacy_training_session_attendees")
  .select("user_id").eq("school_id",ctx.schoolId).limit(4000);
 if(attendanceRes.error)throw attendanceRes.error;
 return people.map(p=>{
  const mine=(progressRes.data||[]).filter(v=>v.user_id===p.user_id);
  const ownCert=(certRes.data||[]).filter(v=>v.user_id===p.user_id);
  return {user_id:p.user_id,name:p.display_name||"Staff member",role:p.role,
   units_completed:mine.length,certificates:ownCert.length,
   average_quiz_score:mine.filter(p=>p.quiz_percent!==null).length?
    Math.round(mine.filter(p=>p.quiz_percent!==null)
      .reduce((sum,p)=>sum+p.quiz_percent,0)/mine.filter(p=>p.quiz_percent!==null).length):null,
   attended_sessions:(attendanceRes.data||[]).filter(x=>x.user_id===p.user_id).length,
   courses:courses.filter(c=>c.target_roles.includes(p.role)).map(c=>{
    const lessonIds=new Set(units.filter(u=>u.course_id===c.id).map(u=>u.id));
    return {id:c.id,title:c.title,units_completed:mine.filter(v=>lessonIds.has(v.unit_id)).length,
     units_total:lessonIds.size,certified:ownCert.some(x=>x.course_id===c.id)};
   })};
 });
}
async function trainingSessions(ctx,courses){
 if(!ctx.schoolId||!ctx.can("training.review")&&!ctx.can("training.deliver"))return [];
 const ids=courses.map(x=>x.id);
 if(!ids.length)return [];
 const {data,error}=await ctx.admin.from("literacy_training_sessions")
  .select("id,course_id,trainer_user_id,held_on,attendee_count,notes,next_action")
  .eq("school_id",ctx.schoolId).in("course_id",ids).order("held_on",{ascending:false}).limit(50);
 if(error)throw error;return data||[];
}
async function courseAllowed(ctx,courseId,feature="training.access"){
 if(!ctx.can(feature))throw Error("This training permission is disabled for your role.");
 const {data:course,error}=await ctx.admin.from("literacy_training_courses")
  .select("*").eq("id",courseId).maybeSingle();
 if(error||!course)throw Error("Training course was not found.");
 if(ctx.isAdmin)return course;
 if(course.status!=="published"||!course.target_roles.includes(ctx.role))throw Error("This course is not assigned to your role.");
 const {data:assignment,error:assignError}=await ctx.admin.from("literacy_training_course_schools")
  .select("course_id").eq("course_id",courseId).eq("school_id",ctx.schoolId).maybeSingle();
 if(assignError||!assignment)throw Error("This course is not assigned to your school.");
 return course;
}
async function maybeCertificate(ctx,course){
 if(!ctx.can("training.certificates"))return null;
 const {data:units,error}=await ctx.admin.from("literacy_training_units")
  .select("id,kind").eq("course_id",course.id);
 if(error)throw error;
 if(!units?.length)return null;
 const {data:done,error:doneError}=await ctx.admin.from("literacy_training_progress")
  .select("unit_id,quiz_percent").eq("school_id",ctx.schoolId)
  .eq("user_id",ctx.user.id).in("unit_id",units.map(u=>u.id));
 if(doneError)throw doneError;
 const match=new Map((done||[]).map(d=>[d.unit_id,d]));
 if(!units.every(u=>match.has(u.id)&&(u.kind!=="exercise"&&u.kind!=="interactive"||match.get(u.id).quiz_percent!==null&&match.get(u.id).quiz_percent>=course.pass_percent)))return null;
 const cert={school_id:ctx.schoolId,user_id:ctx.user.id,course_id:course.id,
  code:"VISION-"+randomUUID().slice(0,12).toUpperCase()};
 const {data,error:certError}=await ctx.admin.from("literacy_training_certificates")
  .upsert(cert,{onConflict:"school_id,user_id,course_id",ignoreDuplicates:true})
  .select("id,code,course_id,issued_at").maybeSingle();
 if(certError)throw certError;
 if(data)return data;
 const existing=await ctx.admin.from("literacy_training_certificates")
  .select("id,code,course_id,issued_at").eq("school_id",ctx.schoolId)
  .eq("user_id",ctx.user.id).eq("course_id",course.id).maybeSingle();
 if(existing.error)throw existing.error;
 return existing.data;
}

async function studentOutcome(ctx,studentId){
 if(!ctx.can("reports.view")||!ctx.schoolId)throw Error("Student progress review is disabled for this school or role.");
 if(!UUID.test(studentId))throw Error("Select a valid student.");
 const {data:student,error:studentError}=await ctx.admin.from("literacy_students")
  .select("id,student_name,class_id").eq("id",studentId).maybeSingle();
 if(studentError||!student)throw Error("Student was not found.");
 const {data:cls,error:classError}=await ctx.admin.from("literacy_classes")
  .select("id,school_id,grade,section").eq("id",student.class_id).eq("school_id",ctx.schoolId).maybeSingle();
 if(classError||!cls)throw Error("Student is outside the selected school.");
 if(!ctx.isAdmin&&ctx.role==="teacher"){
  const {data:assignment,error}=await ctx.admin.from("literacy_teacher_classes")
   .select("class_id").eq("teacher_user_id",ctx.user.id).eq("class_id",cls.id).maybeSingle();
  if(error||!assignment)throw Error("Student is not in one of your assigned classes.");
 }
 const [{data:teachers,error:teacherError},{data:schoolCourses,error:courseError},{data:assessments,error:assessError}]=await Promise.all([
  ctx.admin.from("literacy_teacher_classes").select("teacher_user_id").eq("class_id",cls.id),
  ctx.admin.from("literacy_training_course_schools").select("course_id").eq("school_id",ctx.schoolId).limit(500),
  ctx.admin.from("literacy_assessments")
   .select("id,assessment_date,assessment_stage,assessor_role")
   .eq("school_id",ctx.schoolId).eq("student_id",studentId).eq("class_id",cls.id)
   .eq("subject_type","student").order("assessment_date",{ascending:true}).limit(30)
 ]);
 if(teacherError||courseError||assessError)throw teacherError||courseError||assessError;
 const teacherIds=[...new Set((teachers||[]).map(t=>t.teacher_user_id))];
 const courseIds=(schoolCourses||[]).map(c=>c.course_id);
 const [{data:membership,error:memberError},{data:courseList,error:courseListError},
   {data:results,error:resultError}]=await Promise.all([
  teacherIds.length?ctx.admin.from("literacy_memberships")
   .select("user_id,display_name").eq("school_id",ctx.schoolId).in("user_id",teacherIds):
   Promise.resolve({data:[],error:null}),
  courseIds.length?ctx.admin.from("literacy_training_courses")
   .select("id,title,grade,competency_id,target_roles,status")
   .in("id",courseIds).eq("status","published"):
   Promise.resolve({data:[],error:null}),
  assessments?.length?ctx.admin.from("literacy_assessment_results")
   .select("assessment_id,competency_id,rating")
   .in("assessment_id",assessments.map(a=>a.id)).limit(2000):
   Promise.resolve({data:[],error:null})
 ]);
 if(memberError||courseListError||resultError)throw memberError||courseListError||resultError;
 const allCourses=(courseList||[]).filter(c=>c.target_roles.includes("teacher")&&
  (c.grade==="All Grades"||c.grade===cls.grade));
 const ids=allCourses.map(c=>c.id);
 const [{data:units,error:unitError},{data:certificates,error:certError},
 {data:sessions,error:sessionError}]=await Promise.all([
  ids.length?ctx.admin.from("literacy_training_units").select("id,course_id")
   .in("course_id",ids).limit(1000):Promise.resolve({data:[],error:null}),
  ids.length&&teacherIds.length?ctx.admin.from("literacy_training_certificates")
   .select("user_id,course_id").in("course_id",ids).eq("school_id",ctx.schoolId)
   .in("user_id",teacherIds):Promise.resolve({data:[],error:null}),
  ids.length?ctx.admin.from("literacy_training_sessions")
   .select("id,course_id,held_on,attendee_count")
   .in("course_id",ids).eq("school_id",ctx.schoolId)
   .order("held_on",{ascending:false}).limit(10):Promise.resolve({data:[],error:null})
 ]);
 if(unitError||certError||sessionError)throw unitError||certError||sessionError;
 const unitIds=(units||[]).map(u=>u.id);
 const progress=unitIds.length&&teacherIds.length?await ctx.admin.from("literacy_training_progress")
  .select("user_id,unit_id,quiz_percent").eq("school_id",ctx.schoolId)
  .in("user_id",teacherIds).in("unit_id",unitIds).limit(2500):{data:[],error:null};
 if(progress.error)throw progress.error;
 const teacherAttend=teacherIds.length?await ctx.admin.from("literacy_training_session_attendees")
  .select("user_id,session_id").eq("school_id",ctx.schoolId)
  .in("user_id",teacherIds).limit(4000):{data:[],error:null};
 if(teacherAttend.error)throw teacherAttend.error;
 const sessionSet=new Set((sessions||[]).map(x=>x.id));
 const teachersReport=teacherIds.map(userId=>({
  attended_sessions:(teacherAttend.data||[]).filter(a=>a.user_id===userId&&sessionSet.has(a.session_id)).length,
  name:(membership||[]).find(m=>m.user_id===userId)?.display_name||"Assigned teacher",
  courses:allCourses.map(c=>{
   const unitSet=new Set((units||[]).filter(u=>u.course_id===c.id).map(u=>u.id));
   const mine=(progress.data||[]).filter(p=>p.user_id===userId&&unitSet.has(p.unit_id));
   const quizzes=mine.filter(p=>p.quiz_percent!==null);
   return {title:c.title,competency_id:c.competency_id,
    units_completed:mine.length,average_quiz_score:quizzes.length?
     Math.round(quizzes.reduce((a,p)=>a+p.quiz_percent,0)/quizzes.length):null,
    units_total:unitSet.size,
    certified:(certificates||[]).some(x=>x.user_id===userId&&x.course_id===c.id)};
  })
 }));
 const assessmentTimeline=(assessments||[]).map(a=>{
  const ratings=(results||[]).filter(r=>r.assessment_id===a.id);
  return {date:a.assessment_date,stage:a.assessment_stage||"periodic",assessor_role:a.assessor_role||"legacy",
   observed:ratings.length,independent:ratings.filter(r=>r.rating==="Independent").length,
   competency_ids:ratings.map(r=>r.competency_id)};
 });
 return {student_name:student.student_name,grade:cls.grade,section:cls.section,
  teachers:teachersReport,sessions:sessions||[],assessments:assessmentTimeline,
  explanation:"Training completion is staff evidence; student competency observations are separate. Their association does not establish causation."};
}

export async function GET(request){
 try{
  const url=new URL(request.url);
  const schoolId=clean(url.searchParams.get("schoolId"),40);
  const ctx=await access(request,schoolId);
  if(ctx.error)return send({error:ctx.error},ctx.status);
  if(url.searchParams.get("action")==="studentOutcome"){
   try{return send({outcome:await studentOutcome(ctx,clean(url.searchParams.get("studentId"),40))});}
   catch(e){return send({error:e.message||"Unable to retrieve student-linked training evidence."},403);}
  }
  if(!ctx.can("training.access")&&!ctx.can("training.review")&&!ctx.can("training.deliver"))
   return send({error:"Training access is disabled for your role."},403);
  const {courses}=await coursesFor(ctx);
  const units=await safeUnits(ctx,courses,ctx.can("training.access"));
  const {data:memberName}=ctx.schoolId?await ctx.admin.from("literacy_memberships")
   .select("display_name").eq("school_id",ctx.schoolId).eq("user_id",ctx.user.id).maybeSingle():{data:null};
  const {data:consultantName}=ctx.role==="consultant"?await ctx.admin.from("literacy_consultants")
   .select("display_name").eq("user_id",ctx.user.id).maybeSingle():{data:null};
  const learnerName=memberName?.display_name||consultantName?.display_name||
   ctx.user.user_metadata?.full_name||ctx.user.email||ctx.user.phone||"Learner";
  const [own,people,sessions]=await Promise.all([
   ownLearning(ctx,units,courses),reviewSchool(ctx,courses,units),trainingSessions(ctx,courses)
  ]);
  const {data:trainingStaff,error:staffError}=ctx.schoolId&&ctx.can("training.deliver")
   ?await ctx.admin.from("literacy_memberships").select("user_id,display_name")
    .eq("school_id",ctx.schoolId).eq("role","teacher").order("display_name").limit(500)
   :{data:[],error:null};
  if(staffError)throw staffError;
  return send({courses,units,...own,review:people,sessions,trainingStaff:trainingStaff||[],
   learnerName,role:ctx.role,isAdmin:ctx.isAdmin});
 }catch(e){return send({error:"Training library unavailable: "+(e.message||"Unknown error")},500);}
}
export async function POST(request){
 try{
  const schoolId=clean(new URL(request.url).searchParams.get("schoolId"),40);
  const ctx=await access(request,schoolId);
  if(ctx.error)return send({error:ctx.error},ctx.status);
  const raw=await request.text();
  if(raw.length>55000)return send({error:"Training request exceeds maximum size."},413);
  let body;try{body=JSON.parse(raw);}catch{return send({error:"Invalid request."},400);}
  const action=clean(body.action,40);
  if(["createCourse","saveUnit","publishCourse","deleteUnit","uploadTicket"].includes(action)&&!ctx.isAdmin)
   return send({error:"Only the Platform Super Admin can publish or modify the shared course library."},403);
  if(action==="createCourse"){
   const title=clean(body.title,180),description=clean(body.description,3000),grade=clean(body.grade,32);
   const schoolIds=[...new Set(Array.isArray(body.schoolIds)?body.schoolIds:[])];
   const targetRoles=[...new Set(Array.isArray(body.targetRoles)?body.targetRoles:[])];
   if(title.length<4||description.length>3000||!GRADES.includes(grade)||!schoolIds.length||
      !schoolIds.every(x=>UUID.test(x))||!targetRoles.length||!targetRoles.every(r=>ROLES.includes(r)))
    return send({error:"Provide a course name, school assignments, valid audience roles and grade."},400);
   const competency=clean(body.competencyId,40);
   if(competency&&!UUID.test(competency))return send({error:"Invalid linked competency."},400);
   const duration=Number(body.minutes),passPercent=Number(body.passPercent);
   if(!Number.isInteger(duration)||duration<1||duration>2000||!Number.isInteger(passPercent)||passPercent<0||passPercent>100)
    return send({error:"Invalid estimated duration or passing score."},400);
   const {data:schoolRows,error:schoolsError}=await ctx.admin.from("literacy_schools")
    .select("id").in("id",schoolIds);
   if(schoolsError||schoolRows?.length!==schoolIds.length)return send({error:"Some selected schools were not found."},400);
   const {data:course,error}=await ctx.admin.from("literacy_training_courses").insert({
    title,description,grade,competency_id:competency||null,
    target_roles:targetRoles,pass_percent:passPercent,estimated_minutes:duration,
    created_by:ctx.user.id
   }).select("id,title").single();
   if(error)throw error;
   const {error:assignmentError}=await ctx.admin.from("literacy_training_course_schools")
    .insert(schoolIds.map(id=>({course_id:course.id,school_id:id})));
   if(assignmentError)throw assignmentError;
   return send({course,message:"Training course created as a draft. Add learning units, then publish."});
  }
  if(action==="uploadTicket"){
   if(!UUID.test(body.courseId))return send({error:"Choose a course."},400);
   const uploadCourse=await courseAllowed(ctx,body.courseId);
   if(uploadCourse.status!=="draft")return send({error:"Only draft courses may receive new files."},403);
   const mimetype=clean(body.mimeType,120),size=Number(body.size);
   const extension=mimetype==="application/pdf"?"pdf":mimetype==="video/mp4"?"mp4":
    mimetype==="video/webm"?"webm":mimetype==="video/quicktime"?"mov":"";
   if(!extension||!Number.isInteger(size)||size<1||size>50*1024*1024)
    return send({error:"Upload a PDF, MP4, WebM or MOV file up to 50 MB."},400);
   const path=body.courseId+"/"+randomUUID()+"."+extension;
   const {data,error}=await ctx.admin.storage.from(BUCKET)
    .createSignedUploadUrl(path);
   if(error)throw error;
   return send({path,token:data.token,message:"Upload authorization created."});
  }
  if(action==="saveUnit"){
   if(!UUID.test(body.courseId))return send({error:"Invalid course."},400);
   const course=await courseAllowed(ctx,body.courseId);
   if(course.status!=="draft")return send({error:"Published courses are locked. Create a revised course to update training material."},403);
   const kind=clean(body.kind,30),title=clean(body.title,180);
   const description=clean(body.description,3000),externalUrl=clean(body.externalUrl,1500);
   const content=clean(body.content,30000),path=clean(body.filePath,500);
   if(!TYPES.includes(kind)||title.length<3||description.length>3000||
      !validUrl(externalUrl)||content.length>30000)
    return send({error:"Invalid learning resource details or external URL."},400);
   if(path&&!path.startsWith(body.courseId+"/"))return send({error:"Uploaded file does not belong to this course."},400);
   if(path){
    const {data:exists,error:existsError}=await ctx.admin.storage.from(BUCKET).info(path);
    if(existsError||!exists)return send({error:"Finish the PDF or video upload first."},400);
   }
   if(["pdf","video","mooc"].includes(kind)&&!externalUrl&&!path)
    return send({error:"Provide a resource URL or upload a file."},400);
   if(kind==="reading"&&!content)return send({error:"Enter reading material."},400);
   let questions=[];
   if(kind==="exercise"||kind==="interactive"){
    if(!Array.isArray(body.questions)||body.questions.length<1||body.questions.length>12)
     return send({error:"Add 1 to 12 multiple-choice questions to each exercise or interactive unit."},400);
    questions=body.questions.map(q=>({prompt:clean(q.prompt,400),
     options:Array.isArray(q.options)?q.options.map(x=>clean(x,250)):[],
     correctIndex:Number(q.correctIndex)}));
    if(questions.some(q=>q.prompt.length<8||q.options.length<2||q.options.length>5||
       q.options.some(o=>!o)||!Number.isInteger(q.correctIndex)||q.correctIndex<0||q.correctIndex>=q.options.length))
     return send({error:"Every question needs a prompt, answer choices and one correct answer."},400);
   }
   const {data,error}=await ctx.admin.from("literacy_training_units").insert({
    course_id:course.id,kind,title,description,external_url:externalUrl,
    file_path:path,content,questions,sequence:Number(body.sequence)||1
   }).select("id,title").single();
   if(error)throw error;
   return send({unit:data,message:"Training resource added."});
  }
  if(action==="deleteUnit"){
   if(!UUID.test(body.unitId)||!UUID.test(body.courseId))return send({error:"Invalid resource."},400);
   const course=await courseAllowed(ctx,body.courseId);
   if(course.status!=="draft")return send({error:"Published learning content is locked."},403);
   const {error}=await ctx.admin.from("literacy_training_units").delete()
    .eq("id",body.unitId).eq("course_id",course.id);
   if(error)throw error;return send({message:"Draft learning unit removed."});
  }
  if(action==="publishCourse"){
   if(!UUID.test(body.courseId))return send({error:"Invalid course."},400);
   const course=await courseAllowed(ctx,body.courseId);
   const {count,error:countError}=await ctx.admin.from("literacy_training_units")
    .select("id",{head:true,count:"exact"}).eq("course_id",course.id);
   if(countError)throw countError;
   if(!count)return send({error:"Add at least one training unit before publishing."},400);
   const {error}=await ctx.admin.from("literacy_training_courses").update({
    status:"published",updated_at:new Date().toISOString()
   }).eq("id",course.id);
   if(error)throw error;return send({message:"Training published to selected schools and roles."});
  }
  if(action==="completeUnit"){
   if(!ctx.schoolId)return send({error:"Choose the school where training was assigned."},400);
   const unitId=clean(body.unitId,40);
   if(!UUID.test(unitId))return send({error:"Choose a learning unit."},400);
   const {data:unit,error:unitError}=await ctx.admin.from("literacy_training_units")
    .select("*").eq("id",unitId).maybeSingle();
   if(unitError||!unit)return send({error:"Learning unit not found."},404);
   if(!ctx.can("training.access"))return send({error:"Training library access is disabled."},403);
   const course=await courseAllowed(ctx,unit.course_id,"training.complete");
   if(course.status!=="published")return send({error:"Only published training can be completed."},403);
   if(["exercise","interactive"].includes(unit.kind)){
    const questions=Array.isArray(unit.questions)?unit.questions:[];
    const answers=body.answers;
    if(!Array.isArray(answers)||answers.length!==questions.length||
       answers.some(x=>!Number.isInteger(x)||x<0||x>4))
     return send({error:"Answer all questions before submitting."},400);
    const correct=questions.filter((q,i)=>answers[i]===q.correctIndex).length;
    const percent=Math.round(100*correct/questions.length);
    const {error:attemptError}=await ctx.admin.from("literacy_training_quiz_attempts").insert({
     school_id:ctx.schoolId,user_id:ctx.user.id,unit_id:unit.id,
     score_percent:percent,passed:percent>=course.pass_percent
    });
    if(attemptError)throw attemptError;
    if(percent<course.pass_percent)
     return send({passed:false,score:percent,required:course.pass_percent,
      message:"Score: "+percent+"%. Passing score: "+course.pass_percent+"%. Review and retry."});
    const {error}=await ctx.admin.from("literacy_training_progress").upsert({
     school_id:ctx.schoolId,user_id:ctx.user.id,unit_id:unit.id,quiz_percent:percent,
     completed_at:new Date().toISOString()
    },{onConflict:"school_id,user_id,unit_id"});
    if(error)throw error;
    const certificate=await maybeCertificate(ctx,course);
    return send({passed:true,score:percent,certificate,
     message:"Exercise passed. Your training progress has been saved."});
   }
   const {error}=await ctx.admin.from("literacy_training_progress").upsert({
    school_id:ctx.schoolId,user_id:ctx.user.id,unit_id:unit.id,quiz_percent:null,
    completed_at:new Date().toISOString()
   },{onConflict:"school_id,user_id,unit_id"});
   if(error)throw error;
   const certificate=await maybeCertificate(ctx,course);
   return send({passed:true,certificate,message:"Learning unit marked complete."});
  }
  if(action==="logSession"){
   if(!ctx.can("training.deliver"))return send({error:"Training delivery is disabled for your role."},403);
   if(!ctx.schoolId)return send({error:"Choose the school that attended."},400);
   if(!UUID.test(body.courseId))return send({error:"Select a training course."},400);
   const sessionCourse=await courseAllowed(ctx,body.courseId,"training.deliver");
   if(sessionCourse.status!=="published")return send({error:"Select a published training programme."},403);
   const heldOn=clean(body.heldOn,20),notes=clean(body.notes,4000),
    nextAction=clean(body.nextAction,2000),attendeeCount=Number(body.attendeeCount);
   if(!/^\d{4}-\d{2}-\d{2}$/.test(heldOn)||heldOn>new Date().toISOString().slice(0,10)||
      !Number.isInteger(attendeeCount)||attendeeCount<0||attendeeCount>10000||
      notes.length>4000||nextAction.length>2000)
    return send({error:"Check the session date, attendance count and notes."},400);
   const attendeeIds=[...new Set(Array.isArray(body.attendeeIds)?body.attendeeIds:[])];
   if(attendeeIds.length>250||attendeeIds.some(id=>!UUID.test(id)))
    return send({error:"Select up to 250 valid teacher attendees."},400);
   if(attendeeIds.length){
    const {data:matched,error:attendeeError}=await ctx.admin.from("literacy_memberships")
     .select("user_id").eq("school_id",ctx.schoolId).eq("role","teacher").in("user_id",attendeeIds);
    if(attendeeError||matched?.length!==attendeeIds.length)
     return send({error:"Some selected attendees are not teachers in this school."},400);
   }
   const {data:saved,error}=await ctx.admin.from("literacy_training_sessions").insert({
    school_id:ctx.schoolId,course_id:body.courseId,trainer_user_id:ctx.user.id,
    held_on:heldOn,attendee_count:attendeeIds.length||attendeeCount,notes,next_action
   }).select("id").single();
   if(error)throw error;
   if(attendeeIds.length){
    const {error:attendanceError}=await ctx.admin.from("literacy_training_session_attendees")
     .insert(attendeeIds.map(id=>({session_id:saved.id,school_id:ctx.schoolId,user_id:id})));
    if(attendanceError){
     await ctx.admin.from("literacy_training_sessions").delete().eq("id",saved.id);
     throw attendanceError;
    }
   }
   return send({message:"Trainer-led session saved"+(attendeeIds.length?" with "+attendeeIds.length+" named teacher attendees.":".")});
  }
  return send({error:"Unknown training action."},400);
 }catch(e){return send({error:"Training operation failed: "+(e.message||"Unknown error")},500);}
}
