// Real-storage self-check for lesson-documentation PDF snapshots.
//
// Writes ONE uniquely named synthetic PDF snapshot (plus, with --probe, a few synthetic diagnostic
// objects at fresh random keys) to the existing snapshot prefix, using the same library code as the
// production routes. It never touches teacher records, never overwrites an object, and prints only
// booleans, HTTP statuses, R2 error codes and request references: no credentials, signed URLs, keys
// of real snapshots, or report content.
//
// Needs the Production School Success settings (Supabase service role for the stored R2 settings,
// SCHOOL_SUCCESS_SIGNING_KEY, SCHOOL_SUCCESS_TRANSFER_KEY). Refuses to run without --write-synthetic.
//   node scripts/r2-snapshot-selfcheck.mjs --write-synthetic [--probe] [--next-route-context]
// --next-route-context runs everything through Next.js's patched fetch inside a route-handler context,
// i.e. the same fetch behaviour as the deployed /api routes.
import {AwsClient} from 'aws4fetch';
import {createRequire} from 'node:module';
import {AsyncLocalStorage} from 'node:async_hooks';
import {env} from '../lib/school-success/environment.js';
import {localDatabase} from '../lib/school-success/database.js';
import {loadR2Config,r2Request,r2Diagnostics,describeR2,r2UploadsConfigured} from '../lib/school-success/r2-evidence.js';
import {sealSnapshot,openSnapshot,snapshotKey,sha256Hex,assertPdfBytes} from '../lib/school-success/report-snapshots.js';
import {storeSnapshotObject,loadSnapshotObject,snapshotExists,createShareObject,loadShareObject,shareRevocation,revokeShareObject} from '../lib/school-success/snapshot-storage.js';
import {shareKey,revokedKey,secretDigest,sameDigest} from '../lib/school-success/report-shares.js';

const args=new Set(process.argv.slice(2));
const out=(step,data)=>console.log('SELFCHECK '+JSON.stringify({step,...data}));
const results=[];const check=(step,pass,data={})=>{results.push(pass);out(step,{pass,...data});};
if(!args.has('--write-synthetic')){console.log('Refusing to run: pass --write-synthetic to write a synthetic snapshot to real storage.');process.exit(2);}

