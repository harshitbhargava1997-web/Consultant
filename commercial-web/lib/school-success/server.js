import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {service,checked,localDatabase} from './database';
import {loadArchives,isArchived} from './directory';
import {schoolLinkIdentity} from './teacher-flow';
import {activeTeacherNames,readModuleGrant} from './module-access';
const context=new AsyncLocalStorage();
export function withRequest(request,run){return context.run({request},run);}
export function database(){return localDatabase();}
export async function actor(req){
 const state=context.getStore();req=req||state?.request;if(!req)throw Error('401:Sign in through Vision');
 if(state?.actor)return state.actor;
 const identity=await identify(req);if(state)state.actor=identity;return identity;
}
export async function sessionIdentity(req){
 const db=service(),token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
 if(!token)throw Error('401:Sign in to Vision to open the School Success folder');
 const {data:{user},error}=await db.auth.getUser(token);
 if(error||!user||!(user.email_confirmed_at||user.phone_confirmed_at))throw Error('401:Vision session expired');
 if(user.app_metadata?.must_change_password)throw Error('403:Change your initial Vision password first');
 const admin=await checked(db.from('literacy_platform_admins').select('user_id').eq('user_id',user.id).maybeSingle());
 return {user,isSuperAdmin:Boolean(admin)};
}
export async function schoolTeachers(school,archives){
 const db=service();
 const [roster,members,flags]=await Promise.all([
  checked(db.rpc('school_success_school_roster',{p_school:school})),
  checked(db.from('success_members').select('school,name,role').eq('school',school)),
  archives?Promise.resolve(archives):loadArchives(database())
 ]);
 return activeTeacherNames(roster,members,school,flags);
}
async function identify(req){
 const db=service(),url=new URL(req.url),access=req.headers.get('X-School-Link')||url.searchParams.get('access');
 if(access){
  if(!/^[a-f0-9-]{36}$/i.test(access))throw Error('403:Invalid school link');
  const saved=await checked(db.from('success_config').select('value').eq('key','schoolLink:'+access).maybeSingle());
  if(!saved)throw Error('403:Invalid school link');
  const link=JSON.parse(saved.value),archives=await loadArchives(database());
  if(link.scope!=='school-success')throw Error('403:Ask School Success management for a fresh school link');
  if(isArchived(archives,link.school))throw Error('403:This school is archived');
  link.teachers=await schoolTeachers(link.school,archives);
  const selected=req.headers.has('X-Teacher')?decodeURIComponent(req.headers.get('X-Teacher')):url.searchParams.get('teacher')||'';
  const identity=schoolLinkIdentity(link,selected);
  const fingerprint=createHash('sha256').update(access+'\0'+identity.name).digest('hex').slice(0,32);
  return {...identity,email:'school-link-'+fingerprint+'@school-portal.invalid',role:'school-teacher',visionRole:'public',anonymous:true,isSuperAdmin:false,allowedSchools:[link.school]};
 }
 const {user,isSuperAdmin}=await sessionIdentity(req);
 const saved=isSuperAdmin?null:await checked(db.from('success_config').select('value').eq('key','moduleAccess:'+user.id).maybeSingle());
 const grant=readModuleGrant(saved?.value,user.id);
 if(!isSuperAdmin&&!grant)throw Error('403:Ask Super Admin to assign your School Success module access');
 return {email:user.email||user.phone,name:user.user_metadata?.full_name||user.email||user.phone||'Administrator',role:'admin',visionRole:isSuperAdmin?'super_admin':'consultant',isSuperAdmin,userId:user.id,school:'',allowedSchools:isSuperAdmin?null:grant.schools};
}
export function assertSchool(a,school){if(!school||a.allowedSchools&&!a.allowedSchools.includes(school))throw Error('403:School is outside your assignment');}
export function checkOrigin(req){const o=req.headers.get('Origin');if(o&&o!==new URL(req.url).origin)throw Error('403:Cross-origin request rejected');}
export function streamJson(data,init={}){const bytes=new TextEncoder().encode(JSON.stringify(data));let offset=0;return new Response(new ReadableStream({pull(controller){if(offset>=bytes.length){controller.close();return;}controller.enqueue(bytes.subarray(offset,offset+32768));offset+=32768;}}),{...init,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...init.headers}});}
export function failure(e){const message=String(e.message||e),status=Number(message.match(/^(401|403|409|413|503):/)?.[1]||400);return Response.json({error:message.replace(/^\d+:/,'')},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
