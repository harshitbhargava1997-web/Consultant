import {z} from 'zod';
import {withRequest,database,checkOrigin,failure,actor,assertSchool} from '@/lib/school-success/server';
import {env} from '@/lib/school-success/environment';
import {loadR2Config} from '@/lib/school-success/r2-evidence';
import {presignDownload} from '@/lib/school-success/r2-upload';
import {isShareId,FILE_URL_TTL_SECONDS} from '@/lib/school-success/report-shares';
import {authorizeAccess} from '@/lib/school-success/report-access';
import {loadShareObject,shareRevocation} from '@/lib/school-success/snapshot-storage';
export const runtime='nodejs';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
const fail=e=>{const m=String(e?.message||e);
 if(m.startsWith('404:'))return Response.json({error:'This file link is not valid. Ask the sender for a new link.'},{status:404,headers:noStore});
 if(m.startsWith('410:'))return Response.json({error:m.slice(4)},{status:410,headers:noStore});
 return failure(e);};
const body=z.object({secret:z.string().max(100).optional()}).strict();
async function signedIn(req,school){const a=await actor(req);if(a.role!=='admin')throw Error('403:This file requires school sign-in with access to the school.');assertSchool(a,school);}
// One evidence file (photo, writing sample, recording, attachment) linked from a consolidated report.
// Same access as the report itself; only files recorded in that report's access record; revocation
// applies. The answer is a signed storage URL valid for FILE_URL_TTL_SECONDS that the browser opens
// directly (images display, recordings play, with range requests).
async function handlePOST(req,id,n){
 try{
  checkOrigin(req);
  if(!isShareId(id)||!/^\d{1,4}$/.test(n))throw Error('404:not valid');
  let input;try{input=body.parse(await req.json());}catch{throw Error('404:not valid');}
  const config=await loadR2Config(env,database()),secret=config.SUPABASE_GATEWAY_TOKEN;
  const record=await loadShareObject({config,secret,id});
  await authorizeAccess(record,input.secret,school=>signedIn(req,school));
  if(await shareRevocation({config,secret,id}))throw Error('410:This link has been revoked by the school. Ask the sender for a new link.');
  const key=Array.isArray(record.evidence)?record.evidence[Number(n)]:undefined;
  if(!key)throw Error('404:not in this report');
  return Response.json({url:await presignDownload(config,key,FILE_URL_TTL_SECONDS),expiresInSeconds:FILE_URL_TTL_SECONDS},{headers:noStore});
 }catch(e){return fail(e);}
}
export async function POST(req,{params}){const {id,n}=await params;return withRequest(req,()=>handlePOST(req,id,n));}
