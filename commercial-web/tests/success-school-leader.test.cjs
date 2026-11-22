// School leader role (principals and coordinators). The module grant schema, Vision sign-in identity (server.js),
// the data gateway (live.js), the portal route's write guard and the teacher PIN admin route are real; Supabase and
// PostgREST are an in-memory synthetic school. No school records are read or written.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc'),root=path.resolve(__dirname,'..');
const S='Sunrise Public School',OTHER='Green Valley School',LEADER='11111111-2222-4333-8444-555555555555',CONSULTANT='66666666-7777-4888-9999-000000000000';
function load(file,mocks={}){
 const filename=path.join(root,file),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const normal=mod.require.bind(mod);
 mod.require=name=>{if(mocks[name])return mocks[name];const target=name.startsWith('@/')?path.join(root,name.slice(2)):name.startsWith('.')?path.resolve(path.dirname(filename),name):null;
  if(target){for(const ext of ['.js','.jsx',''])if(fs.existsSync(target+ext)&&fs.statSync(target+ext).isFile()){const f=path.relative(root,target+ext);return mocks[f]||load(f,mocks);}}
  return normal(name);};
 mod._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true}},module:{type:'commonjs'}}).code,filename);
 return mod.exports;
}
function fakeSupabase(tables,users){
 function from(table){
  const st={filters:[]};const rows=()=>(tables[table]||[]).filter(r=>st.filters.every(([k,v])=>r[k]===v));
  const q={select(){return q;},eq(k,v){st.filters.push([k,v]);return q;},like(){return q;},async maybeSingle(){return {data:rows()[0]||null,error:null};},then(res,rej){return Promise.resolve({data:rows(),error:null}).then(res,rej);}};
  return q;
 }
 return {from,rpc:async()=>({data:[],error:null}),auth:{getUser:async token=>({data:{user:users[token]||null},error:users[token]?null:{message:'bad'}})}};
}
function harness(t){
 const grant=(id,role,schools)=>({key:'moduleAccess:'+id,value:JSON.stringify({userId:id,enabled:true,schools,role}),revision:''});
 const tables={literacy_platform_admins:[],success_config:[grant(LEADER,'leader',[S]),{key:'moduleAccess:'+CONSULTANT,value:JSON.stringify({userId:CONSULTANT,enabled:true,schools:[S]}),revision:''}],success_import_state:[]};
 const users={leader:{id:LEADER,phone:'919800000001',phone_confirmed_at:'x',app_metadata:{},user_metadata:{full_name:'Principal Rao'}},consultant:{id:CONSULTANT,email:'c@example.test',email_confirmed_at:'x',app_metadata:{}}};
 const db=fakeSupabase(tables,users);
 const database={service:()=>db,checked:async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data;},localDatabase:()=>({prepare:()=>({all:async()=>({results:[]}),first:async()=>null,bind(){return this;}}),batch:async()=>{throw Error('no writes in this test');}})};
 const mocks={'lib/school-success/database.js':database};
 const server=load('lib/school-success/server.js',mocks);
 const live=load('lib/school-success/live.js',{...mocks,'lib/school-success/server.js':server});
 // PostgREST: every table returns rows for the leader's school and another school.
 const original=global.fetch;t.after(()=>{global.fetch=original;});
 const rowsFor=table=>({portal_contacts:[{school:S,name:'Owner phone'},{school:OTHER}],portal_call_logs:[{school:S,id:1,notes:'Fee follow-up'}],portal_tickets:[{school:S,id:2}],classroom_observations:[{school:S,id:3},{school:OTHER,id:4}],portal_evidence_reviews:[],portal_school_plans:[],teacher_records:[{id:9,Center:S,FullName:'Asha Verma',StartTime:'2026-11-10T00:00:00'},{id:10,Center:OTHER,FullName:'Other',StartTime:'2026-11-10T00:00:00'}]}[table]||[]);
 global.fetch=async rawUrl=>{const u=new URL(String(rawUrl).replace(/^undefined/,'https://fixture.invalid'));const table=u.pathname.split('/').pop();const result=table==='school_success_roster'?[]:rowsFor(table);return Response.json(result,{headers:{'content-range':'0-'+result.length+'/'+result.length}});};
 const as=(who,run)=>server.withRequest(new Request('http://app.test/x',{headers:{Authorization:'Bearer '+who}}),run);
 return {server,live,as,mocks:{...mocks,'lib/school-success/server.js':server}};
}

