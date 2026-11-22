import {z} from 'zod';
import {withRequest,actor,database,checkOrigin,failure} from '@/lib/school-success/server';
import {service,checked} from '@/lib/school-success/database';
import {moduleGrantSchema} from '@/lib/school-success/module-access';
import {moduleSchools} from '@/lib/school-success/module-schools';
import {normalizePhone} from '@/lib/auth';
export const runtime='nodejs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
// School leaders (principals and coordinators) managed by Super Admin from School Success → Schools & teachers.
// Adding a leader creates a mobile-number sign-in (or reuses an existing account with that mobile number) and grants
// School leader access to that school. A starting password must be replaced at first sign-in (Vision's existing
// first-login screen). Accounts created here are marked so that only they can have their password reset here.
const text=z.string().trim();
const body=z.discriminatedUnion('action',[
 z.object({action:z.literal('list'),school:text.min(1).max(1000)}),
 z.object({action:z.literal('add'),school:text.min(1).max(1000),name:text.min(2).max(160),title:z.enum(['Principal','Coordinator','School management']),mobile:text.min(10).max(20),password:z.string().min(6).max(128)}),
 z.object({action:z.literal('reset'),school:text.min(1).max(1000),userId:z.string().uuid(),password:z.string().min(6).max(128)}),
 z.object({action:z.literal('remove'),school:text.min(1).max(1000),userId:z.string().uuid()})
]);
const digits=p=>String(p||'').replace(/\D/g,'');
async function grants(){
 const rows=await checked(service().from('success_config').select('key,value').like('key','moduleAccess:%'));
 return new Map(rows.map(r=>{try{const g=moduleGrantSchema.parse(JSON.parse(r.value));return [g.userId,g];}catch{return null;}}).filter(Boolean));
}
async function saveGrant(grant,a,action){
 const db=database(),key='moduleAccess:'+grant.userId,now=new Date().toISOString();
 await db.batch([
  db.prepare('INSERT INTO portal_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify({...moduleGrantSchema.parse(grant),updatedAt:now,updatedBy:a.userId})),
  db.prepare('INSERT INTO portal_audit(id,actor,action,record,created) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),a.email,action,key,now)
 ]);
}
async function userByPhone(phone){
 const want=digits(phone);
 for(let page=1;;page++){
  const {data,error}=await service().auth.admin.listUsers({page,perPage:1000});
  if(error)throw Error('503:Could not check existing accounts');
  const hit=data.users.find(u=>u.phone&&digits(u.phone)===want);
  if(hit||data.users.length<1000)return hit||null;
 }
}
const statusOf=u=>u?.app_metadata?.must_change_password?'Waiting for first sign-in':'Active';
async function handlePOST(req){
 try{
  checkOrigin(req);
  const a=await actor(req);
  if(!a.isSuperAdmin)throw Error('403:Only Super Admin can manage school leaders');
  let input;try{input=body.parse(await req.json());}catch(e){throw Error(e?.issues?.[0]?.message?'Check the name, role, mobile number and starting password (at least 6 characters).':'Invalid request');}
  if(!(await moduleSchools()).includes(input.school))throw Error('Choose a school from the School Success directory');
  const auth=service().auth.admin,all=await grants();
  if(input.action==='list'){
   const leaders=[];
   for(const g of all.values()){
    if(!g.enabled||g.role!=='leader'||!g.schools.includes(input.school))continue;
    const {data}=await auth.getUserById(g.userId);const u=data?.user;
    leaders.push({userId:g.userId,name:u?.user_metadata?.full_name||'',mobile:u?.phone?'+'+digits(u.phone):'',email:u?.email||'',title:g.title||'',status:u?statusOf(u):'Account missing',managed:Boolean(u?.app_metadata?.school_success_leader)});
   }
   leaders.sort((x,y)=>(x.title+x.name).localeCompare(y.title+y.name));
   return Response.json({school:input.school,leaders},{headers});
  }
  if(input.action==='add'){
   const phone=normalizePhone(input.mobile);
   if(!phone)throw Error('Enter a valid 10-digit mobile number');
   let user=await userByPhone(phone),created=false;
   if(user){
    const admin=await checked(service().from('literacy_platform_admins').select('user_id').eq('user_id',user.id).maybeSingle());
    const g=all.get(user.id);
    if(admin)throw Error('409:This mobile number belongs to a Super Admin account.');
    if(g?.enabled&&g.role!=='leader')throw Error('409:This mobile number already has consultant access to School Success.');
   }else{
    const made=await auth.createUser({phone,phone_confirm:true,password:input.password,user_metadata:{full_name:input.name},app_metadata:{must_change_password:true,school_success_leader:true}});
    if(made.error)throw Error(/password/i.test(made.error.message||'')?'The sign-in service rejected this starting password. Try a longer one.':'409:Could not create the sign-in for this mobile number.');
    user=made.data.user;created=true;
   }
   const g=all.get(user.id),schools=[...new Set([...(g?.enabled&&g.role==='leader'?g.schools:[]),input.school])];
   try{await saveGrant({userId:user.id,enabled:true,schools,role:'leader',title:input.title},a,'grant-school-leader');}
   catch(e){if(created)await auth.deleteUser(user.id);throw e;}
   return Response.json({ok:true,created,status:statusOf(user)},{headers});
  }
  const g=all.get(input.userId);
  if(!g?.enabled||g.role!=='leader'||!g.schools.includes(input.school))throw Error('403:Choose a school leader of this school');
  if(input.action==='reset'){
   const {data}=await auth.getUserById(input.userId);const u=data?.user;
   if(!u?.app_metadata?.school_success_leader)throw Error('403:This sign-in was not created here. Reset its password where it was created.');
   const {error}=await auth.updateUserById(u.id,{password:input.password,app_metadata:{...u.app_metadata,must_change_password:true}});
   if(error)throw Error(/password/i.test(error.message||'')?'The sign-in service rejected this starting password. Try a longer one.':'503:Password could not be reset');
   await saveGrant(g,a,'reset-school-leader-password');
   return Response.json({ok:true},{headers});
  }
  // remove: this school only; the sign-in itself is kept (it may be used elsewhere).
  const schools=g.schools.filter(s=>s!==input.school);
  await saveGrant({...g,enabled:schools.length>0,schools},a,'revoke-school-leader');
  return Response.json({ok:true},{headers});
 }catch(e){return failure(e);}
}
export async function POST(req){return withRequest(req,()=>handlePOST(req));}
