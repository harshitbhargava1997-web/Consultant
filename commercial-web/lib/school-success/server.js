import {AsyncLocalStorage} from 'node:async_hooks';
import {service,checked,localDatabase} from './database';
const context=new AsyncLocalStorage();
export function withRequest(request,run){return context.run({request},run);}
export function database(){return localDatabase();}
export async function actor(req){
 const state=context.getStore();req=req||state?.request;if(!req)throw Error('401:Sign in through Vision');
 if(state?.actor)return state.actor;
 const identity=await identify(req);if(state)state.actor=identity;return identity;
}
async function identify(req){
 if(req.headers.get('X-School-Link')||new URL(req.url).searchParams.get('access'))throw Error('403:School Success is a separate programme. Use its original portal or your Vision teacher link.');
 const db=service(),token=(req.headers.get('Authorization')||'').replace(/^Bearer\\s+/i,'');
 if(!token)throw Error('401:Sign in to Vision to open the School Success folder');
 const {data:{user},error}=await db.auth.getUser(token);
 if(error||!user||!(user.email_confirmed_at||user.phone_confirmed_at))throw Error('401:Vision session expired');
 if(user.app_metadata?.must_change_password)throw Error('403:Change your initial Vision password first');
 const admin=await checked(db.from('literacy_platform_admins').select('user_id').eq('user_id',user.id).maybeSingle());
 if(!admin)throw Error('403:The separate School Success folder is available to Super Admin. Open Teacher Portal in Vision for literacy preparation and evidence.');
 return {email:user.email||user.phone,name:user.email||user.phone||'Super Admin',role:'admin',visionRole:'super_admin',isSuperAdmin:true,userId:user.id,school:'',allowedSchools:null};
}
export function assertSchool(a,school){if(!school||a.allowedSchools&&!a.allowedSchools.includes(school))throw Error('403:School is outside your assignment');}
export function checkOrigin(req){const o=req.headers.get('Origin');if(o&&o!==new URL(req.url).origin)throw Error('403:Cross-origin request rejected');}
export function streamJson(data,init={}){const value=JSON.stringify(data),encoder=new TextEncoder();let offset=0;return new Response(new ReadableStream({pull(controller){if(offset>=value.length){controller.close();return;}controller.enqueue(encoder.encode(value.slice(offset,offset+32768)));offset+=32768;}}),{...init,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...init.headers}});}
export function failure(e){const message=String(e.message||e),status=Number(message.match(/^(401|403|409|413|503):/)?.[1]||400);return Response.json({error:message.replace(/^\d+:/,'')},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
