// Snapshot storage against a scripted R2 (real r2Request, signing and crypto; only fetch is faked):
// HEAD must treat only 404 as "absent", failures must surface status/code/reference without secrets,
// writes never overwrite, and storage outages on read are not reported as "not found".
import test from 'node:test';
import assert from 'node:assert/strict';
import {storeSnapshotObject,loadSnapshotObject,snapshotExists} from '../lib/school-success/snapshot-storage.js';
import {r2Diagnostics,describeR2} from '../lib/school-success/r2-evidence.js';

const SECRET='storage-test-secret',config={R2_ACCESS_KEY_ID:'AKTEST',R2_SECRET_ACCESS_KEY:'super-secret-key',R2_ENDPOINT_URL:'https://acc.r2.cloudflarestorage.com',R2_BUCKET_NAME:'onelern-media',R2_PUBLIC_BASE_URL:'https://media.example.test',SUPABASE_GATEWAY_TOKEN:SECRET};
const scope={kind:'teacher-lesson-documentation',school:'Alpha School',teacher:'AKANSHA PAL',grade:'Grade 1',section:'A',subject:'Mathematics',from:'2026-11-01',to:'2026-11-17',generatedAt:'2026-11-17T06:00:00.000Z',includeArchived:false};
const pdf=new TextEncoder().encode('%PDF-1.4\nAKANSHA PAL lesson documentation\n%%EOF\n');
const xml=(status,code)=>new Response(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>detail</Message></Error>`,{status,headers:{'cf-ray':'8f00aa11bb22cc33-BOM'}});

// script: (method, call) → Response | undefined (default: in-memory bucket honouring If-None-Match).
function scriptedR2(script=()=>undefined){
 const bucket=new Map(),calls=[],native=globalThis.fetch,logs=[],nativeError=console.error;
 globalThis.fetch=async(input,init={})=>{
  assert.equal(typeof input,'string','r2Request passes a URL string');
  const url=new URL(input),key=decodeURIComponent(url.pathname.split('/').slice(2).join('/')),method=init.method||'GET';
  const call={method,key,headers:new Headers(init.headers),length:init.body?.byteLength??null};calls.push(call);
  const scripted=await script(method,call,calls);if(scripted)return scripted;
  if(method==='HEAD')return new Response(null,{status:bucket.has(key)?200:404});
  if(method==='GET')return bucket.has(key)?new Response(bucket.get(key)):xml(404,'NoSuchKey');
  if(method==='PUT'){if(call.headers.get('if-none-match')==='*'&&bucket.has(key))return xml(412,'PreconditionFailed');bucket.set(key,new Uint8Array(init.body));return new Response(null,{status:200});}
  return new Response(null,{status:405});
 };
 console.error=(...a)=>logs.push(a.join(' '));
 return {bucket,calls,logs,restore(){globalThis.fetch=native;console.error=nativeError;}};
}
const store=()=>storeSnapshotObject({config,secret:SECRET,scope,pdf,createdBy:'consultant@example.test'});

test('stores once with If-None-Match and a known length; reads back the exact bytes',async()=>{
 const r=scriptedR2();
 try{
  const first=await store();assert.equal(first.created,true);
  const put=r.calls.find(c=>c.method==='PUT');assert.equal(put.headers.get('if-none-match'),'*');assert.ok(put.length>pdf.length,'encrypted envelope sent with its length');
  const again=await store();assert.equal(again.id,first.id);assert.equal(again.created,false);assert.equal(r.calls.filter(c=>c.method==='PUT').length,1,'no second write');
  const {pdf:read,meta}=await loadSnapshotObject({config,secret:SECRET,id:first.id});
  assert.deepEqual(read,pdf);assert.equal(meta.school,'Alpha School');
 }finally{r.restore();}
});

test('HEAD failures other than 404 are surfaced and never treated as permission to upload',async()=>{
 for(const status of [403,500,503]){
  const r=scriptedR2(method=>method==='HEAD'?new Response(null,{status,headers:{'cf-ray':'8f00aa11bb22cc33-BOM'}}):undefined);
  try{
   await assert.rejects(store(),e=>{assert.match(e.message,new RegExp(`^503:Report storage could not be checked \\(R2 HEAD ${status}, ref 8f00aa11bb22cc33-BOM\\)\\. Retry the export\\.$`));return true;});
   assert.equal(r.calls.filter(c=>c.method==='PUT').length,0,`no upload after HEAD ${status}`);
  }finally{r.restore();}
 }
});

test('the observed PUT failure reports operation, status, R2 code and reference; logs carry no secrets or content',async()=>{
 const r=scriptedR2(method=>method==='PUT'?xml(411,'MissingContentLength'):undefined);
 try{
  await assert.rejects(store(),e=>{assert.equal(e.message,'503:Lesson documentation could not be stored (R2 PUT 411 MissingContentLength, ref 8f00aa11bb22cc33-BOM). Retry the export.');assert.deepEqual(e.r2,{op:'PUT',status:411,code:'MissingContentLength',requestId:'8f00aa11bb22cc33-BOM'});return true;});
  assert.equal(r.logs.length,1);const log=JSON.parse(r.logs[0]);
  assert.deepEqual(log,{event:'r2-request-failed',stage:'snapshot-put',op:'PUT',status:411,code:'MissingContentLength',requestId:'8f00aa11bb22cc33-BOM'});
  for(const secret of ['super-secret-key','AKTEST',SECRET,'X-Amz-Signature','report-snapshots','AKANSHA','Alpha School'])assert.ok(!r.logs[0].includes(secret),`log omits ${secret}`);
 }finally{r.restore();}
});

test('a 412 from a concurrent identical write is accepted once the object is confirmed; nothing is overwritten',async()=>{
 const r=scriptedR2((method,call,calls)=>method==='PUT'?xml(412,'PreconditionFailed'):method==='HEAD'&&calls.filter(c=>c.method==='HEAD').length>1?new Response(null,{status:200}):undefined);
 try{const s=await store();assert.equal(s.created,false);assert.equal(r.bucket.size,0,'the existing object was not replaced');}
 finally{r.restore();}
});

test('a missing object after a successful PUT is reported, not linked',async()=>{
 const r=scriptedR2(method=>method==='PUT'?new Response(null,{status:200}):method==='HEAD'?new Response(null,{status:404}):undefined);
 try{await assert.rejects(store(),/^Error: 503:Lesson documentation could not be confirmed in storage/);}finally{r.restore();}
});

test('reads: 404 is "not found"; storage errors are 503 with diagnostics, not "not found"',async()=>{
 const id='0b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f60';
 let r=scriptedR2();
 try{await assert.rejects(loadSnapshotObject({config,secret:SECRET,id}),/^Error: 404:/);}finally{r.restore();}
 r=scriptedR2(method=>method==='GET'?xml(403,'AccessDenied'):undefined);
 try{await assert.rejects(loadSnapshotObject({config,secret:SECRET,id}),/^Error: 503:Lesson documentation could not be read from storage \(R2 GET 403 AccessDenied, ref 8f00aa11bb22cc33-BOM\)\. Try again shortly\.$/);}finally{r.restore();}
 r=scriptedR2(method=>method==='HEAD'?new Response(null,{status:404}):undefined);
 try{assert.equal(await snapshotExists(config,'school-success/report-snapshots/v1/'+id+'.bin','t'),false);}finally{r.restore();}
});

test('diagnostics accept only safe codes and references',async()=>{
 const d=await r2Diagnostics('PUT',new Response('<Error><Code>Bad<script></Code></Error>',{status:400,headers:{'cf-ray':'abc"; secret=1'}}));
 assert.deepEqual(d,{op:'PUT',status:400,code:'',requestId:'abcsecret1'});
 assert.equal(describeR2({op:'HEAD',status:403,code:'',requestId:''}),'R2 HEAD 403');
});
