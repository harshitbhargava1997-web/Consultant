// Regression test for the production failure "Lesson documentation could not be stored" (R2 answered
// 411 MissingContentLength, confirmed against real R2 through Next.js's patched fetch): inside Next.js
// route handlers the patched fetch rebuilt the signed Request from its body stream, so R2 PUTs went out
// with Transfer-Encoding: chunked and no Content-Length. Uses Next's real patched fetch and a local server
// to observe the bytes on the wire.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
import {AsyncLocalStorage} from 'node:async_hooks';
import {AwsClient} from 'aws4fetch';

globalThis.AsyncLocalStorage??=AsyncLocalStorage;
const require=createRequire(import.meta.url);
const {createPatchedFetcher}=require('next/dist/server/lib/patch-fetch.js');
const {workAsyncStorage}=require('next/dist/server/app-render/work-async-storage.external.js');
const {workUnitAsyncStorage}=require('next/dist/server/app-render/work-unit-async-storage.external.js');
const {r2Request}=await import('../lib/school-success/r2-evidence.js');

const config={R2_ACCESS_KEY_ID:'AKTEST',R2_SECRET_ACCESS_KEY:'test-secret',R2_ENDPOINT_URL:'https://acc.r2.cloudflarestorage.com',R2_BUCKET_NAME:'onelern-media',R2_PUBLIC_BASE_URL:'https://media.example.test'};
const inRouteHandler=fn=>workAsyncStorage.run({route:'/api/school-success/report-snapshots',page:'/api/school-success/report-snapshots/route',isDraftMode:false,isStaticGeneration:false,nextFetchId:1,pendingRevalidates:{},incrementalCache:undefined},()=>workUnitAsyncStorage.run({type:'request',implicitTags:{tags:[]}},fn));

async function wire(){
 const seen=[];
 const server=http.createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{seen.push({method:req.method,url:req.url,contentLength:req.headers['content-length']??null,transferEncoding:req.headers['transfer-encoding']??null,ifNoneMatch:req.headers['if-none-match']??null,body:Buffer.concat(chunks)});res.end();});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {seen,origin:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};
}
const body=()=>{const b=new Uint8Array(70000);for(let i=0;i<b.length;i++)b[i]=(i*31)&255;return b;};

test('cause: the deployed request shape loses Content-Length inside a Next.js route handler',async()=>{
 const w=await wire(),patched=createPatchedFetcher(globalThis.fetch,{workAsyncStorage,workUnitAsyncStorage});
 const send=async f=>{const signed=await new AwsClient({accessKeyId:'AK',secretAccessKey:'SK',service:'s3',region:'auto'}).sign(w.origin+'/onelern-media/k.bin',{method:'PUT',headers:{'If-None-Match':'*','x-amz-content-sha256':'UNSIGNED-PAYLOAD'},body:body(),aws:{signQuery:true},duplex:'half'});return f(signed,{signal:AbortSignal.timeout(5000)});};
 try{
  await send(globalThis.fetch);await inRouteHandler(()=>send(patched));
  assert.equal(w.seen[0].contentLength,'70000','plain Node keeps the length (why the build-machine self-check passed)');
  assert.equal(w.seen[1].contentLength,null);assert.equal(w.seen[1].transferEncoding,'chunked','route handler: chunked upload without Content-Length');
 }finally{await w.close();}
});

test('fix: r2Request sends a URL and known-length bytes, so PUTs keep Content-Length inside route handlers',async()=>{
 const w=await wire(),native=globalThis.fetch,inputs=[];
 // Faithful redirect to the local server: only string URLs can be redirected without re-wrapping a body.
 const origin=(input,init)=>{inputs.push(typeof input);if(typeof input!=='string')throw Error('r2Request must not pass a Request object to fetch');const u=new URL(input);return native(w.origin+u.pathname+u.search,init);};
 globalThis.fetch=createPatchedFetcher(origin,{workAsyncStorage,workUnitAsyncStorage});
 try{
  const bytes=body();
  const put=await inRouteHandler(()=>r2Request(config,'school-success/report-snapshots/v1/0b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f60.bin','PUT',bytes,{'Content-Type':'application/octet-stream','If-None-Match':'*'}));
  const text=await inRouteHandler(()=>r2Request(config,'school-success/x/closure/r.json','PUT','{"answers":"नमस्ते"}',{'Content-Type':'application/json','If-None-Match':'*'}));
  const head=await inRouteHandler(()=>r2Request(config,'school-success/report-snapshots/v1/0b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f60.bin','HEAD'));
  assert.ok(put.ok&&text.ok&&head.ok);assert.deepEqual(inputs,['string','string','string']);
  const [p,t,h]=w.seen;
  assert.equal(p.contentLength,'70000');assert.equal(p.transferEncoding,null);assert.equal(p.ifNoneMatch,'*','overwrite protection is still sent');
  assert.deepEqual(new Uint8Array(p.body),bytes,'bytes arrive unchanged');
  assert.equal(t.contentLength,String(Buffer.byteLength('{"answers":"नमस्ते"}')),'text bodies (reflections) are sent as UTF-8 with a length');
  assert.equal(h.method,'HEAD');
  for(const s of w.seen){const q=new URL(s.url,w.origin).searchParams;assert.match(q.get('X-Amz-SignedHeaders'),/if-none-match|host/);assert.ok(q.get('X-Amz-Signature'));}
  assert.match(new URL(p.url,w.origin).searchParams.get('X-Amz-SignedHeaders'),/(^|;)if-none-match(;|$)/,'If-None-Match is covered by the signature');
 }finally{globalThis.fetch=native;await w.close();}
});

test('r2Request refuses stream bodies (their length would be unknown)',async()=>{
 await assert.rejects(r2Request(config,'school-success/x.bin','PUT',new ReadableStream()),/string or bytes/);
});
