// Route-level tests for /api/school-success/evidence with the real route, sealing, schemas and lesson
// workflow. Only storage (in-memory R2 honouring If-None-Match), the database RPC (in-memory emulation of
// school_success_append_lesson_evidence) and the signed-in actor are faked.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc');
const root=path.resolve(__dirname,'..'),BASE='https://media.example.test',SECRET='test-signing-secret';
const S='Alpha School',T='Asha',EMAIL='asha-link@school.invalid',SUB='11111111-1111-4111-8111-111111111111';
const PERIOD=i=>`${String(i).padStart(8,'a')}-aaaa-4aaa-8aaa-${String(i).padStart(12,'a')}`;
const CONFIG={SUPABASE_GATEWAY_TOKEN:SECRET,R2_ACCESS_KEY_ID:'k',R2_SECRET_ACCESS_KEY:'s',R2_ENDPOINT_URL:'https://acc.r2.cloudflarestorage.com',R2_BUCKET_NAME:'onelern-media',R2_PUBLIC_BASE_URL:BASE};

function harness({periods=1,plan='Why — learning objective\nRead CVC words',school=S,teacher=T,submissionId=SUB,storageConfig=CONFIG,storageRequest,actor={role:'school-teacher',email:EMAIL,school,name:teacher}}={}){
 const r2=new Map(),writes=[],faults={put:0,rpc:0},state={actor};
 const rows=Array.from({length:periods},(_,i)=>({id:900+i,Center:school,Institution:school,FullName:teacher,Uploaded_By:EMAIL,Grade:'Grade 2',Section:'A',Subject:'English',Book:'Topic '+(i+1),submission_id:submissionId,lesson_period_id:PERIOD(i+1),planned_lesson_on:'2026-10-21',preparation_saved_at:'2026-10-20T05:00:00',lesson_stage:'preparation_saved',lesson_version:0,last_evidence_update_id:null,lesson_reflection:plan,materials_notes:'',lesson_evidence_history:[],Voice_Note_Link:'',Lesson_Plan_Picture:'',Video_Evidence_1:'',Video_Evidence_2:'',Video_Evidence_3:'',Writing_Sample_Link:'',Phonics_Evidence_Link:'',Portfolio_Evidence_Link:'',Event_Pictures_Link:''}));
 const reviews=[];
 const tick=()=>new Promise(r=>setTimeout(r,0));
 const merge=(a,b)=>[...new Set([...String(a||'').split(','),...String(b||'').split(',')].filter(Boolean))].join(',');
 const fileCols=['Video_Evidence_1','Video_Evidence_2','Video_Evidence_3','Writing_Sample_Link','Phonics_Evidence_Link','Portfolio_Evidence_Link','Event_Pictures_Link','Lesson_Plan_Picture'];
 async function gateway(b){
  await tick();
  if(b.action==='readLesson'||b.action==='findLessons')return {rows:structuredClone(rows)};
  if(b.action==='evidenceStatus')return {saved:state.prepSaved===b.id,submissionId:b.id,periods:0,resumable:true};
  if(b.action==='savePreparation'){state.prepSaved=b.rows[0].submission_id;state.prepRows=b.rows;return {saved:true,submissionId:b.rows[0].submission_id,periods:b.rows.length,version:0};}
  if(b.action==='readLessonReviews')return {rows:reviews.filter(r=>b.ids.includes(String(r.record_id)))};
  if(b.action==='appendLessonEvidence'){
   if(faults.rpc>0){faults.rpc--;throw Error('503:Database temporarily unavailable');}
   // Emulates the RPC as one serialized transaction.
   if(!rows.some(r=>r.last_evidence_update_id!==b.updateId))return {saved:true,alreadySaved:true,submissionId,periods:rows.length,version:rows[0].lesson_version};
   if(rows.some(r=>r.lesson_version!==b.version))throw Error('409:Lesson changed. Reopen the return link before adding evidence.');
   for(const inc of b.rows){const row=rows.find(r=>r.lesson_period_id===inc.lesson_period_id);if(inc.Voice_Note_Link)throw Error('Preparation audio cannot be replaced');
    const has=fileCols.some(c=>inc[c]);for(const c of fileCols)row[c]=merge(row[c],inc[c]);
    if(has){row.lesson_evidence_history=[...row.lesson_evidence_history,{id:b.updateId,at:'2026-10-22T06:00:00',conductedOn:b.conductedOn,files:Object.fromEntries(fileCols.map(c=>[c,inc[c]||'']))}];row.lesson_stage='evidence_submitted';row.evidence_submitted_at='2026-10-22T06:00:00';row.conducted_on=b.conductedOn;}
    row.lesson_version++;row.last_evidence_update_id=b.updateId;}
   return {saved:true,alreadySaved:false,submissionId,periods:rows.length,version:rows[0].lesson_version,stage:'evidence_submitted'};
  }
  throw Error('Unexpected gateway action '+b.action);
 }
 async function r2Request(config,key,method,body,headers={}){
  await tick();
  const status=(code,len,body=null)=>new Response(body,{status:code,headers:len==null?{}:{'content-length':String(len)}});
  if(method==='HEAD'){const v=r2.get(key);return v?status(200,Buffer.byteLength(v)):status(404);}
  if(method==='GET'){const v=r2.get(key);return v?status(200,Buffer.byteLength(v),v):status(404);}
  if(method==='PUT'){
   if(faults.put>0){faults.put--;return status(500);}
   if(headers['If-None-Match']==='*'&&r2.has(key))return status(412);
   writes.push({key,body:String(body)});r2.set(key,String(body));return status(200);
  }
  throw Error('Unexpected R2 method '+method);
 }
 const real=require(path.join(root,'lib/school-success/r2-evidence.js'));
 const mocks={
  '@/lib/school-success/server':{withRequest:(req,fn)=>fn(),actor:async()=>state.actor,assertConsultant:a=>{if(a?.leader)throw Error('403:This part of School Success is available to consultants only.');},database:()=>({}),checkOrigin(){},failure:e=>{const message=String(e.message||e),status=Number(message.match(/^(401|403|409|413|503):/)?.[1]||400);return Response.json({error:message.replace(/^\d+:/,'')},{status});}}, // same as server.js failure()
  '@/lib/school-success/environment':{env:{}},
  '@/lib/school-success/live':{gateway,publicBase:()=>storageConfig.R2_PUBLIC_BASE_URL},
  '@/lib/school-success/r2-evidence':{...real,r2Request:storageRequest||r2Request,loadR2Config:async()=>storageConfig}
 };
 const filename=path.join(root,'app/api/school-success/evidence/route.js'),out=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}),m=new Module(filename,module);
 m.paths=Module._nodeModulePaths(path.dirname(filename));const normal=m.require.bind(m);
 m.require=name=>mocks[name]||normal(name.startsWith('@/')?path.join(root,name.slice(2)):name);
 m._compile(out.code,filename);
 const call=async body=>{const res=await m.exports.POST(new Request('http://app.test/api/school-success/evidence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));return {status:res.status,body:await res.json()};};
 const resume=()=>real.seal({kind:'lesson-resume',id:submissionId,school,teacher,email:EMAIL,exp:Date.now()+86400000},SECRET);
 return {r2,writes,faults,rows,reviews,state,call,resume,real};
}
async function prepared(h,{updateId,version=0,answers,periodCount=1,files=[],uploadWrittenReflections=false,directUploads=false}){
 const token=await h.resume(),lesson=(await h.call({action:'resume',resume:token})).body;
 const submission={...lesson.submission,files};
 const reflections=answers?Array.from({length:periodCount},(_,i)=>({periodId:lesson.submission.periods[i].id,answers:typeof answers==='function'?answers(i):answers})):[];
 const prep=await h.call({action:'prepare',mode:'evidence',resume:token,submission,version,updateId,conductedOn:'2026-10-22',reflections,uploadWrittenReflections,directUploads});
 return {prep,commit:extra=>h.call({action:'commit',token:prep.body.token,submission,reflections,...extra}),submission,reflections,token};
}
const U1='c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',U2='c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
const referenced=h=>h.rows.flatMap(r=>r.lesson_evidence_history.flatMap(e=>Object.values(e.files).flatMap(v=>String(v).split(',').filter(u=>u.endsWith('.json')))));
const keyOf=url=>url.slice(BASE.length+1).split('/').map(decodeURIComponent).join('/');
const noOverwrite=h=>{const seen=new Map();for(const w of h.writes){if(seen.has(w.key))assert.equal(w.body,seen.get(w.key),'an accepted object was rewritten with different bytes: '+w.key);seen.set(w.key,w.body);}};

test('identical retries succeed without changing saved reflection content',async()=>{
 const h=harness(),a=await prepared(h,{updateId:U1,answers:{achievement:'Pairs blended well.',nextStep:'Small group on Monday.'}});
 assert.equal(a.prep.status,200,JSON.stringify(a.prep.body));
 const first=await a.commit();assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.alreadySaved,false);
 const [url]=referenced(h),saved=h.r2.get(keyOf(url));
 const again=await a.commit();assert.equal(again.status,200);assert.equal(again.body.alreadySaved,true);
 const fresh=await prepared(h,{updateId:U1,version:0,answers:{achievement:'Pairs blended well.',nextStep:'Small group on Monday.'}});
 assert.equal(fresh.prep.body.alreadySaved,true,'a new prepare with the saved update ID is recognised as saved');
 assert.equal(h.r2.get(keyOf(url)),saved);assert.equal(referenced(h).length,1);assert.equal(h.writes.length,1,'retry skipped the existing object');noOverwrite(h);
});

test('a conflicting plan with the same update ID cannot overwrite the accepted reflection',async()=>{
 const h=harness(),a=await prepared(h,{updateId:U1,answers:{achievement:'Accepted answer'}}),b=await prepared(h,{updateId:U1,answers:{achievement:'Conflicting answer'}});
 assert.notEqual(a.prep.body.token,b.prep.body.token);
 assert.equal((await a.commit()).body.alreadySaved,false);
 const second=await b.commit();assert.equal(second.status,200);assert.equal(second.body.alreadySaved,true);
 const refs=referenced(h);assert.equal(refs.length,1);
 assert.equal(JSON.parse(h.r2.get(keyOf(refs[0]))).answers.achievement,'Accepted answer');
 noOverwrite(h);
});

test('concurrent commits of conflicting plans record exactly one reflection and overwrite nothing',async()=>{
 const h=harness(),a=await prepared(h,{updateId:U1,answers:{achievement:'Version A'}}),b=await prepared(h,{updateId:U1,answers:{achievement:'Version B'}});
 const results=await Promise.all([a.commit(),b.commit()]);
 assert.deepEqual(results.map(r=>r.status),[200,200]);
 assert.deepEqual(results.map(r=>r.body.alreadySaved).sort(),[false,true]);
 const refs=referenced(h);assert.equal(refs.length,1);
 const winner=results[0].body.alreadySaved?'Version B':'Version A';
 assert.equal(JSON.parse(h.r2.get(keyOf(refs[0]))).answers.achievement,winner);
 assert.equal(h.rows[0].lesson_evidence_history.length,1);noOverwrite(h);
});

test('a stale plan is rejected and leaves saved history unchanged',async()=>{
 const h=harness(),a=await prepared(h,{updateId:U1,answers:{achievement:'First update'}}),b=await prepared(h,{updateId:U2,answers:{achievement:'Stale update'}});
 assert.equal((await a.commit()).status,200);
 const before=JSON.stringify(h.rows);
 const stale=await b.commit();assert.equal(stale.status,409);assert.match(stale.body.error,/Lesson changed/);
 assert.equal(JSON.stringify(h.rows),before);
 assert.equal(JSON.parse(h.r2.get(keyOf(referenced(h)[0]))).answers.achievement,'First update');noOverwrite(h);
 const late=await prepared(h,{updateId:U2,version:0,answers:{achievement:'Stale update'}});assert.equal(late.prep.status,409,'prepare also refuses an old version');
});

test('partial failures can be retried: storage failure, then database failure after storage',async()=>{
 const h=harness(),a=await prepared(h,{updateId:U1,answers:{achievement:'Retry me',nextStep:'Next steps'}});
 h.faults.put=3;
 const failed=await a.commit();assert.equal(failed.status,503);assert.match(failed.body.error,/R2 PUT 500/);assert.match(failed.body.error,/could not be saved/);assert.equal(referenced(h).length,0);
 h.faults.rpc=1;
 const dbFail=await a.commit();assert.equal(dbFail.status,503);assert.equal(referenced(h).length,0);assert.equal(h.writes.length,1);
 const ok=await a.commit();assert.equal(ok.status,200);assert.equal(ok.body.alreadySaved,false);
 assert.equal(referenced(h).length,1);assert.equal(h.writes.length,1,'the stored object was reused, not rewritten');noOverwrite(h);
});

test('a commit whose resent submission or answers differ from the prepared plan is refused',async()=>{
 const h=harness(),a=await prepared(h,{updateId:U1,answers:{achievement:'Prepared text'}});
 const tampered=await a.commit({reflections:[{periodId:a.reflections[0].periodId,answers:{achievement:'Different text'}}]});
 assert.equal(tampered.status,409);assert.match(tampered.body.error,/changed after it was prepared/);
 const other=await a.commit({submission:{...a.submission,date:'2026-10-25'}});assert.equal(other.status,409);
 assert.equal(h.writes.length,0);assert.equal(referenced(h).length,0);
});

test('file selection rejects arbitrary JSON evidence and reflections must belong to the lesson',async()=>{
 const h=harness(),token=await h.resume(),lesson=(await h.call({action:'resume',resume:token})).body;
 const json=await h.call({action:'prepare',mode:'evidence',resume:token,version:0,updateId:U1,conductedOn:'2026-10-22',submission:{...lesson.submission,files:[{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',periodId:lesson.submission.periods[0].id,category:'closure',name:'x.json',size:10}]}});
 assert.equal(json.status,400);assert.match(json.body.error,/PDF, photo, video or audio/);
 const foreign=await h.call({action:'prepare',mode:'evidence',resume:token,version:0,updateId:U1,conductedOn:'2026-10-22',submission:lesson.submission,reflections:[{periodId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',answers:{achievement:'x'}}]});
 assert.equal(foreign.status,403);
});

for(const [name,make] of [['English',()=>'E'.repeat(3990)+' done.'],['Hindi',()=>'क्'.repeat(1995)+'।'],['mixed',()=>('बच्चों ने पढ़ा and wrote ').repeat(160).slice(0,4000)]]){
 test(`maximum-length ${name} reflections for 10 periods complete prepare → token → commit and read back intact`,async()=>{
  const longPlan='Why — learning objective\n'+'पाठ योजना '.repeat(490);
  const h=harness({periods:10,plan:longPlan});
  const text=make();assert.equal(text.length<=4000,true);
  const a=await prepared(h,{updateId:U1,periodCount:10,answers:i=>({achievement:text,nextStep:text})});
  assert.equal(a.prep.status,200,JSON.stringify(a.prep.body).slice(0,300));
  // Token size depends only on the number of periods/files, not on answer or plan length.
  const small=await prepared(harness({periods:10}),{updateId:U1,periodCount:10,answers:()=>({achievement:'x',nextStep:'y'})});
  assert.ok(Math.abs(a.prep.body.token.length-small.prep.body.token.length)<64,`token ${a.prep.body.token.length} vs ${small.prep.body.token.length}`);
  assert.ok(a.prep.body.token.length<4000,`plan token stays bounded (${a.prep.body.token.length} chars)`);
  const done=await a.commit();assert.equal(done.status,200,JSON.stringify(done.body).slice(0,300));
  assert.equal(referenced(h).length,10);
  const lesson=(await h.call({action:'resume',resume:await h.resume()})).body;
  const texts=lesson.files.filter(f=>f.reflection);assert.equal(texts.length,10);
  assert.ok(texts.every(f=>f.reflection.answers.achievement===text.trim()&&f.reflection.answers.nextStep===text.trim()&&f.date==='2026-10-22'));
 });
}

test('large sealed payloads no longer crash the encoder',async()=>{
 const h=harness(),big={kind:'x',exp:Date.now()+60000,text:'क्'.repeat(60000)};
 const sealed=await h.real.seal(big,SECRET);assert.ok(sealed.length>200000,'large tokens are still refused by unseal, so plans must stay bounded');
 await assert.rejects(h.real.unseal(sealed,SECRET),/expired or is invalid/);
});

test('saved reflections reload as dated text; earlier PDFs and recordings stay listed; feedback for admins only',async()=>{
 const h=harness();
 h.rows[0].Video_Evidence_1=`${BASE}/legacy/closure/ffffffff-ffff-4fff-8fff-ffffffffffff.pdf`;h.rows[0].Voice_Note_Link=`${BASE}/legacy/voice/rec.wav`;
 h.rows[0].lesson_evidence_history=[{id:'old',at:'2026-10-21T06:00:00',conductedOn:'2026-10-21',files:{Video_Evidence_1:h.rows[0].Video_Evidence_1}}];h.rows[0].lesson_version=1;h.rows[0].last_evidence_update_id='old';
 const a=await prepared(h,{updateId:U1,version:1,answers:{achievement:'First reflection',nextStep:'Group A'}});assert.equal((await a.commit()).status,200);
 const b=await prepared(h,{updateId:U2,version:2,answers:{achievement:'दूसरा प्रतिबिंब',nextStep:'Group B'}});assert.equal((await b.commit()).status,200);
 const lesson=(await h.call({action:'resume',resume:await h.resume()})).body;
 const texts=lesson.files.filter(f=>f.reflection).map(f=>f.reflection.answers.achievement);
 assert.deepEqual(texts.sort(),['First reflection','दूसरा प्रतिबिंब'].sort(),'both dated reflections kept');
 assert.ok(lesson.files.some(f=>f.url.endsWith('.pdf')&&f.date==='2026-10-21'),'legacy PDF stays with its date');
 assert.ok(lesson.files.some(f=>f.url.endsWith('rec.wav')),'recording stays');
 assert.equal(lesson.feedback,undefined,'teachers do not receive review feedback');
 h.reviews.push({record_id:900,feedback:'Strong modelling',updated_at:'2026-10-23T05:00:00+00:00'});h.state.actor={role:'admin',email:EMAIL,name:'Admin',school:''};
 const asAdmin=(await h.call({action:'resume',resume:await h.real.seal({kind:'lesson-resume',id:SUB,school:S,teacher:T,email:EMAIL,exp:Date.now()+86400000},SECRET)})).body;
 assert.deepEqual(asAdmin.feedback,[{periodId:PERIOD(1),text:'Strong modelling',date:'2026-10-23T05:00:00+00:00'}]);
});

test('lesson-plan preparation with ten maximum-length Hindi periods saves through a bounded token',async()=>{
 const h=harness(),id='22222222-2222-4222-8222-222222222222';
 const submission={id,school:S,teacher:T,date:'2026-10-21',periods:Array.from({length:10},(_,i)=>({id:PERIOD(i+20),grade:'Grade 3',section:'B',subject:'Hindi',topic:'पाठ '.repeat(240).slice(0,1000),reflection:'क्ष'.repeat(1666),materials:'पुस्तक '.repeat(285).slice(0,2000)})),files:[]};
 const prep=await h.call({action:'prepare',mode:'preparation',submission});
 assert.equal(prep.status,200,JSON.stringify(prep.body).slice(0,200));assert.ok(prep.body.token.length<4000,`bounded token (${prep.body.token.length})`);
 const tampered=await h.call({action:'commit',token:prep.body.token,submission:{...submission,periods:submission.periods.map((p,i)=>i?p:{...p,topic:'Changed'})}});
 assert.equal(tampered.status,409);
 const done=await h.call({action:'commit',token:prep.body.token,submission});
 assert.equal(done.status,200,JSON.stringify(done.body).slice(0,200));assert.equal(h.state.prepRows.length,10);assert.equal(h.state.prepRows[0].lesson_reflection,'क्ष'.repeat(1666));
 assert.ok(done.body.resumeToken,'return link still issued');
});

test('photos, student work and written answers reach one lesson even if the server reflection PUT is unavailable',async()=>{
 const h=harness(),files=['activity','writing'].map((category,i)=>({id:crypto.randomUUID(),periodId:PERIOD(1),category,name:category+'.jpg',size:3}));
 const a=await prepared(h,{updateId:U1,files,uploadWrittenReflections:true,answers:{achievement:'बच्चे पढ़ सके।',nextStep:'Review pairs.'}});
 assert.equal(a.prep.status,200);assert.equal(a.prep.body.reflectionUploads.length,1);
 for(const f of a.prep.body.files){const file=await h.real.unseal(f.token,SECRET);h.r2.set(file.key,'img');}
 const ticket=a.prep.body.reflectionUploads[0],key=decodeURIComponent(new URL(ticket.url).pathname.slice('/onelern-media/'.length));
 h.r2.set(key,ticket.text);h.faults.put=10;
 const result=await a.commit();assert.equal(result.status,200,JSON.stringify(result.body));
 assert.equal(h.faults.put,10);assert.equal(h.rows[0].lesson_evidence_history.length,1);
 const row=h.rows[0].lesson_evidence_history[0];
 assert.ok(row.files.Video_Evidence_1.includes('/activity/'));assert.ok(row.files.Writing_Sample_Link.includes('/writing/'));
 const reopened=await h.call({action:'resume',resume:a.token});
 assert.ok(reopened.body.files.some(f=>f.reflection?.answers?.achievement==='बच्चे पढ़ सके।'));
 assert.equal((await a.commit()).body.alreadySaved,true);assert.equal(h.rows[0].lesson_evidence_history.length,1);
});
test('incomplete media identifies only the file that must be resent; an incorrect reflection cannot commit',async()=>{
 const h=harness(),file={id:crypto.randomUUID(),periodId:PERIOD(1),category:'writing',name:'work.jpg',size:3};
 const a=await prepared(h,{updateId:U1,files:[file],uploadWrittenReflections:true,answers:{achievement:'Original'}});
 const ticket=a.prep.body.reflectionUploads[0],key=decodeURIComponent(new URL(ticket.url).pathname.slice('/onelern-media/'.length));
 h.r2.set(key,ticket.text.replace('Original','Modified'));
 assert.equal((await a.commit()).status,409);assert.equal(h.rows[0].lesson_evidence_history.length,0);
 h.r2.set(key,ticket.text);
 const incomplete=await a.commit();assert.equal(incomplete.status,409);assert.equal(incomplete.body.fileId,file.id);
 assert.equal(h.rows[0].lesson_evidence_history.length,0);
});

// Only this opt-in check uses real storage. The lesson, actor and database stay in memory.
test('real R2 saves classroom evidence, student work and multilingual reflection through the lesson route',
 {skip:process.env.SCHOOL_SUCCESS_TEST_R2!=='1' && 'requires a configured test storage connection'}, async t=>{
 const {env}=await import('../lib/school-success/environment.js');
 const r2=await import('../lib/school-success/r2-evidence.js');
 const {presignUpload}=await import('../lib/school-success/r2-upload.js');
 const {transferWrittenReflections}=await import('../lib/school-success/storage-upload.js');
 let config=env;
 if(!r2.r2UploadsConfigured(config)){
  assert.ok(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SCHOOL_SUCCESS_TRANSFER_KEY,'the requested storage test must have a connection');
  const {localDatabase}=await import('../lib/school-success/database.js');
  config=await r2.loadR2Config(env,localDatabase());
 }
 const school='ZZ Synthetic Evidence Save',teacher='Synthetic Teacher',submissionId=crypto.randomUUID();
 const keys=new Set(),prefix='schools/'+encodeURIComponent(school)+'/teachers/'+encodeURIComponent(teacher)+'/2026-10-21/submission_'+submissionId+'/';
 const remember=key=>{assert.ok(key.startsWith(prefix),'only the isolated synthetic lesson can be written or cleaned up');keys.add(key);};
 t.after(async()=>{
  const responses=await Promise.all([...keys].map(key=>r2.r2Request(config,key,'DELETE')));
  assert.ok(responses.every(r=>r.ok),'synthetic lesson files removed');
 });
 const h=harness({school,teacher,submissionId,storageConfig:{...config,SUPABASE_GATEWAY_TOKEN:SECRET},storageRequest:r2.r2Request});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
 const {jsPDF}=require('jspdf'),pdf=new jsPDF();pdf.text('Synthetic student work',20,20);
 const worksheet=Buffer.from(pdf.output('arraybuffer'));
 const file=(category,name,size)=>({id:crypto.randomUUID(),periodId:PERIOD(1),category,name,size});
 const files=[file('activity','classroom.png',png.length),file('writing','work.pdf',worksheet.length)];
 const answers={achievement:'लेखन अभ्यास पूरा हुआ।',nextStep:'Read again in pairs.'};
 const a=await prepared(h,{updateId:crypto.randomUUID(),files,answers,uploadWrittenReflections:true});
 assert.equal(a.prep.status,200);
 for(const entry of a.prep.body.files){
  const f=await r2.unseal(entry.token,SECRET);remember(f.key);
  const url=await presignUpload(config,f.key,f.type),bytes=f.category==='activity'?png:worksheet;
  const uploaded=await fetch(url,{method:'PUT',headers:{'Content-Type':f.type},body:new Blob([bytes],{type:f.type})});
  assert.ok(uploaded.ok,'synthetic attachment upload HTTP '+uploaded.status);
 }
 const ticket=a.prep.body.reflectionUploads[0];
 const keyFor=ticket=>decodeURIComponent(new URL(ticket.url).pathname.slice(('/'+config.R2_BUCKET_NAME+'/').length));
 remember(keyFor(ticket));
 const responses=[];
 const transfer=()=>transferWrittenReflections([ticket],async(url,init)=>{const res=await fetch(url,init);responses.push(res.status);return res;});
 await transfer();await transfer();
 assert.deepEqual(responses,[200,412],'the direct reflection is stored and a duplicate cannot replace it');
 const saved=await a.commit();assert.equal(saved.status,200);
 assert.equal((await a.commit()).body.alreadySaved,true);
 const reopened=await h.call({action:'resume',resume:a.token});
 assert.ok(reopened.body.files.some(f=>f.reflection?.answers?.achievement===answers.achievement));
 assert.ok(reopened.body.files.some(f=>f.url.includes('/activity/')));assert.ok(reopened.body.files.some(f=>f.url.includes('/writing/')));
 const b=await prepared(h,{updateId:crypto.randomUUID(),version:saved.body.version,answers:{nextStep:'Server fallback'},uploadWrittenReflections:true});
 assert.equal(b.prep.status,200);remember(keyFor(b.prep.body.reflectionUploads[0]));
 // Withhold this direct transfer to exercise a server write, as with an already-open teacher form.
 assert.equal((await b.commit()).status,200);assert.equal(h.rows[0].lesson_evidence_history.length,2);
 const afterFallback=await h.call({action:'resume',resume:b.token});
 assert.ok(afterFallback.body.files.some(f=>f.reflection?.answers?.nextStep==='Server fallback'));
});


test('batched upload permissions match the sealed files and a lost commit response preserves one update',async()=>{
 const h=harness(),files=Array.from({length:6},(_,i)=>({id:crypto.randomUUID(),periodId:PERIOD(1),category:i%2?'writing':'activity',name:'file-'+i+'.jpg',size:3}));
 const a=await prepared(h,{updateId:U1,files,directUploads:true,uploadWrittenReflections:true,answers:{achievement:'All six groups practised.'}});
 assert.equal(a.prep.status,200);assert.equal(a.prep.body.files.length,6);
 for(const [index,file] of a.prep.body.files.entries()){
  const signed=await h.real.unseal(file.token,SECRET),url=new URL(file.upload.url);
  assert.equal(file.id,files[index].id);assert.equal(file.upload.file,files[index].category);
  assert.equal(decodeURIComponent(url.pathname.slice('/onelern-media/'.length)),signed.key);
  assert.equal(file.upload.contentType,signed.type);assert.ok(url.searchParams.has('X-Amz-Signature'));
  if(index!==2)h.r2.set(signed.key,'abc');
 }
 const missing=await a.commit();assert.equal(missing.status,409);assert.equal(missing.body.fileId,files[2].id);
 assert.equal(h.rows[0].lesson_evidence_history.length,0);
 const signed=await h.real.unseal(a.prep.body.files[2].token,SECRET);h.r2.set(signed.key,'abc');
 const {requestJson}=await import('../lib/school-success/request-json.js');let calls=0;
 const receipt=await requestJson(async()=>{
  const result=await a.commit();calls++;
  if(calls===1)throw TypeError('Load failed');
  return Response.json(result.body,{status:result.status});
 },{wait:async()=>{}});
 assert.equal(receipt.saved,true);assert.equal(receipt.alreadySaved,true);
 assert.equal(h.rows[0].lesson_evidence_history.length,1);assert.equal(referenced(h).length,1);
});