test('grants default to consultant; a leader grant is limited to its schools',()=>{
 const {moduleGrantSchema}=load('lib/school-success/module-access.js');
 assert.equal(moduleGrantSchema.parse({userId:LEADER,enabled:true,schools:[S]}).role,'consultant','existing grants keep full staff access');
 assert.equal(moduleGrantSchema.parse({userId:LEADER,enabled:true,schools:[S],role:'leader'}).role,'leader');
 assert.throws(()=>moduleGrantSchema.parse({userId:LEADER,enabled:true,schools:[S],role:'owner'}));
});

test('a principal signs in with a mobile-number Vision account and is a school leader for their school only',async t=>{
 const h=harness(t);
 const a=await h.as('leader',()=>h.server.actor());
 assert.deepEqual([a.role,a.leader,a.staffRole,a.visionRole,a.name],['admin',true,'leader','school_leader','Principal Rao']);
 assert.deepEqual(a.allowedSchools,[S]);
 assert.throws(()=>h.server.assertSchool(a,OTHER),/403/);
 assert.throws(()=>h.server.assertConsultant(a),/consultants only/);
 const c=await h.as('consultant',()=>h.server.actor());
 assert.equal(c.leader,false);assert.equal(c.staffRole,'consultant');h.server.assertConsultant(c);
});

test('leaders read their school without the CRM; consultants keep it',async t=>{
 const h=harness(t),read={action:'read',from:'2026-11-01',to:'2026-11-22'};
 const leader=await h.as('leader',()=>h.live.gateway(read));
 assert.deepEqual([leader.contacts,leader.calls,leader.tickets,leader.legacyCalls],[[],[],[],[]],'CRM is never sent to school leaders');
 assert.deepEqual(leader.legacyContacts,{contacts:{}});
 assert.deepEqual(leader.records.map(r=>r.Center),[S],'only their school');
 assert.deepEqual(leader.visits.map(v=>v.school),[S],'classroom visits of their school');
 const consultant=await h.as('consultant',()=>h.live.gateway(read));
 assert.equal(consultant.contacts.length,1);assert.equal(consultant.calls.length,1);assert.equal(consultant.tickets.length,1);
});

test('every data change and teacher-submission action is refused for school leaders',async t=>{
 const h=harness(t);
 for(const action of ['importUsage','contact','call','ticket','observation','review','savePreparation','appendLessonEvidence','submitEvidence','findLessons','teacherLessons','readLesson','evidenceStatus'])
  await assert.rejects(h.as('leader',()=>h.live.gateway({action,school:S})),/consultants only/,action);
});

test('the portal write route refuses school leaders before reading the request',async t=>{
 const h=harness(t);
 const route=load('app/api/school-success/portal/route.js',h.mocks);
 for(const body of [{action:'directoryArchive',target:'school',school:S,archived:true},{action:'member',school:S},{kind:'school',data:{name:'X'}},{action:'reportSettings'}]){
  const res=await route.POST(new Request('http://app.test/api/school-success/portal',{method:'POST',headers:{Authorization:'Bearer leader','content-type':'application/json'},body:JSON.stringify(body)}));
  assert.equal(res.status,403,JSON.stringify(body));assert.match((await res.json()).error,/consultants only/);
 }
});

test('school leaders can open the teacher PIN panel for their school only',async t=>{
 const h=harness(t);
 const route=load('app/api/school-success/teacher-pins/route.js',h.mocks);
 const call=async school=>{const res=await route.POST(new Request('http://app.test/api/school-success/teacher-pins',{method:'POST',headers:{Authorization:'Bearer leader','content-type':'application/json'},body:JSON.stringify({action:'list',school})}));return res.status;};
 assert.equal(await call(S),200);
 assert.equal(await call(OTHER),403);
});
