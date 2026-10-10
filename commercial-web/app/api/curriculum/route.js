import {NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export const runtime="nodejs";
const GRADES=["Nursery","LKG","UKG","Grade 1","Grade 2","Grade 3","Grade 4"];
function send(data,status=200){return NextResponse.json(data,{status,headers:{"Cache-Control":"no-store"}});}
export async function POST(request){
 try{
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return send({error:"Sign in required."},401);
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if(!url||!secret||!key)return send({error:"Admin service not configured."},503);
  const userClient=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await userClient.auth.getUser(token);
  if(userError||!user||!user.email_confirmed_at)return send({error:"Invalid account."},401);
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const [adminResult,consultantResult]=await Promise.all([
   admin.from("literacy_platform_admins").select("user_id").eq("user_id",user.id).maybeSingle(),
   admin.from("literacy_consultant_assignments").select("school_id")
    .eq("consultant_user_id",user.id).limit(1)
  ]);
  if(adminResult.error||consultantResult.error)return send({error:"Unable to verify permissions."},503);
  if(!adminResult.data&&!consultantResult.data?.length)
   return send({error:"Only the Super Admin or an assigned Consultant can edit the shared curriculum."},403);
  const raw=await request.text();
  if(raw.length>20000)return send({error:"Request too large."},413);
  const body=JSON.parse(raw);
  const action=String(body.action||"");
  if(action!=="create"&&action!=="update")return send({error:"Unknown action."},400);
  const title=String(body.title||"").trim();
  const strand=String(body.strand||"").trim();
  const description=String(body.description||"").trim();
  const sequence=Number(body.sequence);
  if(title.length<3||title.length>160||strand.length<2||strand.length>100||
     description.length>2000||!Number.isInteger(sequence)||sequence<0||sequence>10000)
   return send({error:"Enter a title (3–160), strand (2–100), description (up to 2,000) and sequence (0–10,000)."},400);
  let result;
  if(action==="create"){
   const code=String(body.code||"").trim().toUpperCase();
   const grade=String(body.grade||"").trim();
   if(!/^[A-Z][A-Z0-9_]{2,24}$/.test(code)||!GRADES.includes(grade))
    return send({error:"Choose a valid grade and unique competency code."},400);
   result=await admin.from("literacy_competencies").insert({
    code,grade,title,strand,description,sequence,active:body.active===true,
    version:1,updated_by:user.id,updated_at:new Date().toISOString()
   }).select("id,code,grade,strand,title,description,sequence,active,version").single();
  }else{
   const id=String(body.id||"");
   if(!/^[a-f0-9-]{36}$/i.test(id))return send({error:"Select a valid competency."},400);
   const {data:existing,error:readError}=await admin.from("literacy_competencies")
    .select("id,version").eq("id",id).maybeSingle();
   if(readError||!existing)return send({error:"Competency not found."},404);
   const expected=Number(body.version);
   if(!Number.isInteger(expected)||expected!==existing.version)
    return send({error:"The competency was updated elsewhere. Refresh and try again."},409);
   result=await admin.from("literacy_competencies").update({
    title,strand,description,sequence,active:body.active===true,
    version:expected+1,updated_by:user.id,updated_at:new Date().toISOString()
   }).eq("id",id).eq("version",expected)
    .select("id,code,grade,strand,title,description,sequence,active,version").maybeSingle();
   if(!result.error&&!result.data)return send({error:"Another editor changed this competency. Refresh."},409);
  }
  if(result.error)return send({error:result.error.message},400);
  return send({competency:result.data,message:action==="create"?"Competency created and audited.":"Competency updated and audited."});
 }catch(e){return send({error:"Unable to save competency. "+(e?.message||"")},500);}
}
