// Route-level tests for lesson-documentation PDF snapshots: real routes, crypto and sealing; only the
// signed-in actor, R2 (in memory, honouring If-None-Match) and configuration loading are faked.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc');
const root=path.resolve(__dirname,'..'),SECRET='route-test-secret';
const CONFIG={SUPABASE_GATEWAY_TOKEN:SECRET,R2_ACCESS_KEY_ID:'k',R2_SECRET_ACCESS_KEY:'s',R2_ENDPOINT_URL:'https://acc.r2.cloudflarestorage.com',R2_BUCKET_NAME:'onelern-media',R2_PUBLIC_BASE_URL:'https://media.example.test'};
const ADMIN={role:'admin',email:'consultant@example.test',allowedSchools:['Alpha School']},SUPER={role:'admin',email:'super@example.test',allowedSchools:null};

function harness(){
 const r2=new Map(),writes=[],state={actor:ADMIN,fail:null};
 const status=(code,body,extra={})=>({ok:code<300,status:code,headers:new Headers({...(body?{'content-length':String(body.length)}:{}),...extra}),arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.length),text:async()=>Buffer.from(body||'').toString()});
 async function r2Request(config,key,method,body,headers={}){
  const scripted=state.fail&&state.fail(method);if(scripted)return scripted;
  if(method==='HEAD')return r2.has(key)?status(200,r2.get(key)):status(404);
  if(method==='GET')return r2.has(key)?status(200,r2.get(key)):status(404);
  if(method==='PUT'){if(headers['If-None-Match']==='*'&&r2.has(key))return status(412);const bytes=new Uint8Array(body);writes.push(key);r2.set(key,bytes);return status(200);}
  throw Error('Unexpected '+method);
 }
 const real=require(path.join(root,'lib/school-success/r2-evidence.js'));
 const mocks={
  '@/lib/school-success/server':{withRequest:(req,fn)=>fn(),actor:async()=>{if(!state.actor)throw Error('401:Sign in to Vision to open the School Success folder');return state.actor;},database:()=>({}),checkOrigin(){},
   assertSchool:(a,school)=>{if(!school||a.allowedSchools&&!a.allowedSchools.includes(school))throw Error('403:School is outside your assignment');},
   failure:e=>{const message=String(e.message||e),code=Number(message.match(/^(401|403|409|413|503):/)?.[1]||400); /* identical to server.js failure() */return Response.json({error:message.replace(/^\d+:/,'')},{status:code});}},
  '@/lib/school-success/environment':{env:{}},
  '@/lib/school-success/r2-evidence':{...real,r2Request,loadR2Config:async()=>CONFIG}
 };
 const load=file=>{const filename=path.join(root,file),out=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const normal=m.require.bind(m);m.require=name=>mocks[name]||normal(name.startsWith('@/')?path.join(root,name.slice(2)):name);m._compile(out.code,filename);return m.exports;};
 // The shared storage module is compiled with the same in-memory R2 in place of its relative import.
 mocks['./r2-evidence.js']=mocks['@/lib/school-success/r2-evidence'];
 mocks['@/lib/school-success/snapshot-storage']=load('lib/school-success/snapshot-storage.js');
 const store=load('app/api/school-success/report-snapshots/route.js'),one=load('app/api/school-success/report-snapshots/[id]/route.js');
 const scopeHeader=s=>Buffer.from(JSON.stringify(s)).toString('base64url');
 return {r2,writes,state,real,status,
  store:async(bytes,s)=>{const res=await store.POST(new Request('https://app.test/api/school-success/report-snapshots',{method:'POST',headers:{'Content-Type':'application/pdf','X-Snapshot-Scope':scopeHeader(s)},body:bytes}));return {status:res.status,body:await res.json()};},
  ticket:async id=>{const res=await one.POST(new Request('https://app.test/api/school-success/report-snapshots/'+id,{method:'POST'}),{params:Promise.resolve({id})});return {status:res.status,body:await res.json()};},
  open:async(id,query)=>one.GET(new Request('https://app.test/api/school-success/report-snapshots/'+id+query),{params:Promise.resolve({id})})};
}
const pdf=text=>new TextEncoder().encode(`%PDF-1.3\n${text}\n%%EOF\n`);
const scope=(over={})=>({kind:'teacher-lesson-documentation',school:'Alpha School',teacher:'AKANSHA PAL',grade:'Grade 1',section:'A',subject:'Mathematics',from:'2026-11-01',to:'2026-11-17',generatedAt:'2026-11-17T06:00:00.000Z',includeArchived:false,...over});

