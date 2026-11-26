// The review route, lesson mapping, gateway and validation are real. PostgREST and staff identities
// are replaced with a synthetic school so that no school records are written by this test.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc'),root=path.resolve(__dirname,'..');
function load(file,mocks){
 const filename=path.join(root,file),mod=new Module(filename,module);
 mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const normal=mod.require.bind(mod);
 mod.require=name=>mocks[name]||normal(name.startsWith('@/')?path.join(root,name.slice(2)):name);
 mod._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}).code,filename);
 return mod.exports;
}
async function harness(t){
 const fixture=await import('./fixtures/lesson-records.mjs'),raw=fixture.raw(),saved=new Map();
 const admin={role:'admin',email:'reviewer@example.test',allowedSchools:['Alpha School']},state={actor:admin};
 const server={actor:async()=>{if(!state.actor)throw Error('401:Sign in');return state.actor;},
  assertSchool:(a,s)=>{if(!s||a.allowedSchools&&!a.allowedSchools.includes(s))throw Error('403:Unassigned school');},
  withRequest:(req,fn)=>fn(),checkOrigin(){},failure:e=>{
   const message=String(e.message||e),status=Number(message.match(/^(401|403|409|503):/)?.[1]||400);
   return Response.json({error:message.replace(/^\d+:/,'')},{status});
  }};
 const original=global.fetch;t.after(()=>{global.fetch=original;});
 global.fetch=async(rawUrl,init={})=>{
  const u=new URL(String(rawUrl).replace(/^undefined/,'https://fixture.invalid')),q=u.searchParams;
  const list=Array.from(saved.values());let result;
  if(u.pathname.endsWith('/teacher_records')){
   const row=raw.records.find(r=>String(r.id)===q.get('id')?.slice(3));
   result=row&&(!state.actor.allowedSchools||state.actor.allowedSchools.includes(row.Center))?[row]:[];
  }else if(u.pathname.endsWith('/portal_evidence_reviews')){
   result=raw.reviews.filter(r=>q.get('record_id')?.includes(String(r.record_id))&&state.actor.allowedSchools.includes(r.school));
  }else if(u.pathname.endsWith('/success_entries')){
   if(init.method==='POST'){
    const entry=JSON.parse(init.body);assert.match(init.headers.Prefer,/ignore-duplicates/);
    if(saved.has(entry.id))result=[];else{saved.set(entry.id,entry);result=[{id:entry.id}];}
   }else if(q.has('id'))result=list.filter(r=>'eq.'+r.id===q.get('id')&&'eq.'+r.school===q.get('school'));
   else if(q.get('kind')==='eq.feedback-noted'){assert.equal(q.get('school'),'in.("Alpha School")');result=[];} // teachers' "Noted" acknowledgements: none here
   else{
    assert.equal(q.get('kind'),'eq.lesson-review');assert.equal(q.get('school'),'in.("Alpha School")');
    const ids=[...q.get('or').matchAll(/id\.like\.lesson-review-(\d+)-\*/g)].map(m=>m[1]);
    result=list.filter(r=>state.actor.allowedSchools.includes(r.school)&&ids.some(id=>r.id.startsWith('lesson-review-'+id+'-')));
   }
  }else throw Error('Unexpected fixture call '+u.pathname);
  return Response.json(result,{headers:{'content-range':'0-'+result.length+'/'+result.length}});
 };
 const live=load('lib/school-success/live.js',{'./server':server,'./database':{}});
 const route=load('app/api/school-success/lesson-reviews/route.js',{'@/lib/school-success/server':{...server,database:()=>({})},'@/lib/school-success/live':live,'@/lib/school-success/r2-evidence':{loadR2Config:async()=>({}),r2UploadsConfigured:()=>false,r2Request:async()=>{throw Error('not used');}}});
 async function post(body){
  const res=await route.POST(new Request('http://app.test/api/school-success/lesson-reviews',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  return {status:res.status,body:await res.json()};
 }
 return {admin,state,post,saved,raw,fixture,live};
}
test('open the actual lesson, record planning before execution, and preserve earlier feedback and dates',async t=>{
 const {post,saved,raw,fixture}=await harness(t),open={action:'open',recordId:'101'};
 let result=await post(open);assert.equal(result.status,200);
 const lesson=result.body.lesson;assert.equal(lesson.subject,'English');assert.ok(lesson.activities.length&&lesson.writing.length&&lesson.plan.fields.length);
 assert.ok(lesson.feedback.text.includes(raw.reviews[0].feedback));
 const planning={action:'save',recordId:'101',requestId:crypto.randomUUID(),review:{planning:{level:'A',note:'The check matches the outcome.'}}};
 const execution={...planning,requestId:crypto.randomUUID(),review:{execution:{level:'B',note:'Collect one independent response.'}}};
 const [p,pRetry,e]=await Promise.all([post(planning),post(planning),post(execution)]);
 assert.equal(p.status,200);assert.equal(pRetry.status,200);assert.equal(e.status,200);
 assert.equal(saved.size,2);assert.equal([p,pRetry].filter(r=>r.body.alreadySaved).length,1);
 assert.equal((await post({...planning,review:execution.review})).status,409);
 const history=[...saved.values()];history.find(r=>r.id.endsWith(planning.requestId)).updated='2026-10-25T05:00:00Z';history.find(r=>r.id.endsWith(execution.requestId)).updated='2026-11-03T05:00:00Z';
 result=await post(open);const full=result.body.lesson.feedback.text;
 for(const s of [raw.reviews[0].feedback,'Planning · A (Strong practice)','The check matches the outcome.','Execution · B (Developing)','Collect one independent response.'])assert.ok(full.includes(s),s);
 assert.match(full,/25 Oct 2026/);assert.match(full,/3 Nov 2026/);
 const {mapLive}=await import('../lib/school-success/live-mapping.js'),{buildLessonRecords}=await import('../lib/school-success/lesson-records.js');
 const {readRubricRows}=await import('../lib/school-success/lesson-review-store.js');
 const notes=await readRubricRows(['101'],{},async()=>history);
 const mapped=await mapLive({...raw,reviews:[...raw.reviews,...notes]},fixture.base);
 const october=buildLessonRecords(mapped.entries,fixture.from,fixture.to).find(l=>l.recordId==='101');
 assert.ok(october.feedback.text.includes('The check matches the outcome.'));assert.ok(!october.feedback.text.includes('independent response'));assert.ok(october.reviewOutsidePeriod);
 assert.ok(!(await post({action:'open',recordId:'102'})).body.lesson.feedback);
});
test('only school-authorized staff can read and save a lesson-scoped rubric; blank or partial ratings are rejected',async t=>{
 const {post,state,admin,saved,raw}=await harness(t),outside=raw.records.find(r=>r.Center==='Beta School');
 const input={action:'save',recordId:'101',requestId:crypto.randomUUID(),review:{planning:{level:'A',note:'Clear objective.'}}};
 for(const actor of [null,{role:'school-teacher',school:'Alpha School'}, {...admin,allowedSchools:['Beta School']}]){
  state.actor=actor;
  for(const body of [input,{action:'open',recordId:'101'}])assert.equal((await post(body)).status,actor?403:401);
 }
 state.actor=admin;
 for(const id of [String(outside.id),'99999'])assert.equal((await post({...input,recordId:id})).status,403);
 for(const review of [{},{planning:{level:'',note:'a'}},{execution:{level:'B',note:'    '}},{planning:{level:'C',note:'x'.repeat(501)}}])assert.equal((await post({...input,review})).status,400);
 assert.equal((await post({...input,school:'Different school'})).status,400);assert.equal(saved.size,0);
});
