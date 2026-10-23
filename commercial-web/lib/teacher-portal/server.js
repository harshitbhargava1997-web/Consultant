import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {isConfirmedUser} from '../auth';
import {BUCKET,CATEGORIES,filesSchema,fileType,lessonFiles,scopeDraft,today,validDay} from './domain';

export const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export const hash=s=>createHash('sha256').update(s).digest('hex');
export function database(){if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('503:Teacher portal is not configured');return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});}
export async function checked(query){const {data,error}=await query;if(error)throw Error(error.message);return data;}
export function send(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export function fail(e){const message=e.issues?.[0]?.message||String(e.message||e),status=Number(message.match(/^(400|401|403|404|409|413|503):/)?.[1]||400);return send({error:message.replace(/^\d+:/,'')},status);}
export function checkOrigin(req){const origin=req.headers.get('Origin');if(origin&&origin!==new URL(req.url).origin)throw Error('403:Cross-origin request rejected');}
function secret(){const s=process.env.VISION_TEACHER_PORTAL_SIGNING_KEY;if(!s)throw Error('503:Teacher portal signing is not configured');return s;}
export function sign(payload,audience,ttl){const body=Buffer.from(JSON.stringify({...payload,audience,expires:Date.now()+ttl})).toString('base64url');return body+'.'+createHmac('sha256',secret()).update(body).digest('base64url');}
export function verify(token,audience){
 if(typeof token!=='string'||token.length>220000)throw Error('403:Invalid teacher portal grant');const [body,sig,...rest]=token.split('.');if(!body||!sig||rest.length)throw Error('403:Invalid teacher portal grant');
 const expected=createHmac('sha256',secret()).update(body).digest(),actual=Buffer.from(sig,'base64url');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error('403:Invalid teacher portal grant');
 const value=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));if(value.audience!==audience||value.expires<Date.now())throw Error('403:Teacher portal grant expired');return value;
}
export async function authorize(req){
 const db=database(),params=new URL(req.url).searchParams,access=req.headers.get('X-Vision-Teacher-Link')||'';
 let schoolId=params.get('schoolId')||'',teacherId=params.get('teacherId')||'',user=null,role='',isAdmin=false,link=null;
 if(access){
  if(!UUID.test(access))throw Error('403:Invalid Vision teacher link');
  link=await checked(db.from('literacy_teacher_portal_links').select('id,school_id,revoked_at').eq('token_hash',hash(access)).maybeSingle());
  if(!link||link.revoked_at)throw Error('403:This Vision teacher link is not active');
  if(schoolId&&schoolId!==link.school_id)throw Error('403:Teacher link belongs to another school');schoolId=link.school_id;role='teacher';
 }else{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)throw Error('401:Sign in to Vision');
  const {data,error}=await db.auth.getUser(token);user=data?.user;if(error||!isConfirmedUser(user))throw Error('401:Vision session expired');
  if(user.app_metadata?.must_change_password)throw Error('403:Change your initial Vision password first');
  isAdmin=!!await checked(db.from('literacy_platform_admins').select('user_id').eq('user_id',user.id).maybeSingle());
  if(!UUID.test(schoolId))throw Error('400:Select a Vision school');
  const [membership,assignment]=await Promise.all([
   checked(db.from('literacy_memberships').select('role').eq('school_id',schoolId).eq('user_id',user.id).maybeSingle()),
   checked(db.from('literacy_consultant_assignments').select('school_id').eq('school_id',schoolId).eq('consultant_user_id',user.id).maybeSingle())
  ]);
  role=isAdmin?'super_admin':assignment?'consultant':membership?.role||'';
  if(!['super_admin','consultant','owner','principal','coordinator','teacher'].includes(role))throw Error('403:You are not assigned to this Vision school');
  if(role==='teacher'){if(teacherId&&teacherId!==user.id)throw Error('403:Select your own teacher account');teacherId=user.id;}
 }
 const grants=isAdmin?[]:await checked(db.from('literacy_role_permissions').select('feature').eq('role',role).eq('enabled',true));
 const can=feature=>isAdmin||grants.some(g=>g.feature===feature),canReview=!link&&role!=='teacher'&&can('implementation.review');
 if(!can('implementation.view')&&!can('implementation.submit')&&!canReview)throw Error('403:Teacher portal access is disabled for your role');
 if(!link&&role!=='teacher'&&!canReview)throw Error('403:Teacher review access is required');
 const school=await checked(db.from('literacy_schools').select('id,name').eq('id',schoolId).is('archived_at',null).maybeSingle());if(!school)throw Error('404:Vision school not found');
 const roster=await checked(db.from('literacy_memberships').select('user_id,display_name').eq('school_id',schoolId).eq('role','teacher').order('display_name'));
 if(teacherId&&!roster.some(t=>t.user_id===teacherId))throw Error('403:Teacher is not assigned to this Vision school');
 const [classes,assignments,competencies]=await Promise.all([
  checked(db.from('literacy_classes').select('id,grade,section,academic_year').eq('school_id',schoolId).order('grade')),
  checked(db.from('literacy_teacher_classes').select('class_id,teacher_user_id').in('teacher_user_id',roster.length?roster.map(t=>t.user_id):['00000000-0000-0000-0000-000000000000'])),
  checked(db.from('literacy_competencies').select('id,grade,code,title,sequence,active').eq('active',true))
 ]);
 const teachers=roster.filter(t=>link||canReview||t.user_id===user?.id).map(t=>({id:t.user_id,name:t.display_name||'Teacher',classes:classes.filter(c=>assignments.some(a=>a.teacher_user_id===t.user_id&&a.class_id===c.id))}));
 const teacher=teachers.find(t=>t.id===teacherId);
 return {db,user,role,isAdmin,school,schoolId,teacherId,teacher,teachers,classes:teacher?.classes||[],competencies,can,canReview,canFeedback:canReview&&can('implementation.feedback'),canSubmit:(!!link||role==='teacher'||isAdmin)&&can('implementation.submit'),canShare:!link&&role!=='teacher'&&(isAdmin||can('users.manage')),link,actorKey:link?'public:'+link.id+':'+teacherId:'user:'+user.id};
}
export function requireSubmit(ctx){if(!ctx.teacher||!ctx.canSubmit)throw Error('403:Choose an assigned teacher with lesson submission access');}
export async function getLesson(ctx,id){if(!UUID.test(id||''))throw Error('400:Choose a saved lesson');let q=ctx.db.from('literacy_teacher_lessons').select('*').eq('school_id',ctx.schoolId).eq('id',id);if(!ctx.canReview||ctx.teacherId)q=q.eq('teacher_user_id',ctx.teacherId);const l=await checked(q.maybeSingle());if(!l)throw Error('404:Saved Vision lesson not found');return l;}
export function fileUrl(req,ctx,lessonId,file){const token=sign({schoolId:ctx.schoolId,teacherId:ctx.teacherId||file.teacherId,lessonId,fileId:file.id,path:file.path,linkId:ctx.link?.id||null},'vision-teacher-file',365*86400000);return new URL('/api/teacher-portal/download?grant='+encodeURIComponent(token),req.url).href;}
export function decorateLesson(req,ctx,lesson){const all=lessonFiles(lesson).map(f=>({...f,url:fileUrl(req,{...ctx,teacherId:lesson.teacher_user_id},lesson.id,f)}));const byId=new Map(all.map(f=>[f.path,f]));return {...lesson,files:all,preparation_files:lesson.preparation_files.map(f=>byId.get(f.path)),evidence_updates:lesson.evidence_updates.map(u=>({...u,files:u.files.map(f=>byId.get(f.path))}))};}
export async function list(ctx,params){
 let q=ctx.db.from('literacy_teacher_lessons').select('*').eq('school_id',ctx.schoolId).order('prepared_at',{ascending:false}).limit(201);
 if(ctx.teacherId)q=q.eq('teacher_user_id',ctx.teacherId);else if(!ctx.canReview)return [];
 const date=params.get('date');if(date)q=q.eq('planned_on',validDay.parse(date));return await checked(q);
}
export async function prepare(req,ctx,b){
 requireSubmit(ctx);const mode=b.mode;if(!['preparation','evidence'].includes(mode))throw Error('400:Choose preparation or evidence');
 let submission,version=0,updateId=null,conductedOn=null;
 if(mode==='preparation'){
  submission={...scopeDraft(b.submission,ctx.classes,ctx.competencies),schoolId:ctx.schoolId,teacherId:ctx.teacherId};
  const existing=await checked(ctx.db.from('literacy_teacher_lessons').select('id,teacher_user_id,school_id,version').eq('id',submission.id).maybeSingle());
  if(existing){if(existing.teacher_user_id!==ctx.teacherId||existing.school_id!==ctx.schoolId)throw Error('403:Lesson identity belongs to another teacher');return {saved:true,alreadySaved:true,id:existing.id,version:existing.version};}
 }else{
  const lesson=await getLesson(ctx,b.lessonId);if(lesson.teacher_user_id!==ctx.teacherId)throw Error('403:Choose your own saved preparation');
  version=Number(b.version);updateId=b.updateId;conductedOn=validDay.parse(b.conductedOn);if(conductedOn>today()||!UUID.test(updateId||''))throw Error('400:Choose the day the lesson was taught');
  if(lesson.evidence_updates.some(u=>u.id===updateId))return {saved:true,alreadySaved:true,id:lesson.id,version:lesson.version};
  if(!Number.isInteger(version)||version!==lesson.version)throw Error('409:Lesson changed. Reload it before adding evidence');
  submission={id:lesson.id,date:lesson.planned_on,periods:lesson.periods,schoolId:ctx.schoolId,teacherId:ctx.teacherId};
 }
 const files=filesSchema.parse(b.files||[]);if(!files.length)throw Error('400:Add a preparation PDF or classroom evidence');
 const periodIds=new Set(submission.periods.map(p=>p.id));if(files.some(f=>!periodIds.has(f.periodId)))throw Error('400:Evidence must belong to a saved class period');
 if(mode==='preparation'&&submission.periods.some(p=>!files.some(f=>f.periodId===p.id&&f.category==='lesson_plan')))throw Error('400:Generate a preparation PDF for every period');
 const planId=randomUUID(),planned=files.map(f=>{const {type,ext}=fileType(f);return {...f,contentType:type,path:['teacher-portal',ctx.schoolId,ctx.teacherId,submission.id,planId,f.id+'.'+ext].join('/')};});
 const tickets=await Promise.all(planned.map(async f=>{const upload=await checked(ctx.db.storage.from(BUCKET).createSignedUploadUrl(f.path));return {...f,uploadToken:upload.token};}));
 return {token:sign({actor:ctx.actorKey,schoolId:ctx.schoolId,teacherId:ctx.teacherId,mode,submission,files:planned,version,updateId,conductedOn},'vision-teacher-upload',90*60000),files:tickets};
}
export async function commit(ctx,b){
 requireSubmit(ctx);const plan=verify(b.token,'vision-teacher-upload');if(plan.actor!==ctx.actorKey||plan.schoolId!==ctx.schoolId||plan.teacherId!==ctx.teacherId)throw Error('403:This upload plan belongs to another teacher or school');
 const existing=await checked(ctx.db.from('literacy_teacher_lessons').select('*').eq('id',plan.submission.id).maybeSingle());
 if(existing){if(existing.school_id!==ctx.schoolId||existing.teacher_user_id!==ctx.teacherId)throw Error('403:Lesson identity belongs to another teacher');if(plan.mode==='preparation'||existing.evidence_updates.some(u=>u.id===plan.updateId))return {saved:true,alreadySaved:true,id:existing.id,version:existing.version};if(existing.version!==plan.version)throw Error('409:Lesson changed. Reload before submitting evidence');}
 // Never accept merely claimed object paths; verify the completed direct uploads.
 await Promise.all(plan.files.map(async f=>{const info=await checked(ctx.db.storage.from(BUCKET).info(f.path));const actual=Number(info.metadata?.size??info.size);if(!info||!Number.isFinite(actual)||actual!==f.size)throw Error('400:Finish uploading '+f.name+' before saving');}));
 const saved=await checked(ctx.db.rpc('literacy_commit_teacher_lesson',{p_mode:plan.mode,p_submission:plan.submission,p_files:plan.files,p_actor:ctx.actorKey,p_version:plan.version,p_update:plan.updateId,p_conducted:plan.conductedOn}));return saved;
}
export async function share(ctx,req,b){
 if(!ctx.canShare)throw Error('403:School user-management permission is required to manage teacher links');
 if(b.action==='createSchoolLink'){const token=randomUUID();const row=await checked(ctx.db.from('literacy_teacher_portal_links').insert({school_id:ctx.schoolId,token_hash:hash(token),created_by:ctx.user.id}).select('id,created_at').single());return {...row,url:new URL('/teacher-portal/'+token,req.url).href};}
 if(b.action==='revokeSchoolLink'){if(!UUID.test(b.id||''))throw Error('400:Choose a school link');await checked(ctx.db.from('literacy_teacher_portal_links').update({revoked_at:new Date().toISOString()}).eq('id',b.id).eq('school_id',ctx.schoolId));return {saved:true};}
 throw Error('400:Unsupported school-link action');
}
