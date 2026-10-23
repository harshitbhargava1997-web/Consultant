import {createClient} from '@supabase/supabase-js';
import {isConfirmedUser} from '@/lib/auth';
import {loadOverviewTotals} from '@/lib/overview';
import {readModuleGrant} from '@/lib/school-success/module-access';
export const dynamic='force-dynamic';
export const runtime='nodejs';
async function checked(query){const {data,error}=await query;if(error)throw Error('Workspace database request failed');return data;}
export async function GET(req){
 const started=performance.now();
 try{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  if(!token)return Response.json({error:'Sign in required'},{status:401});
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Workspace service is not configured');
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await db.auth.getUser(token);
  if(error||!isConfirmedUser(user))return Response.json({error:'Invalid or expired session'},{status:401});
  if(user.app_metadata?.must_change_password)return Response.json({error:'Change your initial password first'},{status:403});
  const authDone=performance.now();
  const [admin,profile,memberships,assignments,module]=await Promise.all([
   checked(db.from('literacy_platform_admins').select('user_id').eq('user_id',user.id).maybeSingle()),
   checked(db.from('literacy_consultants').select('user_id').eq('user_id',user.id).maybeSingle()),
   checked(db.from('literacy_memberships').select('school_id,role,user_id,display_name').eq('user_id',user.id)),
   checked(db.from('literacy_consultant_assignments').select('school_id').eq('consultant_user_id',user.id)),
   checked(db.from('success_config').select('value').eq('key','moduleAccess:'+user.id).maybeSingle())
  ]);
  const isAdmin=Boolean(admin),consultantSchools=!isAdmin&&profile?assignments.map(a=>a.school_id):[];
  const ids=[...new Set([...memberships.map(m=>m.school_id),...consultantSchools])];
  const roles=[...new Set([...memberships.map(m=>m.role),...consultantSchools.length?['consultant']:[]])];
  let schoolQuery=db.from('literacy_schools').select('id,name').is('archived_at',null).order('name');if(!isAdmin)schoolQuery=schoolQuery.in('id',ids);
  const [schools,grants,archivedSchools]=await Promise.all([
   isAdmin||ids.length?checked(schoolQuery):[],
   !isAdmin&&roles.length?checked(db.from('literacy_role_permissions').select('role,feature').in('role',roles).eq('enabled',true)):[],
   isAdmin?checked(db.from('literacy_schools').select('id,name,archived_at').not('archived_at','is',null).order('name')):[]
  ]);
  const permissionsByRole=Object.fromEntries(roles.map(role=>[role,grants.filter(g=>g.role===role).map(g=>g.feature)]));
  const activeIds=new Set(schools.map(s=>s.id));
  const signed=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{
   global:{headers:{Authorization:'Bearer '+token}},auth:{persistSession:false,autoRefreshToken:false}
  });
  let overview=null,overviewError='';
  try{overview=await loadOverviewTotals(signed,{isAdmin,schoolIds:[...activeIds]});}
  catch{overviewError='Overview totals could not be loaded. Please refresh.';}
  return Response.json({admin:isAdmin,isConsultant:Boolean(profile),consultantSchools:consultantSchools.filter(id=>activeIds.has(id)),memberships:memberships.filter(m=>activeIds.has(m.school_id)),schools,archivedSchools,overview,overviewError,permissionsByRole,successAccess:isAdmin||Boolean(readModuleGrant(module?.value,user.id))},{headers:{'Cache-Control':'no-store','Server-Timing':`auth;dur=${(authDone-started).toFixed(1)}, data;dur=${(performance.now()-authDone).toFixed(1)}, total;dur=${(performance.now()-started).toFixed(1)}`}});
 }catch(e){return Response.json({error:e.message||'Workspace unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
