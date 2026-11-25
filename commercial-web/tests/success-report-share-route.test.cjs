// Consolidated lesson-report links (anyone-with-the-link and school sign-in) and earlier sharing links:
// real routes, crypto, sealing and storage code; only the signed-in actor, configuration loading and R2
// (in memory, honouring If-None-Match) are faked.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc');
const root=path.resolve(__dirname,'..'),SECRET='share-route-secret';
const CONFIG={SUPABASE_GATEWAY_TOKEN:SECRET,R2_ACCESS_KEY_ID:'k',R2_SECRET_ACCESS_KEY:'s',R2_ENDPOINT_URL:'https://acc.r2.cloudflarestorage.com',R2_BUCKET_NAME:'onelern-media',R2_PUBLIC_BASE_URL:'https://media.example.test'};
const ADMIN={role:'admin',email:'consultant@example.test',allowedSchools:['Alpha School']},OTHER={role:'admin',email:'other@example.test',allowedSchools:['Beta School']},TEACHER={role:'school-teacher',email:'t@school.invalid',allowedSchools:['Alpha School']};

function harness(config = CONFIG){
 const r2=new Map(),writes=[],state={actor:ADMIN,fail:null,rows:[{id:201,Type:'Classroom Reflection',Center:'Alpha School',FullName:'AKANSHA PAL',Grade:'Grade 1',Section:'A',Subject:'Mathematics',implementation_date:'2026-11-05',Video_Evidence_1:KEYS[0],Writing_Sample_Link:KEYS[1],Portfolio_Evidence_Link:KEYS[2]}]},logs=[];
 const res=(code,body,extra={})=>({ok:code>=200&&code<300,status:code,headers:new Headers({...(body?{'content-length':String(body.length)}:{}),...extra}),body:null,arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.length),text:async()=>Buffer.from(body||'').toString()});
 async function r2Request(config,key,method,body,headers={}){
  const f=state.fail&&state.fail(method,key);if(f)return f;
  if(method==='HEAD'||method==='GET')return r2.has(key)?res(200,r2.get(key)):res(404);
  if(method==='PUT'){if(headers['If-None-Match']==='*'&&r2.has(key))return res(412);writes.push(key);r2.set(key,new Uint8Array(body));return res(200);}
  throw Error('Unexpected '+method);
 }
 const real=require(path.join(root,'lib/school-success/r2-evidence.js'));
 const r2Mock={...real,r2Request,loadR2Config:async()=>config};
 const mocks={
  '@/lib/school-success/live':{publicBase:()=>config.R2_PUBLIC_BASE_URL, reportLessonRows:async(scope, ids)=>state.rows.filter(row=>!ids?.length||ids.includes(String(row.id)))},
  '@/lib/school-success/server':{withRequest:(req,fn)=>fn(),database:()=>({}),
   actor:async()=>{if(!state.actor)throw Error('401:Sign in to Vision to open the School Success folder');return state.actor;},
   checkOrigin(req){const o=req.headers.get('Origin');if(o&&o!==new URL(req.url).origin)throw Error('403:Cross-origin request rejected');},
   assertSchool:(a,school)=>{if(!school||a.allowedSchools&&!a.allowedSchools.includes(school))throw Error('403:School is outside your assignment');},
   failure:e=>{const m=String(e.message||e),code=Number(m.match(/^(401|403|409|413|503):/)?.[1]||400);return Response.json({error:m.replace(/^\d+:/,'')},{status:code});}},
  '@/lib/school-success/environment':{env:{}},'@/lib/school-success/r2-evidence':r2Mock,'./r2-evidence.js':r2Mock};
 const load=file=>{const filename=path.join(root,file),out=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const normal=m.require.bind(m);m.require=name=>mocks[name]||normal(name.startsWith('@/')?path.join(root,name.slice(2)):name);m._compile(out.code,filename);return m.exports;};
 mocks['@/lib/school-success/snapshot-storage']=load('lib/school-success/snapshot-storage.js');
 const snapStore=load('app/api/school-success/report-snapshots/route.js'),snapOne=load('app/api/school-success/report-snapshots/[id]/route.js');
 const fileRoute=load('app/api/school-success/report-shares/[id]/file/[n]/route.js');
 const create=load('app/api/school-success/report-shares/route.js'),share=load('app/api/school-success/report-shares/[id]/route.js'),manage=load('app/api/school-success/report-shares/[id]/manage/route.js');
 const json=async r=>({status:r.status,body:await r.json().catch(()=>({})),headers:r.headers});
 const scope=(over={})=>({kind:'teacher-lesson-documentation',school:'Alpha School',teacher:'AKANSHA PAL',grade:'Grade 1',section:'A',subject:'Mathematics',from:'2026-11-01',to:'2026-11-17',generatedAt:'2026-11-17T06:00:00.000Z',includeArchived:false,...over});
 const pdf=text=>new TextEncoder().encode(`%PDF-1.3\n${text}\n%%EOF\n`);
 const p=id=>({params:Promise.resolve({id})});
 return {r2,writes,state,real,res,logs,scope,pdf,
  storeSnapshot:async(bytes,s=scope())=>json(await snapStore.POST(new Request('https://app.test/api/school-success/report-snapshots',{method:'POST',headers:{'Content-Type':'application/pdf','X-Snapshot-Scope':Buffer.from(JSON.stringify(s)).toString('base64url')},body:bytes}))),
  createShare:async(body,headers={})=>json(await create.POST(new Request('https://app.test/api/school-success/report-shares',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}))),
  open:async(id,body,headers={})=>json(await share.POST(new Request('https://app.test/api/school-success/report-shares/'+id,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),p(id))),
  file:async(id,n,body)=>json(await fileRoute.POST(new Request('https://app.test/api/school-success/report-shares/'+id+'/file/'+n,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({id,n:String(n)})})),
  get:(id,query)=>share.GET(new Request('https://app.test/api/school-success/report-shares/'+id+query),p(id)),
  manage:async(id,action)=>json(await manage.POST(new Request('https://app.test/api/school-success/report-shares/'+id+'/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})}),p(id))),
  snapshotTicket:async id=>json(await snapOne.POST(new Request('https://app.test/api/school-success/report-snapshots/'+id,{method:'POST'}),p(id)))};
}
const shares=require(path.join(root,'lib/school-success/report-shares.js'));
const KEYS=['schools/Alpha%20School/teachers/AKANSHA%20PAL/2026-11-05/submission_1/implementation_1/activity/photo.jpg',
 'schools/Alpha%20School/teachers/AKANSHA%20PAL/2026-11-05/submission_1/implementation_1/writing/sample.jpg',
 'schools/Alpha%20School/teachers/AKANSHA%20PAL/2026-11-05/submission_1/implementation_1/voice/note.m4a'];
// Export one consolidated report the way the browser does: client-chosen ID/secret, full snapshot, record.
async function publish(h,{mode='link',text='AKANSHA PAL · Grade 1 · Mathematics · complete report',over={},evidence=KEYS}={}){
 const s=await h.storeSnapshot(h.pdf(text),h.scope(over));assert.equal(s.status,200,JSON.stringify(s.body));
 const id=crypto.randomUUID(),secret=mode==='link'?shares.newShareSecret():null;
 const c=await h.createShare({id,mode,snapshotId:s.body.id,secretSha256:secret?await shares.secretDigest(secret):null,evidence});
 assert.equal(c.status,200,JSON.stringify(c.body));
 return {id,secret,snapshotId:s.body.id,bytes:h.pdf(text),path:c.body.path};
}
const query=url=>url.slice(url.indexOf('?'));
const signedUrl=u=>{const x=new URL(u);return {host:x.host,key:x.pathname.split('/').slice(2).map(decodeURIComponent).join('/'),signed:Boolean(x.searchParams.get('X-Amz-Signature')),expires:x.searchParams.get('X-Amz-Expires')};};

test('anyone with the link: signed out, the complete report opens, and so does every included file; storage holds only ciphertext',async()=>{
 const h=harness(),r=await publish(h);
 assert.equal(r.path,'/school-success/shared/'+r.id);
 h.state.actor=null;
 const o=await h.open(r.id,{secret:r.secret});assert.equal(o.status,200,JSON.stringify(o.body));
 assert.equal(o.body.filename,'Lesson_Documentation_AKANSHA_PAL_Grade_1_A_Mathematics_2026-11-01_2026-11-17.pdf','the full report, no reduced-copy suffix');
 const pdf=await h.get(r.id,query(o.body.url));assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');
 assert.deepEqual(Buffer.from(await pdf.arrayBuffer()),Buffer.from(r.bytes));
 for(const [n,key] of KEYS.entries()){
  const f=await h.file(r.id,n,{secret:r.secret});assert.equal(f.status,200,JSON.stringify(f.body));
  const u=signedUrl(f.body.url);assert.equal(u.key,key,'signed URL for exactly that file');assert.ok(u.signed);assert.equal(u.expires,'3600');assert.equal(u.host,'acc.r2.cloudflarestorage.com');
 }
 assert.equal((await h.file(r.id,KEYS.length,{secret:r.secret})).status,404,'only files included in this report');
 for(const [key,value] of h.r2){const b=Buffer.from(value);for(const plain of ['%PDF','AKANSHA','Alpha School',r.secret,'photo.jpg'])assert.ok(!b.includes(Buffer.from(plain)),`${key} leaks ${plain}`);}
});

test('require school sign-in: report and every file need sign-in with access to the school; the same report opens after sign-in',async()=>{
 const h=harness(),r=await publish(h,{mode:'signin'});
 assert.equal(r.path,'/school-success/secure/'+r.id);
 h.state.actor=null;
 assert.equal((await h.open(r.id,{})).status,401);assert.equal((await h.file(r.id,0,{})).status,401);
 const forged=await h.open(r.id,{secret:shares.newShareSecret()});assert.equal(forged.status,401,'a secret never substitutes for sign-in');
 h.state.actor=OTHER;assert.equal((await h.open(r.id,{})).status,403);assert.equal((await h.file(r.id,0,{})).status,403);
 h.state.actor=TEACHER;assert.equal((await h.open(r.id,{})).status,403);
 h.state.actor={role:'admin',email:'colleague@example.test',allowedSchools:['Alpha School']};
 const o=await h.open(r.id,{});assert.equal(o.status,200);
 const pdf=await h.get(r.id,query(o.body.url));assert.deepEqual(Buffer.from(await pdf.arrayBuffer()),Buffer.from(r.bytes),'same complete report');
 const f=await h.file(r.id,2,{});assert.equal(f.status,200);assert.equal(signedUrl(f.body.url).key,KEYS[2],'the recording, after sign-in');
});

test('report creation is staff-only and scoped to the snapshot\'s school, teacher and included files',async()=>{
 const h=harness(),s=await h.storeSnapshot(h.pdf('x'));const base={id:crypto.randomUUID(),mode:'link',snapshotId:s.body.id,secretSha256:'a'.repeat(64),evidence:KEYS};
 h.state.actor=OTHER;assert.equal((await h.createShare(base)).status,403);
 h.state.actor=TEACHER;assert.equal((await h.createShare(base)).status,403);
 h.state.actor=null;assert.equal((await h.createShare(base)).status,401);
 h.state.actor=ADMIN;
 assert.equal((await h.createShare({...base,evidence:['schools/Beta%20School/teachers/AKANSHA%20PAL/x.jpg']})).status,403,'another school\'s file');
 assert.equal((await h.createShare({...base,evidence:['schools/Alpha%20School/teachers/Someone%20Else/x.jpg']})).status,403,'another teacher\'s file');
 assert.equal((await h.createShare({...base,evidence:['school-success/report-snapshots/v1/x.bin']})).status,400,'internal objects');
 assert.equal((await h.createShare({...base,secretSha256:null})).status,400,'a link needs a secret digest');
 assert.equal((await h.createShare({...base,mode:'signin'})).status,400,'a sign-in link has no secret');
 assert.equal((await h.createShare({...base,extra:1})).status,400);
 assert.equal((await h.createShare({...base,snapshotId:crypto.randomUUID()})).status,404);
 assert.equal((await h.createShare(base,{Origin:'https://evil.example'})).status,403);
 assert.equal(h.writes.filter(k=>k.includes('report-shares')).length,0);
 assert.equal((await h.createShare(base)).status,200);assert.equal((await h.createShare(base)).status,409,'IDs are never reused');
});

test('old and current storage keys must appear in this school, teacher, class, subject and period',async()=>{
 const h=harness(), snapshot=await h.storeSnapshot(h.pdf('selected lesson'));
 const row=h.state.rows[0], legacy='legacy/worksheets/fractions.pdf';
 row.Lesson_Plan_Picture=legacy;
 h.state.rows.push({...row,id:202,Section:'B',Writing_Sample_Link:'legacy/other-section.pdf'},
  {...row,id:203,Subject:'English',Writing_Sample_Link:'legacy/other-subject.pdf'},
  {...row,id:204,implementation_date:'2026-09-01',Writing_Sample_Link:'legacy/old-period.pdf'},
  {...row,id:205,FullName:'Another teacher',Writing_Sample_Link:'legacy/other-teacher.pdf'},
  {...row,id:206,Center:'Beta School',Writing_Sample_Link:'legacy/other-school.pdf'});
 for(const mode of ['link','signin']){
  const make=(key,recordIds)=>h.createShare({id:crypto.randomUUID(),mode,snapshotId:snapshot.body.id,
   secretSha256:mode==='link'?'a'.repeat(64):null,evidence:[key],recordIds});
  for(const key of ['legacy/missing.pdf','legacy/other-section.pdf','legacy/other-subject.pdf','legacy/old-period.pdf',
   'legacy/other-teacher.pdf','legacy/other-school.pdf',KEYS[0].replace('photo.jpg','unlisted.jpg')]){
   assert.equal((await make(key)).status,409,key);
  }
  assert.equal((await make(legacy,['202'])).status,409);
  assert.equal((await make(legacy,['201'])).status,200);
  assert.equal((await make(KEYS[1],['201'])).status,200);
 }
});

test('altered credentials, cross-report use and private-link tickets never open a report or a file',async()=>{
 const h=harness(),a=await publish(h,{text:'first'}),b=await publish(h,{text:'second',over:{subject:'English'},evidence:[]});h.state.actor=null;
 const flip=x=>x.slice(0,-1)+(x.endsWith('A')?'B':'A');
 assert.equal((await h.open(a.id,{secret:flip(a.secret)})).status,404);assert.equal((await h.file(a.id,0,{secret:flip(a.secret)})).status,404);
 assert.equal((await h.open(a.id,{})).status,404);assert.equal((await h.file(a.id,0,{})).status,404);
 assert.equal((await h.open(b.id,{secret:a.secret})).status,404,'A\'s secret on B');assert.equal((await h.file(b.id,0,{secret:a.secret})).status,404);
 assert.equal((await h.open(a.snapshotId,{secret:a.secret})).status,404,'a snapshot ID is not a report link');
 const ta=await h.open(a.id,{secret:a.secret});assert.equal((await h.get(b.id,query(ta.body.url))).status,303,'A\'s ticket on B');
 const mixed=await h.real.seal({kind:'share-view',id:b.id,snapshotId:a.snapshotId,exp:Date.now()+60000},SECRET);
 assert.equal((await h.get(b.id,'?ticket='+encodeURIComponent(mixed))).status,404);
 const priv=await h.real.seal({kind:'snapshot-view',id:a.id,email:'x',exp:Date.now()+60000},SECRET);assert.equal((await h.get(a.id,'?ticket='+encodeURIComponent(priv))).status,303);
 assert.equal((await h.file(a.id,'x',{secret:a.secret})).status,404);
});

test('revocation stops the report and every file, for both modes, including already-issued tickets; staff-only; idempotent',async()=>{
 for(const mode of ['link','signin']){
  const h=harness(),r=await publish(h,{mode}),body=mode==='link'?{secret:r.secret}:{};
  if(mode==='link')h.state.actor=null;
  const before=await h.open(r.id,body);assert.equal(before.status,200);
  h.state.actor=null;assert.equal((await h.manage(r.id,'revoke')).status,401);
  h.state.actor=OTHER;assert.equal((await h.manage(r.id,'revoke')).status,403);
  h.state.actor=ADMIN;const st=await h.manage(r.id,'status');assert.equal(st.body.mode,mode);assert.equal(st.body.files,3);
  assert.equal((await h.manage(r.id,'revoke')).body.revoked,true);
  const markers=h.writes.filter(k=>k.endsWith('.revoked')).length;assert.equal((await h.manage(r.id,'revoke')).body.revoked,true);assert.equal(h.writes.filter(k=>k.endsWith('.revoked')).length,markers);
  if(mode==='link')h.state.actor=null;
  assert.equal((await h.open(r.id,body)).status,410,mode);
  assert.equal((await h.file(r.id,0,body)).status,410,mode+': files stop too');
  assert.equal((await h.get(r.id,query(before.body.url))).status,410,mode+': issued tickets stop');
 }
});

test('storage errors fail closed for reports and files',async()=>{
 const h=harness(),r=await publish(h);h.state.actor=null;
 const errors=[],err=console.error;console.error=(...a)=>errors.push(a.join(' '));
 try{
  h.state.fail=(method,key)=>key.endsWith('.revoked')?h.res(500,new TextEncoder().encode('<Error><Code>InternalError</Code></Error>')):null;
  assert.equal((await h.open(r.id,{secret:r.secret})).status,503);assert.equal((await h.file(r.id,0,{secret:r.secret})).status,503);
  for(const line of errors)for(const secret of [r.secret,'AKANSHA','Alpha School',SECRET])assert.ok(!line.includes(secret));
 }finally{console.error=err;}
});

test('earlier reduced-content sharing links keep their original scope: the reduced copy only, no files',async()=>{
 const h=harness();
 // A v1 sharing link as issued by the previous release: shareable snapshot, record without mode or files.
 const s=await h.storeSnapshot(h.pdf('reduced shareable copy'),h.scope({variant:'shareable'}));
 const id=crypto.randomUUID(),secret=shares.newShareSecret();
 h.r2.set(shares.shareKey(id),await shares.sealShareRecord(SECRET,id,'share',{v:1,id,snapshotId:s.body.id,school:'Alpha School',secretSha256:await shares.secretDigest(secret),createdBy:'x',createdAt:'2026-11-18T10:00:00.000Z'}));
 h.state.actor=null;
 const o=await h.open(id,{secret});assert.equal(o.status,200);assert.match(o.body.filename,/_Shareable\.pdf$/);
 assert.match(Buffer.from(await (await h.get(id,query(o.body.url))).arrayBuffer()).toString(),/reduced shareable copy/);
 assert.equal((await h.file(id,0,{secret})).status,404,'no evidence through an earlier reduced link');
 h.state.actor=ADMIN;assert.equal((await h.createShare({id:crypto.randomUUID(),mode:'link',snapshotId:s.body.id,secretSha256:'a'.repeat(64),evidence:[]})).status,400,'new links are never made for reduced copies');
});

test('existing private snapshot links are unchanged: sign-in and school access required',async()=>{
 const h=harness(),r=await publish(h,{mode:'signin'});
 h.state.actor=null;assert.equal((await h.snapshotTicket(r.snapshotId)).status,401);
 h.state.actor=OTHER;assert.equal((await h.snapshotTicket(r.snapshotId)).status,403);
 h.state.actor=ADMIN;assert.equal((await h.snapshotTicket(r.snapshotId)).status,200);
});

test('export → revoke (another admin, another session) → re-export without refreshing: a new link with new file links; the old stays revoked',async()=>{
 const h=harness();
 const {buildDocumentationLinks,reportAccessSession,createReportAccess,storeSnapshot}=await import(path.join(root,'lib/school-success/lesson-snapshots.js'));
 const {mapLive}=await import(path.join(root,'lib/school-success/live-mapping.js'));
 const fx=await import(path.join(root,'tests/fixtures/lesson-records.mjs')),mapped=await mapLive(fx.raw(),fx.base),entries=mapped.entries;
 h.state.rows=fx.raw().records;
 const teacherKeys=[JSON.stringify(['Alpha School','Asha'])],pick=list=>list.filter(l=>l.grade==='Grade 2'&&l.section==='A'&&l.subject==='English');  // a lesson with School Success evidence files (the Hindi lesson has only a previous-portal voice note)
 // Fake browser render: lists the PDF's evidence links (through session.linkFor) as text.
 const render=async(lessons,{session})=>h.pdf('complete · '+lessons.flatMap(l=>[...l.activities,...l.writing,...(l.remedial||[]),...(l.portfolio||[]),...l.planFiles,...l.reflections]).map(f=>session.linkFor(f.url)).join(' '));
 const fetcher=async(url,init)=>{const route=url==='/api/school-success/report-snapshots'?null:url;if(!route){const scope=JSON.parse(Buffer.from(init.headers['X-Snapshot-Scope'],'base64url').toString());const r=await h.storeSnapshot(init.body,scope);return Response.json(r.body,{status:r.status});}const r=await h.createShare(JSON.parse(init.body));return Response.json(r.body,{status:r.status});};
 const exportOnce=async()=>pick([...(await buildDocumentationLinks({entries,from:fx.from,to:fx.to,teacherKeys,generatedAt:'2026-11-17T06:00:00.000Z',render,wait:async()=>{},
  begin:()=>reportAccessSession({mode:'link',origin:'https://app.test',mediaBase:fx.base,newSecret:shares.newShareSecret}),
  store:(bytes,scope)=>storeSnapshot(fetcher,bytes,scope),
  link:async(stored,g,session)=>{await createReportAccess(fetcher,{id:session.id,mode:'link',snapshotId:stored.id,secretSha256:await shares.secretDigest(session.secret),evidence:[...session.evidence]});return {url:session.url()};}})).values()].flat());
 const first=await exportOnce();assert.equal(first.length,1);
 const [id1,secret1]=first[0].url.split('/shared/')[1].split('#');
 h.state.actor={role:'admin',email:'second-admin@example.test',allowedSchools:['Alpha School']};
 assert.equal((await h.manage(id1,'revoke')).body.revoked,true);
 h.state.actor=ADMIN;
 const second=await exportOnce(),[id2,secret2]=second[0].url.split('/shared/')[1].split('#');
 assert.notEqual(id2,id1);assert.notEqual(secret2,secret1);
 h.state.actor=null;
 assert.equal((await h.open(id1,{secret:secret1})).status,410,'old link stays revoked');assert.equal((await h.file(id1,0,{secret:secret1})).status,410);
 const o=await h.open(id2,{secret:secret2});assert.equal(o.status,200);
 assert.equal(o.body.filename,'Lesson_Documentation_Asha_Grade_2_A_English_'+fx.from+'_'+fx.to+'.pdf','same exact selection, complete report');
 const text=Buffer.from(await (await h.get(id2,query(o.body.url))).arrayBuffer()).toString();
 assert.ok(text.includes(`/school-success/shared/${id2}/file/0#${secret2}`),'the new report\'s file links belong to the new link');assert.ok(!text.includes(id1));
 const f=await h.file(id2,0,{secret:secret2});assert.equal(f.status,200);assert.ok(signedUrl(f.body.url).signed);
});

// Opt-in integration check. Report records and the school session stay in the harness. Only three
// unique, synthetic evidence objects are written to real R2 and removed when the check finishes.
test('real R2 serves the signed photo, writing sample and ranged recording in both report modes',
 {skip:process.env.SCHOOL_SUCCESS_TEST_R2!=='1' && 'requires a configured test storage connection'}, async t=>{
 const {env}=await import('../lib/school-success/environment.js');
 const r2=await import('../lib/school-success/r2-evidence.js');
 let config=env;
 if(!r2.r2UploadsConfigured(config)){
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY||!process.env.SCHOOL_SUCCESS_TRANSFER_KEY){
   t.skip('the test storage connection is unavailable in this environment');return;
  }
  const {localDatabase}=await import('../lib/school-success/database.js');
  config=await r2.loadR2Config(env,localDatabase());
 }
 assert.ok(r2.r2UploadsConfigured(config),'test storage connection is configured');
 const school='ZZ Synthetic Report Check',teacher='Synthetic Teacher',prefix='schools/'+encodeURIComponent(school)+'/teachers/'+encodeURIComponent(teacher)+'/'+crypto.randomUUID()+'/';
 const wave=Buffer.alloc(44+16000);
 wave.write('RIFF');wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);
 wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(8000,24);wave.writeUInt32LE(16000,28);
 wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(wave.length-44,40);
 const {jsPDF}=require('jspdf'),writing=new jsPDF();writing.text('Synthetic written work',20,20);
 const files=[
  {name:'classroom.png',type:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64')},
  {name:'writing.pdf',type:'application/pdf',bytes:Buffer.from(writing.output('arraybuffer'))},
  {name:'reflection.wav',type:'audio/wav',bytes:wave}
 ];
 const keys=files.map(file=>prefix+file.name),created=[];
 t.after(async()=>{for(const key of created){const res=await r2.r2Request(config,key,'DELETE');assert.ok(res.ok,'synthetic file cleanup HTTP '+res.status);}});
 for(const [index,file] of files.entries()){
  const res=await r2.r2Request(config,keys[index],'PUT',file.bytes,{'Content-Type':file.type,'If-None-Match':'*'});
  assert.ok(res.ok,'synthetic upload HTTP '+res.status);created.push(keys[index]);
 }
 const h=harness({...config,SUPABASE_GATEWAY_TOKEN:SECRET}),editor={...ADMIN,allowedSchools:[school]};
 h.state.rows=[{...h.state.rows[0],Center:school,FullName:teacher,Video_Evidence_1:keys[0],Writing_Sample_Link:keys[1],Portfolio_Evidence_Link:keys[2]}];
 for(const mode of ['link','signin']){
  h.state.actor=editor;
  const record=await publish(h,{mode,over:{school,teacher},evidence:keys});
  h.state.actor=mode==='link'?null:editor;
  const auth=mode==='link'?{secret:record.secret}:{};
  for(const [index,file] of files.entries()){
   const response=await h.file(record.id,index,auth);assert.equal(response.status,200);
   const download=await fetch(response.body.url);assert.equal(download.status,200);
   assert.equal(download.headers.get('content-type')?.split(';')[0],file.type);
   assert.ok(Buffer.from(await download.arrayBuffer()).equals(file.bytes),'download matches '+file.type);
   if(file.type==='audio/wav'){
    const range=await fetch(response.body.url,{headers:{Range:'bytes=0-43'}});
    assert.equal(range.status,206);assert.ok(Buffer.from(await range.arrayBuffer()).equals(wave.subarray(0,44)));
   }
  }
  h.state.actor=editor;assert.equal((await h.manage(record.id,'revoke')).status,200);
  if(mode==='link')h.state.actor=null;
  assert.equal((await h.file(record.id,0,auth)).status,410);
 }
});
