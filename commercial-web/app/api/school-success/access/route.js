import {withRequest,sessionIdentity,actor,database,checkOrigin,failure} from '@/lib/school-success/server';
import {service,checked} from '@/lib/school-success/database';
import {moduleGrantSchema,readModuleGrant} from '@/lib/school-success/module-access';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
async function moduleSchools(){
 const db=service();
 const [roster,members,local,archives]=await Promise.all([
  checked(db.rpc('school_success_roster')),
  checked(db.from('success_members').select('school')),
  checked(db.from('success_entries').select('school').eq('kind','school')),
  checked(db.from('success_config').select('value').like('key','directoryArchive:%'))
 ]);
 return [...new Set([...roster,...members,...local,...archives.map(r=>JSON.parse(r.value))].map(r=>r.school).filter(Boolean))].sort();
}
export async function GET(req){return withRequest(req,async()=>{try{
 const {user,isSuperAdmin}=await sessionIdentity(req),db=service();
 const saved=isSuperAdmin?null:await checked(db.from('success_config').select('value').eq('key','moduleAccess:'+user.id).maybeSingle());
 const grant=readModuleGrant(saved?.value,user.id);
 if(new URL(req.url).searchParams.get('manage')!=='1')return Response.json({allowed:isSuperAdmin||Boolean(grant),isSuperAdmin},{headers});
 if(!isSuperAdmin)throw Error('403:Super Admin access required');
 const users=[];
 for(let page=1;;page++){
  const {data,error}=await db.auth.admin.listUsers({page,perPage:1000});
  if(error)throw Error('503:Could not load user accounts');
  users.push(...data.users.filter(u=>u.email_confirmed_at||u.phone_confirmed_at).map(u=>({id:u.id,label:u.email||u.phone||u.id,name:u.user_metadata?.full_name||''})));
  if(data.users.length<1000)break;
 }
 const assignments=(await checked(db.from('success_config').select('value').like('key','moduleAccess:%'))).map(r=>{try{return moduleGrantSchema.parse(JSON.parse(r.value));}catch{return null;}}).filter(Boolean);
 return Response.json({users,assignments,schools:await moduleSchools()},{headers});
}catch(e){return failure(e);}});}
export async function POST(req){return withRequest(req,async()=>{try{
 checkOrigin(req);const a=await actor(req);if(!a.isSuperAdmin)throw Error('403:Super Admin access required');
 const grant=moduleGrantSchema.parse(await req.json());
 const {data,error}=await service().auth.admin.getUserById(grant.userId);
 if(error||!data.user||!(data.user.email_confirmed_at||data.user.phone_confirmed_at))throw Error('Choose an existing confirmed user account');
 const schools=new Set(await moduleSchools());
 if(grant.enabled&&grant.schools.some(s=>!schools.has(s)))throw Error('Choose schools from the School Success directory');
 const db=database(),key='moduleAccess:'+grant.userId,now=new Date().toISOString();
 await db.batch([
  db.prepare('INSERT INTO portal_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,JSON.stringify({...grant,updatedAt:now,updatedBy:a.userId})),
  db.prepare('INSERT INTO portal_audit(id,actor,action,record,created) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),a.email,grant.enabled?'grant-module-access':'revoke-module-access',key,now)
 ]);
 return Response.json({ok:true},{headers});
}catch(e){return failure(e);}});}
