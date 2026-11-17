import {withRequest,actor,database,checkOrigin,failure,assertSchool} from '@/lib/school-success/server';
import {env} from '@/lib/school-success/environment';
import {loadR2Config,r2Request,r2UploadsConfigured} from '@/lib/school-success/r2-evidence';
import {snapshotScopeSchema,MAX_SNAPSHOT_BYTES,assertPdfBytes,sha256Hex,snapshotId,snapshotKey,sealSnapshot,snapshotPagePath} from '@/lib/school-success/report-snapshots';
export const runtime='nodejs';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const decodeScope=value=>{try{return snapshotScopeSchema.parse(JSON.parse(Buffer.from(String(value||''),'base64url').toString('utf8')));}catch{throw Error('Invalid lesson documentation scope');}};
// Stores one lesson-documentation PDF snapshot (encrypted) and returns its durable application link.
async function handlePOST(req){
 try{
  checkOrigin(req);
  const a=await actor(req);
  if(a.role!=='admin')throw Error('403:Lesson documentation is available to School Success administrators');
  const scope=decodeScope(req.headers.get('X-Snapshot-Scope'));
  assertSchool(a,scope.school);
  if(Number(req.headers.get('content-length')||0)>MAX_SNAPSHOT_BYTES)throw Error('413:Lesson documentation PDF is larger than 4 MB');
  const bytes=new Uint8Array(await req.arrayBuffer());assertPdfBytes(bytes);
  const config=await loadR2Config(env,database()),secret=config.SUPABASE_GATEWAY_TOKEN;
  if(!r2UploadsConfigured(config))throw Error('503:Report storage is not configured');
  const sha256=await sha256Hex(bytes),id=await snapshotId(secret,scope,sha256),key=snapshotKey(id);
  // Never overwrite: an existing object at this content-derived ID already holds these exact bytes.
  if(!(await r2Request(config,key,'HEAD')).ok){
   const envelope=await sealSnapshot(secret,id,{v:1,id,...scope,sha256,size:bytes.length,createdBy:a.email,storedAt:new Date().toISOString()},bytes);
   const put=await r2Request(config,key,'PUT',envelope,{'Content-Type':'application/octet-stream','If-None-Match':'*'});
   if(!put.ok&&put.status!==412)throw Error('Lesson documentation could not be stored. Retry the export.');
   if(!(await r2Request(config,key,'HEAD')).ok)throw Error('Lesson documentation could not be confirmed in storage. Retry the export.');
  }
  return Response.json({id,url:snapshotPagePath(id),size:bytes.length},{headers:noStore});
 }catch(e){return failure(e);}
}
export async function POST(req){return withRequest(req,()=>handlePOST(req));}
