// Editing reviews and yellow highlights (27 November 2026). The review route, lesson mapping, gateway and validation are real. PostgREST and staff identities
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
   const message=String(e.message||e),status=Number(message.match(/^(401|403|404|409|503):/)?.[1]||400);
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
    const entries=[].concat(JSON.parse(init.body));assert.match(init.headers.Prefer,/ignore-duplicates/);
    result=[];for(const entry of entries)if(!saved.has(entry.id)){saved.set(entry.id,entry);result.push({id:entry.id});}
   }else if(q.get('id')?.startsWith('like.')){const p=q.get('id').slice(5,-1);result=list.filter(r=>r.id.startsWith(p)&&'eq.'+r.school===q.get('school'));}
   else if(q.get('id')?.startsWith('in.(')){const ids=q.get('id').slice(4,-1).split(',');result=list.filter(r=>ids.includes(r.id)&&'eq.'+r.school===q.get('school'));}
   else if(q.has('id'))result=list.filter(r=>'eq.'+r.id===q.get('id')&&'eq.'+r.school===q.get('school'));
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

const consultant={role:'admin',email:'reviewer@example.test',name:'Harshit',allowedSchools:['Alpha School']};
const other={role:'admin',email:'second@example.test',name:'Kiran',allowedSchools:['Alpha School']};
const principal={role:'admin',leader:true,title:'Principal',email:'9800000001@mobile.schoolsuccess.in',name:'Meera Rao',allowedSchools:['Alpha School']};
const coordinator={role:'admin',leader:true,title:'Coordinator',email:'9800000002@mobile.schoolsuccess.in',name:'Ravi Coord',allowedSchools:['Alpha School']};
const superAdmin={role:'admin',isSuperAdmin:true,email:'owner@example.test',name:'Owner',allowedSchools:['Alpha School']};
const uuid=()=>crypto.randomUUID();
const mine=lesson=>lesson.reviews.filter(r=>!/^legacy:/.test(r.key));

test('a consultant edits their own review: the latest version shows, the first is kept, and the key changes',async t=>{
 const {state,post,saved}=await harness(t);state.actor=consultant;
 const hl=[{record:'101',field:'objective',text:'Children will blend CVC words aloud and read them independently.'}];
 let r=await post({action:'save',recordId:'101',requestId:uuid(),review:{planning:{level:'B',note:'Add a quick check.'},highlights:hl}});assert.equal(r.status,200);
 let lesson=(await post({action:'open',recordId:'101'})).body.lesson,first=mine(lesson)[0];
 assert.deepEqual(first.highlights,hl);assert.equal(first.by,'Harshit, Consultant');assert.equal(first.editedBy,'');
 r=await post({action:'edit',recordId:'101',reviewKey:first.key,requestId:uuid(),review:{planning:{level:'A',note:'Clear outcome and check.'},execution:{level:'C',note:'Plan support for five children.'},highlights:[]}});
 assert.equal(r.status,200);assert.equal(r.body.edited,true);
 lesson=(await post({action:'open',recordId:'101'})).body.lesson;
 const now=mine(lesson);assert.equal(now.length,1,'one review, shown at its latest version');
 assert.match(now[0].text,/Planning · A[\s\S]*Execution · C/);assert.doesNotMatch(now[0].text,/Add a quick check/);
 assert.notEqual(now[0].key,first.key,'a new key: the teacher notes the updated review again');assert.equal(now[0].root,first.key);
 assert.equal(now[0].by,'Harshit, Consultant');assert.equal(now[0].editedBy,'Harshit, Consultant');assert.deepEqual(now[0].highlights,[]);
 assert.match(lesson.feedback.text,/updated/);
 const rows=[...saved.values()].filter(e=>e.id.startsWith('lesson-review-101-'));assert.equal(rows.length,2,'the first version is still stored');
 assert.match(rows[0].payload,/Add a quick check/);assert.equal(JSON.parse(rows[1].payload).edits,first.key);
 assert.ok(!JSON.stringify(lesson).includes('reviewer@example.test'),'no sign-in address reaches the screen');
 // Editing an older version is refused: someone already changed it.
 r=await post({action:'edit',recordId:'101',reviewKey:first.key,requestId:uuid(),review:{planning:{level:'B',note:'x'}}});
 assert.equal(r.status,409);assert.match(r.body.error,/changed by someone else/);
 r=await post({action:'edit',recordId:'101',reviewKey:'lesson-review-101-nope',requestId:uuid(),review:{planning:{level:'B',note:'x'}}});
 assert.equal(r.status,404);
});

