import {withRequest,actor,checkOrigin,failure} from '@/lib/school-success/server';
import {service,checked} from '@/lib/school-success/database';
import {env} from '@/lib/school-success/environment';
import {loadR2Config,r2Request} from '@/lib/school-success/r2-evidence';
import {localDatabase} from '@/lib/school-success/database';
import {bucketCors} from '@/lib/school-success/r2-upload';
export const runtime='nodejs';
export const maxDuration=300;
const TABLES=['portal_school_plans','classroom_observations','portal_actions','portal_action_history','portal_evidence_reviews','portal_import_runs','portal_contacts','portal_tickets','portal_call_logs','teacher_records','success_config','success_members','success_entries','success_audit','success_school_mappings','success_teacher_mappings','success_import_state'];
async function admin(req){const a=await actor(req);if(!a.isSuperAdmin)throw Error('403:Super Admin access required');return a;}
export async function GET(req){return withRequest(req,async()=>{try{
 await admin(req);const db=service();
 if(new URL(req.url).searchParams.get('download')==='database'){
  const stream=new ReadableStream({async start(controller){const enc=new TextEncoder();try{for(const table of TABLES){for(let offset=0;;offset+=500){let q=db.from(table).select('*').range(offset,offset+499);const primary=table==='portal_contacts'?'school':table==='portal_school_plans'?'school':table==='portal_evidence_reviews'?'record_id':['success_config','success_import_state'].includes(table)?'key':table==='success_members'?'email':table.startsWith('success_')&&table.includes('mappings')?'source_school':'id';q=q.order(primary);if(table==='portal_contacts')q=q.order('entity_type');if(table==='success_teacher_mappings')q=q.order('source_teacher');if(table==='success_import_state')q=q.not('key','like','qa:%');const rows=await checked(q);for(const row of rows)controller.enqueue(enc.encode(JSON.stringify({table,row})+'\n'));if(rows.length<500)break;}}controller.close();}catch(e){controller.error(e);}}});
  return new Response(stream,{headers:{'Content-Type':'application/x-ndjson','Content-Disposition':'attachment; filename="Vision-School-Success-Backup.ndjson"','Cache-Control':'no-store'}});
 }
 const [state,schools,people,schoolMappings,teacherMappings,sourceRoster,localRoster]=await Promise.all([
  checked(db.from('success_import_state').select('key,value,updated_at').neq('key','sourceSnapshot').not('key','like','legacy:%')),
  checked(db.from('literacy_schools').select('id,name').order('name')),
  checked(db.from('literacy_memberships').select('user_id,school_id,display_name,role').eq('role','teacher')),
  checked(db.from('success_school_mappings').select('*')),
  checked(db.from('success_teacher_mappings').select('*')),
  checked(db.rpc('school_success_roster',{})),
  checked(db.from('success_members').select('school,name'))
 ]);
 const roster=[...new Map([...sourceRoster,...localRoster].map(r=>[JSON.stringify([r.school,r.name]),r])).values()];
 return Response.json({state,schools,people,schoolMappings,teacherMappings,roster,tables:TABLES},{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}});}
export async function POST(req){return withRequest(req,async()=>{try{
 checkOrigin(req);const a=await admin(req),db=service(),b=await req.json();
 if(b.action==='cleanupQaMedia'){
  if(!/^[a-f0-9-]{36}$/i.test(b.runId))throw Error('Invalid verification run');
  const saved=await checked(db.from('success_import_state').select('value').eq('key','qa:'+b.runId).maybeSingle());if(!saved)throw Error('Verification run not found');
  const schools=saved.value.schools.map(s=>s.name);if(schools.some(s=>!s.startsWith('Vision QA '+b.runId+' ')))throw Error('Verification school mismatch');
  const rows=await checked(db.from('teacher_records').select('Voice_Note_Link,Lesson_Plan_Picture,Video_Evidence_1,Video_Evidence_2,Video_Evidence_3,Writing_Sample_Link,Phonics_Evidence_Link,Portfolio_Evidence_Link,Event_Pictures_Link').in('Center',schools));
  const config=await loadR2Config(env,localDatabase()),keys=new Set();for(const row of rows)for(const val of Object.values(row))for(const value of String(val||'').split(',').filter(Boolean)){const url=new URL(value);if(url.origin!==new URL(config.R2_PUBLIC_BASE_URL).origin)throw Error('Unexpected verification media host');const key=url.pathname.slice(1).split('/').map(decodeURIComponent).join('/');if(!schools.some(s=>key.startsWith('schools/'+encodeURIComponent(s)+'/teachers/')))throw Error('Unexpected verification media path');keys.add(key);}
  for(const key of keys){const r=await r2Request(config,key,'DELETE');if(!r.ok)throw Error('Could not remove disposable verification media ('+r.status+')');}
  return Response.json({ok:true,removed:keys.size});
 }
 if(b.action==='freshWorkspace'){
  const school=await checked(db.from('literacy_schools').select('id,name').eq('id',b.visionSchoolId).maybeSingle());if(!school)throw Error('Select a Vision school');
  let mapped=await checked(db.from('success_school_mappings').select('source_school').eq('vision_school_id',school.id).maybeSingle());
  if(mapped)throw Error('This school already has a workspace. Use the explicit teacher mapping below for additional accounts.');
  const sourceSchool=mapped?.source_school||school.name+' · Vision '+school.id.slice(0,8);
  const people=await checked(db.from('literacy_memberships').select('user_id,display_name').eq('school_id',school.id).eq('role','teacher'));if(!people.length)throw Error('Add teacher accounts to this Vision school first');
  const duplicates=Object.fromEntries(people.map(p=>[p.display_name,people.filter(x=>x.display_name===p.display_name).length]));
  if(!mapped)await checked(db.from('success_school_mappings').insert({source_school:sourceSchool,vision_school_id:school.id,approved_by:a.userId}));
  const current=await checked(db.from('success_teacher_mappings').select('source_teacher,vision_user_id').eq('source_school',sourceSchool));
  for(const person of people){if(current.some(m=>m.vision_user_id===person.user_id))continue;const name=(person.display_name||'Teacher')+(duplicates[person.display_name]>1?' · '+person.user_id.slice(0,8):'');if(current.some(m=>m.source_teacher===name))throw Error('An imported teacher already uses this label. Approve the teacher mapping explicitly.');await checked(db.from('success_teacher_mappings').insert({source_school:sourceSchool,source_teacher:name,vision_user_id:person.user_id,approved_by:a.userId}));await checked(db.from('success_members').upsert({email:school.id+'.'+person.user_id+'@vision-roster.invalid',role:'teacher',school:sourceSchool,name},{onConflict:'email'}));}
  await checked(db.from('success_entries').upsert({id:'vision-school:'+school.id,kind:'school',school:sourceSchool,owner:a.email,payload:JSON.stringify({name:sourceSchool}),updated:new Date().toISOString()},{onConflict:'id'}));
  return Response.json({ok:true,sourceSchool,teachers:people.length});
 }
 if(b.action==='schoolMap'){
  const school=await checked(db.from('literacy_schools').select('id').eq('id',b.visionSchoolId).maybeSingle());if(!school||!b.sourceSchool||b.sourceSchool.length>1000)throw Error('Choose a source school and a Vision school');
  const existing=await checked(db.from('success_school_mappings').select('*').eq('source_school',b.sourceSchool).maybeSingle());if(existing&&existing.vision_school_id!==school.id)throw Error('409:This source school already has an approved mapping');
  await checked(db.from('success_school_mappings').upsert({source_school:b.sourceSchool,vision_school_id:school.id,approved_by:a.userId},{onConflict:'source_school'}));return Response.json({ok:true});
 }
 if(b.action==='teacherMap'){
  const school=await checked(db.from('success_school_mappings').select('vision_school_id').eq('source_school',b.sourceSchool).maybeSingle());if(!school)throw Error('Map the school first');
  const teacher=await checked(db.from('literacy_memberships').select('user_id').eq('school_id',school.vision_school_id).eq('user_id',b.visionUserId).eq('role','teacher').maybeSingle());if(!teacher||!b.sourceTeacher||b.sourceTeacher.length>1000)throw Error('Choose an assigned Vision teacher');
  await checked(db.from('success_teacher_mappings').upsert({source_school:b.sourceSchool,source_teacher:b.sourceTeacher,vision_user_id:teacher.user_id,approved_by:a.userId},{onConflict:'source_school,source_teacher'}));return Response.json({ok:true});
 }
 if(b.action==='configureCors'){
  const config=await loadR2Config(env,localDatabase());const r=await bucketCors(config);let xml=await r.text();if(!r.ok&&!xml.includes('NoSuchCORSConfiguration'))throw Error('Storage CORS could not be read ('+r.status+')');
  const origin=new URL(req.url).origin;const canonical='https://vision-school-commercial-staging.vercel.app';const origins=[...new Set([origin,canonical])];
  if(!r.ok)xml='<CORSConfiguration></CORSConfiguration>';
  const missing=origins.filter(o=>!xml.includes('<AllowedOrigin>'+o+'</AllowedOrigin>')&&!xml.includes('<AllowedOrigin>*</AllowedOrigin>'));
  if(missing.length){const rule='<CORSRule><ID>vision-school-success</ID>'+missing.map(o=>'<AllowedOrigin>'+o+'</AllowedOrigin>').join('')+'<AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule>';xml=xml.replace('</CORSConfiguration>',rule+'</CORSConfiguration>');const saved=await bucketCors(config,'PUT',xml);if(!saved.ok)throw Error('Storage CORS could not be saved ('+saved.status+')');}
  return Response.json({ok:true,origins});
 }
 if(b.action==='importStep'){
  if((await checked(db.from('success_import_state').select('key').eq('key','complete').maybeSingle())))throw Error('Import is complete. Restore from a backup through a reviewed migration to avoid changing newer records.');
  if(!['config','page','legacy','finish'].includes(b.step?.action))throw Error('Invalid import step');
  const r=await fetch('https://amtjvwroaennfypurkji.supabase.co/functions/v1/vision-success-import',{method:'POST',headers:{Authorization:'Bearer '+process.env.SCHOOL_SUCCESS_TRANSFER_KEY,'Content-Type':'application/json'},body:JSON.stringify(b.step)});const result=await r.json();if(!r.ok)throw Error(result.error);return Response.json(result);
 }
 throw Error('Unsupported action');
}catch(e){return failure(e);}});}
