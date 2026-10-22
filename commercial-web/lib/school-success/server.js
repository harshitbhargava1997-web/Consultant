import {AsyncLocalStorage} from 'node:async_hooks';
import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import {service,checked,localDatabase} from './database';
import {loadArchives,isArchived} from './directory';
import {schoolLinkIdentity} from './teacher-flow';
const context=new AsyncLocalStorage();
export function withRequest(request,run){return context.run({request},run);}
export function database(){return localDatabase();}
export async function actor(req){
 const state=context.getStore();req=req||state?.request;if(!req)throw Error('401:Sign in through Vision');
 if(state?.actor)return state.actor;
 const identity=await identify(req);if(state)state.actor=identity;return identity;
}
async function identify(req){
 const db=service(),url=new URL(req.url),access=req.headers.get('X-School-Link')||url.searchParams.get('access');
 if(access){
  if(!/^[a-f0-9-]{36}$/i.test(access))throw Error('403:Invalid school link');
  const saved=await checked(db.from('success_config').select('value').eq('key','schoolLink:'+access).maybeSingle());
  if(!saved)throw Error('403:Invalid school link');const link=JSON.parse(saved.value);
  const schoolMap=await checked(db.from('success_school_mappings').select('vision_school_id').eq('source_school',link.school).eq('vision_school_id',link.visionSchoolId).maybeSingle());
  if(!schoolMap)throw Error('403:This school link is no longer assigned');
  const archives=await loadArchives(database());if(isArchived(archives,link.school))throw Error('403:This school is archived');
  const maps=await checked(db.from('success_teacher_mappings').select('source_teacher,vision_user_id').eq('source_school',link.school));
  const members=await checked(db.from('literacy_memberships').select('user_id').eq('school_id',schoolMap.vision_school_id).eq('role','teacher'));
  const ids=new Set(members.map(m=>m.user_id));link.teachers=maps.filter(m=>ids.has(m.vision_user_id)&&!isArchived(archives,link.school,m.source_teacher)).map(m=>m.source_teacher);
  const identity=schoolLinkIdentity(link,decodeURIComponent(req.headers.get('X-Teacher')||url.searchParams.get('teacher')||''));
  const fingerprint=createHash('sha256').update(access+'\0'+identity.name).digest('hex').slice(0,32);
  return {...identity,email:'school-link-'+fingerprint+'@school-portal.invalid',role:'school-teacher',visionRole:'public',anonymous:true,isSuperAdmin:false,allowedSchools:[link.school],visionSchoolId:link.visionSchoolId};
 }
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)throw Error('401:Sign in to Vision to open School Success');
 const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await auth.auth.getUser(token);if(error||!user||!(user.email_confirmed_at||user.phone_confirmed_at))throw Error('401:Vision session expired');
 if(user.app_metadata?.must_change_password)throw Error('403:Change your initial Vision password first');
 const admin=await checked(db.from('literacy_platform_admins').select('user_id').eq('user_id',user.id).maybeSingle());
 const name=user.email||user.phone||'Vision user';
 if(admin)return {email:user.email||user.phone,name,role:'admin',visionRole:'super_admin',isSuperAdmin:true,userId:user.id,school:'',allowedSchools:null};
 const [assignments,memberships,permissions,mappings]=await Promise.all([
  checked(db.from('literacy_consultant_assignments').select('school_id').eq('consultant_user_id',user.id)),
  checked(db.from('literacy_memberships').select('school_id,role,display_name').eq('user_id',user.id)),
  checked(db.from('literacy_role_permissions').select('role,feature').eq('enabled',true).like('feature','school_success.%')),
  checked(db.from('success_school_mappings').select('*'))
 ]);
 const selected=req.headers.get('X-Vision-School')||url.searchParams.get('schoolId')||'';
 const consultantIds=assignments.map(a=>a.school_id);const role=consultantIds.length?'consultant':memberships.find(m=>!selected||m.school_id===selected)?.role;
 if(!permissions.some(p=>p.role===role&&p.feature==='school_success.access'))throw Error('403:School Success access is disabled for your role');
 const ids=new Set(role==='consultant'?consultantIds:memberships.filter(m=>m.role===role).map(m=>m.school_id));
 const allowed=mappings.filter(m=>ids.has(m.vision_school_id)&&(!selected||selected===m.vision_school_id));
 if(!allowed.length)throw Error('403:No assigned Vision school has an approved School Success mapping');
 if(role==='teacher'){
  const map=await checked(db.from('success_teacher_mappings').select('*').eq('vision_user_id',user.id).in('source_school',allowed.map(m=>m.source_school)));
  if(map.length!==1)throw Error('403:Choose your assigned school in Vision first');
  const member=memberships.find(m=>m.school_id===allowed.find(s=>s.source_school===map[0].source_school)?.vision_school_id);
  if(!member)throw Error('403:Teacher membership is not active');
  if(isArchived(await loadArchives(database()),map[0].source_school,map[0].source_teacher))throw Error('403:Teacher or school is archived');
  return {email:user.email||user.phone,name:map[0].source_teacher,school:map[0].source_school,role:'teacher',visionRole:role,userId:user.id,isSuperAdmin:false,allowedSchools:[map[0].source_school]};
 }
 if(role!=='consultant')throw Error('403:Administrative School Success tools are available to consultants and Super Admin');
 return {email:user.email||user.phone,name,role:'admin',visionRole:role,userId:user.id,isSuperAdmin:false,school:'',allowedSchools:allowed.map(m=>m.source_school)};
}
export function assertSchool(a,school){if(!school||a.allowedSchools&&!a.allowedSchools.includes(school))throw Error('403:School is outside your assignment');}
export function checkOrigin(req){const o=req.headers.get('Origin');if(o&&o!==new URL(req.url).origin)throw Error('403:Cross-origin request rejected');}
export function streamJson(data,init={}){const value=JSON.stringify(data),encoder=new TextEncoder();let offset=0;return new Response(new ReadableStream({pull(controller){if(offset>=value.length){controller.close();return;}controller.enqueue(encoder.encode(value.slice(offset,offset+32768)));offset+=32768;}}),{...init,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...init.headers}});}
export function failure(e){const message=String(e.message||e),status=Number(message.match(/^(401|403|409|413|503):/)?.[1]||400);return Response.json({error:message.replace(/^\d+:/,'')},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
