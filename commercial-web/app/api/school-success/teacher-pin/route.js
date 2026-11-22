import {withRequest,checkOrigin,failure,schoolLink,verifyTeacherSession} from '@/lib/school-success/server';
import {service} from '@/lib/school-success/database';
import {env} from '@/lib/school-success/environment';
import {seal,unseal} from '@/lib/school-success/r2-evidence';
import {configStore,checkPin,setPin,linkHash,pinProblem,SESSION_MS,CHANGE_TICKET_MS} from '@/lib/school-success/teacher-pin';
export const runtime='nodejs';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(body,status=200)=>Response.json(body,{status,headers:noStore});
// Teacher sign-in on a school link: the link names the school, the teacher chooses their name and enters their PIN.
//   login  {teacher, pin}                      → {session} or, with the default PIN, {mustChange, changeTicket}
//   create {teacher, changeTicket, newPin}      → {session}   (first sign-in, or after an administrator reset)
//   change {teacher, currentPin, newPin}        → {session}   (signed-in teacher; signs out other devices)
async function handlePOST(req){
 try{
  checkOrigin(req);
  const access=req.headers.get('X-School-Link')||'',link=await schoolLink(access),secret=env.SUPABASE_GATEWAY_TOKEN;
  if(!secret)throw Error('503:Teacher sign-in is not configured');
  let body;try{body=await req.json();}catch{throw Error('Invalid request');}
  const teacher=typeof body.teacher==='string'?body.teacher:'';
  if(!link.teachers.includes(teacher))throw Error('403:Choose your name from this school');
  const store=configStore(service()),school=link.school,linkId=linkHash(access);
  const session=async version=>reply({teacher,session:await seal({kind:'teacher-session',link:linkId,school,teacher,version,exp:Date.now()+SESSION_MS},secret)});
  if(body.action==='login'){
   const result=await checkPin({store,school,teacher,pin:String(body.pin||'')});
   if(!result.mustChange)return session(result.version);
   return reply({teacher,mustChange:true,changeTicket:await seal({kind:'pin-change',link:linkId,school,teacher,version:result.version,exp:Date.now()+CHANGE_TICKET_MS},secret)});
  }
  if(body.action==='create'){
   let ticket;try{ticket=await unseal(String(body.changeTicket||''),secret);}catch{throw Error('401:Sign in again with the default PIN.');}
   if(ticket.kind!=='pin-change'||ticket.link!==linkId||ticket.school!==school||ticket.teacher!==teacher)throw Error('401:Sign in again with the default PIN.');
   const problem=pinProblem(String(body.newPin||''));if(problem)throw Error(problem);
   return session(await setPin({store,school,teacher,pin:String(body.newPin),version:ticket.version,by:'teacher'}));
  }
  if(body.action==='change'){
   await verifyTeacherSession(req.headers.get('X-Teacher-Session')||'',{access,school,teacher});
   const problem=pinProblem(String(body.newPin||''));if(problem)throw Error(problem);
   const current=await checkPin({store,school,teacher,pin:String(body.currentPin||'')});
   if(current.mustChange)throw Error('401:Sign in again.');
   return session(await setPin({store,school,teacher,pin:String(body.newPin),version:current.version,by:'teacher'}));
  }
  throw Error('Unsupported request');
 }catch(e){return failure(e);}
}
export async function POST(req){return withRequest(req,()=>handlePOST(req));}
