import {withRequest,actor,checkOrigin,failure} from '@/lib/school-success/server';
import {service,checked} from '@/lib/school-success/database';
import {database} from '@/lib/school-success/server';
import {env} from '@/lib/school-success/environment';
import {loadR2Config,r2Request} from '@/lib/school-success/r2-evidence';
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

 const state=await checked(db.from('success_import_state').select('key,value,updated_at').neq('key','sourceSnapshot').not('key','like','legacy:%').not('key','like','qa:%'));
 return Response.json({state,tables:TABLES,separate:true},{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}});}
export async function POST(req){return withRequest(req,async()=>{try{
 checkOrigin(req);await admin(req);const b=await req.json();
 // Verification fixtures only: this cannot target an actual customer school.
 if(b.action!=='cleanupQaMedia'||!/^\b[a-f0-9-]{36}$/.test(b.runId||''))throw Error('Unsupported maintenance action');
 const schools=['A','B'].map(s=>'School Success QA '+b.runId+' '+s),db=service(),config=await loadR2Config(env,database());
 const rows=await checked(db.from('teacher_records').select('Center,Voice_Note_Link,Lesson_Plan_Picture,Video_Evidence_1,Video_Evidence_2,Video_Evidence_3,Writing_Sample_Link,Phonics_Evidence_Link,Portfolio_Evidence_Link,Event_Pictures_Link').in('Center',schools));
 const keys=new Set();
 for(const row of rows)for(const [column,value] of Object.entries(row))if(column!=='Center'&&value)for(const url of String(value).split(',')){
  const base=config.R2_PUBLIC_BASE_URL.replace(/\/$/,'')+'/';if(!url.startsWith(base))throw Error('Unexpected QA media base');
  const key=url.slice(base.length).split('/').map(decodeURIComponent).join('/');
  if(!key.startsWith('schools/'+encodeURIComponent(row.Center)+'/teachers/')||!key.includes('/submission_'))throw Error('Unexpected QA media path');
  keys.add(key);
 }
 for(const key of keys){const r=await r2Request(config,key,'DELETE');if(!r.ok)throw Error('QA media cleanup failed');}
 return Response.json({ok:true,removed:keys.size},{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}});}
