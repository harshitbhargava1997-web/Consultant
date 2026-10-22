// Temporary test-account service. Removed after verification; no customer account is changed.
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const expected='TRANSFER_HASH',expires='TRANSFER_EXPIRY';
const h={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
async function api(path:string,method='GET',body?:unknown){const r=await fetch(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error('QA fixture error '+r.status+': '+(await r.text()).slice(0,150));const t=await r.text();return t?JSON.parse(t):null;}
Deno.serve(async req=>{try{
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');if(actual!==expected||Date.now()>Date.parse(expires))return Response.json({error:'Unauthorized'},{status:403});const b=await req.json();if(!/^[a-f0-9-]{36}$/.test(b.runId))throw Error('Invalid QA run');
 if(b.action==='setup'){
  const old=await api('/rest/v1/success_import_state?key=eq.qa:'+b.runId+'&select=value');if(old.length)throw Error('QA run already exists');
  const schools=[{id:crypto.randomUUID(),name:'Vision QA '+b.runId+' A'},{id:crypto.randomUUID(),name:'Vision QA '+b.runId+' B'}];const users:Record<string,any>={};
  await api('/rest/v1/literacy_schools','POST',schools);
  for(const role of ['admin','consultant','teacher','otherTeacher']){const email='vision-qa-'+role.toLowerCase()+'-'+b.runId+'@example.invalid',password=crypto.randomUUID()+'Aa9!';const user=await api('/auth/v1/admin/users','POST',{email,password,email_confirm:true,app_metadata:{vision_integration_qa:b.runId}});users[role]={id:user.id,email,password};}
  await api('/rest/v1/literacy_platform_admins','POST',{user_id:users.admin.id});
  await api('/rest/v1/literacy_memberships','POST',[{school_id:schools[0].id,user_id:users.teacher.id,display_name:'QA Teacher A',role:'teacher'},{school_id:schools[1].id,user_id:users.otherTeacher.id,display_name:'QA Teacher B',role:'teacher'}]);
  await api('/rest/v1/literacy_consultant_assignments','POST',{school_id:schools[0].id,consultant_user_id:users.consultant.id});
  await api('/rest/v1/success_school_mappings','POST',schools.map(s=>({source_school:s.name,vision_school_id:s.id,approved_by:users.admin.id})));
  await api('/rest/v1/success_teacher_mappings','POST',[{source_school:schools[0].name,source_teacher:'QA Teacher A',vision_user_id:users.teacher.id,approved_by:users.admin.id},{source_school:schools[1].name,source_teacher:'QA Teacher B',vision_user_id:users.otherTeacher.id,approved_by:users.admin.id}]);
  await api('/rest/v1/success_members','POST',[{email:users.teacher.email,role:'teacher',school:schools[0].name,name:'QA Teacher A'},{email:users.otherTeacher.email,role:'teacher',school:schools[1].name,name:'QA Teacher B'}]);
  await api('/rest/v1/success_import_state','POST',{key:'qa:'+b.runId,value:{schools,users:Object.values(users).map((u:any)=>({id:u.id,email:u.email})),runId:b.runId}});
  for(const u of Object.values(users) as any[]){const session=await api('/auth/v1/token?grant_type=password','POST',{email:u.email,password:u.password});u.token=session.access_token;}
  return Response.json({schools,users});
 }
 if(b.action==='cleanup'){
  const saved=await api('/rest/v1/success_import_state?key=eq.qa:'+b.runId+'&select=value');if(!saved[0])return Response.json({ok:true,absent:true});const {schools,users}=saved[0].value;
  for(const s of schools){const query='?school=eq.'+encodeURIComponent(s.name);await api('/rest/v1/teacher_records?Center=eq.'+encodeURIComponent(s.name),'DELETE');for(const t of ['portal_call_logs','portal_tickets','portal_contacts','portal_evidence_reviews','portal_import_runs','classroom_observations']){if(t==='portal_import_runs')continue;await api('/rest/v1/'+t+query,'DELETE');}await api('/rest/v1/success_members'+query,'DELETE');await api('/rest/v1/success_teacher_mappings?source_school=eq.'+encodeURIComponent(s.name),'DELETE');await api('/rest/v1/success_school_mappings?source_school=eq.'+encodeURIComponent(s.name),'DELETE');await api('/rest/v1/success_config?key=like.'+encodeURIComponent('directoryArchive:%'+b.runId+'%'),'DELETE');await api('/rest/v1/literacy_consultant_assignments?school_id=eq.'+s.id,'DELETE');await api('/rest/v1/literacy_memberships?school_id=eq.'+s.id,'DELETE');await api('/rest/v1/literacy_schools?id=eq.'+s.id,'DELETE');}
  for(const u of users){const user=await api('/auth/v1/admin/users/'+u.id);if(user.app_metadata?.vision_integration_qa!==b.runId)throw Error('Refusing to delete a non-QA user');await api('/rest/v1/literacy_platform_admins?user_id=eq.'+u.id,'DELETE');await api('/auth/v1/admin/users/'+u.id,'DELETE');}
  await api('/rest/v1/success_import_state?key=eq.qa:'+b.runId,'DELETE');return Response.json({ok:true});
 }
 throw Error('Unsupported action');
}catch(e){return Response.json({error:String((e as Error).message)},{status:400})}});
