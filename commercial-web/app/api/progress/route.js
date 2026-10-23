import {NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
import {isConfirmedUser} from "../../../lib/auth";
import {visionImplementationSummary} from "../../../lib/teacher-portal/domain";

export const runtime="nodejs";
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const SUPERVISORS=new Set(["consultant","owner","principal","coordinator"]);
const send=(data,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const text=(value,max=90)=>String(value??"").trim().slice(0,max+1);
function db(key){
 return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,{
  auth:{persistSession:false,autoRefreshToken:false}
 });
}
async function authorize(request,schoolId){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!anon||!secret)return {error:"Progress reporting service unavailable.",status:503};
 if(!UUID.test(schoolId))return {error:"Select a valid school.",status:400};
 const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return {error:"Sign in to view reports.",status:401};
 const auth=db(anon),admin=db(secret);
 const {data:{user},error:userError}=await auth.auth.getUser(token);
 if(userError||!isConfirmedUser(user))return {error:"Session expired. Sign in again.",status:401};
 if(user.app_metadata?.must_change_password)return {error:"Change the initial password first.",status:403};
 const [a,c,m]=await Promise.all([
  admin.from("literacy_platform_admins").select("user_id").eq("user_id",user.id).maybeSingle(),
  admin.from("literacy_consultant_assignments").select("school_id").eq("school_id",schoolId).eq("consultant_user_id",user.id).maybeSingle(),
  admin.from("literacy_memberships").select("role").eq("school_id",schoolId).eq("user_id",user.id).maybeSingle()
 ]);
 if(a.error||c.error||m.error)return {error:"Cannot verify school membership.",status:503};
 const isAdmin=!!a.data,role=isAdmin?"super_admin":c.data?"consultant":m.data?.role||"";
 if(!isAdmin&&!SUPERVISORS.has(role)&&role!=="teacher")return {error:"This school is not assigned to you.",status:403};
 const {data:grants,error:grantsError}=isAdmin?{data:[],error:null}:
  await admin.from("literacy_role_permissions").select("feature").eq("role",role).eq("enabled",true);
 if(grantsError)return {error:"Unable to check reporting permissions.",status:503};
 const grantSet=new Set((grants||[]).map(x=>x.feature));
 const can=key=>isAdmin||grantSet.has(key);
 if(!can("reports.view"))return {error:"Progress reporting permission is disabled for this role.",status:403};
 return {admin,user,schoolId,role,isAdmin,can,manager:isAdmin||SUPERVISORS.has(role)};
}
async function allRows(makeQuery,limit=4000){
 const pageSize=1000,result=[];
 for(let offset=0;offset<limit;offset+=pageSize){
  const {data,error}=await makeQuery().range(offset,offset+pageSize-1);
  if(error)throw error;
  result.push(...(data||[]));
  if(!data||data.length<pageSize)return {rows:result,truncated:false};
 }
 return {rows:result,truncated:true};
}
const indexBy=(items,key)=>new Map(items.map(x=>[x[key],x]));
function countBy(rows,key){const m=new Map();for(const row of rows)m.set(row[key],(m.get(row[key])||0)+1);return m;}
async function baseSchool(ctx){
 const {rows:classes,truncated:classLimit}=await allRows(
  ()=>ctx.admin.from("literacy_classes").select("id,grade,section,academic_year")
   .eq("school_id",ctx.schoolId).order("id"),2000);
 if(!classes.length)return {classes:[],students:[],teachers:[],assignments:[],limits:classLimit};
 const clsIds=classes.map(x=>x.id);
 const [studentData,memberData,assignData]=await Promise.all([
  allRows(()=>ctx.admin.from("literacy_students")
   .select("id,class_id,active").in("class_id",clsIds).order("id"),4000),
  allRows(()=>ctx.admin.from("literacy_memberships")
   .select("user_id,display_name,role").eq("school_id",ctx.schoolId).order("user_id"),2000),
  allRows(()=>ctx.admin.from("literacy_teacher_classes").select("class_id,teacher_user_id")
   .in("class_id",clsIds).order("class_id"),4000)
 ]);
 return {classes,students:studentData.rows.filter(s=>s.active!==false),
  teachers:memberData.rows.filter(m=>m.role==="teacher"),
  assignments:assignData.rows,
  limits:classLimit||studentData.truncated||memberData.truncated||assignData.truncated};
}
async function studentStats(ctx,base){
 const {rows:assessments,truncated:assessLimit}=await allRows(
  ()=>ctx.admin.from("literacy_assessments")
   .select("id,student_id,class_id,assessment_date,assessment_stage")
   .eq("school_id",ctx.schoolId).eq("subject_type","student")
   .order("id"),5000);
 const classSet=new Set(base.classes.map(c=>c.id)),studentSet=new Set(base.students.map(s=>s.id));
 const visible=assessments.filter(a=>classSet.has(a.class_id)&&studentSet.has(a.student_id));
 const gradeMap=new Map(base.classes.map(x=>[x.id,x.grade]));
 const studentGrade=new Map(base.students.map(s=>[s.id,gradeMap.get(s.class_id)]));
 const grades=new Map();
 for(const x of base.students){
  const g=studentGrade.get(x.id)||"Unknown";
  if(!grades.has(g))grades.set(g,{grade:g,students:0,assessedStudents:0,sessions:0,independent:0,ratings:0,baseline:0,followUp:0,endline:0});
  grades.get(g).students++;
 }
 const observedByStudent=new Set(visible.map(a=>a.student_id));
 const byGradeSessions=new Map();
 for(const a of visible){
  const g=studentGrade.get(a.student_id)||"Unknown";
  if(!byGradeSessions.has(g))byGradeSessions.set(g,[]);
  byGradeSessions.get(g).push(a);
  if(grades.has(g)){
   grades.get(g).sessions++;
   if(a.assessment_stage==="baseline")grades.get(g).baseline++;
   if(a.assessment_stage==="follow_up")grades.get(g).followUp++;
   if(a.assessment_stage==="endline")grades.get(g).endline++;
  }
 }
 for(const s of base.students)if(observedByStudent.has(s.id))grades.get(studentGrade.get(s.id)||"Unknown").assessedStudents++;
 let ratingLimited=false;
 if(visible.length){
  const chunks=[];
  for(let p=0;p<visible.length;p+=500)chunks.push(visible.slice(p,p+500).map(a=>a.id));
  // 6K rows is a reporting boundary; mark ratings incomplete rather than misrepresent the denominator.
  let total=0;
  for(const ids of chunks){
   const query=()=>ctx.admin.from("literacy_assessment_results")
    .select("assessment_id,rating").in("assessment_id",ids).order("id");
   const found=await allRows(query,6000);
   total+=found.rows.length;
   if(found.truncated)ratingLimited=true;
   const sessionIndex=new Map(visible.map(a=>[a.id,a]));
   for(const rating of found.rows){
    const session=sessionIndex.get(rating.assessment_id);
    const grade=session&&studentGrade.get(session.student_id);
    const group=grades.get(grade);
    if(group&&rating.rating!=="Not Assessed"){
     group.ratings++;
     if(rating.rating==="Independent")group.independent++;
    }
   }
   if(total>=12000){ratingLimited=true;break;}
  }
 }
 const rows=[...grades.values()].sort((a,b)=>{
  const order=["Nursery","LKG","UKG","Grade 1","Grade 2","Grade 3","Grade 4","Grade 5"];
  return order.indexOf(a.grade)-order.indexOf(b.grade);
 });
 return {students:base.students.length,assessedStudents:observedByStudent.size,
  sessions:visible.length,
  ratings:rows.reduce((n,g)=>n+g.ratings,0),
  independentRatings:rows.reduce((n,g)=>n+g.independent,0),
  byGrade:rows,truncated:assessLimit||ratingLimited};
}
async function schoolTraining(ctx,teachers){
 if(!ctx.can("training.review"))return null;
 const {rows:links,truncated:linkLimit}=await allRows(
  ()=>ctx.admin.from("literacy_training_course_schools").select("course_id")
   .eq("school_id",ctx.schoolId).order("course_id"),2000);
 const ids=[...new Set(links.map(x=>x.course_id))];
 const teacherIds=teachers.map(t=>t.user_id);
 if(!ids.length)return {courses:[],teacherStats:teachers.map(t=>({user_id:t.user_id,unitsCompleted:0,totalUnits:0,certificates:0,averageQuiz:null})),sessions:0,attendances:0,truncated:linkLimit};
 const [coursesResult,unitsResult,certificateResult,sessionsResult,attendanceResult]=await Promise.all([
  ctx.admin.from("literacy_training_courses")
   .select("id,title,grade,target_roles,status").in("id",ids).eq("status","published"),
  allRows(()=>ctx.admin.from("literacy_training_units").select("id,course_id")
   .in("course_id",ids).order("id"),4000),
  allRows(()=>ctx.admin.from("literacy_training_certificates").select("user_id,course_id")
   .eq("school_id",ctx.schoolId).in("course_id",ids).order("id"),4000),
  allRows(()=>ctx.admin.from("literacy_training_sessions").select("id,course_id,attendee_count")
   .eq("school_id",ctx.schoolId).in("course_id",ids).order("id"),4000),
  allRows(()=>ctx.admin.from("literacy_training_session_attendees")
   .select("user_id,session_id").eq("school_id",ctx.schoolId).order("session_id"),4000)
 ]);
 if(coursesResult.error)throw coursesResult.error;
 const courses=(coursesResult.data||[]).filter(x=>x.target_roles?.includes("teacher"));
 const courseIds=new Set(courses.map(c=>c.id));
 const units=unitsResult.rows.filter(u=>courseIds.has(u.course_id));
 const unitIds=new Set(units.map(u=>u.id));
 const progress=unitIds.size&&teacherIds.length?
  await allRows(()=>ctx.admin.from("literacy_training_progress")
   .select("user_id,unit_id,quiz_percent").eq("school_id",ctx.schoolId)
   .in("user_id",teacherIds).in("unit_id",[...unitIds]).order("user_id"),5000):
  {rows:[],truncated:false};
 const courseUnitMap=new Map();
 for(const u of units){if(!courseUnitMap.has(u.course_id))courseUnitMap.set(u.course_id,new Set());courseUnitMap.get(u.course_id).add(u.id);}
 const relevantCerts=certificateResult.rows.filter(c=>courseIds.has(c.course_id));
 const teacherStats=teachers.map(t=>{
  const completed=progress.rows.filter(p=>p.user_id===t.user_id);
  const quizzes=completed.filter(p=>p.quiz_percent!==null);
  const ownCerts=relevantCerts.filter(c=>c.user_id===t.user_id);
  return {user_id:t.user_id,unitsCompleted:completed.length,totalUnits:units.length,
   certificates:ownCerts.length,
   averageQuiz:quizzes.length?Math.round(quizzes.reduce((n,q)=>n+q.quiz_percent,0)/quizzes.length):null,
   courses:courses.map(c=>{
    const set=courseUnitMap.get(c.id)||new Set();
    return {id:c.id,title:c.title,completed:completed.filter(p=>set.has(p.unit_id)).length,
     total:set.size,certified:ownCerts.some(x=>x.course_id===c.id)};
   })};
 });
 const sessions=sessionsResult.rows.filter(x=>courseIds.has(x.course_id));
 const sessionIds=new Set(sessions.map(x=>x.id));
 return {courses,teacherStats,sessions:sessions.length,
  attendances:attendanceResult.rows.filter(x=>sessionIds.has(x.session_id)).length,
  truncated:linkLimit||unitsResult.truncated||certificateResult.truncated||
   sessionsResult.truncated||attendanceResult.truncated||progress.truncated};
}
async function implementation(ctx,teachers){
 if(!ctx.can("implementation.review"))return null;
 const native=await allRows(()=>ctx.admin.from("literacy_teacher_lessons")
  .select("id,school_id,teacher_user_id,planned_on,periods,preparation_minutes,prepared_at,preparation_files,evidence_updates,reviews,version")
  .eq("school_id",ctx.schoolId).order("id"),5000);
 const entriesResult=await allRows(()=>ctx.admin.from("literacy_implementation_entries")
   .select("id,class_id,teacher_user_id,implementation_date,subject,lesson_topic,submitted_at")
   .eq("school_id",ctx.schoolId).order("id"),5000);
 const schoolEntries=entriesResult.rows;
 const reviews=[];
 let reviewTruncated=false;
 for(let i=0;i<schoolEntries.length;i+=400){
  const entryIds=schoolEntries.slice(i,i+400).map(x=>x.id);
  const found=await allRows(()=>ctx.admin.from("literacy_implementation_reviews")
   .select("entry_id,status,feedback,reviewed_at").in("entry_id",entryIds).order("entry_id"),2000);
  reviews.push(...found.rows);
  reviewTruncated=reviewTruncated||found.truncated;
 }
 const reviewById=indexBy(reviews,"entry_id");
 let fileCounts={};
 let filesTruncated=false;
 if(schoolEntries.length){
  let allFiles=[];
  for(let i=0;i<schoolEntries.length;i+=400){
   const ids=schoolEntries.slice(i,i+400).map(x=>x.id);
   const {rows,truncated}=await allRows(()=>ctx.admin.from("literacy_implementation_files")
    .select("entry_id,category").in("entry_id",ids).order("id"),5000);
   allFiles.push(...rows);
   if(truncated){filesTruncated=true;break;}
  }
  for(const f of allFiles){
   if(!fileCounts[f.entry_id])fileCounts[f.entry_id]={};
   fileCounts[f.entry_id][f.category]=(fileCounts[f.entry_id][f.category]||0)+1;
  }
 }
 const teacherStats=teachers.map(t=>{
  const own=schoolEntries.filter(e=>e.teacher_user_id===t.user_id),fresh=visionImplementationSummary(native.rows,t.user_id);
  const records=[...own.map(e=>({...e,files:fileCounts[e.id]||{},review:reviewById.get(e.id)||null})),...fresh.records];
  const reviewed=records.filter(e=>e.review?.status==="reviewed").length;
  const needsFollowUp=records.filter(e=>e.review?.status==="needs_follow_up").length;
  const files=records.reduce((sum,x)=>sum+Object.values(x.files||{}).reduce((a,b)=>a+b,0),0);
  return {user_id:t.user_id,submissions:records.length,files,reviewed,needsFollowUp,pending:records.length-reviewed-needsFollowUp,
   preparationSessions:fresh.preparationSessions,preparedPeriods:fresh.preparedPeriods,preparationMinutes:fresh.preparationMinutes,
   records:records.sort((a,b)=>String(b.submitted_at).localeCompare(String(a.submitted_at))).slice(0,45)};
 });
 return {teacherStats,submissions:teacherStats.reduce((n,t)=>n+t.submissions,0),
  pending:teacherStats.reduce((n,t)=>n+t.pending,0),
  needsFollowUp:teacherStats.reduce((n,t)=>n+t.needsFollowUp,0),
  preparationSessions:teacherStats.reduce((n,t)=>n+t.preparationSessions,0),
  preparationMinutes:teacherStats.reduce((n,t)=>n+t.preparationMinutes,0),
  truncated:entriesResult.truncated||reviewTruncated||filesTruncated||native.truncated};
}
async function teacherSkillReviews(ctx,teachers){
 if(!ctx.can("teacher_reviews.create"))return null;
 const ids=new Set(teachers.map(t=>t.user_id));
 const {rows:allAssess,truncated:assessmentTruncated}=await allRows(
  ()=>ctx.admin.from("literacy_assessments").select("id,teacher_user_id,assessment_date,assessment_stage,notes,created_at")
   .eq("school_id",ctx.schoolId).eq("subject_type","teacher").order("id"),4000);
 const assessments=allAssess.filter(a=>ids.has(a.teacher_user_id));
 let results=[],sounds=[],truncated=assessmentTruncated;
 if(assessments.length){
  const chunks=[];for(let i=0;i<assessments.length;i+=450)chunks.push(assessments.slice(i,i+450).map(x=>x.id));
  for(const chunk of chunks){
   const [r,s]=await Promise.all([
    allRows(()=>ctx.admin.from("literacy_assessment_results").select("assessment_id,competency_id,rating")
     .in("assessment_id",chunk).order("id"),5000),
    allRows(()=>ctx.admin.from("literacy_assessment_phonics_results").select("assessment_id,competency_id,item_id,rating,observation_dimension")
     .in("assessment_id",chunk).order("assessment_id"),5000)
   ]);
   results.push(...r.rows);sounds.push(...s.rows);
   truncated=truncated||r.truncated||s.truncated;
  }
 }
 const latestById=new Map(assessments.map(a=>[a.id,a]));
 const teacherStats=teachers.map(t=>{
  const mine=assessments.filter(x=>x.teacher_user_id===t.user_id)
   .sort((a,b)=>String(b.assessment_date).localeCompare(String(a.assessment_date))||
    String(b.created_at).localeCompare(String(a.created_at)));
  const rated=results.filter(r=>mine.some(x=>x.id===r.assessment_id));
  const lastRating=new Map();
  for(const session of mine)for(const r of rated.filter(x=>x.assessment_id===session.id))
   if(!lastRating.has(r.competency_id))lastRating.set(r.competency_id,r.rating);
  const independent=[...lastRating.values()].filter(r=>r==="Independent").length;
  const phonics=sounds.filter(x=>mine.some(s=>s.id===x.assessment_id));
  return {user_id:t.user_id,reviews:mine.length,latest:mine[0]?.assessment_date||null,
   competenciesObserved:lastRating.size,competenciesIndependent:independent,
   phonicsRatings:phonics.length,
   sessions:mine.slice(0,35).map(a=>({...a,
    competencyRatings:rated.filter(r=>r.assessment_id===a.id),
    phonicsRatings:phonics.filter(r=>r.assessment_id===a.id)}))};
 });
 return {teacherStats,teachersReviewed:teacherStats.filter(t=>t.reviews>0).length,
  sessions:assessments.length,truncated};
}
export async function GET(request){
 try{
  const url=new URL(request.url),schoolId=text(url.searchParams.get("schoolId"),40),
   mode=text(url.searchParams.get("mode"),20)||"school";
  const ctx=await authorize(request,schoolId);
  if(ctx.error)return send({error:ctx.error},ctx.status);
  if(!ctx.manager)return send({error:"Schoolwide and staff reports are restricted to authorized school leaders and Consultants."},403);
  if(!["school","teacher"].includes(mode))return send({error:"Invalid progress report mode."},400);
  const base=await baseSchool(ctx);
  const studentPromise=mode==="school"&&ctx.can("assessments.view")?studentStats(ctx,base):Promise.resolve(null);
  const [studentData,trainingData,implementationData,teacherData]=await Promise.all([
   studentPromise,schoolTraining(ctx,base.teachers),implementation(ctx,base.teachers),
   teacherSkillReviews(ctx,base.teachers)
  ]);
  const teachers=base.teachers.map(t=>{
   const assignments=base.assignments.filter(a=>a.teacher_user_id===t.user_id);
   const classNames=assignments.map(a=>base.classes.find(c=>c.id===a.class_id))
    .filter(Boolean).map(c=>c.grade+" "+c.section);
   const teach=teacherData?.teacherStats.find(x=>x.user_id===t.user_id);
   const train=trainingData?.teacherStats.find(x=>x.user_id===t.user_id);
   const imp=implementationData?.teacherStats.find(x=>x.user_id===t.user_id);
   return {id:t.user_id,name:t.display_name||"Teacher",classes:[...new Set(classNames)],
    assessments:teach||null,training:train||null,implementation:imp||null};
  }).sort((a,b)=>a.name.localeCompare(b.name));
  const general={schoolId,teachers:teachers.length,students:base.students.length,
   classCount:base.classes.length,
   student:studentData,training:trainingData?{
    publishedCourses:trainingData.courses.length,
    certificates:trainingData.teacherStats.reduce((sum,t)=>sum+t.certificates,0),
    teachersCertified:trainingData.teacherStats.filter(t=>t.certificates>0).length,
    sessions:trainingData.sessions,individualAttendances:trainingData.attendances,
    truncated:trainingData.truncated
   }:null,
   implementation:implementationData?{
    submissions:implementationData.submissions,pending:implementationData.pending,
    needsFollowUp:implementationData.needsFollowUp,
    preparationSessions:implementationData.preparationSessions,
    preparationMinutes:implementationData.preparationMinutes,
    truncated:implementationData.truncated
   }:null,
   teacherSkills:teacherData?{reviewed:teacherData.teachersReviewed,
    sessions:teacherData.sessions,truncated:teacherData.truncated}:null,
   dataLimited:base.limits||studentData?.truncated||trainingData?.truncated||
    implementationData?.truncated||teacherData?.truncated};
  if(mode==="school")return send({summary:general,
   teachers:teachers.map(t=>({
    id:t.id,name:t.name,classes:t.classes,
    reviews:t.assessments?.reviews??null,
    observedCompetencies:t.assessments?.competenciesObserved??null,
    certificates:t.training?.certificates??null,
    trainingUnits:t.training?.unitsCompleted??null,
    implementationPeriods:t.implementation?.submissions??null,
    followUp:t.implementation?.needsFollowUp??null
   }))});
  const teacherId=text(url.searchParams.get("teacherId"),40);
  if(!UUID.test(teacherId))return send({error:"Choose a teacher."},400);
  const teacher=teachers.find(t=>t.id===teacherId);
  if(!teacher)return send({error:"That teacher is not assigned to this school."},404);
  return send({teacher,summary:{classes:general.classCount,students:general.students,
   dataLimited:general.dataLimited},available:{
    skills:ctx.can("teacher_reviews.create"),training:ctx.can("training.review"),
    implementation:ctx.can("implementation.review")
   }});
 }catch(e){return send({error:"Unable to compile school progress report: "+(e.message||"Unknown error")},500);}
}
