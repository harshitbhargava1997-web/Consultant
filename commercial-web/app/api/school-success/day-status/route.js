import {withRequest,actor,checkOrigin,failure,assertSchool,schoolTeachers} from '@/lib/school-success/server';
import {dayStatuses,saveDayStatus} from '@/lib/school-success/live';
import {reviewerName,reviewerRole} from '@/lib/school-success/lesson-reviews';
import {addDays,daysBetween} from '@/lib/school-success/day-status';
export const runtime='nodejs';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
// Day status in the Planner (owner decision, 28 November 2026).
//   read {from, to [, school, teacher]} → statuses: a teacher reads their own days; School Success staff,
//                                          principals and coordinators read a school (optionally one teacher)
//   save {from, to, status, …, requestId [, school, teacher]} → a teacher marks their own day; staff, principals
//                                          and coordinators mark or correct any teacher of their school
// Who saved a status is stored by name and role only; sign-ins never leave the server.
const istToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const isDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'));
async function who(a,body){
 if(a.role==='school-teacher'){
  if(!a.name||!a.school)throw Error('403:Choose your name and enter your PIN first.');
  return {school:a.school,teacher:a.name,by:{name:a.name.slice(0,160),role:'Teacher'}};
 }
 if(a.role!=='admin')throw Error('403:School Success access required');
 const school=typeof body.school==='string'?body.school:'';assertSchool(a,school);
 return {school,teacher:typeof body.teacher==='string'?body.teacher.trim().slice(0,160):'',by:{name:reviewerName(a.name),role:reviewerRole(a)}};
}
async function handlePOST(req){
 try{
  checkOrigin(req);
  const a=await actor(req);
  let body;try{body=await req.json();}catch{throw Error('Invalid request');}
  const {school,teacher,by}=await who(a,body);
  if(body.action==='read'){
   const {from,to}=body;
   if(!isDay(from)||!isDay(to)||from>to||daysBetween(from,to)>370)throw Error('Choose the dates to show.');
   return Response.json({statuses:await dayStatuses({school,teacher,from,to})},{headers:noStore});
  }
  if(body.action==='save'){
   if(!teacher)throw Error('Choose a teacher.');
   if(a.role==='admin'&&!(await schoolTeachers(school)).includes(teacher))throw Error('403:This teacher is not on this school\'s list.');
   const {action,school:_s,teacher:_t,...input}=body,today=istToday();
   // Days from the last four months up to a year ahead.
   if(!isDay(input.from)||input.from<addDays(today,-120)||input.to>addDays(today,366))throw Error('Choose a date within the last four months or the coming year.');
   const result=await saveDayStatus({school,teacher,owner:a.email,by,input});
   const [from,to]=[input.from,input.to];
   return Response.json({...result,statuses:await dayStatuses({school,teacher,from,to})},{headers:noStore});
  }
  throw Error('Unsupported request');
 }catch(e){
  if(e?.name==='ZodError')return failure(Error(e.issues?.[0]?.message||'Please check the day you chose.'));
  return failure(e);
 }
}
export async function POST(req){return withRequest(req,()=>handlePOST(req));}