test('an authorised administrator stores a snapshot once; storage holds only ciphertext',async()=>{
 const h=harness(),bytes=pdf('AKANSHA PAL · Grade 1 · Mathematics');
 const first=await h.store(bytes,scope());
 assert.equal(first.status,200,JSON.stringify(first.body));assert.match(first.body.url,/^\/school-success\/report\/[0-9a-f-]{36}$/);
 const again=await h.store(bytes,scope());
 assert.equal(again.body.id,first.body.id,'retry of the same bytes reuses the snapshot');assert.equal(h.writes.length,1,'no duplicate object');
 const stored=Buffer.from([...h.r2.values()][0]);
 assert.ok(!stored.includes(Buffer.from('%PDF'))&&!stored.includes(Buffer.from('AKANSHA')),'public bucket URL would expose only ciphertext');
});

test('storing is refused outside the reader’s schools, for teachers and for invalid input',async()=>{
 const h=harness();
 assert.equal((await h.store(pdf('x'),scope({school:'Beta School'}))).status,403);
 h.state.actor={role:'school-teacher',email:'t@school.invalid',allowedSchools:['Alpha School']};
 assert.equal((await h.store(pdf('x'),scope())).status,403);
 h.state.actor=null;assert.equal((await h.store(pdf('x'),scope())).status,401);
 h.state.actor=ADMIN;
 assert.equal((await h.store(new TextEncoder().encode('<html>not a pdf</html>'),scope())).status,400);
 assert.equal((await h.store(pdf('x'),{...scope(),from:'2026-01-01',to:'2026-08-01'})).status,400);
 assert.equal((await h.store(pdf('x'),{...scope(),school:'Alpha School',extra:'x'})).status,400);
 const big=new Uint8Array(4_000_100);big.set(pdf('x'));big.set(new TextEncoder().encode('%%EOF'),big.length-6);
 assert.equal((await h.store(big,scope())).status,413);
 assert.equal(h.writes.length,0);
});

test('an authorised reader gets a ticket and the PDF opens inline with a filename; download is available',async()=>{
 const h=harness(),bytes=pdf('lesson documentation body'),{body:{id}}=await h.store(bytes,scope());
 const t=await h.ticket(id);assert.equal(t.status,200);assert.match(t.body.url,new RegExp(`^/api/school-success/report-snapshots/${id}\\?ticket=`));
 assert.equal(t.body.filename,'Lesson_Documentation_AKANSHA_PAL_Grade_1_A_Mathematics_2026-11-01_2026-11-17.pdf');
 const res=await h.open(id,t.body.url.slice(t.body.url.indexOf('?')));
 assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),'application/pdf');
 assert.match(res.headers.get('content-disposition'),/^inline; filename="Lesson_Documentation_AKANSHA_PAL_Grade_1_A_Mathematics_2026-11-01_2026-11-17\.pdf"/);
 assert.equal(res.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(Buffer.from(await res.arrayBuffer()),Buffer.from(bytes));
 const dl=await h.open(id,t.body.downloadUrl.slice(t.body.downloadUrl.indexOf('?')));assert.match(dl.headers.get('content-disposition'),/^attachment;/);
 h.state.actor=SUPER;assert.equal((await h.ticket(id)).status,200,'super admin may open any school');
});

