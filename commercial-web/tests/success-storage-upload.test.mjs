// Browser evidence upload (presigned PUT to R2): storage rejections vs network/CORS failures, bounded
// retries with a fresh ticket, safe diagnostics, and the upload-report route.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import {createRequire} from 'node:module';
import {uploadEvidenceFile,storageOutcome,retryable,uploadMessage,transferWrittenReflections} from '../lib/school-success/storage-upload.js';

const SIGNED='https://acc.r2.cloudflarestorage.com/onelern-media/schools/Alpha%2520School/teachers/AKANSHA%2520PAL/x.pdf?X-Amz-Signature=deadbeef&X-Amz-Credential=AKSECRET';
const xml=(status,code,id)=>new Response(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>m</Message>${id?`<RequestId>${id}</RequestId>`:''}</Error>`,{status});
function harness(answers,{file='generated-preparation-pdf'}={}){
 const tickets=[],puts=[],reports=[],waits=[];
 return {tickets,puts,reports,waits,run:(body=new Blob(['%PDF-1.4 lesson'],{type:'application/pdf'}))=>uploadEvidenceFile({
  fetchTicket:async()=>{tickets.push(1);return Response.json({url:SIGNED+'&n='+tickets.length,contentType:'application/pdf',file});},
  put:async(url,init)=>{puts.push({url,init});const a=answers.shift();if(a instanceof Error)throw a;return a;},
  body,report:o=>reports.push(o),wait:async ms=>{waits.push(ms);}})};
}

test('success on the first attempt sends the Blob itself (browser sets Content-Length) with the signed type',async()=>{
 const h=harness([new Response(null,{status:200})]),body=new Blob(['%PDF'],{type:'application/pdf'});
 const res=await h.run(body);assert.equal(res.status,200);assert.deepEqual(await res.json(),{ok:true,attempts:1});
 assert.equal(h.puts[0].init.body,body,'body is not re-wrapped');assert.deepEqual(h.puts[0].init.headers,{'Content-Type':'application/pdf'},'no manual Content-Length');
 assert.equal(h.reports.length,0);
});

test('storage rejection: no retry for 403, message names the file, R2 status, code and reference; nothing secret',async()=>{
 const h=harness([xml(403,'AccessDenied','3f2a9c')]);
 const res=await h.run(),body=await res.json();
 assert.equal(res.status,502);assert.equal(h.puts.length,1,'a permanent rejection is not retried');
 assert.equal(body.error,'Storage upload failed: storage refused the lesson preparation PDF (R2 403 AccessDenied, ref 3f2a9c). Your lesson details and selected files are kept on this page — save again to retry.');
 assert.deepEqual(body.upload,{kind:'storage',status:403,code:'AccessDenied',ref:'3f2a9c',file:'generated-preparation-pdf',attempt:1});
 assert.deepEqual(h.reports,[{kind:'storage',status:403,code:'AccessDenied',ref:'3f2a9c',file:'generated-preparation-pdf',attempt:1,final:true}]);
 for(const text of [JSON.stringify(body),JSON.stringify(h.reports)])for(const secret of ['X-Amz','deadbeef','AKSECRET','cloudflarestorage','AKANSHA','Alpha'])assert.ok(!text.includes(secret),secret);
});

test('transient answers are retried with a fresh ticket each time and recover',async()=>{
 const h=harness([xml(503,'ServiceUnavailable'),xml(400,'RequestTimeout'),new Response(null,{status:200})]);
 const res=await h.run();assert.deepEqual(await res.json(),{ok:true,attempts:3});
 assert.equal(h.tickets.length,3,'new presigned URL per attempt');assert.deepEqual(h.waits,[1500,3000]);
 assert.deepEqual(h.reports.map(r=>[r.status,r.code,r.final]),[[503,'ServiceUnavailable',false],[400,'RequestTimeout',false]]);
});

test('network/CORS failure (fetch throws, e.g. Safari "Load failed") is distinguished from a storage answer',async()=>{
 const h=harness([new TypeError('Load failed'),new TypeError('Load failed'),new TypeError('Load failed')],{file:'voice'});
 const res=await h.run(),body=await res.json();
 assert.equal(h.puts.length,3);assert.equal(body.upload.kind,'network');assert.equal(body.upload.status,0);
 assert.match(body.error,/^Storage upload failed: the voice note could not reach storage \(network connection lost or the browser blocked the upload\)\./);
 assert.deepEqual(h.reports.map(r=>r.final),[false,false,true]);
});

test('ticket errors from our API are passed through unchanged (no upload attempted)',async()=>{
 const puts=[];const res=await uploadEvidenceFile({fetchTicket:async()=>Response.json({error:'Submission permission expired or is invalid. Prepare the submission again.'},{status:403}),put:async()=>{puts.push(1);},body:new Blob(['x'])});
 assert.equal(res.status,403);assert.equal(puts.length,0);
});

test('diagnostic parsing keeps only safe codes and references',async()=>{
 assert.deepEqual(await storageOutcome(new Response('<Error><Code>Bad<script></Code><RequestId>a"b c</RequestId></Error>',{status:400})),{kind:'storage',status:400,code:'',ref:'abc'});
 assert.equal(retryable({kind:'storage',status:403,code:'SignatureDoesNotMatch'}),false);
 assert.equal(retryable({kind:'storage',status:429,code:''}),true);
 assert.match(uploadMessage({kind:'storage',status:500,code:'',ref:'',file:'unknown-kind'}),/refused the file \(R2 500\)/);
});

test('reflection transfers send the prepared UTF-8 bytes and yield to commit after one blocked request',async()=>{
 const headers={'Content-Type':'application/json','Content-MD5':'synthetic','If-None-Match':'*'};
 const tickets=['पहला','दूसरा','तीसरा'].map((text,i)=>({text,headers,url:'https://storage.example.test/'+i}));
 const seen=[];
 await transferWrittenReflections(tickets,async(url,init)=>{
  seen.push(await init.body.text());
  assert.deepEqual(init.headers,headers);assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');
  return new Response(null,{status:seen.length===1?412:seen.length===2?503:200});
 });
 assert.deepEqual(seen,tickets.slice(0,2).map(t=>t.text));
 let attempts=0;
 await transferWrittenReflections(tickets,async()=>{attempts++;throw TypeError('interrupted');});
 assert.equal(attempts,1);
});

// upload-report route: authenticated, strict schema, logs only safe fields.
const root=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..'),require=createRequire(import.meta.url);
const {transformSync}=require('next/dist/build/swc');
function loadReportRoute(state){
 const mocks={'@/lib/school-success/server':{withRequest:(req,fn)=>fn(),checkOrigin(req){const o=req.headers.get('Origin');if(o&&o!==new URL(req.url).origin)throw Error('403:Cross-origin request rejected');},actor:async()=>{if(!state.actor)throw Error('401:Sign in');return state.actor;},
  failure:e=>{const m=String(e.message||e),code=Number(m.match(/^(401|403|409|413|503):/)?.[1]||400);return Response.json({error:m.replace(/^\d+:/,'')},{status:code});}}};
 const file=path.join(root,'app/api/school-success/evidence/upload-report/route.js');
 const out=transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}});
 const m=new Module(file);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));const normal=m.require.bind(m);
 m.require=n=>mocks[n]||normal(n.startsWith('@/')?path.join(root,n.slice(2)):n);m._compile(out.code,file);return m.exports;
}
test('upload-report route logs only safe fields for authenticated callers and rejects anything else',async()=>{
 const state={actor:{role:'school-teacher',school:'Alpha School',name:'AKANSHA PAL',email:'t@school.invalid'}},route=loadReportRoute(state),logs=[],warn=console.warn;
 console.warn=(...a)=>logs.push(a.join(' '));
 const post=(body,headers={})=>route.POST(new Request('https://app.test/api/school-success/evidence/upload-report',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',...headers},body:JSON.stringify(body)}));
 const good={kind:'storage',file:'generated-preparation-pdf',status:403,code:'AccessDenied',ref:'3f2a9c',attempt:1,final:true};
 try{
  assert.equal((await post(good)).status,204);
  assert.deepEqual(JSON.parse(logs[0]),{event:'browser-upload-failed',...good,agent:'iPhone 18 Safari'});
  assert.ok(!logs[0].includes('AKANSHA')&&!logs[0].includes('Alpha'));
  assert.equal((await post({...good,url:SIGNED})).status,400,'unknown fields (e.g. a signed URL) are refused');
  assert.equal((await post({...good,code:'<x>'})).status,400);
  assert.equal((await post({...good,file:'Lesson-preparation-1.pdf'})).status,400,'file names are not accepted');
  assert.equal((await post(good,{Origin:'https://evil.example'})).status,403);
  state.actor=null;assert.equal((await post(good)).status,401);
  assert.equal(logs.length,1);
 }finally{console.warn=warn;}
});
