import {authorize,checkOrigin,checked,commit,decorateLesson,fail,getLesson,list,prepare,send,share,UUID} from '@/lib/teacher-portal/server';
export const runtime='nodejs';
export const maxDuration=120;
export async function GET(req){try{
 const ctx=await authorize(req),params=new URL(req.url).searchParams,rows=await list(ctx,params);
 const links=ctx.canShare?await checked(ctx.db.from('literacy_teacher_portal_links').select('id,created_at,revoked_at').eq('school_id',ctx.schoolId).order('created_at',{ascending:false})):[];
 return send({school:ctx.school,teachers:ctx.teachers,teacherId:ctx.teacherId,classes:ctx.classes,competencies:ctx.competencies,canSubmit:ctx.canSubmit,canReview:ctx.canReview,canFeedback:ctx.canFeedback,canShare:ctx.canShare,isPublic:!!ctx.link,lessons:rows.slice(0,200).map(l=>decorateLesson(req,ctx,l)),limited:rows.length>200,links});
}catch(e){return fail(e);}}
export async function POST(req){try{
 checkOrigin(req);const ctx=await authorize(req),raw=await req.text();if(raw.length>240000)throw Error('413:Lesson request is too large');let b;try{b=JSON.parse(raw);}catch{throw Error('400:Invalid lesson request');}
 if(['createSchoolLink','revokeSchoolLink'].includes(b.action))return send(await share(ctx,req,b));
 if(b.action==='prepare')return send(await prepare(req,ctx,b));
 if(b.action==='commit')return send(await commit(ctx,b));
 if(b.action==='lesson')return send({lesson:decorateLesson(req,ctx,await getLesson(ctx,b.id))});
 if(b.action==='review'){
  if(!ctx.canFeedback)throw Error('403:Teacher implementation review and feedback permissions are required');if(!UUID.test(b.id||'')||!['reviewed','needs_follow_up'].includes(b.status)||!Number.isInteger(b.version)||typeof b.feedback!=='string'||b.feedback.length>4000||b.status==='needs_follow_up'&&!b.feedback.trim())throw Error('400:Add a valid review status and feedback');
  await getLesson(ctx,b.id);return send(await checked(ctx.db.rpc('literacy_review_teacher_lesson',{p_id:b.id,p_school:ctx.schoolId,p_reviewer:ctx.user.id,p_version:b.version,p_status:b.status,p_feedback:b.feedback.trim()})));
 }
 throw Error('400:Unsupported teacher portal action');
}catch(e){return fail(e);}}
