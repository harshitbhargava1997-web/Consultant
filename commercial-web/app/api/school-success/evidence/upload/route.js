import {withRequest,actor,database,checkOrigin,failure} from '@/lib/school-success/server';
import {env} from '@/lib/school-success/environment';
import {loadR2Config,unseal} from '@/lib/school-success/r2-evidence';
import {presignUpload} from '@/lib/school-success/r2-upload';
export const runtime='nodejs';
export async function POST(req){return withRequest(req,async()=>{try{
 checkOrigin(req);const a=await actor(req),config=await loadR2Config(env,database());
 const file=await unseal(req.headers.get('X-Evidence-Token')||'',config.SUPABASE_GATEWAY_TOKEN);
 if(file.kind!=='file'||file.email!==a.email||!Number.isSafeInteger(file.size)||file.size<=0||file.size>50*1024*1024)throw Error('403:File access denied');
 return Response.json({url:await presignUpload(config,file.key,file.type),contentType:file.type},{headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}});}
