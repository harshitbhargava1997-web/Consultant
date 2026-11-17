import {withRequest,actor,database,checkOrigin,failure,assertSchool} from '@/lib/school-success/server';
import {env} from '@/lib/school-success/environment';
import {loadR2Config,seal,unseal} from '@/lib/school-success/r2-evidence';
import {loadSnapshotObject} from '@/lib/school-success/snapshot-storage';
import {isSnapshotId,contentDisposition,snapshotFilename,snapshotPagePath,TICKET_TTL_MS} from '@/lib/school-success/report-snapshots';
export const runtime='nodejs';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
// failure() has no 404 mapping; missing, altered or undecryptable snapshots answer 404 here. Storage
// outages (R2 403/5xx) answer 503 with diagnostics instead of pretending the snapshot does not exist.
const fail=e=>String(e?.message||e).startsWith('404:')?Response.json({error:'Lesson documentation not found'},{status:404,headers:noStore}):failure(e);
async function load(config,id){
 if(!isSnapshotId(id))throw Error('404:Lesson documentation not found');
 return loadSnapshotObject({config,secret:config.SUPABASE_GATEWAY_TOKEN,id});
}
// Authorises the signed-in reader against the snapshot's stored school, then issues a two-minute
// viewing ticket bound to this snapshot and reader. URL parameters never grant access.
async function handlePOST(req,id){
 try{
  checkOrigin(req);
  const a=await actor(req);
  if(a.role!=='admin')throw Error('403:Lesson documentation is available to School Success administrators');
  const config=await loadR2Config(env,database()),{meta}=await load(config,id);
  assertSchool(a,meta.school);
  const ticket=await seal({kind:'snapshot-view',id,email:a.email,exp:Date.now()+TICKET_TTL_MS},config.SUPABASE_GATEWAY_TOKEN);
  const url='/api/school-success/report-snapshots/'+id+'?ticket='+encodeURIComponent(ticket);
  return Response.json({url,downloadUrl:url+'&download=1',filename:snapshotFilename(meta),generatedAt:meta.generatedAt,scope:{school:meta.school,teacher:meta.teacher,grade:meta.grade,section:meta.section,subject:meta.subject,from:meta.from,to:meta.to}},{headers:noStore});
 }catch(e){return fail(e);}
}
// Serves the stored PDF inline (or as an attachment with download=1) for a valid ticket.
async function handleGET(req,id){
 const url=new URL(req.url);
 try{
  const config=await loadR2Config(env,database());
  let ticket;
  try{ticket=await unseal(url.searchParams.get('ticket')||'',config.SUPABASE_GATEWAY_TOKEN);}catch{ticket=null;}
  // A missing or expired ticket (e.g. a bookmarked address) goes back through the signed-in page.
  if(!ticket||ticket.kind!=='snapshot-view'||ticket.id!==id)return Response.redirect(new URL(isSnapshotId(id)?snapshotPagePath(id):'/school-success',url.origin),303);
  const {meta,pdf}=await load(config,id);
  return new Response(pdf,{headers:{'Content-Type':'application/pdf','Content-Length':String(pdf.length),'Content-Disposition':contentDisposition(meta,url.searchParams.get('download')==='1'),'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
 }catch(e){return fail(e);}
}
export async function POST(req,{params}){const {id}=await params;return withRequest(req,()=>handlePOST(req,id));}
export async function GET(req,{params}){const {id}=await params;return withRequest(req,()=>handleGET(req,id));}
