import {z} from 'zod';
import {withRequest,actor,checkOrigin,failure} from '@/lib/school-success/server';
import {uploadLabels} from '@/lib/school-success/storage-upload';
export const runtime='nodejs';
// Safe diagnostics for a failed browser upload (the PUT goes straight to R2, so the server cannot see it).
// Only an authenticated teacher/administrator can report. Logged fields: file kind, outcome kind, HTTP
// status, R2 error code, request reference, attempt, whether it was final, and a coarse device/browser.
// Never URLs, tokens, file names, contents, school or teacher names.
const report=z.object({kind:z.enum(['storage','network']),file:z.enum(Object.keys(uploadLabels)),status:z.number().int().min(0).max(599),code:z.string().regex(/^[A-Za-z0-9.]{0,64}$/),ref:z.string().regex(/^[A-Za-z0-9-]{0,64}$/),attempt:z.number().int().min(1).max(5),final:z.boolean()}).strict();
export function coarseAgent(ua=''){
 const device=/iPhone/.test(ua)?'iPhone':/iPad/.test(ua)?'iPad':/Android/.test(ua)?'Android':/Macintosh/.test(ua)?'Mac':/Windows/.test(ua)?'Windows':'other';
 const browser=/CriOS|Chrome\//.test(ua)&&!/Edg/.test(ua)?'Chrome':/FxiOS|Firefox\//.test(ua)?'Firefox':/Edg/.test(ua)?'Edge':/Safari\//.test(ua)?'Safari':'other';
 const os=(ua.match(/OS (\d+)_\d/)||ua.match(/Android (\d+)/)||[])[1]||'';
 return `${device}${os?' '+os:''} ${browser}`;
}
export async function POST(req){return withRequest(req,async()=>{try{
 checkOrigin(req);await actor(req);
 if(Number(req.headers.get('content-length')||0)>2048)throw Error('413:Report too large');
 let body;try{body=report.parse(JSON.parse(await req.text()));}catch{throw Error('Invalid upload report');}
 console.warn(JSON.stringify({event:'browser-upload-failed',...body,agent:coarseAgent(req.headers.get('user-agent')||'')}));
 return new Response(null,{status:204,headers:{'Cache-Control':'no-store'}});
}catch(e){return failure(e);}});}
