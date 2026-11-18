// Sharing links for lesson-documentation PDFs: real routes, crypto, sealing and storage code; only the
// signed-in actor, configuration loading and R2 (in memory, honouring If-None-Match) are faked.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc');
const root=path.resolve(__dirname,'..'),SECRET='share-route-secret';
const CONFIG={SUPABASE_GATEWAY_TOKEN:SECRET,R2_ACCESS_KEY_ID:'k',R2_SECRET_ACCESS_KEY:'s',R2_ENDPOINT_URL:'https://acc.r2.cloudflarestorage.com',R2_BUCKET_NAME:'onelern-media',R2_PUBLIC_BASE_URL:'https://media.example.test'};
const ADMIN={role:'admin',email:'consultant@example.test',allowedSchools:['Alpha School']},OTHER={role:'admin',email:'other@example.test',allowedSchools:['Beta School']},TEACHER={role:'school-teacher',email:'t@school.invalid',allowedSchools:['Alpha School']};

function harness(){
 const r2=new Map(),writes=[],state={actor:ADMIN,fail:null},logs=[];
 const res=(code,body,extra={})=>({ok:code>=200&&code<300,status:code,headers:new Headers({...(body?{'content-length':String(body.length)}:{}),...extra}),body:null,arrayBuffer:async()=>body.buffer.slice(body.byteOffset,body.byteOffset+body.length),text:async()=>Buffer.from(body||'').toString()});
 async function r2Request(config,key,method,body,headers={}){
  const f=state.fail&&state.fail(method,key);if(f)return f;
  if(method==='HEAD'||method==='GET')return r2.has(key)?res(200,r2.get(key)):res(404);
  if(method==='PUT'){if(headers['If-None-Match']==='*'&&r2.has(key))return res(412);writes.push(key);r2.set(key,new Uint8Array(body));return res(200);}
  throw Error('Unexpected '+method);
 }
 const real=require(path.join(root,'lib/school-success/r2-evidence.js'));
 const r2Mock={...real,r2Request,loadR2Config:async()=>CONFIG};
 const mocks={
  '@/lib/school-success/server':{withRequest:(req,fn)=>fn(),database:()=>({}),
   actor:async()=>{if(!state.actor)throw Error('401:Sign in to Vision to open the School Success folder');return state.actor;},
   checkOrigin(req){const o=req.headers.get('Origin');if(o&&o!==new URL(req.url).origin)throw Error('403:Cross-origin request rejected');},
   assertSchool:(a,school)=>{if(!school||a.allowedSchools&&!a.allowedSchools.includes(school))throw Error('403:School is outside your assignment');},
   failure:e=>{const m=String(e.message||e),code=Number(m.match(/^(401|403|409|413|503):/)?.[1]||400);return Response.json({error:m.replace(/^\d+:/,'')},{status:code});}},
  '@/lib/school-success/environment':{env:{}},'@/lib/school-success/r2-evidence':r2Mock,'./r2-evidence.js':r2Mock};
 const load=file=>{const filename=path.join(root,file),out=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const normal=m.require.bind(m);m.require=name=>mocks[name]||normal(name.startsWith('@/')?path.join(root,name.slice(2)):name);m._compile(out.code,filename);return m.exports;};
 mocks['@/lib/school-success/snapshot-storage']=load('lib/school-success/snapshot-storage.js');
 const snapStore=load('app/api/school-success/report-snapshots/route.js'),snapOne=load('app/api/school-success/report-snapshots/[id]/route.js');
 const create=load('app/api/school-success/report-shares/route.js'),share=load('app/api/school-success/report-shares/[id]/route.js'),manage=load('app/api/school-success/report-shares/[id]/manage/route.js');
 const json=async r=>({status:r.status,body:await r.json().catch(()=>({})),headers:r.headers});
 const scope=(over={})=>({kind:'teacher-lesson-documentation',school:'Alpha School',teacher:'AKANSHA PAL',grade:'Grade 1',section:'A',subject:'Mathematics',from:'2026-11-01',to:'2026-11-17',generatedAt:'2026-11-17T06:00:00.000Z',includeArchived:false,...over});
 const pdf=text=>new TextEncoder().encode(`%PDF-1.3\n${text}\n%%EOF\n`);
 const p=id=>({params:Promise.resolve({id})});
 return {r2,writes,state,real,res,logs,scope,pdf,
  storeSnapshot:async(bytes,s=scope())=>json(await snapStore.POST(new Request('https://app.test/api/school-success/report-snapshots',{method:'POST',headers:{'Content-Type':'application/pdf','X-Snapshot-Scope':Buffer.from(JSON.stringify(s)).toString('base64url')},body:bytes}))),
  createShare:async(body,headers={})=>json(await create.POST(new Request('https://app.test/api/school-success/report-shares',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}))),
  open:async(id,body,headers={})=>json(await share.POST(new Request('https://app.test/api/school-success/report-shares/'+id,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),p(id))),
  get:(id,query)=>share.GET(new Request('https://app.test/api/school-success/report-shares/'+id+query),p(id)),
  manage:async(id,action)=>json(await manage.POST(new Request('https://app.test/api/school-success/report-shares/'+id+'/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})}),p(id))),
  snapshotTicket:async id=>json(await snapOne.POST(new Request('https://app.test/api/school-success/report-snapshots/'+id,{method:'POST'}),p(id)))};
}
async function shared(h,text='AKANSHA PAL · Grade 1 · Mathematics',over){
 const s=await h.storeSnapshot(h.pdf(text),h.scope({variant:'shareable',...over}));assert.equal(s.status,200,JSON.stringify(s.body));
 const c=await h.createShare({snapshotId:s.body.id});assert.equal(c.status,200,JSON.stringify(c.body));
 return {snapshotId:s.body.id,id:c.body.id,secret:c.body.secret,path:c.body.path,bytes:h.pdf(text)};
}
const query=url=>url.slice(url.indexOf('?'));

test('a signed-out holder of the link opens exactly that PDF; storage holds only ciphertext',async()=>{
 const h=harness(),s=await shared(h);
 assert.match(s.path,/^\/school-success\/shared\/[0-9a-f-]{36}$/);assert.match(s.secret,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(s.id,s.snapshotId,'separate credential, not the snapshot ID');
 h.state.actor=null;
 const o=await h.open(s.id,{secret:s.secret});assert.equal(o.status,200,JSON.stringify(o.body));
 assert.equal(o.body.filename,'Lesson_Documentation_AKANSHA_PAL_Grade_1_A_Mathematics_2026-11-01_2026-11-17_Shareable.pdf');
 assert.ok(!o.body.url.includes(s.secret),'the link secret is never echoed into URLs');
 const r=await h.get(s.id,query(o.body.url));
 assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/pdf');
 assert.match(r.headers.get('content-disposition'),/^inline; filename="Lesson_Documentation_AKANSHA_PAL/);
 assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-robots-tag'),'noindex, nofollow');assert.equal(r.headers.get('referrer-policy'),'no-referrer');
 assert.deepEqual(Buffer.from(await r.arrayBuffer()),Buffer.from(s.bytes));
 const dl=await h.get(s.id,query(o.body.downloadUrl));assert.match(dl.headers.get('content-disposition'),/^attachment;/);
 for(const [key,value] of h.r2){const b=Buffer.from(value);for(const plain of ['%PDF','AKANSHA','Alpha School',s.secret,s.snapshotId])assert.ok(!b.includes(Buffer.from(plain)),`${key} leaks ${plain}`);}
});

test('only signed-in administrators for the snapshot\'s stored school can create sharing links',async()=>{
 const h=harness(),s=await h.storeSnapshot(h.pdf('x'),h.scope({variant:'shareable'}));const body={snapshotId:s.body.id};
 h.state.actor=OTHER;assert.equal((await h.createShare(body)).status,403);
 h.state.actor=TEACHER;assert.equal((await h.createShare(body)).status,403);
 h.state.actor=null;assert.equal((await h.createShare(body)).status,401);
 h.state.actor=ADMIN;
 assert.equal((await h.createShare({snapshotId:'0b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f60'})).status,404,'unknown snapshot');
 assert.equal((await h.createShare({...body,school:'Beta School'})).status,400,'extra fields refused');
 assert.equal((await h.createShare(body,{Origin:'https://evil.example'})).status,403);
 assert.equal(h.writes.filter(k=>k.includes('report-shares')).length,0);
});

test('altered or missing credentials never open a PDF',async()=>{
 const h=harness(),s=await shared(h);h.state.actor=null;
 const flip=x=>x.slice(0,-1)+(x.endsWith('A')?'B':'A');
 assert.equal((await h.open(s.id,{secret:flip(s.secret)})).status,404,'altered secret');
 assert.equal((await h.open(flip(s.id).replace(/[^0-9a-f-]/g,'0'),{secret:s.secret})).status,404,'altered share ID');
 assert.equal((await h.open(s.id,{secret:'short'})).status,404,'malformed secret');
 assert.equal((await h.open(s.id,{})).status,404);
 assert.equal((await h.open(s.snapshotId,{secret:s.secret})).status,404,'a snapshot ID is not a share');
 const bare=await h.get(s.id,'');assert.equal(bare.status,303);assert.equal(new URL(bare.headers.get('location')).pathname,'/school-success/shared/'+s.id);
 const forged=await h.real.seal({kind:'share-view',id:s.id,snapshotId:s.snapshotId,exp:Date.now()+60000},'wrong-secret');
 assert.equal((await h.get(s.id,'?ticket='+encodeURIComponent(forged))).status,303);
 const expired=await h.real.seal({kind:'share-view',id:s.id,snapshotId:s.snapshotId,exp:Date.now()-1},SECRET);
 assert.equal((await h.get(s.id,'?ticket='+encodeURIComponent(expired))).status,303);
 const viewTicket=await h.real.seal({kind:'snapshot-view',id:s.id,email:'x',exp:Date.now()+60000},SECRET);
 assert.equal((await h.get(s.id,'?ticket='+encodeURIComponent(viewTicket))).status,303,'private-link tickets do not open shares');
});

test('cross-snapshot access is refused: a link or ticket for one PDF never opens another',async()=>{
 const h=harness(),a=await shared(h,'first'),b=await shared(h,'second',{subject:'English'});h.state.actor=null;
 assert.equal((await h.open(b.id,{secret:a.secret})).status,404,'A\'s secret on B');
 const ta=await h.open(a.id,{secret:a.secret});
 const crossed=await h.get(b.id,query(ta.body.url));assert.equal(crossed.status,303,'A\'s ticket on B');
 const mixed=await h.real.seal({kind:'share-view',id:b.id,snapshotId:a.snapshotId,exp:Date.now()+60000},SECRET);
 assert.equal((await h.get(b.id,'?ticket='+encodeURIComponent(mixed))).status,404,'B cannot be pointed at A\'s snapshot');
 const rb=await h.get(b.id,query((await h.open(b.id,{secret:b.secret})).body.url));
 assert.match(Buffer.from(await rb.arrayBuffer()).toString(),/second/);
});

test('revocation: school-authorised, enforced on open and on already-issued tickets, permanent and idempotent',async()=>{
 const h=harness(),s=await shared(h);
 h.state.actor=null;const before=await h.open(s.id,{secret:s.secret});assert.equal(before.status,200);
 assert.equal((await h.manage(s.id,'revoke')).status,401,'signed out cannot revoke');
 h.state.actor=TEACHER;assert.equal((await h.manage(s.id,'revoke')).status,403);
 h.state.actor=OTHER;assert.equal((await h.manage(s.id,'revoke')).status,403,'other school');
 h.state.actor=ADMIN;
 const status=await h.manage(s.id,'status');assert.equal(status.status,200);assert.equal(status.body.revoked,false);
 assert.deepEqual(status.body.scope,{school:'Alpha School',teacher:'AKANSHA PAL',grade:'Grade 1',section:'A',subject:'Mathematics',from:'2026-11-01',to:'2026-11-17',generatedAt:'2026-11-17T06:00:00.000Z'});
 const revoked=await h.manage(s.id,'revoke');assert.equal(revoked.status,200);assert.equal(revoked.body.revoked,true);assert.ok(revoked.body.revokedAt);
 const markerWrites=h.writes.filter(k=>k.endsWith('.revoked')).length;
 assert.equal((await h.manage(s.id,'revoke')).body.revoked,true,'idempotent');assert.equal(h.writes.filter(k=>k.endsWith('.revoked')).length,markerWrites,'marker never rewritten');
 h.state.actor=null;
 const after=await h.open(s.id,{secret:s.secret});assert.equal(after.status,410);assert.match(after.body.error,/revoked/);
 const late=await h.get(s.id,query(before.body.url));assert.equal(late.status,410,'a ticket issued before revocation stops working');
 assert.equal((await h.open(s.id,{secret:s.secret.replace(/.$/,'x')})).status,404,'wrong secret on a revoked link reveals nothing');
});

test('revocation checks fail closed and storage errors never serve the PDF',async()=>{
 const h=harness(),s=await shared(h);h.state.actor=null;
 const errors=[],err=console.error;console.error=(...a)=>errors.push(a.join(' '));
 try{
  h.state.fail=(method,key)=>key.endsWith('.revoked')?h.res(500,new TextEncoder().encode('<Error><Code>InternalError</Code></Error>')):null;
  const o=await h.open(s.id,{secret:s.secret});assert.equal(o.status,503);assert.match(o.body.error,/R2 GET 500 InternalError/);
  for(const line of errors)for(const secret of [s.secret,'AKANSHA','Alpha School',SECRET])assert.ok(!line.includes(secret));
 }finally{console.error=err;}
});

test('existing private links are unchanged: snapshot routes still require sign-in and school access',async()=>{
 const h=harness(),s=await shared(h);
 h.state.actor=null;assert.equal((await h.snapshotTicket(s.snapshotId)).status,401);
 h.state.actor=OTHER;assert.equal((await h.snapshotTicket(s.snapshotId)).status,403);
 h.state.actor=ADMIN;assert.equal((await h.snapshotTicket(s.snapshotId)).status,200);
});

test('only the shareable copy can be shared: full-evidence and older snapshots stay behind sign-in; shareable PDFs cannot carry links',async()=>{
 const h=harness();
 const full=await h.storeSnapshot(h.pdf('full evidence with /Annots'));assert.equal(full.status,200);
 const refused=await h.createShare({snapshotId:full.body.id});assert.equal(refused.status,403);assert.match(refused.body.error,/Only the shareable copy can be shared without sign-in/);
 // A snapshot stored before the variant existed (no variant field) is treated as full evidence.
 const legacy=await h.storeSnapshot(h.pdf('legacy'),(({variant,...rest})=>rest)(h.scope()));assert.equal((await h.createShare({snapshotId:legacy.body.id})).status,403);
 const withLink=await h.storeSnapshot(h.pdf('<< /S /URI /URI (https://media.example.test/schools/a/photo.jpg) >>'),h.scope({variant:'shareable'}));
 assert.equal(withLink.status,400);assert.match(withLink.body.error,/must not contain attachment links/);
 assert.equal(h.writes.filter(k=>k.includes('report-shares')).length,0);
 // The full version still opens for signed-in staff of the school.
 assert.equal((await h.snapshotTicket(full.body.id)).status,200);
});

test('export → revoke (another admin, another session) → re-export without refreshing: the old link stays revoked, the new one opens the right PDF',async()=>{
 const h=harness();
 const {buildDocumentationLinks}=await import(path.join(root,'lib/school-success/lesson-snapshots.js'));
 const {mapLive}=await import(path.join(root,'lib/school-success/live-mapping.js'));
 const fx=await import(path.join(root,'tests/fixtures/lesson-records.mjs')),entries=(await mapLive(fx.raw(),fx.base)).entries;
 // The exact selection: Asha (Alpha School), Grade 3 · B · Hindi.
 const teacherKeys=[JSON.stringify(['Alpha School','Asha'])],pick=list=>list.filter(l=>l.grade==='Grade 3'&&l.section==='B'&&l.subject==='Hindi');
 // Browser side of the export, wired to the real routes as a signed-in admin; one snapshot cache for the session.
 const cache=new Map(),renders=[];
 const render=async(lessons,{audience})=>{renders.push(audience);return h.pdf(`${audience} · ${lessons.map(l=>l.subject+' '+l.topic).join(' | ')}`);};
 const store=async(bytes,scope)=>{const r=await h.storeSnapshot(bytes,scope);if(r.status!==200)throw Object.assign(Error(r.body.error),{permanent:true});return {id:r.body.id,url:'https://app.test'+r.body.url};};
 const link=async stored=>{const r=await h.createShare({snapshotId:stored.shareable.id});if(r.status!==200)throw Object.assign(Error(r.body.error),{permanent:true});return {url:`https://app.test/school-success/shared/${r.body.id}#${r.body.secret}`,fullUrl:stored.full.url};};
 const exportOnce=async()=>pick([...(await buildDocumentationLinks({entries,from:fx.from,to:fx.to,teacherKeys,generatedAt:'2026-11-17T06:00:00.000Z',render,store,link,audiences:['shareable','full'],cache,wait:async()=>{}})).values()].flat());
 const first=await exportOnce();assert.equal(first.length,1);const rendersAfterFirst=renders.length;
 const [id1,secret1]=first[0].url.split('/shared/')[1].split('#');
 // Another administrator of the same school revokes it from their own session.
 h.state.actor={role:'admin',email:'second-admin@example.test',allowedSchools:['Alpha School']};
 assert.equal((await h.manage(id1,'revoke')).body.revoked,true);
 // The first administrator exports the same selection again, without refreshing the data.
 h.state.actor=ADMIN;
 const second=await exportOnce(),[id2,secret2]=second[0].url.split('/shared/')[1].split('#');
 assert.notEqual(id2,id1,'a fresh sharing link');assert.notEqual(secret2,secret1);
 assert.equal(second[0].fullUrl,first[0].fullUrl,'the immutable full-evidence snapshot is reused');
 assert.equal(renders.length,rendersAfterFirst,'nothing re-rendered or re-stored: immutable snapshots are reused');
 h.state.actor=null;
 const old=await h.open(id1,{secret:secret1});assert.equal(old.status,410,'the old link stays revoked');
 const o=await h.open(id2,{secret:secret2});assert.equal(o.status,200);
 assert.equal(o.body.filename,'Lesson_Documentation_Asha_Grade_3_B_Hindi_'+fx.from+'_'+fx.to+'_Shareable.pdf','same exact selection');
 const pdf=await h.get(id2,query(o.body.url));assert.equal(pdf.status,200);
 assert.match(Buffer.from(await pdf.arrayBuffer()).toString(),/^%PDF-1\.3\nshareable · Hindi /,'the new link opens the shareable copy of that selection');
});
