import {withRequest,actor,database,checkOrigin,failure} from '@/lib/school-success/server';
import {env} from '@/lib/school-success/environment';
import {loadR2Config,unseal} from '@/lib/school-success/r2-evidence';
import {presignUpload} from '@/lib/school-success/r2-upload';
export const runtime='nodejs';
export async function POST(req){return withRequest(req,async()=>{try{
 checkOrigin(req);const a=await actor(req),config=await loadR2Config(env,database());
 const file=await unseal(req.headers.get('X-Evidence-Token')||'',config.SUPABASE_GATEWAY_TOKEN);
 if(file.kind!=='file'||file.email!==a.email||!Number.isSafeInteger(file.size)||file.size<=0||file.size>50*1024*1024)throw Error('403:File access denied');
 // "file" is a coarse kind for diagnostics; the generated preparation PDF uses its period ID as file ID.
 const kind=file.category==='lesson_plan'&&file.id===file.periodId?'generated-preparation-pdf':file.category;
 return Response.json({url:await presignUpload(config,file.key,file.type),contentType:file.type,file:kind},{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}});}
