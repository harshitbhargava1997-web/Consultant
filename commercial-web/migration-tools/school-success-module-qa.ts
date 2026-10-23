// Temporary, expiring fixture service. No customer accounts or Vision schools are changed.
const base=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const expected='TRANSFER_HASH',expires='TRANSFER_EXPIRY';
const h={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
async function api(path:string,method='GET',body?:unknown){const r=await fetch(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error('QA fixture error '+r.status+': '+(await r.text()).slice(0,150));const t=await r.text();return t?JSON.parse(t):null;}
async function nativeSnapshot(){const result:Record<string,unknown>={};for(const table of ['literacy_schools','literacy_memberships','literacy_teacher_lessons','literacy_teacher_portal_links','success_school_mappings','success_teacher_mappings'])result[table]=await api('/rest/v1/'+table+'?select=*');return result;}
Deno.serve(async req=>{try{
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');if(actual!==expected||Date.now()>Date.parse(expires))return Response.json({error:'Unauthorized'},{status:403});const b=await req.json();if(!/^[a-f0-9-]{36}$/.test(b.runId))throw Error('Invalid QA run');
 const stateKey='qa:'+b.runId;
 if(b.action==='setup'){
  const old=await api('/rest/v1/success_import_state?key=eq.'+stateKey+'&select=value');if(old.length)throw Error('QA run already exists');
  const schools=['A','B'].map(s=>({name:'School Success QA '+b.runId+' '+s})),users:Record<string,any>={},baseline=await nativeSnapshot();
  for(const role of ['admin','consultant','teacher','otherTeacher']){const email='vision-qa-'+role.toLowerCase()+'-'+b.runId+'@example.invalid',password=crypto.randomUUID()+'Aa9!';const user=await api('/auth/v1/admin/users','POST',{email,password,email_confirm:true,app_metadata:{success_module_qa:b.runId},user_metadata:{full_name:role==='teacher'?'QA Teacher A':role==='otherTeacher'?'QA Teacher B':'QA '+role}});users[role]={id:user.id,email,password};}
  await api('/rest/v1/success_import_state','POST',{key:stateKey,value:{schools,users:Object.values(users).map((u:any)=>({id:u.id,email:u.email})),runId:b.runId,baseline}});
  await api('/rest/v1/literacy_platform_admins','POST',{user_id:users.admin.id});
  await api('/rest/v1/success_members','POST',[{email:users.teacher.email,role:'teacher',school:schools[0].name,name:'QA Teacher A'},{email:users.otherTeacher.email,role:'teacher',school:schools[1].name,name:'QA Teacher B'}]);
  for(const u of Object.values(users) as any[]){const session=await api('/auth/v1/token?grant_type=password','POST',{email:u.email,password:u.password});u.token=session.access_token;delete u.password;}
  return Response.json({schools,users});
 }
 const saved=await api('/rest/v1/success_import_state?key=eq.'+stateKey+'&select=value');if(!saved[0])throw Error('QA run not found');const {schools,users,baseline}=saved[0].value;
 if(b.action==='isolation')return Response.json({unchanged:JSON.stringify(await nativeSnapshot())===JSON.stringify(baseline)});
 if(b.action==='resume'){
  const sessions:Record<string,any>={};for(const u of users){const current=await api('/auth/v1/admin/users/'+u.id);if(current.app_metadata?.success_module_qa!==b.runId)throw Error('QA identity mismatch');const role=u.email.includes('otherteacher')?'otherTeacher':u.email.includes('consultant')?'consultant':u.email.includes('teacher')?'teacher':'admin';const link=await api('/auth/v1/admin/generate_link','POST',{type:'magiclink',email:u.email}),session=await api('/auth/v1/verify','POST',{type:'magiclink',token_hash:link.hashed_token});sessions[role]={...u,token:session.access_token};}return Response.json({schools,users:sessions});
 }
 if(b.action==='cleanup'){
  for(const s of schools){if(!s.name.startsWith('School Success QA '+b.runId+' '))throw Error('Refusing non-QA school');const query='?school=eq.'+encodeURIComponent(s.name);
   await api('/rest/v1/teacher_records?Center=eq.'+encodeURIComponent(s.name),'DELETE');for(const t of ['portal_call_logs','portal_tickets','portal_contacts','portal_evidence_reviews','classroom_observations'])await api('/rest/v1/'+t+query,'DELETE');await api('/rest/v1/success_members'+query,'DELETE');
   const tokenRows=await api('/rest/v1/success_config?key=eq.'+encodeURIComponent('schoolLinkToken:'+s.name)+'&select=value');for(const row of tokenRows)await api('/rest/v1/success_config?key=eq.'+encodeURIComponent('schoolLink:'+row.value),'DELETE');await api('/rest/v1/success_config?key=eq.'+encodeURIComponent('schoolLinkToken:'+s.name),'DELETE');
  }
  await api('/rest/v1/success_config?key=like.'+encodeURIComponent('directoryArchive:%'+b.runId+'%'),'DELETE');await api('/rest/v1/success_config?key=eq.'+encodeURIComponent('crmTemplate:qa-'+b.runId),'DELETE');
  for(const u of users){const user=await api('/auth/v1/admin/users/'+u.id);if(user.app_metadata?.success_module_qa!==b.runId)throw Error('Refusing to delete a non-QA user');await api('/rest/v1/success_config?key=eq.'+encodeURIComponent('moduleAccess:'+u.id),'DELETE');await api('/rest/v1/portal_import_runs?actor=eq.'+encodeURIComponent(u.email),'DELETE');await api('/rest/v1/success_audit?actor=eq.'+encodeURIComponent(u.email),'DELETE');await api('/rest/v1/literacy_platform_admins?user_id=eq.'+u.id,'DELETE');await api('/auth/v1/admin/users/'+u.id,'DELETE');}
  await api('/rest/v1/success_import_state?key=eq.'+stateKey,'DELETE');return Response.json({ok:true});
 }
 throw Error('Unsupported action');
}catch(e){return Response.json({error:String((e as Error).message)},{status:400})}});
