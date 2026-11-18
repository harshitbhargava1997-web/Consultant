import {z} from 'zod';
import {withRequest,actor,database,checkOrigin,failure,assertSchool} from '@/lib/school-success/server';
import {env} from '@/lib/school-success/environment';
import {loadR2Config} from '@/lib/school-success/r2-evidence';
import {isShareId} from '@/lib/school-success/report-shares';
import {loadSnapshotObject,loadShareObject,shareRevocation,revokeShareObject} from '@/lib/school-success/snapshot-storage';
export const runtime='nodejs';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const body=z.object({action:z.enum(['status','revoke'])}).strict();
const fail=e=>String(e?.message||e).startsWith('404:')?Response.json({error:'This sharing link was not found'},{status:404,headers:noStore}):failure(e);
// Status and revocation for one sharing link. Requires sign-in and a School Success grant covering the
// share's stored school; the link's secret is not needed (and never sent here).
async function handlePOST(req,id){
 try{
  checkOrigin(req);
  const a=await actor(req);
  if(a.role!=='admin')throw Error('403:Managing sharing links is available to School Success administrators');
  if(!isShareId(id))throw Error('404:not found');
  let input;try{input=body.parse(await req.json());}catch{throw Error('Invalid request');}
  const config=await loadR2Config(env,database()),secret=config.SUPABASE_GATEWAY_TOKEN;
  const record=await loadShareObject({config,secret,id});
  assertSchool(a,record.school);
  if(input.action==='revoke'){const result=await revokeShareObject({config,secret,id,revokedBy:a.email});console.info(JSON.stringify({event:'report-share-revoked',alreadyRevoked:result.alreadyRevoked}));}
  const revoked=await shareRevocation({config,secret,id}),{meta}=await loadSnapshotObject({config,secret,id:record.snapshotId});
  return Response.json({id,createdAt:record.createdAt,revoked:Boolean(revoked),revokedAt:revoked?.revokedAt||null,
   scope:{school:meta.school,teacher:meta.teacher,grade:meta.grade,section:meta.section,subject:meta.subject,from:meta.from,to:meta.to,generatedAt:meta.generatedAt}},{headers:noStore});
 }catch(e){return fail(e);}
}
export async function POST(req,{params}){const {id}=await params;return withRequest(req,()=>handlePOST(req,id));}
