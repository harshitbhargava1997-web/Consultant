import {BUCKET,lessonFiles} from '@/lib/teacher-portal/domain';
import {checked,database,fail,verify} from '@/lib/teacher-portal/server';
export const runtime='nodejs';
export async function GET(req){try{
 const grant=verify(new URL(req.url).searchParams.get('grant'),'vision-teacher-file'),db=database();
 if(grant.linkId){const link=await checked(db.from('literacy_teacher_portal_links').select('school_id,revoked_at').eq('id',grant.linkId).maybeSingle());if(!link||link.revoked_at||link.school_id!==grant.schoolId)throw Error('403:This teacher link is no longer active');}
 const lesson=await checked(db.from('literacy_teacher_lessons').select('*').eq('id',grant.lessonId).eq('school_id',grant.schoolId).eq('teacher_user_id',grant.teacherId).maybeSingle());
 const file=lesson&&lessonFiles(lesson).find(f=>f.id===grant.fileId&&f.path===grant.path);if(!file)throw Error('404:Lesson file not found');
 const signed=await checked(db.storage.from(BUCKET).createSignedUrl(file.path,600,{download:file.name}));
 return new Response(null,{status:302,headers:{Location:signed.signedUrl,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}catch(e){return fail(e);}}
