// Temporary, hash-authenticated fixture service; deployed with a short expiry and disabled after verification.
const base=Deno.env.get('SUPABASE_URL')!,secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const expected='QA_HASH',expires='QA_EXPIRY';
const headers={apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'};
async function api(path:string,method='GET',body?:unknown){const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();if(!r.ok)throw Error('Fixture '+r.status+': '+t.slice(0,180));return t?JSON.parse(t):null;}
Deno.serve(async req=>{try{
 const key=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))].map(v=>v.toString(16).padStart(2,'0')).join('');if(actual!==expected||Date.now()>Date.parse(expires))return Response.json({error:'Unauthorized'},{status:403});const b=await req.json();if(!/^[a-f0-9-]{36}$/.test(b.runId))throw Error('Invalid QA run');const prefix='Vision Literacy QA '+b.runId+' ';
 let users:Record<string,any>={},schools:any[]=[],classes:any[]=[];
 if(b.action==='setup'){
  schools=[{id:crypto.randomUUID(),name:prefix+'A'},{id:crypto.randomUUID(),name:prefix+'B'}];classes=schools.map((s,i)=>({id:crypto.randomUUID(),school_id:s.id,grade:i?'Grade 1':'Nursery',section:'A',academic_year:'2026-27'}));
  await api('/rest/v1/literacy_schools','POST',schools);await api('/rest/v1/literacy_classes','POST',classes);
  for(const role of ['admin','principal','teacher','otherTeacher']){const email='vision-native-'+role.toLowerCase()+'-'+b.runId+'@example.invalid',password=crypto.randomUUID()+'Ab9!';const u=await api('/auth/v1/admin/users','POST',{email,password,email_confirm:true,app_metadata:{vision_teacher_qa:b.runId,qa_schools:schools,qa_classes:classes,qa_role:role}});users[role]={id:u.id,email};}
  await api('/rest/v1/literacy_platform_admins','POST',{user_id:users.admin.id});
  await api('/rest/v1/literacy_memberships','POST',[{school_id:schools[0].id,user_id:users.principal.id,role:'principal',display_name:'QA Principal'},{school_id:schools[0].id,user_id:users.teacher.id,role:'teacher',display_name:'QA Literacy Teacher A'},{school_id:schools[1].id,user_id:users.otherTeacher.id,role:'teacher',display_name:'QA Literacy Teacher B'}]);
  await api('/rest/v1/literacy_teacher_classes','POST',[{class_id:classes[0].id,teacher_user_id:users.teacher.id},{class_id:classes[1].id,teacher_user_id:users.otherTeacher.id}]);
 }else{
  const listed=await api('/auth/v1/admin/users?page=1&per_page=1000');for(const u of listed.users.filter((u:any)=>u.app_metadata?.vision_teacher_qa===b.runId)){users[u.app_metadata.qa_role]={id:u.id,email:u.email};schools=u.app_metadata.qa_schools;classes=u.app_metadata.qa_classes;}
 }
 if(b.action==='cleanup'){
  if(!schools.length)return Response.json({ok:true,absent:true});
  for(const school of schools){const current=await api('/rest/v1/literacy_schools?id=eq.'+school.id+'&select=id,name');if(current[0]&&!current[0].name.startsWith(prefix))throw Error('Refusing non-QA school cleanup');const lessons=await api('/rest/v1/literacy_teacher_lessons?school_id=eq.'+school.id+'&select=preparation_files,evidence_updates');const paths=[...new Set(lessons.flatMap((l:any)=>[...l.preparation_files,...l.evidence_updates.flatMap((u:any)=>u.files)]).map((f:any)=>f.path))] as string[];if(paths.some(p=>!p.startsWith('teacher-portal/'+school.id+'/')))throw Error('Refusing non-QA media cleanup');if(paths.length)await api('/storage/v1/object/vision-implementation','DELETE',{prefixes:paths});await api('/rest/v1/literacy_teacher_lessons?school_id=eq.'+school.id,'DELETE');await api('/rest/v1/literacy_teacher_portal_links?school_id=eq.'+school.id,'DELETE');for(const c of classes.filter(c=>c.school_id===school.id)){await api('/rest/v1/literacy_teacher_classes?class_id=eq.'+c.id,'DELETE');await api('/rest/v1/literacy_classes?id=eq.'+c.id,'DELETE');}await api('/rest/v1/literacy_memberships?school_id=eq.'+school.id,'DELETE');await api('/rest/v1/literacy_schools?id=eq.'+school.id,'DELETE');}
  for(const u of Object.values(users)){await api('/rest/v1/literacy_platform_admins?user_id=eq.'+u.id,'DELETE');await api('/auth/v1/admin/users/'+u.id,'DELETE');}return Response.json({ok:true});
 }
 if(!['setup','resume'].includes(b.action)||!users.admin)throw Error('QA fixture not found');
 for(const u of Object.values(users)){const grant=await api('/auth/v1/admin/generate_link','POST',{type:'magiclink',email:u.email}),session=await api('/auth/v1/verify','POST',{type:'magiclink',token_hash:grant.hashed_token});u.token=session.access_token;}
 return Response.json({users,schools,classes});
}catch(e){return Response.json({error:String((e as Error).message)},{status:400})}});
