import {withRequest,actor,checkOrigin,failure,assertSchool,schoolTeachers} from '@/lib/school-success/server';
import {service} from '@/lib/school-success/database';
import {configStore,readPin,pinStatus,resetPin,setDefaultPin,hasCustomDefault} from '@/lib/school-success/teacher-pin';
export const runtime='nodejs';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
// Teacher PIN administration for School Success administrators with access to the school.
//   list       {school}                 → teachers with PIN status (never the PIN itself)
//   reset      {school, teacher}        → back to the default PIN ("forgot PIN"); signs the teacher out everywhere
//   setDefault {school, pin}            → default PIN for teachers of this school who have not created their own
async function handlePOST(req){
 try{
  checkOrigin(req);
  const a=await actor(req);
  if(a.role!=='admin')throw Error('403:School Success administrators only');
  let body;try{body=await req.json();}catch{throw Error('Invalid request');}
  const school=typeof body.school==='string'?body.school:'';assertSchool(a,school);
  const store=configStore(service()),teachers=await schoolTeachers(school);
  if(body.action==='list'){
   const rows=await Promise.all(teachers.map(async teacher=>{const {record}=await readPin(store,school,teacher);return {teacher,status:pinStatus(record),updatedAt:record?.updatedAt||null,resetBy:record?.status==='reset'?record.updatedBy||null:null};}));
   return Response.json({school,customDefault:await hasCustomDefault(store,school),teachers:rows},{headers:noStore});
  }
  if(body.action==='reset'){
   if(!teachers.includes(body.teacher))throw Error('403:Choose a teacher of this school');
   await resetPin({store,school,teacher:body.teacher,by:a.email});
   return Response.json({ok:true},{headers:noStore});
  }
  if(body.action==='setDefault'){
   await setDefaultPin({store,school,pin:String(body.pin||''),by:a.email});
   return Response.json({ok:true,customDefault:await hasCustomDefault(store,school)},{headers:noStore});
  }
  throw Error('Unsupported request');
 }catch(e){return failure(e);}
}
export async function POST(req){return withRequest(req,()=>handlePOST(req));}
