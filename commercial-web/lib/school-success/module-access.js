import {z} from 'zod';

export const moduleGrantSchema=z.object({
 userId:z.string().uuid(),
 enabled:z.boolean(),
 schools:z.array(z.string().trim().min(1).max(1000)).max(500),
 // consultant: full staff access to the assigned schools (unchanged behaviour for existing grants).
 // leader: school principal or coordinator; their own school's reports, lesson reviews, visits and teacher PINs only.
 role:z.enum(['consultant','leader']).default('consultant'),
 // For school leaders: shown to Super Admin in School Success → Schools & teachers.
 title:z.enum(['Principal','Coordinator']).optional()
}).transform(value=>({...value,schools:[...new Set(value.schools)]})).refine(value=>!value.enabled||value.schools.length>0,'Choose at least one School Success school');

export function readModuleGrant(value,userId){
 try{
  const grant=moduleGrantSchema.parse(typeof value==='string'?JSON.parse(value):value);
  return grant.userId===userId&&grant.enabled?grant:null;
 }catch{return null;}
}

export function activeTeacherNames(roster,members,school,archives=[]){
 const archived=(teacher='')=>archives.some(r=>r.archived&&r.school===school&&(r.kind==='school'||r.kind==='teacher'&&r.teacher===teacher));
 if(archived())return [];
 return [...new Set([...roster,...members.filter(r=>r.role==='teacher')].filter(r=>r.school===school&&typeof r.name==='string'&&r.name.trim()&&!archived(r.name)).map(r=>r.name))].sort();
}
