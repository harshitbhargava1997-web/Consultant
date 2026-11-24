// "Noted" on feedback: the evidence route, gateway (live.js), note store and mapping are real; PostgREST is an
// in-memory synthetic school. No school records are read or written.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc'),root=path.resolve(__dirname,'..');
const S='Alpha School',T='Asha',EMAIL='asha@example.test';
function load(file,mocks){
 const filename=path.join(root,file),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const normal=mod.require.bind(mod);mod.require=name=>mocks[name]||normal(name.startsWith('@/')?path.join(root,name.slice(2)):name);
 mod._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}).code,filename);return mod.exports;
}
const notes=load('lib/school-success/feedback-notes.js',{});
function harness(t,actor={role:'school-teacher',school:S,name:T,email:EMAIL}){
 const records=[{id:7,Center:S,FullName:T,Uploaded_By:EMAIL,lesson_stage:'evidence_submitted'},{id:8,Center:S,FullName:'Other Teacher',Uploaded_By:'other@example.test',lesson_stage:'evidence_submitted'}];
 const legacy=[{record_id:7,school:S,feedback:'Clear modelling.',updated_at:'2026-11-20T05:00:00+00:00'},{record_id:8,school:S,feedback:'For another teacher',updated_at:'2026-11-20T05:00:00+00:00'}];
 const rubric=[{id:'lesson-review-7-aaaa',school:S,kind:'lesson-review',payload:JSON.stringify({planning:{level:'A',note:'Strong start.'}}),updated:'2026-11-22T04:00:00Z'}];
 const entries=new Map(),posts=[];
 const original=global.fetch;t.after(()=>{global.fetch=original;});
 global.fetch=async(rawUrl,init={})=>{
  const u=new URL(String(rawUrl).replace(/^undefined/,'https://fixture.invalid')),q=u.searchParams;let result;
  const eq=k=>q.get(k)?.replace(/^eq\./,'');
  if(u.pathname.endsWith('/teacher_records'))result=records.filter(r=>String(r.id)===eq('id'));
  else if(u.pathname.endsWith('/portal_evidence_reviews'))result=legacy.filter(r=>String(r.record_id)===eq('record_id')&&r.school===eq('school'));
  else if(u.pathname.endsWith('/success_entries')&&init.method==='POST'){const row=JSON.parse(init.body);posts.push(row);if(entries.has(row.id))result=[];else{entries.set(row.id,row);result=[{id:row.id,payload:row.payload}];}}
  else if(u.pathname.endsWith('/success_entries')&&q.has('id'))result=[...entries.values()].filter(r=>'eq.'+r.id===q.get('id')&&'eq.'+r.school===q.get('school'));
  else if(u.pathname.endsWith('/success_entries')&&q.get('kind')==='eq.lesson-review')result=rubric.filter(r=>r.school===eq('school'));
  else if(u.pathname.endsWith('/success_entries')&&q.get('kind')==='eq.feedback-noted')result=[...entries.values()].filter(r=>r.school===eq('school'));
  else throw Error('Unexpected fixture call '+u.pathname);
  return Response.json(result,{headers:{'content-range':'0-'+result.length+'/'+result.length}});
 };
 const server={actor:async()=>actor,assertConsultant:a=>{if(a?.leader)throw Error('403:This part of School Success is available to consultants only.');},assertSchool:(a,s)=>{if(!s||a.allowedSchools&&!a.allowedSchools.includes(s)||a.role==='school-teacher'&&s!==a.school)throw Error('403:Unassigned school');},
  withRequest:(req,fn)=>fn(),checkOrigin(){},database:()=>({}),failure:e=>{const m=String(e.message||e),status=Number(m.match(/^(401|403|409|503):/)?.[1]||400);return Response.json({error:m.replace(/^\d+:/,'')},{status});}};
 const live=load('lib/school-success/live.js',{'./server':server,'./database':{}});
 const r2=require(path.join(root,'lib/school-success/r2-evidence.js'));
 const route=load('app/api/school-success/evidence/route.js',{'@/lib/school-success/server':server,'@/lib/school-success/live':live,'@/lib/school-success/environment':{env:{}},'@/lib/school-success/r2-evidence':{...r2,loadR2Config:async()=>({SUPABASE_GATEWAY_TOKEN:'x'})}});
 const call=async body=>{const res=await route.POST(new Request('http://app.test/api/school-success/evidence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));return {status:res.status,body:await res.json()};};
 return {call,entries,posts};
}

test('a teacher marks rubric and legacy feedback on their own lesson as noted, once',async t=>{
 const h=harness(t);
 const first=await h.call({action:'noteFeedback',recordId:'7',key:'lesson-review-7-aaaa'});
 assert.equal(first.status,200);assert.equal(first.body.noted,true);assert.ok(first.body.notedAt);
 const row=[...h.entries.values()][0];
 assert.equal(row.id,notes.noteId('7','lesson-review-7-aaaa'));assert.equal(row.kind,'feedback-noted');assert.equal(row.school,S);assert.equal(row.owner,EMAIL);
 assert.deepEqual(JSON.parse(row.payload).recordId,'7');
 const again=await h.call({action:'noteFeedback',recordId:'7',key:'lesson-review-7-aaaa'});
 assert.equal(again.body.alreadyNoted,true);assert.equal(again.body.notedAt,first.body.notedAt,'the first Noted date is kept');
 assert.equal(h.entries.size,1);
 const legacy=await h.call({action:'noteFeedback',recordId:'7',key:'legacy:2026-11-20T05:00:00+00:00'});
 assert.equal(legacy.status,200);assert.equal(h.entries.size,2);
});

test('changed feedback, another teacher’s lesson and staff accounts are refused, and nothing is saved',async t=>{
 const h=harness(t);
 assert.equal((await h.call({action:'noteFeedback',recordId:'7',key:'legacy:2026-01-01T00:00:00Z'})).status,409,'feedback edited since the teacher saw it');
 assert.equal((await h.call({action:'noteFeedback',recordId:'8',key:'legacy:2026-11-20T05:00:00+00:00'})).status,403,'another teacher’s lesson');
 assert.equal((await h.call({action:'noteFeedback',recordId:'abc',key:'x'})).status,400);
 assert.equal(h.posts.length,0);
 const admin=harness(t,{role:'admin',email:'consultant@example.test',allowedSchools:[S]});
 assert.equal((await admin.call({action:'noteFeedback',recordId:'7',key:'lesson-review-7-aaaa'})).status,403,'staff cannot mark it for the teacher');
 const leader=harness(t,{role:'admin',leader:true,email:'principal@example.test',allowedSchools:[S]});
 assert.equal((await leader.call({action:'noteFeedback',recordId:'7',key:'lesson-review-7-aaaa'})).status,403);
 assert.equal(admin.posts.length+leader.posts.length,0);
});

test('reviewers see when the teacher noted the feedback shown to them',async()=>{
 const {mapLive}=load('lib/school-success/live-mapping.js',{});const {buildLessonRecords}=load('lib/school-success/lesson-records.js',{});
 const row={id:7,Center:S,FullName:T,Uploaded_By:EMAIL,Type:'Classroom Reflection',StartTime:'2026-11-19T03:00:00',submission_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',lesson_period_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',lesson_stage:'evidence_submitted',planned_lesson_on:'2026-11-19',Grade:'Grade 2',Section:'A',Subject:'English',Book:'LP 13',lesson_reflection:'Why — learning objective\nUse action words.',Video_Evidence_1:'https://media.test/a.jpg'};
 const reviews=[{record_id:7,school:S,feedback:'Planning · A (Strong practice)\nStrong start.',updated_at:'2026-11-22T04:00:00Z',review_id:'lesson-review-7-aaaa'},{record_id:7,school:S,feedback:'Clear modelling.',updated_at:'2026-11-20T05:00:00+00:00'}];
 const build=async noted=>{const {entries}=await mapLive({records:[row],reviews,notes:noted},'https://media.test');return buildLessonRecords(entries,'0001-01-01','9999-12-31',{scope:'all'})[0];};
 assert.equal((await build([])).feedbackNoted,null,'not noted yet');
 const one=await build([{record_id:'7',school:S,key:'lesson-review-7-aaaa',noted_at:'2026-11-23T06:00:00Z'}]);
 assert.deepEqual(one.feedbackNoted,{notedAt:'2026-11-23T06:00:00Z',all:false});
 const both=await build([{record_id:'7',school:S,key:'lesson-review-7-aaaa',noted_at:'2026-11-23T06:00:00Z'},{record_id:'7',school:S,key:'legacy:2026-11-20T05:00:00+00:00',noted_at:'2026-11-24T06:00:00Z'}]);
 assert.deepEqual(both.feedbackNoted,{notedAt:'2026-11-24T06:00:00Z',all:true});
 const otherSchool=await build([{record_id:'7',school:'Other School',key:'lesson-review-7-aaaa',noted_at:'2026-11-23T06:00:00Z'}]);
 assert.equal(otherSchool.feedbackNoted,null,'a note from another school is ignored');
});

test('feedback keys and note IDs are stable',()=>{
 assert.equal(notes.feedbackKey({review_id:'lesson-review-7-aaaa'}),'lesson-review-7-aaaa');
 assert.equal(notes.feedbackKey({updated_at:'2026-11-20T05:00:00+00:00'}),'legacy:2026-11-20T05:00:00+00:00');
 assert.equal(notes.noteId('7','k'),notes.noteId('7','k'));assert.notEqual(notes.noteId('7','k'),notes.noteId('7','k2'));
 assert.match(notes.noteId('7','k'),/^feedback-noted-7-[0-9a-f]{16}$/);
});
