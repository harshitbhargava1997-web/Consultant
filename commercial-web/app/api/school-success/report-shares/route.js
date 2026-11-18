import {z} from 'zod';
import {withRequest,actor,database,checkOrigin,failure,assertSchool} from '@/lib/school-success/server';
import {env} from '@/lib/school-success/environment';
import {loadR2Config,r2UploadsConfigured} from '@/lib/school-success/r2-evidence';
import {isSnapshotId} from '@/lib/school-success/report-snapshots';
import {sharePagePath} from '@/lib/school-success/report-shares';
import {loadSnapshotObject,createShareObject} from '@/lib/school-success/snapshot-storage';
export const runtime='nodejs';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const body=z.object({snapshotId:z.string().refine(isSnapshotId)}).strict();
const fail=e=>String(e?.message||e).startsWith('404:')?Response.json({error:'Lesson documentation not found'},{status:404,headers:noStore}):failure(e);
// Creates a sharing link for one stored snapshot. Only School Success administrators/consultants whose
// grant covers the snapshot's stored school (from the encrypted envelope, never from the request).
async function handlePOST(req){
 try{
  checkOrigin(req);
  const a=await actor(req);
  if(a.role!=='admin')throw Error('403:Sharing links are available to School Success administrators');
  let input;try{input=body.parse(await req.json());}catch{throw Error('Invalid sharing request');}
  const config=await loadR2Config(env,database()),secret=config.SUPABASE_GATEWAY_TOKEN;
  if(!r2UploadsConfigured(config))throw Error('503:Report storage is not configured');
  const {meta}=await loadSnapshotObject({config,secret,id:input.snapshotId});
  assertSchool(a,meta.school);
  const {id,shareSecret}=await createShareObject({config,secret,snapshotId:input.snapshotId,school:meta.school,createdBy:a.email});
  return Response.json({id,secret:shareSecret,path:sharePagePath(id)},{headers:noStore});
 }catch(e){return fail(e);}
}
export async function POST(req){return withRequest(req,()=>handlePOST(req));}
