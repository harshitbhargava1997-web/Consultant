import {z} from 'zod';
import {withRequest,actor,database,checkOrigin,failure,assertSchool} from '@/lib/school-success/server';
import {env} from '@/lib/school-success/environment';
import {loadR2Config,r2UploadsConfigured} from '@/lib/school-success/r2-evidence';
import {isSnapshotId} from '@/lib/school-success/report-snapshots';
import {isShareId,ACCESS_MODES,MAX_EVIDENCE_PER_REPORT,isEvidenceKey,evidenceKeyInScope,sharePagePath,securePagePath} from '@/lib/school-success/report-shares';
import {loadSnapshotObject,createAccessRecord} from '@/lib/school-success/snapshot-storage';
export const runtime='nodejs';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
// The browser chooses the ID (and, for 'link', the secret) before rendering, because the PDF's own
// evidence links point at this record. Only the secret's SHA-256 digest is sent and stored.
const body=z.object({
 id:z.string().refine(isShareId),mode:z.enum(ACCESS_MODES),snapshotId:z.string().refine(isSnapshotId),
 secretSha256:z.string().regex(/^[0-9a-f]{64}$/).nullable(),
 evidence:z.array(z.string().refine(isEvidenceKey)).max(MAX_EVIDENCE_PER_REPORT)
}).strict().refine(b=>(b.mode==='link')===(b.secretSha256!==null),'A link needs a secret digest; a sign-in link must not have one');
const fail=e=>String(e?.message||e).startsWith('404:')?Response.json({error:'Lesson documentation not found'},{status:404,headers:noStore}):failure(e);
// Creates the access record for one exported consolidated lesson report (full evidence). Only School
// Success administrators whose grant covers the snapshot's stored school, and only for evidence of that
// school and teacher.
async function handlePOST(req){
 try{
  checkOrigin(req);
  const a=await actor(req);
  if(a.role!=='admin')throw Error('403:Report links are available to School Success administrators');
  let input;try{input=body.parse(await req.json());}catch{throw Error('Invalid report link request');}
  const config=await loadR2Config(env,database()),secret=config.SUPABASE_GATEWAY_TOKEN;
  if(!r2UploadsConfigured(config))throw Error('503:Report storage is not configured');
  const {meta}=await loadSnapshotObject({config,secret,id:input.snapshotId});
  assertSchool(a,meta.school);
  if(meta.variant==='shareable')throw Error('Choose the full lesson documentation report.');
  if(input.evidence.some(k=>!evidenceKeyInScope(k,meta.school,meta.teacher)))throw Error('403:A linked file does not belong to this teacher and school.');
  const record={v:2,id:input.id,mode:input.mode,snapshotId:input.snapshotId,school:meta.school,teacher:meta.teacher,secretSha256:input.secretSha256,evidence:input.evidence,createdBy:a.email,createdAt:new Date().toISOString()};
  await createAccessRecord({config,secret,record});
  return Response.json({id:record.id,mode:record.mode,path:record.mode==='signin'?securePagePath(record.id):sharePagePath(record.id)},{headers:noStore});
 }catch(e){return fail(e);}
}
export async function POST(req){return withRequest(req,()=>handlePOST(req));}
