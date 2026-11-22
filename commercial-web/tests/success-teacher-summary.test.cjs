// Teacher home summary (myLessons). The evidence route, gateway (live.js), sealing and rubric parsing are real.
// PostgREST is an in-memory synthetic school; no school records are read or written.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc'),root=path.resolve(__dirname,'..');
const SECRET='summary-test-secret',S='Alpha School',T='Asha',EMAIL='asha@example.test';
function load(file,mocks){
 const filename=path.join(root,file),mod=new Module(filename,module);
 mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const normal=mod.require.bind(mod);
 mod.require=name=>mocks[name]||normal(name.startsWith('@/')?path.join(root,name.slice(2)):name);
 mod._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}).code,filename);
 return mod.exports;
}
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const shift=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const sub=i=>`${String(i).padStart(8,'5')}-5555-4555-8555-${String(i).padStart(12,'5')}`;
function row(id,extra){return {id,Center:S,Institution:S,FullName:T,Uploaded_By:EMAIL,Grade:'Grade 2',Section:'A',Subject:'English',Book:'LP '+id,submission_id:sub(1),lesson_period_id:sub(100+id),planned_lesson_on:shift(-2),lesson_stage:'preparation_saved',evidence_submitted_at:null,...extra};}

function harness(t,{actor={role:'teacher',school:S,name:T,email:EMAIL}}={}){
 const records=[
  row(1,{}),row(2,{submission_id:sub(1)}),                                                     // two periods, one lesson, no evidence
  row(3,{submission_id:sub(2),planned_lesson_on:shift(-5),lesson_stage:'evidence_submitted',Subject:'Mathematics'}),
  row(4,{submission_id:sub(3),planned_lesson_on:shift(3)}),                                   // upcoming
  row(5,{submission_id:sub(4),FullName:'Other Teacher'}),                                      // another teacher
  row(6,{submission_id:sub(5),Uploaded_By:'someone-else@example.test'}),                       // another account
  row(7,{submission_id:sub(6),planned_lesson_on:shift(-90)}),                                  // outside window
  row(8,{submission_id:sub(7),lesson_stage:null})                                              // not a lesson
 ];
 const legacy=[{record_id:3,school:S,feedback:'Clear modelling of place value.',updated_at:shift(-1)+'T05:00:00+00:00'},{record_id:5,school:S,feedback:'For another teacher',updated_at:shift(-1)+'T05:00:00+00:00'}];
 const rubric=[{id:'lesson-review-1-'+crypto.randomUUID(),school:S,kind:'lesson-review',payload:JSON.stringify({planning:{level:'B',note:'Match the activity to the outcome.'}}),updated:shift(0)+'T04:00:00Z'}];
 const calls=[],state={actor};
 const original=global.fetch;t.after(()=>{global.fetch=original;});
 global.fetch=async rawUrl=>{
  const u=new URL(String(rawUrl).replace(/^undefined/,'https://fixture.invalid')),q=u.searchParams;let result;
  calls.push(u);
  if(u.pathname.endsWith('/teacher_records')){
   const eq=k=>q.get(k)?.replace(/^eq\./,'');
   const [,from,to]=q.get('and').match(/^\(planned_lesson_on\.gte\.([\d-]+),planned_lesson_on\.lte\.([\d-]+)\)$/);
   assert.equal(q.get('lesson_stage'),'not.is.null');
   // Includes one row the database should not have returned, to prove the gateway filters again.
   result=[...records.filter(r=>r.Center===eq('Center')&&r.FullName===eq('FullName')&&r.Uploaded_By===eq('Uploaded_By')&&r.planned_lesson_on>=from&&r.planned_lesson_on<=to&&r.lesson_stage),records[4]];
  }else if(u.pathname.endsWith('/portal_evidence_reviews')){
   assert.equal(q.get('school'),'eq.'+S);
   result=legacy; // deliberately unfiltered: the gateway and route must keep only the teacher's own records
  }else if(u.pathname.endsWith('/success_entries')){
   assert.equal(q.get('school'),'eq.'+S);assert.equal(q.get('kind'),'eq.lesson-review');
   const ids=[...q.get('or').matchAll(/id\.like\.lesson-review-(\d+)-\*/g)].map(m=>m[1]);
   result=rubric.filter(r=>ids.some(id=>r.id.startsWith('lesson-review-'+id+'-')));
  }else throw Error('Unexpected fixture call '+u.pathname);
  return Response.json(result,{headers:{'content-range':'0-'+result.length+'/'+result.length}});
 };
 const server={actor:async()=>state.actor,assertConsultant:a=>{if(a?.leader)throw Error('403:This part of School Success is available to consultants only.');},assertSchool:(a,s)=>{if(!s||a.allowedSchools&&!a.allowedSchools.includes(s))throw Error('403:Unassigned school');},
  withRequest:(req,fn)=>fn(),checkOrigin(){},database:()=>({}),failure:e=>{const m=String(e.message||e),status=Number(m.match(/^(401|403|409|503):/)?.[1]||400);return Response.json({error:m.replace(/^\d+:/,'')},{status});}};
 const live=load('lib/school-success/live.js',{'./server':server,'./database':{}});
 const r2=require(path.join(root,'lib/school-success/r2-evidence.js'));
 const route=load('app/api/school-success/evidence/route.js',{'@/lib/school-success/server':server,'@/lib/school-success/live':live,'@/lib/school-success/environment':{env:{}},'@/lib/school-success/r2-evidence':{...r2,loadR2Config:async()=>({SUPABASE_GATEWAY_TOKEN:SECRET})}});
 const call=async body=>{const res=await route.POST(new Request('http://app.test/api/school-success/evidence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));return {status:res.status,body:await res.json()};};
 return {call,calls,state,r2};
}

test('a teacher sees only their own lessons in the window, with evidence status and reopen links',async t=>{
 const h=harness(t),{status,body}=await h.call({action:'myLessons'});
 assert.equal(status,200);assert.equal(body.today,today);
 assert.deepEqual(body.lessons.map(l=>l.id).sort(),[sub(1),sub(2),sub(3)].sort(),'other teachers, other accounts, old and non-lesson rows excluded');
 const first=body.lessons.find(l=>l.id===sub(1));
 assert.equal(first.periods.length,2);assert.equal(first.evidence,false);assert.equal(first.plannedOn,shift(-2));
 assert.equal(body.lessons.find(l=>l.id===sub(2)).evidence,true);
 const grant=await h.r2.unseal(first.resumeToken,SECRET);
 assert.deepEqual([grant.kind,grant.id,grant.school,grant.teacher,grant.email],['lesson-resume',sub(1),S,T,EMAIL]);
 const q=h.calls.find(u=>u.pathname.endsWith('/teacher_records')).searchParams;
 assert.deepEqual([q.get('Center'),q.get('FullName'),q.get('Uploaded_By')],['eq.'+S,'eq.'+T,'eq.'+EMAIL]);
 assert.equal(q.get('and'),'(planned_lesson_on.gte.'+shift(-60)+',planned_lesson_on.lte.'+shift(30)+')');
 assert.ok(!JSON.stringify(body).includes('Other Teacher'));
});

test('feedback received lists reviews on the teacher’s own lessons only, newest first',async t=>{
 const h=harness(t),{body}=await h.call({action:'myLessons'});
 assert.deepEqual(body.feedback.map(f=>f.text),['Planning · B (Developing)\nMatch the activity to the outcome.','Clear modelling of place value.']);
 assert.ok(!JSON.stringify(body).includes('For another teacher'),'a review on another teacher’s record never reaches this teacher');
 assert.equal(body.feedback[1].subject,'Mathematics');assert.equal(body.feedback[0].lessonId,sub(1));
});

test('a signed-in teacher cannot widen the summary to another teacher or school',async t=>{
 const h=harness(t),{body}=await h.call({action:'myLessons',school:'Beta School',teacher:'Other Teacher'});
 const q=h.calls.find(u=>u.pathname.endsWith('/teacher_records')).searchParams;
 assert.deepEqual([q.get('Center'),q.get('FullName'),q.get('Uploaded_By')],['eq.'+S,'eq.'+T,'eq.'+EMAIL]);
 assert.ok(body.lessons.every(l=>l.periods.length));
});

test('an administrator outside the school is refused',async t=>{
 const h=harness(t,{actor:{role:'admin',email:'admin@example.test',allowedSchools:['Beta School']}});
 const {status}=await h.call({action:'myLessons',school:S,teacher:T});
 assert.equal(status,403);
 assert.ok(!h.calls.length,'no database request is made');
});
