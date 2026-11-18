// Real-storage check of the browser evidence-upload path (presigned PUT), using the production
// evidencePlan() key builder and presignUpload() signer. Replays what a browser sends (CORS preflight,
// then PUT with Origin and Content-Type) for a uniquely named SYNTHETIC school/teacher, and reads the
// bucket's CORS rules. Prints only statuses, R2 error codes, request references, CORS rule values and
// booleans: never signed URLs, credentials, keys of real objects or file contents. Touches no teacher
// records (no database writes).
//   node scripts/r2-upload-selfcheck.mjs --write-synthetic [--origin=https://…]
import {env} from '../lib/school-success/environment.js';
import {localDatabase} from '../lib/school-success/database.js';
import {loadR2Config,r2Request,r2UploadsConfigured} from '../lib/school-success/r2-evidence.js';
import {presignUpload,bucketCors} from '../lib/school-success/r2-upload.js';
import {evidencePlan} from '../lib/school-success/teacher-submissions.js';

const args=process.argv.slice(2),has=f=>args.includes(f),opt=(n,d)=>(args.find(a=>a.startsWith(n+'='))||'').slice(n.length+1)||d;
const out=(step,data)=>console.log('UPLOADCHECK '+JSON.stringify({step,...data}));
if(!has('--write-synthetic')){console.log('Refusing to run: pass --write-synthetic to write synthetic objects to real storage.');process.exit(2);}
const ORIGIN=opt('--origin','https://vision-school-commercial-staging.vercel.app');
const code=text=>(String(text).slice(0,4096).match(/<Code>([A-Za-z0-9.]{1,64})<\/Code>/)||[])[1]||'';
const ref=res=>String(res.headers.get('cf-ray')||'').replace(/[^A-Za-z0-9-]/g,'').slice(0,64);
const pdf=(label,pad=0)=>new TextEncoder().encode(`%PDF-1.4\n% synthetic upload check ${label}\n${'0'.repeat(pad)}\n%%EOF\n`);

async function browserPut(config,key,type,body,label){
 const url=await presignUpload(config,key,type);
 const pre=await fetch(url,{method:'OPTIONS',headers:{Origin:ORIGIN,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'content-type'}});
 out('preflight',{label,status:pre.status,allowOrigin:pre.headers.get('access-control-allow-origin'),allowMethods:pre.headers.get('access-control-allow-methods'),allowHeaders:pre.headers.get('access-control-allow-headers'),maxAge:pre.headers.get('access-control-max-age')});
 await pre.arrayBuffer().catch(()=>{});
 const res=await fetch(url,{method:'PUT',headers:{Origin:ORIGIN,'Content-Type':type},body});
 const text=res.ok?'':await res.text().catch(()=>'');
 out('put',{label,type,bytes:body.length,ok:res.ok,status:res.status,code:code(text),ref:ref(res),corsReadable:Boolean(res.headers.get('access-control-allow-origin')),exposeHeaders:res.headers.get('access-control-expose-headers')});
 return res.ok;
}

async function main(){
 const config=await loadR2Config(env,localDatabase());
 out('r2-config',{configured:r2UploadsConfigured(config),origin:ORIGIN});
 const cors=await bucketCors(config,'GET'),xml=await cors.text();
 const rules=[...xml.matchAll(/<CORSRule>([\s\S]*?)<\/CORSRule>/g)].map(m=>({origins:[...m[1].matchAll(/<AllowedOrigin>(.*?)<\/AllowedOrigin>/g)].map(x=>x[1]),methods:[...m[1].matchAll(/<AllowedMethod>(.*?)<\/AllowedMethod>/g)].map(x=>x[1]),headers:[...m[1].matchAll(/<AllowedHeader>(.*?)<\/AllowedHeader>/g)].map(x=>x[1]),expose:[...m[1].matchAll(/<ExposeHeader>(.*?)<\/ExposeHeader>/g)].map(x=>x[1]),maxAge:(m[1].match(/<MaxAgeSeconds>(\d+)<\/MaxAgeSeconds>/)||[])[1]||null}));
 out('bucket-cors',{status:cors.status,code:cors.ok?'':code(xml),rules});

 const today=new Date().toISOString().slice(0,10),uuid=()=>crypto.randomUUID();
 const submission=(school,teacher,files)=>({id:uuid(),school,teacher,date:today,periods:[{id:files[0].periodId}],files});
 const period=uuid();
 // 1. Generated preparation PDF: file ID = period ID (as teacher-portal.jsx does), category lesson_plan.
 const s1=submission('ZZ Synthetic Upload Check','Synthetic Teacher',[{id:period,periodId:period,category:'lesson_plan',name:'Lesson-preparation-1.pdf',size:1}]);
 const [gen]=evidencePlan(s1);
 const first=await browserPut(config,gen.key,gen.type,pdf('generated'),'generated-preparation-pdf');
 if(first){const head=await r2Request(config,gen.key,'HEAD');out('head-after-put',{label:'generated-preparation-pdf',status:head.status});}
 // 2. Retry of the same file (same submission, same key) — what "Save lesson preparation" does again.
 await browserPut(config,gen.key,gen.type,pdf('generated-retry'),'retry-same-key');
 // 3. Optional plan attachments (random file IDs), including a phone-sized photo.
 const p2=uuid(),s2=submission('ZZ Synthetic Upload Check','Synthetic Teacher',[{id:uuid(),periodId:p2,category:'lesson_plan',name:'IMG_0001.jpg',size:1},{id:uuid(),periodId:p2,category:'lesson_plan',name:'plan.pdf',size:1}]);
 const [photo,doc]=evidencePlan(s2);
 const jpeg=new Uint8Array(3_000_000);jpeg.set([0xff,0xd8,0xff,0xe0]);
 await browserPut(config,photo.key,photo.type,jpeg,'attachment-photo-3MB');
 await browserPut(config,doc.key,doc.type,pdf('attachment'),'attachment-pdf');
 // 4. Names with spaces, punctuation and Devanagari (encoded into the key twice, as in production).
 const p3=uuid(),s3=submission("ZZ Synthetic School (Check) & Co's",'सिंथेटिक शिक्षक Test',[{id:p3,periodId:p3,category:'lesson_plan',name:'Lesson-preparation-1.pdf',size:1}]);
 const [named]=evidencePlan(s3);
 await browserPut(config,named.key,named.type,pdf('named'),'generated-pdf-special-names');
 // 5. Optional audio note (m4a as recorded on iPhone).
 const p4=uuid(),s4=submission('ZZ Synthetic Upload Check','Synthetic Teacher',[{id:uuid(),periodId:p4,category:'voice',name:'voice-note.m4a',size:1}]);
 const [voice]=evidencePlan(s4);
 await browserPut(config,voice.key,voice.type,new Uint8Array(200_000),'optional-audio-m4a');
}
main().then(()=>console.log('UPLOADCHECK DONE')).catch(e=>{out('fatal',{error:String(e?.message||e).replace(/^\d+:/,'').slice(0,300)});process.exitCode=1;});
