// Weekly review route: who may use it, and the covered periods always come from the server's own read.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc'),root=path.resolve(__dirname,'..');
function load(file,mocks={}){const filename=path.join(root,file),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const normal=mod.require.bind(mod);mod.require=name=>mocks[name]||normal(name.startsWith('@/')?path.join(root,name.slice(2)):name);
 mod._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}).code,filename);return mod.exports;}
const S='Sunrise Public School',RID='11111111-1111-4111-8111-111111111111';
const rec=(id,date,subject)=>({id,Type:'Classroom Reflection',Center:S,FullName:'Asha Verma',Grade:'Grade 2',Section:'A',Subject:subject,Book:'T'+id,submission_id:'s'+id,lesson_period_id:'p'+id,planned_lesson_on:date,preparation_saved_at:date+'T03:00:00',lesson_stage:'preparation_saved',lesson_reflection:'Why — learning objective\nx',StartTime:date+'T00:00:00'});
function harness(actor){
 const state={actor,saved:null,asked:null};
 const route=load('app/api/school-success/weekly-reviews/route.js',{
  '@/lib/school-success/server':{withRequest:(r,fn)=>fn(),checkOrigin(){},actor:async()=>state.actor,
   assertSchool:(a,s)=>{if(!s||a.allowedSchools&&!a.allowedSchools.includes(s))throw Error('403:School is outside your assignment');},
   failure:e=>{const m=String(e.message||e),status=Number(m.match(/^(401|403|409)/)?.[1]||400);return Response.json({error:m.replace(/^\d+:/,'')},{status});}},
  '@/lib/school-success/live':{publicBase:()=>'https://media.test',
   weekLessonRows:async q=>{state.asked=q;return {records:[rec(101,'2026-11-23','English'),rec(102,'2026-11-25','English'),rec(103,'2026-11-24','Hindi')],reviews:[],notes:[]};},
   saveWeeklyReview:async(input,a)=>{state.saved={input,by:a.email};return {saved:true,periods:input.recordIds.length};}}});
 const call=async body=>{const res=await route.POST(new Request('https://schoolsuccess.in/api/school-success/weekly-reviews',{method:'POST',body:JSON.stringify(body)}));return {status:res.status,body:await res.json()};};
 return {state,call};}
const review={planning:{level:'A',note:'Good.'},focus:'Exit tickets.'};
const consultant={role:'admin',email:'c@x.test',allowedSchools:[S]},principal={role:'admin',leader:true,email:'p@mobile.schoolsuccess.in',allowedSchools:[S],title:'Principal'};

test('consultants and principals of the school can open a week; it is read Monday to Sunday',async()=>{
 for(const who of [consultant,principal]){const h=harness(who);const r=await h.call({action:'week',school:S,teacher:'Asha Verma',week:'2026-11-26'});
  assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual([r.body.from,r.body.to],['2026-11-23','2026-11-29']);
  assert.deepEqual(h.state.asked,{school:S,teacher:'Asha Verma',from:'2026-11-23',to:'2026-11-29'});
  assert.deepEqual(r.body.groups.map(g=>g.subject+':'+g.periods),['English:2','Hindi:1']);}
});

test('other schools, teachers on a school link and unsigned visitors are refused',async()=>{
 assert.equal((await harness({...principal,allowedSchools:['Other School']}).call({action:'week',school:S,teacher:'Asha Verma',week:'2026-11-23'})).status,403);
 assert.equal((await harness({role:'school-teacher',school:S,name:'Asha Verma',allowedSchools:[S]}).call({action:'week',school:S,teacher:'Asha Verma',week:'2026-11-23'})).status,403);
});

test('a save covers exactly the server’s periods for that class and subject, by the signed-in reviewer',async()=>{
 const h=harness(principal);
 const r=await h.call({action:'save',school:S,teacher:'Asha Verma',week:'2026-11-27',grade:'Grade 2',section:'A',subject:'English',requestId:RID,review});
 assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body,{saved:true,periods:2});
 assert.deepEqual(h.state.saved.input.recordIds,['101','102']);assert.equal(h.state.saved.by,'p@mobile.schoolsuccess.in');
 assert.deepEqual([h.state.saved.input.weekStart,h.state.saved.input.weekEnd],['2026-11-23','2026-11-29']);
 const none=await harness(principal).call({action:'save',school:S,teacher:'Asha Verma',week:'2026-11-23',grade:'Grade 5',section:'A',subject:'English',requestId:RID,review});
 assert.equal(none.status,400);assert.match(none.body.error,/no lessons in this week/);
});

test('the teacher’s Feedback lists a weekly review once, noted if any covered period was noted',async()=>{
 const W='weekly-'+RID,weekly={weekStart:'2026-11-23',weekEnd:'2026-11-29',periods:2,grade:'Grade 2',section:'A',subject:'English'};
 const row=(id,date)=>({id,submission_id:'s'+id,Center:S,FullName:'Asha Verma',Uploaded_By:'link',planned_lesson_on:date,lesson_stage:'preparation_saved',lesson_period_id:'p'+id,Grade:'Grade 2',Section:'A',Subject:'English',Book:'T'+id});
 const route=load('app/api/school-success/evidence/route.js',{
  '@/lib/school-success/server':{withRequest:(r,fn)=>fn(),checkOrigin(){},actor:async()=>({role:'school-teacher',school:S,name:'Asha Verma',email:'link'}),assertConsultant(){},database:()=>({}),failure:e=>Response.json({error:e.message},{status:400})},
  '@/lib/school-success/r2-evidence':{loadR2Config:async()=>({SUPABASE_GATEWAY_TOKEN:'x'}),seal:async()=>'tok',unseal:async()=>({}),r2UploadsConfigured:()=>true,r2Request:async()=>{}},
  '@/lib/school-success/live':{publicBase:()=>'',gateway:async()=>({rows:[row(101,'2026-11-23'),row(102,'2026-11-25')],
   reviews:[{record_id:'101',school:S,feedback:'Weekly review · heading\n\n…',updated_at:'2026-11-30T05:00:00.000Z',review_id:W,by:{name:'Meera Rao',role:'Principal'},weekly},
            {record_id:'102',school:S,feedback:'Weekly review · heading\n\n…',updated_at:'2026-11-30T05:00:00.000Z',review_id:W,by:{name:'Meera Rao',role:'Principal'},weekly},
            {record_id:'102',school:S,feedback:'Planning · A (Strong practice)\nGood.',updated_at:'2026-11-26T05:00:00.000Z',review_id:'lesson-review-102-x',by:{name:'Harshit',role:'Consultant'}}],
   notes:[{record_id:'102',key:W,noted_at:'2026-11-30T06:00:00.000Z'}]})}});
 const orig=console.info;console.info=()=>{};
 try{
  const res=await route.POST(new Request('https://schoolsuccess.in/api/school-success/evidence',{method:'POST',body:JSON.stringify({action:'myLessons'})}));
  const body=await res.json();assert.equal(res.status,200,JSON.stringify(body));
  const weeklyItems=body.feedback.filter(f=>f.weekly);
  assert.equal(weeklyItems.length,1,'once, not once per period');
  assert.equal(weeklyItems[0].topic,'Weekly review · 23 Nov – 29 Nov 2026');assert.equal(weeklyItems[0].text,'…','the week heading is shown once, as the title');assert.equal(weeklyItems[0].by,'Meera Rao, Principal');
  assert.equal(weeklyItems[0].notedAt,'2026-11-30T06:00:00.000Z','noted on the second period counts');
  assert.equal(body.feedback.filter(f=>!f.weekly).length,1,'the single-period review is still listed');
 }finally{console.info=orig;}
});
