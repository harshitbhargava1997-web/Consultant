import {z} from 'zod';

export const GRADES=['Nursery','LKG','UKG','Grade 1','Grade 2','Grade 3','Grade 4','Grade 5'];
export const SUBJECTS=['Phonics / Literacy','Reading','Writing','English','Hindi'];
export const CATEGORIES={lesson_plan:'Lesson preparation PDF',voice:'Voice reflection',activity:'Classroom activity',writing:'Student written work',phonics:'Phonics / literacy',portfolio:'Student portfolio',event_pictures:'Event pictures'};
export const BUCKET='vision-implementation';
export const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
export const validDay=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Choose a valid lesson date');
const period=z.object({id:z.string().uuid(),classId:z.string().uuid(),subject:z.enum(SUBJECTS),topic:z.string().trim().min(2).max(1000),competencyIds:z.array(z.string().uuid()).min(1,'Select a literacy competency').max(30),reflection:z.string().trim().min(1,'Add your lesson planning notes').max(5000),materials:z.string().max(2000).default('')});
export const draftSchema=z.object({id:z.string().uuid(),date:validDay,periods:z.array(period).min(1).max(10),preparationMinutes:z.number().min(0).max(480).default(0)}).superRefine((s,ctx)=>{if(new Set(s.periods.map(p=>p.id)).size!==s.periods.length)ctx.addIssue({code:'custom',message:'Each class period needs its own identity'});});
export const filesSchema=z.array(z.object({id:z.string().uuid(),periodId:z.string().uuid(),category:z.enum(Object.keys(CATEGORIES)),name:z.string().min(1).max(250),size:z.number().int().positive().max(50*1024*1024)})).max(50).superRefine((files,ctx)=>{if(new Set(files.map(f=>f.id)).size!==files.length)ctx.addIssue({code:'custom',message:'File identities must be unique'});if(files.reduce((n,f)=>n+f.size,0)>100*1024*1024)ctx.addIssue({code:'custom',message:'Use at most 100 MB per submission'});});
export function fileType(file){
 const ext=file.name.split('.').at(-1)?.toLowerCase();
 const types={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp4:'video/mp4',mov:'video/quicktime',webm:file.category==='voice'?'audio/webm':'video/webm',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg'};
 const type=types[ext];if(!type||file.category==='voice'&&!type.startsWith('audio/')||file.category==='lesson_plan'&&type!=='application/pdf')throw Error('Use a supported photo, audio, video or PDF in its matching category');
 return {ext,type};
}
export function scopeDraft(raw,classes,competencies){
 const draft=draftSchema.parse(raw),byClass=new Map(classes.map(c=>[c.id,c])),byComp=new Map(competencies.filter(c=>c.active).map(c=>[c.id,c]));
 return {...draft,periods:draft.periods.map(p=>{
  const cls=byClass.get(p.classId);if(!cls)throw Error('Choose a class assigned to this teacher');
  const ids=[...new Set(p.competencyIds)],selected=ids.map(id=>byComp.get(id));
  if(selected.some(c=>!c||GRADES.indexOf(c.grade)<0||GRADES.indexOf(c.grade)>GRADES.indexOf(cls.grade)))throw Error('Choose published competencies at or before the selected class level');
  return {...p,competencyIds:ids,grade:cls.grade,section:cls.section,competencies:selected.map(c=>({id:c.id,code:c.code,title:c.title,grade:c.grade}))};
 })};
}
export function lessonFiles(lesson){return [...(lesson.preparation_files||[]),...(lesson.evidence_updates||[]).flatMap(u=>u.files||[])];}
export function latestReview(lesson){return (lesson.reviews||[]).filter(r=>r.version===lesson.version).at(-1)||null;}
export function lessonStage(lesson){return lesson.evidence_updates?.length?'Evidence submitted':'Preparation saved';}
export function visionImplementationSummary(lessons,teacherId){
 const own=lessons.filter(l=>l.teacher_user_id===teacherId),records=[];
 for(const l of own){for(const p of l.periods){const updates=(l.evidence_updates||[]).filter(u=>u.files.some(f=>f.periodId===p.id));if(!updates.length)continue;const counts={};for(const f of lessonFiles(l).filter(f=>f.periodId===p.id))counts[f.category]=(counts[f.category]||0)+1;
  records.push({id:p.id,class_id:p.classId,teacher_user_id:l.teacher_user_id,implementation_date:updates.at(-1).conductedOn,subject:p.subject,lesson_topic:p.topic,submitted_at:updates.at(-1).submittedAt,files:counts,review:latestReview(l),source:'vision_teacher_portal',lesson_id:l.id});
 }}
 return {preparationSessions:own.length,preparedPeriods:own.reduce((n,l)=>n+l.periods.length,0),preparationMinutes:Math.round(own.reduce((n,l)=>n+Number(l.preparation_minutes||0),0)*100)/100,records};
}
