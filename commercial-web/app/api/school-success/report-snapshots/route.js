import {withRequest,actor,database,checkOrigin,failure,assertSchool} from '@/lib/school-success/server';
import {env} from '@/lib/school-success/environment';
import {loadR2Config,r2UploadsConfigured} from '@/lib/school-success/r2-evidence';
import {snapshotScopeSchema,MAX_SNAPSHOT_BYTES,assertPdfBytes,snapshotPagePath} from '@/lib/school-success/report-snapshots';
import {storeSnapshotObject} from '@/lib/school-success/snapshot-storage';
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
  // Never overwrites; storage failures surface the R2 status, code and request reference (no secrets).
  const {id}=await storeSnapshotObject({config,secret,scope,pdf:bytes,createdBy:a.email});
  return Response.json({id,url:snapshotPagePath(id),size:bytes.length},{headers:noStore});
 }catch(e){return failure(e);}
}
export async function POST(req){return withRequest(req,()=>handlePOST(req));}
