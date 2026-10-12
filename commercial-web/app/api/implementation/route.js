import {NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";

export const runtime="nodejs";
const BUCKET="vision-implementation";
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const MAX_BYTES=50*1024*1024;
const CATEGORY_LABELS={
 voice:"Voice reflection",lesson_plan:"Lesson Plan",activity:"Classroom Activity Conducted",
 writing:"Student Written Work / Writing Practice",phonics:"Phonics / Phonetics Implementation",
 assessment:"Student Assessment",portfolio:"Student Portfolio",event_pictures:"Event Pictures"
};
const EXT={
 "application/pdf":"pdf","image/jpeg":"jpg","image/png":"png","image/webp":"webp",
 "video/mp4":"mp4","video/quicktime":"mov","video/webm":"webm","video/x-m4v":"m4v","video/x-msvideo":"avi",
 "audio/wav":"wav","audio/webm":"webm","audio/mp4":"m4a","audio/mpeg":"mp3","audio/x-m4a":"m4a"
};
const allowedMime=(category,mime)=>{
 if(!Object.keys(CATEGORY_LABELS).includes(category)||!EXT[mime])return false;
 if(!["voice","lesson_plan","activity","phonics"].includes(category))return false;
 if(category==="voice")return mime.startsWith("audio/");
 if(category==="event_pictures")return mime.startsWith("image/");
 if(["lesson_plan","writing","assessment"].includes(category))return mime==="application/pdf"||mime.startsWith("image/");
 return mime==="application/pdf"||mime.startsWith("image/")||mime.startsWith("video/");
};
const txt=(value,max=200)=>String(value??"").trim().slice(0,max+1);
const send=(data,status=200)=>NextResponse.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const dbClient=key=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}});
async function authorize(request,schoolId){
 const anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!anon||!secret||!process.env.NEXT_PUBLIC_SUPABASE_URL)return {error:"Evidence service is not configured.",status:503};
 const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
 if(!token)return {error:"Sign in to access evidence.",status:401};
 const signed=dbClient(anon);
 const {data:{user},error:userError}=await signed.auth.getUser(token);
 if(userError||!user||!user.email_confirmed_at)return {error:"Invalid or expired session.",status:401};
 if(user.app_metadata?.must_change_password)return {error:"Change your initial password first.",status:403};
 const admin=dbClient(secret);
 const {data:superUser,error:superError}=await admin.from("literacy_platform_admins")
  .select("user_id").eq("user_id",user.id).maybeSingle();
 if(superError)return {error:"Unable to validate platform role.",status:503};
 const isAdmin=!!superUser;
 if(!UUID.test(schoolId))return {error:"Select a school to continue.",status:400};
 const [consultant,membership]=await Promise.all([
  admin.from("literacy_consultant_assignments").select("school_id")
   .eq("school_id",schoolId).eq("consultant_user_id",user.id).maybeSingle(),
  admin.from("literacy_memberships").select("role")
   .eq("school_id",schoolId).eq("user_id",user.id).maybeSingle()
 ]);
 if(consultant.error||membership.error)return {error:"Unable to check school access.",status:503};
 const role=isAdmin?"super_admin":consultant.data?"consultant":membership.data?.role||"";
 if(!isAdmin&&!["teacher","owner","principal","coordinator","consultant"].includes(role))
  return {error:"You are not assigned to this school.",status:403};
 let grants=[];
 if(!isAdmin){
  const {data,error}=await admin.from("literacy_role_permissions")
   .select("feature").eq("role",role).eq("enabled",true).like("feature","implementation.%");
  if(error)return {error:"Unable to load implementation permissions.",status:503};
  grants=(data||[]).map(g=>g.feature);
 }
 return {admin,user,schoolId,role,isAdmin,can:(feature)=>isAdmin||grants.includes(feature)};
}
async function eligibleClasses(ctx){
 const {data,error}=await ctx.admin.from("literacy_classes")
  .select("id,grade,section,academic_year").eq("school_id",ctx.schoolId).order("grade").limit(500);
 if(error)throw error;
 let classes=data||[];
 if(!ctx.isAdmin&&ctx.role==="teacher"){
  const ids=classes.map(c=>c.id);
  const assigned=ids.length?await ctx.admin.from("literacy_teacher_classes")
   .select("class_id").eq("teacher_user_id",ctx.user.id).in("class_id",ids):{data:[],error:null};
  if(assigned.error)throw assigned.error;
  const known=new Set((assigned.data||[]).map(x=>x.class_id));
  classes=classes.filter(c=>known.has(c.id));
 }
 return classes;
}
function uploadPrefix(ctx){return ctx.schoolId+"/"+ctx.user.id+"/";}
function validateFileMeta(ctx,file){
 const category=txt(file.category,32),mime=txt(file.contentType,70),
  path=txt(file.path,350),name=txt(file.name,240),size=Number(file.size);
 if(!allowedMime(category,mime)||!path.startsWith(uploadPrefix(ctx))||
  !/^[a-f0-9-]{36}\.[a-z0-9]+$/i.test(path.slice(uploadPrefix(ctx).length))||
  !path.endsWith("."+EXT[mime])||!name||name.length>240||!Number.isInteger(size)||size<1||size>MAX_BYTES)throw Error("Invalid or unauthorized evidence file.");
 if(path.split("/").some(v=>v===".."||v==="."))throw Error("Invalid upload path.");
 return {category,content_type:mime,object_path:path,file_name:name,size_bytes:size};
}
async function getEntries(ctx,url){
 const reviewer=ctx.can("implementation.review");
 const self=ctx.can("implementation.view")||ctx.can("implementation.submit");
 if(!reviewer&&!self)throw Error("Implementation visibility is disabled for this role.");
 let query=ctx.admin.from("literacy_implementation_entries")
  .select("id,school_id,class_id,teacher_user_id,submission_key,period_number,implementation_date,subject,lesson_topic,voice_reflection_note,teacher_reflection,competency_id,training_course_id,submitted_at")
  .eq("school_id",ctx.schoolId).order("submitted_at",{ascending:false}).limit(150);
 if(!reviewer)query=query.eq("teacher_user_id",ctx.user.id);
 const classFilter=txt(url.searchParams.get("classId"),40);
 if(classFilter&&UUID.test(classFilter))query=query.eq("class_id",classFilter);
 const {data:entries,error}=await query;
 if(error)throw error;
 const rows=entries||[];
 if(!rows.length)return {entries:[],files:[],reviews:[],people:[],competencyLinks:[],classes:await eligibleClasses(ctx)};
 const ids=rows.map(r=>r.id);
 const [fileResult,reviewResult,peopleResult,linkResult,classes]=await Promise.all([
  ctx.admin.from("literacy_implementation_files").select("id,entry_id,category,object_path,file_name,content_type,size_bytes")
   .in("entry_id",ids).limit(2000),
  ctx.admin.from("literacy_implementation_reviews").select("entry_id,reviewer_id,status,feedback,reviewed_at").in("entry_id",ids),
  ctx.admin.from("literacy_memberships").select("user_id,display_name,role").eq("school_id",ctx.schoolId).limit(600),
  ctx.admin.from("literacy_implementation_competencies").select("entry_id,competency_id").in("entry_id",ids),
  eligibleClasses(ctx)
 ]);
 if(fileResult.error||reviewResult.error||peopleResult.error||linkResult.error)throw fileResult.error||reviewResult.error||peopleResult.error||linkResult.error;
 const files=await Promise.all((fileResult.data||[]).map(async f=>{
  const {data,error:linkError}=await ctx.admin.storage.from(BUCKET).createSignedUrl(f.object_path,600);
  const {object_path,...safe}=f;
  return {...safe,url:linkError?"":data?.signedUrl||""};
 }));
 return {entries:rows,files,reviews:reviewResult.data||[],competencyLinks:linkResult.data||[],people:reviewer?peopleResult.data||[]:
  (peopleResult.data||[]).filter(p=>p.user_id===ctx.user.id),classes};
}
export async function GET(request){
 try{
  const url=new URL(request.url),schoolId=txt(url.searchParams.get("schoolId"),40);
  const ctx=await authorize(request,schoolId);
  if(ctx.error)return send({error:ctx.error},ctx.status);
  return send({...await getEntries(ctx,url),transcriptionAvailable:!!process.env.OPENAI_API_KEY,role:ctx.role,isAdmin:ctx.isAdmin,
   canSubmit:ctx.role==="teacher"&&ctx.can("implementation.submit"),
   canReview:ctx.can("implementation.review"),canFeedback:ctx.can("implementation.feedback"),
   categories:CATEGORY_LABELS});
 }catch(e){return send({error:e.message||"Could not load implementation evidence."},500);}
}
export async function POST(request){
 try{
  const schoolId=txt(new URL(request.url).searchParams.get("schoolId"),40);
  const ctx=await authorize(request,schoolId);
  if(ctx.error)return send({error:ctx.error},ctx.status);
  const raw=await request.text();
  if(raw.length>90000)return send({error:"Implementation request too large."},413);
  let body;try{body=JSON.parse(raw);}catch{return send({error:"Invalid JSON submission."},400);}
  const action=txt(body.action,35);
  if(action==="uploadTicket"){
   if(ctx.role!=="teacher"||!ctx.can("implementation.submit"))return send({error:"Teacher evidence upload is disabled."},403);
   const mime=txt(body.contentType,70),category=txt(body.category,32),
    name=txt(body.name,240),size=Number(body.size);
   if(!allowedMime(category,mime)||!name||name.length>240||
    !Number.isInteger(size)||size<1||size>MAX_BYTES)
    return send({error:"Choose a supported file up to 50 MB in the selected evidence category."},400);
   const path=uploadPrefix(ctx)+randomUUID()+"."+EXT[mime];
   const {data,error}=await ctx.admin.storage.from(BUCKET).createSignedUploadUrl(path);
   if(error)throw error;
   return send({path,token:data.token});
  }
  if(action==="transcribeVoice"){
   if(ctx.role!=="teacher"||!ctx.can("implementation.submit"))
    return send({error:"Only an authorized teacher may transcribe their recording."},403);
   if(!process.env.OPENAI_API_KEY)
    return send({error:"Uploaded audio transcription needs an OPENAI_API_KEY configured on Vercel."},503);
   const path=txt(body.path,350),language=txt(body.language,12);
   if(!path.startsWith(uploadPrefix(ctx))||!/^[a-f0-9-]{36}\.(webm|m4a|mp3|wav)$/i.test(path.slice(uploadPrefix(ctx).length)))
    return send({error:"Invalid audio recording path."},400);
   if(!["en","hi",""].includes(language))
    return send({error:"Choose English or Hindi transcription."},400);
   const {data:obj,error:downloadError}=await ctx.admin.storage.from(BUCKET).download(path);
   if(downloadError||!obj)return send({error:"Audio recording was not uploaded successfully."},404);
   if(obj.size>25*1024*1024)return send({error:"Audio transcription supports files up to 25 MB. You may still submit the audio recording as evidence."},413);
   const extension=path.split(".").at(-1);
   const mime=extension==="webm"?"audio/webm":extension==="m4a"?"audio/mp4":extension==="mp3"?"audio/mpeg":"audio/wav";
   const form=new FormData();
   form.append("model","gpt-4o-mini-transcribe");
   form.append("file",new File([obj],"teacher-reflection."+extension,{type:mime}));
   if(language)form.append("language",language);
   const response=await fetch("https://api.openai.com/v1/audio/transcriptions",{
    method:"POST",headers:{Authorization:"Bearer "+process.env.OPENAI_API_KEY},body:form,
    signal:AbortSignal.timeout(90000)
   });
   if(!response.ok)return send({error:"Speech transcription service was unable to process the recording. Audio is still available for submission."},502);
   const transcription=await response.json();
   const transcript=txt(transcription.text,5000);
   return send({transcript,message:"Voice transcribed. Review and edit the text before submitting."});
  }
  if(action==="cleanupUploads"){
   if(ctx.role!=="teacher"||!ctx.can("implementation.submit"))return send({error:"Not authorized."},403);
   const paths=Array.isArray(body.paths)?body.paths:[];
   if(paths.length>30||paths.some(p=>typeof p!=="string"||!p.startsWith(uploadPrefix(ctx))))
    return send({error:"Invalid cleanup paths."},400);
   // Refuse to delete files already committed to an evidence record.
   const {data:attached,error}=paths.length?await ctx.admin.from("literacy_implementation_files")
    .select("object_path").in("object_path",paths):{data:[],error:null};
   if(error)throw error;
   const keep=new Set((attached||[]).map(f=>f.object_path));
   const pending=paths.filter(p=>!keep.has(p));
   if(pending.length){const {error:removeError}=await ctx.admin.storage.from(BUCKET).remove(pending);if(removeError)throw removeError;}
   return send({removed:pending.length});
  }
  if(action==="submit"){
   if(ctx.role!=="teacher"||!ctx.can("implementation.submit"))
    return send({error:"Only assigned teachers with submission permission may submit classroom evidence."},403);
   if(!UUID.test(body.submissionKey)||!Array.isArray(body.periods)||body.periods.length<1||body.periods.length>10)
    return send({error:"Submit 1–10 lesson periods with a valid submission receipt key."},400);
   const existing=await ctx.admin.from("literacy_implementation_entries")
    .select("id,period_number").eq("school_id",ctx.schoolId)
    .eq("teacher_user_id",ctx.user.id).eq("submission_key",body.submissionKey);
   if(existing.error)throw existing.error;
   if(existing.data?.length)return send({saved:true,alreadySaved:true,count:existing.data.length,receipt:body.submissionKey,
     message:"This implementation receipt was already saved; no duplicate was created."});
   const classes=await eligibleClasses(ctx),byClass=new Map(classes.map(c=>[c.id,c]));
   const seen=new Set(),entryPayloads=[],filePayloads=[],competencyLinks=[];
   for(const [i,p] of body.periods.entries()){
    const period=Number(p.period),cid=txt(p.classId,40),date=txt(p.date,15),
     subject=txt(p.subject,100),topic=txt(p.topic,300),
     reflection=txt(p.reflection,5000),voiceNotes=txt(p.voiceNotes,5000);
    if(!Number.isInteger(period)||period<1||period>10||seen.has(period)||!byClass.has(cid)||
     !/^\d{4}-\d{2}-\d{2}$/.test(date)||date>new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Kolkata"})||
     subject.length<2||subject.length>100||topic.length<3||topic.length>300||
     reflection.length>5000||voiceNotes.length>5000)
     return send({error:"Check period "+(i+1)+" (assigned class, lesson date, subject, lesson topic and reflection)."},400);
    seen.add(period);
    const competencyIds=[...new Set(Array.isArray(p.competencyIds)?p.competencyIds:
     (p.competencyId?[p.competencyId]:[]))];
    if(competencyIds.length>30||competencyIds.some(id=>!UUID.test(id)))
     return send({error:"Choose up to 30 valid published competencies per period."},400);
    competencyLinks.push({period,ids:competencyIds});
    const periodFiles=Array.isArray(p.files)?p.files:[];
    if(periodFiles.length>20)return send({error:"Maximum 20 evidence files per period."},400);
    if(!periodFiles.some(f=>f.category==="voice"))
     return send({error:"Voice reflection audio is required for every period ("+period+")."},400);
    for(const f of periodFiles)filePayloads.push({period,...validateFileMeta(ctx,f)});
    entryPayloads.push({school_id:ctx.schoolId,class_id:cid,teacher_user_id:ctx.user.id,
     submission_key:body.submissionKey,period_number:period,implementation_date:date,
     subject,lesson_topic:topic,voice_reflection_note:voiceNotes,teacher_reflection:"",
     competency_id:competencyIds[0]||null,training_course_id:null});
   }
   if(filePayloads.length>30||new Set(filePayloads.map(f=>f.object_path)).size!==filePayloads.length)
    return send({error:"Maximum 30 unique evidence files per submission."},400);
   // Verify that every signed-upload file really exists in our private bucket.
   for(const f of filePayloads){
    const {data:object,error:infoError}=await ctx.admin.storage.from(BUCKET).info(f.object_path);
    if(infoError||!object)throw Error("Finish uploading all files before submitting: "+f.file_name);
    const actualSize=Number(object.metadata?.size??object.size);
    if(Number.isFinite(actualSize)&&actualSize!==f.size_bytes)throw Error("Uploaded file size does not match: "+f.file_name);
   }
   if(competencyLinks.some(e=>e.ids.length)){
    const ids=[...new Set(competencyLinks.flatMap(e=>e.ids))];
    const {data,error}=await ctx.admin.from("literacy_competencies")
     .select("id").in("id",ids).eq("active",true);
    if(error||data?.length!==ids.length)return send({error:"A linked competency is no longer published."},400);
   }
   const {data:saved,error:saveError}=await ctx.admin.from("literacy_implementation_entries")
    .insert(entryPayloads).select("id,period_number");
   if(saveError)throw saveError;
   try{
    const idByPeriod=new Map((saved||[]).map(x=>[x.period_number,x.id]));
    const payload=filePayloads.map(f=>{
     const {period,...meta}=f;return {entry_id:idByPeriod.get(period),...meta};
    });
    const links=competencyLinks.flatMap(group=>group.ids.map(id=>({
     entry_id:idByPeriod.get(group.period),competency_id:id
    })));
    if(links.length){
     const {error:linkError}=await ctx.admin.from("literacy_implementation_competencies").insert(links);
     if(linkError)throw linkError;
    }
    if(payload.length){
     const {error:fileError}=await ctx.admin.from("literacy_implementation_files").insert(payload);
     if(fileError)throw fileError;
    }
   }catch(e){
    await ctx.admin.from("literacy_implementation_entries").delete()
     .eq("school_id",ctx.schoolId).eq("teacher_user_id",ctx.user.id).eq("submission_key",body.submissionKey);
    throw e;
   }
   return send({saved:true,count:saved.length,receipt:body.submissionKey,
    message:saved.length+" classroom implementation period(s) submitted successfully."});
  }
  if(action==="review"){
   if(!ctx.can("implementation.feedback")||!ctx.can("implementation.review"))
    return send({error:"Implementation feedback or review access is disabled."},403);
   if(!UUID.test(body.entryId))return send({error:"Select an implementation entry."},400);
   const status=txt(body.status,30),feedback=txt(body.feedback,4000);
   if(!["reviewed","needs_follow_up"].includes(status)||feedback.length>4000||
    status==="needs_follow_up"&&!feedback)
    return send({error:"Choose a review status and add feedback when follow-up is required."},400);
   const {data:entry,error:entryError}=await ctx.admin.from("literacy_implementation_entries")
    .select("id,teacher_user_id").eq("id",body.entryId).eq("school_id",ctx.schoolId).maybeSingle();
   if(entryError||!entry)return send({error:"Implementation not found in this school."},404);
   if(entry.teacher_user_id===ctx.user.id)return send({error:"You cannot review your own classroom evidence."},403);
   const {error}=await ctx.admin.from("literacy_implementation_reviews").upsert({
    entry_id:entry.id,reviewer_id:ctx.user.id,status,feedback,reviewed_at:new Date().toISOString()
   },{onConflict:"entry_id"});
   if(error)throw error;
   return send({message:"Teacher implementation feedback saved."});
  }
  return send({error:"Unknown implementation action."},400);
 }catch(e){return send({error:"Implementation operation failed: "+(e.message||"Unknown error")},500);}
}