test('other schools, altered IDs, foreign or expired tickets cannot reach a snapshot',async()=>{
 const h=harness(),{body:{id}}=await h.store(pdf('alpha'),scope());
 h.state.actor={role:'admin',email:'other@example.test',allowedSchools:['Beta School']};
 assert.equal((await h.ticket(id)).status,403,'stored school is checked, not URL parameters');
 h.state.actor={role:'school-teacher',email:'t@school.invalid',allowedSchools:['Alpha School']};assert.equal((await h.ticket(id)).status,403);
 h.state.actor=ADMIN;
 const altered=id.slice(0,-1)+(id.endsWith('0')?'1':'0');
 assert.equal((await h.ticket(altered)).status,404);assert.equal((await h.ticket('../secrets')).status,404);
 const {body:{id:other}}=await h.store(pdf('second'),scope({subject:'English'}));
 const t=await h.ticket(id),q=t.body.url.slice(t.body.url.indexOf('?'));
 const crossed=await h.open(other,q);assert.equal(crossed.status,303,'a ticket for one snapshot does not open another');assert.equal(new URL(crossed.headers.get('location')).pathname,'/school-success/report/'+other);
 const expired=await h.real.seal({kind:'snapshot-view',id,email:ADMIN.email,exp:Date.now()-1},SECRET);
 const late=await h.open(id,'?ticket='+encodeURIComponent(expired));assert.equal(late.status,303);assert.equal(new URL(late.headers.get('location')).pathname,'/school-success/report/'+id,'back through sign-in and authorisation');
 assert.equal((await h.open(id,'')).status,303,'the bare API address never serves the PDF');
 const forged=await h.real.seal({kind:'snapshot-view',id,email:ADMIN.email,exp:Date.now()+60000},'wrong-secret');
 assert.equal((await h.open(id,'?ticket='+encodeURIComponent(forged))).status,303);
});

test('stored snapshots never change; a later export of updated lessons creates a new snapshot',async()=>{
 const h=harness(),first=await h.store(pdf('version 1'),scope()),before=Buffer.from(h.r2.get([...h.r2.keys()][0]));
 const later=await h.store(pdf('version 2 with new evidence'),scope({generatedAt:'2026-11-18T06:00:00.000Z'}));
 assert.notEqual(later.body.id,first.body.id);
 assert.deepEqual(Buffer.from(h.r2.get([...h.r2.keys()][0])),before,'earlier snapshot unchanged');
 const t=await h.ticket(first.body.id),res=await h.open(first.body.id,t.body.url.slice(t.body.url.indexOf('?')));
 assert.match(Buffer.from(await res.arrayBuffer()).toString(),/version 1/);
 // Tampered storage is detected rather than served.
 const key=[...h.r2.keys()][0],bad=new Uint8Array(h.r2.get(key));bad[bad.length-3]^=1;h.r2.set(key,bad);
 assert.equal((await h.ticket(first.body.id)).status,404);
});

test('storage failures answer 503 with diagnostics: no upload after a failed HEAD, no "not found" for an outage',async()=>{
 const h=harness(),xml=code=>new TextEncoder().encode(`<Error><Code>${code}</Code></Error>`),ray={'cf-ray':'8f00aa11bb22cc33-BOM'};
 const errors=[],nativeError=console.error;console.error=(...a)=>errors.push(a.join(' '));
 try{
  h.state.fail=method=>method==='HEAD'?h.status(403,null,ray):null;
  const head=await h.store(pdf('x'),scope());
  assert.equal(head.status,503);assert.equal(head.body.error,'Report storage could not be checked (R2 HEAD 403, ref 8f00aa11bb22cc33-BOM). Retry the export.');
  assert.equal(h.writes.length,0,'a failed HEAD is never treated as permission to upload');
  h.state.fail=method=>method==='PUT'?h.status(400,xml('InvalidRequest'),ray):null;
  const put=await h.store(pdf('x'),scope());
  assert.equal(put.status,503,'retryable by the export');assert.equal(put.body.error,'Lesson documentation could not be stored (R2 PUT 400 InvalidRequest, ref 8f00aa11bb22cc33-BOM). Retry the export.');
  h.state.fail=null;const {body:{id}}=await h.store(pdf('ok'),scope());
  h.state.fail=method=>method==='GET'?h.status(503,xml('ServiceUnavailable'),ray):null;
  const t=await h.ticket(id);assert.equal(t.status,503);assert.match(t.body.error,/^Lesson documentation could not be read from storage \(R2 GET 503 ServiceUnavailable, ref 8f00aa11bb22cc33-BOM\)/);
  assert.equal(errors.length,3);for(const line of errors){const log=JSON.parse(line);assert.equal(log.event,'r2-request-failed');assert.ok(!line.includes('Alpha')&&!line.includes('AKANSHA')&&!line.includes('report-snapshots/v1')&&!line.includes(SECRET),'no teacher details, keys or secrets in logs');}
 }finally{console.error=nativeError;}
});