test('who may edit: school leaders edit leadership reviews, consultants their own, Super Admin all',async t=>{
 const {state,post}=await harness(t),latest=async()=>{const l=(await post({action:'open',recordId:'101'})).body.lesson;return mine(l);};
 state.actor=consultant;await post({action:'save',recordId:'101',requestId:uuid(),review:{planning:{level:'B',note:'From the consultant.'}}});
 state.actor=principal;await post({action:'save',recordId:'101',requestId:uuid(),review:{execution:{level:'A',note:'From the principal.'}}});
 const [fromConsultant,fromPrincipal]=(await latest()).sort((a,b)=>a.text.localeCompare(b.text)).reverse();
 assert.match(fromConsultant.text,/consultant/);assert.match(fromPrincipal.text,/principal/);
 const edit=(key,note,review)=>post({action:'edit',recordId:'101',reviewKey:key,requestId:uuid(),review:review||{planning:{level:'A',note}}});
 state.actor=coordinator;let r=await edit(fromConsultant.key,'Coordinator changes consultant');
 assert.equal(r.status,403,'a school leader cannot change a School Success review');assert.match(r.body.error,/School Success team/);
 r=await edit(fromPrincipal.key,'Coordinator tidies the principal review');assert.equal(r.status,200,'a coordinator edits the principal\'s review');
 state.actor=other;r=await edit((await latest()).find(x=>/Coordinator tidies/.test(x.text)).key,'Other consultant');
 assert.equal(r.status,403,'a consultant cannot edit a school leader\'s review');
 r=await edit(fromConsultant.key,'Other consultant edits');assert.equal(r.status,403,'nor another consultant\'s');
 state.actor=superAdmin;r=await edit(fromConsultant.key,'Super Admin correction');assert.equal(r.status,200);
 const now=await latest();assert.equal(now.length,2);
 const fixed=now.find(x=>/Super Admin correction/.test(x.text));assert.equal(fixed.by,'Harshit, Consultant');assert.equal(fixed.editedBy,'Owner, Super Admin');
 const coord=now.find(x=>/Coordinator tidies/.test(x.text));assert.equal(coord.by,'Meera Rao, Principal');assert.equal(coord.editedBy,'Ravi Coord, Coordinator');
 // A period review keeps no weekly focus.
 r=await edit(fixed.key,'',{planning:{level:'A',note:'ok'},focus:'Next week'});assert.equal(r.status,400);
});

test('highlights must be on the reviewed lesson',async t=>{
 const {state,post}=await harness(t);state.actor=consultant;
 const r=await post({action:'save',recordId:'101',requestId:uuid(),review:{planning:{level:'A',note:'ok'},highlights:[{record:'102',field:'objective',text:'x'}]}});
 assert.equal(r.status,400);assert.match(r.body.error,/Highlights must be on the lessons/);
});

test('a weekly review is edited once for every period it covers, keeping its focus',async t=>{
 const {state,post,saved,live}=await harness(t);state.actor=principal;
 const id=uuid(),base={school:'Alpha School',teacher:'Asha',grade:'Grade 2',section:'A',subject:'English',weekStart:'2026-10-19',weekEnd:'2026-10-25',recordIds:['101','102']};
 await live.saveWeeklyReview({...base,requestId:id,review:{planning:{level:'B',note:'Week one.'},focus:'Exit tickets.',highlights:[{record:'102',field:'objective',text:'बच्चे मात्राओं को पहचानकर शब्द पढ़ेंगे।'}]}},principal);
 let r=await post({action:'edit',recordId:'102',reviewKey:'weekly-'+id,requestId:uuid(),review:{planning:{level:'A',note:'Week one, revised.'}}});
 assert.equal(r.status,400,'the focus is required');
 r=await post({action:'edit',recordId:'102',reviewKey:'weekly-'+id,requestId:uuid(),review:{planning:{level:'A',note:'Week one, revised.'},focus:'Daily exit tickets.'}});
 assert.equal(r.status,200);assert.equal(r.body.periods,2);
 for(const rec of ['101','102']){
  const l=(await post({action:'open',recordId:rec})).body.lesson,w=mine(l).filter(x=>x.weekly);
  assert.equal(w.length,1,'one weekly review per period');assert.match(w[0].text,/revised[\s\S]*Daily exit tickets/);assert.equal(w[0].root,'weekly-'+id);assert.deepEqual(w[0].highlights,[]);
 }
 assert.equal([...saved.values()].filter(e=>e.id.includes('-weekly-')).length,4,'two first-version rows and two edit rows');
});
