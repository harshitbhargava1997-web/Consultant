import {z} from 'zod';
import {withRequest,database,checkOrigin,failure,actor,assertSchool} from '@/lib/school-success/server';
import {env} from '@/lib/school-success/environment';
import {loadR2Config,seal,unseal} from '@/lib/school-success/r2-evidence';
import {contentDisposition,snapshotFilename} from '@/lib/school-success/report-snapshots';
import {isShareId,sharePagePath,securePagePath,SHARE_TICKET_TTL_MS} from '@/lib/school-success/report-shares';
import {authorizeAccess,accessMode} from '@/lib/school-success/report-access';
import {loadSnapshotObject,loadShareObject,shareRevocation} from '@/lib/school-success/snapshot-storage';
export const runtime='nodejs';
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
const NOT_VALID='This sharing link is not valid. Ask the sender for a new link.';
const fail=e=>{const m=String(e?.message||e);
 if(m.startsWith('404:'))return Response.json({error:NOT_VALID},{status:404,headers:noStore});
 if(m.startsWith('410:'))return Response.json({error:m.slice(4)},{status:410,headers:noStore});
 return failure(e);};
const openBody=z.object({secret:z.string().max(100).optional()}).strict();
// 'signin' records: School Success sign-in with access to the record's school.
async function signedIn(req,school){const a=await actor(req);if(a.role!=='admin')throw Error('403:This lesson documentation requires school sign-in with access to the school.');assertSchool(a,school);}

// Resolves a record to its snapshot after the access check (secret for 'link', school sign-in for
// 'signin'). Revocation is enforced here and again when the PDF is served.
async function resolve(config,id,check){
 if(!isShareId(id))throw Error('404:not valid');
 const secret=config.SUPABASE_GATEWAY_TOKEN,record=await loadShareObject({config,secret,id});
 await check(record);
 if(await shareRevocation({config,secret,id}))throw Error('410:This sharing link has been revoked by the school. Ask the sender for a new link.');
 const {meta,pdf}=await loadSnapshotObject({config,secret,id:record.snapshotId});
 if(meta.id!==record.snapshotId)throw Error('404:not valid');
 return {record,meta,pdf};
}
async function handlePOST(req,id){
 try{
  checkOrigin(req);
  let input;try{input=openBody.parse(await req.json());}catch{throw Error('404:not valid');}
  const config=await loadR2Config(env,database());
  const {record,meta}=await resolve(config,id,r=>authorizeAccess(r,input.secret,school=>signedIn(req,school)));
  const ticket=await seal({kind:'share-view',id,snapshotId:record.snapshotId,mode:accessMode(record),exp:Date.now()+SHARE_TICKET_TTL_MS},config.SUPABASE_GATEWAY_TOKEN);
  const url='/api/school-success/report-shares/'+id+'?ticket='+encodeURIComponent(ticket);
  return Response.json({url,downloadUrl:url+'&download=1',filename:snapshotFilename(meta),generatedAt:meta.generatedAt},{headers:noStore});
 }catch(e){return fail(e);}
}
async function handleGET(req,id){
 const url=new URL(req.url);
 try{
  const config=await loadR2Config(env,database());
  let ticket;try{ticket=await unseal(url.searchParams.get('ticket')||'',config.SUPABASE_GATEWAY_TOKEN);}catch{ticket=null;}
  // An expired/missing ticket returns to the share page, which needs the original link (with its secret).
  if(!ticket||ticket.kind!=='share-view'||ticket.id!==id)return Response.redirect(new URL(isShareId(id)?(ticket?.mode==='signin'?securePagePath(id):sharePagePath(id)):'/school-success',url.origin),303);
  const {meta,pdf}=await resolve(config,id,async r=>{if(r.snapshotId!==ticket.snapshotId)throw Error('404:not valid');});
  return new Response(pdf,{headers:{...noStore,'Content-Type':'application/pdf','Content-Length':String(pdf.length),'Content-Disposition':contentDisposition(meta,url.searchParams.get('download')==='1'),'Cache-Control':'private, no-store'}});
 }catch(e){return fail(e);}
}
export async function POST(req,{params}){const {id}=await params;return withRequest(req,()=>handlePOST(req,id));}
export async function GET(req,{params}){const {id}=await params;return withRequest(req,()=>handleGET(req,id));}