function syntheticPdf(runId,padBytes=0){
 // Well-formed one-page PDF; content marks it as synthetic. padBytes adds an unreferenced random-hex
 // stream so the upload is as large as a real lesson PDF with photo thumbnails.
 const text=`Synthetic R2 self-check ${runId}`,objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const stream=`BT /F1 14 Tf 72 770 Td (${text}) Tj ET`;objects[3]=`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
 if(padBytes>0){let hex='';const chunk=new Uint8Array(32768);while(hex.length<padBytes){crypto.getRandomValues(chunk);hex+=Array.from(chunk,b=>b.toString(16).padStart(2,'0')).join('');}hex=hex.slice(0,padBytes);objects.push(`<< /Length ${hex.length} >>\nstream\n${hex}\nendstream`);}
 let pdf='%PDF-1.4\n';const offsets=[];
 objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});
 const xref=pdf.length;pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('');
 pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
 return new TextEncoder().encode(pdf);
}
const option=(name,fallback)=>{const hit=process.argv.find(a=>a.startsWith(name+'='));return hit?Number(hit.slice(name.length+1)):fallback;};
const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);

async function main(){
 out('environment',{supabase:Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY),signingKey:Boolean(env.SUPABASE_GATEWAY_TOKEN),transferKey:Boolean(env.MEDIA_SETTINGS_ENCRYPTION_KEY),node:process.version});
 const config=await loadR2Config(env,localDatabase()),secret=config.SUPABASE_GATEWAY_TOKEN;
 const endpoint=(()=>{try{return new URL(config.R2_ENDPOINT_URL);}catch{return null;}})();
 out('r2-config',{configured:r2UploadsConfigured(config),endpointIsR2:Boolean(endpoint&&endpoint.protocol==='https:'&&endpoint.hostname.endsWith('.r2.cloudflarestorage.com')),bucketIsExpected:config.R2_BUCKET_NAME==='onelern-media',publicBase:Boolean(config.R2_PUBLIC_BASE_URL)});
 if(!r2UploadsConfigured(config)||!secret)throw Error('R2 or signing configuration missing');

 const runId=new Date().toISOString().replace(/[-:.]/g,'').slice(0,15)+'-'+crypto.randomUUID().slice(0,8);
 const pdf=syntheticPdf(runId,option('--pdf-bytes',0));assertPdfBytes(pdf);
 const scope={kind:'teacher-lesson-documentation',school:'SYNTHETIC R2 SELF-CHECK',teacher:'Synthetic Check '+runId,grade:'Synthetic',section:'Z',subject:'Storage Check',from:'2026-11-01',to:'2026-11-17',generatedAt:new Date().toISOString(),includeArchived:false};
 out('synthetic',{runId,pdfBytes:pdf.length});

 if(args.has('--probe')){
  // Isolate the failing request shape on fresh random keys (each a sealed synthetic envelope).
  const fresh=async()=>{const id=crypto.randomUUID();return {id,key:snapshotKey(id),body:await sealSnapshot(secret,id,{v:1,id,synthetic:runId},pdf)};};
  const report=async(variant,res)=>{const d=res.ok?{op:variant.split(':')[0],status:res.status,code:'',requestId:String(res.headers.get('cf-ray')||'').slice(0,64)}:await r2Diagnostics(variant.split(':')[0],res);out('probe',{variant,ok:res.ok,status:d.status,code:d.code,ref:d.requestId});};
  const header=new AwsClient({accessKeyId:config.R2_ACCESS_KEY_ID,secretAccessKey:config.R2_SECRET_ACCESS_KEY,service:'s3',region:'auto'});
  const objectUrl=key=>new URL(config.R2_ENDPOINT_URL).origin+'/'+encodeURIComponent(config.R2_BUCKET_NAME)+'/'+key.split('/').map(encodeURIComponent).join('/');
  let o=await fresh();await report('HEAD:query-signed-absent',await r2Request(config,o.key,'HEAD'));
  // The request exactly as deployed in 88871b8 (signed Request object passed to fetch).
  const deployedShape=async(key,body)=>{const signed=await header.sign(objectUrl(key),{method:'PUT',headers:{'Content-Type':'application/octet-stream','If-None-Match':'*','x-amz-content-sha256':'UNSIGNED-PAYLOAD'},body,aws:{signQuery:true},duplex:'half'});return fetch(signed,{signal:AbortSignal.timeout(120000)});};
  o=await fresh();await report('PUT:deployed-88871b8-request-shape',await deployedShape(o.key,o.body));
  o=await fresh();await report('PUT:fixed-r2Request+if-none-match',await r2Request(config,o.key,'PUT',o.body,{'Content-Type':'application/octet-stream','If-None-Match':'*'}));
  o=await fresh();await report('PUT:query-signed-no-condition',await r2Request(config,o.key,'PUT',o.body,{'Content-Type':'application/octet-stream'}));
  o=await fresh();await report('PUT:header-signed+if-none-match',await header.fetch(objectUrl(o.key),{method:'PUT',body:o.body,headers:{'Content-Type':'application/octet-stream','If-None-Match':'*'}}));
  o=await fresh();await report('PUT:header-signed-no-condition',await header.fetch(objectUrl(o.key),{method:'PUT',body:o.body,headers:{'Content-Type':'application/octet-stream'}}));
  if(args.has('--size-probe')){
   // Same request shapes at the sizes real lesson PDFs reach (with photo thumbnails, up to 4 MB).
   for(const size of [262144,1048576,2500000,3900000]){
    const big=syntheticPdf(runId,size),id=crypto.randomUUID(),id2=crypto.randomUUID();
    const t0=Date.now();await report(`PUT:deployed-88871b8-request-shape@${big.length}B`,await deployedShape(snapshotKey(id),await sealSnapshot(secret,id,{v:1,id,synthetic:runId},big)).catch(e=>({ok:false,status:'fetch-error:'+String(e?.cause?.code||e?.name||'error'),headers:new Headers(),text:async()=>''})));out('probe-ms',{ms:Date.now()-t0});
    const t1=Date.now();await report(`PUT:fixed-r2Request@${big.length}B`,await r2Request(config,snapshotKey(id2),'PUT',await sealSnapshot(secret,id2,{v:1,id:id2,synthetic:runId},big),{'Content-Type':'application/octet-stream','If-None-Match':'*'}).catch(e=>({ok:false,status:'fetch-error:'+String(e?.cause?.code||e?.name||'error'),headers:new Headers(),text:async()=>''})));out('probe-ms',{ms:Date.now()-t1});
   }
  }
 }

 // 1. Store through the production code path.
 let stored;
 try{stored=await storeSnapshotObject({config,secret,scope,pdf,createdBy:'r2-selfcheck@synthetic.invalid'});check('store',stored.created,{created:stored.created,snapshotId:stored.id});}
 catch(e){check('store',false,{error:String(e.message).replace(/^\d+:/,''),r2:e.r2||null});return;}
 // 2. Present in storage.
 check('head-after-store',await snapshotExists(config,stored.key,'selfcheck-head'));
 // 3. Retrying the identical export reuses the snapshot (no second write).
 const again=await storeSnapshotObject({config,secret,scope,pdf,createdBy:'r2-selfcheck@synthetic.invalid'});
 check('identical-retry-reuses',again.id===stored.id&&again.created===false,{created:again.created});
 // 4. Duplicate-write protection: a conflicting conditional PUT to the same key is refused, bytes unchanged.
 const before=new Uint8Array(await (await r2Request(config,stored.key,'GET')).arrayBuffer());
 const rival=await sealSnapshot(secret,stored.id,{v:1,id:stored.id,rival:true},pdf);
 const dup=await r2Request(config,stored.key,'PUT',rival,{'Content-Type':'application/octet-stream','If-None-Match':'*'});
 const dupDiag=dup.ok?{status:dup.status}:await r2Diagnostics('PUT',dup);
 const after=new Uint8Array(await (await r2Request(config,stored.key,'GET')).arrayBuffer());
 check('duplicate-write-refused',dup.status===412&&equal(before,after),{status:dupDiag.status,code:dupDiag.code||'',unchanged:equal(before,after)});
 // 5. Read back and decrypt through the production code path; bytes match exactly.
 const {meta,pdf:read}=await loadSnapshotObject({config,secret,id:stored.id});
 check('read-decrypt-matches',equal(read,pdf)&&meta.sha256===await sha256Hex(pdf)&&meta.school===scope.school,{bytes:read.length});
 // 6. The envelope is bound to its ID (cannot be replayed under another ID).
 let bound=false;try{await openSnapshot(secret,crypto.randomUUID(),before);}catch(e){bound=String(e.message).startsWith('404:');}
 check('envelope-bound-to-id',bound);
 // 7. The public bucket URL exposes ciphertext only.
 const pub=await fetch(config.R2_PUBLIC_BASE_URL.replace(/\/$/,'')+'/'+stored.key,{signal:AbortSignal.timeout(15000)}).catch(()=>null);
 const pubBytes=pub&&pub.ok?new Uint8Array(await pub.arrayBuffer()):new Uint8Array();
 const plain=new TextDecoder('latin1').decode(pubBytes);
 check('public-url-ciphertext-only',!plain.includes('%PDF')&&!plain.includes('Synthetic R2 self-check')&&!plain.includes(scope.teacher),{publicStatus:pub?pub.status:'unreachable',bytes:pubBytes.length});
 if(!args.has('--share'))return;
 // 8. Sharing link: create → read back → not revoked → revoke (once) → revoked; records are ciphertext.
 const created=await createShareObject({config,secret,snapshotId:stored.id,school:scope.school,createdBy:'r2-selfcheck@synthetic.invalid'});
 const record=await loadShareObject({config,secret,id:created.id});
 check('share-created-and-read',record.snapshotId===stored.id&&sameDigest(await secretDigest(created.shareSecret),record.secretSha256),{shareId:created.id});
 check('share-not-revoked',(await shareRevocation({config,secret,id:created.id}))===null);
 const r1=await revokeShareObject({config,secret,id:created.id,revokedBy:'r2-selfcheck@synthetic.invalid'}),r2b=await revokeShareObject({config,secret,id:created.id,revokedBy:'r2-selfcheck@synthetic.invalid'});
 check('share-revoked-once',r1.alreadyRevoked===false&&r2b.alreadyRevoked===true&&Boolean(await shareRevocation({config,secret,id:created.id})));
 const leaks=[];for(const key of [shareKey(created.id),revokedKey(created.id)]){const r=await fetch(config.R2_PUBLIC_BASE_URL.replace(/\/$/,'')+'/'+key,{signal:AbortSignal.timeout(15000)}).catch(()=>null);const t=r&&r.ok?new TextDecoder('latin1').decode(new Uint8Array(await r.arrayBuffer())):'';if(t.includes(created.shareSecret)||t.includes(stored.id)||t.includes(scope.school))leaks.push(key.endsWith('.bin')?'record':'marker');}
 check('share-public-urls-ciphertext-only',leaks.length===0,{leaks});
}

async function run(){
 if(!args.has('--next-route-context'))return main();
 globalThis.AsyncLocalStorage=AsyncLocalStorage;
 const require=createRequire(import.meta.url);
 const {createPatchedFetcher}=require('next/dist/server/lib/patch-fetch.js');
 const {workAsyncStorage}=require('next/dist/server/app-render/work-async-storage.external.js');
 const {workUnitAsyncStorage}=require('next/dist/server/app-render/work-unit-async-storage.external.js');
 globalThis.fetch=createPatchedFetcher(globalThis.fetch,{workAsyncStorage,workUnitAsyncStorage});
 out('fetch-context',{nextPatchedFetch:true,routeHandler:'/api/school-success/report-snapshots'});
 const store={route:'/api/school-success/report-snapshots',page:'/api/school-success/report-snapshots/route',isDraftMode:false,isStaticGeneration:false,nextFetchId:1,pendingRevalidates:{},incrementalCache:undefined};
 return workAsyncStorage.run(store,()=>workUnitAsyncStorage.run({type:'request',implicitTags:{tags:[]}},main));
}
run().then(()=>{const pass=results.length>0&&results.every(Boolean);console.log('SELFCHECK RESULT '+(pass?'PASS':'FAIL'));process.exitCode=pass?0:1;})
 .catch(e=>{out('fatal',{error:String(e?.message||e).replace(/^\d+:/,'').slice(0,300)});console.log('SELFCHECK RESULT FAIL');process.exitCode=1;});
