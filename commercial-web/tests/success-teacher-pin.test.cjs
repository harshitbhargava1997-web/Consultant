// Teacher PIN sign-in on school links. The PIN module, school-link identity (server.js), sealing, the teacher PIN
// route, the admin PIN route and the evidence route's identity check are real. Supabase is an in-memory synthetic
// school; no school records are read or written.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc'),root=path.resolve(__dirname,'..');
const SECRET='pin-test-secret',ACCESS='0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f',SCHOOL='Sunrise Public School';
process.env.SCHOOL_SUCCESS_SIGNING_KEY=SECRET;
const cache=new Map();
function load(file,mocks={}){
 const filename=path.join(root,file),key=filename+JSON.stringify(Object.keys(mocks));
 const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const normal=mod.require.bind(mod);
 mod.require=name=>{if(mocks[name])return mocks[name];const target=name.startsWith('@/')?path.join(root,name.slice(2)):name.startsWith('.')?path.resolve(path.dirname(filename),name):null;
  if(target){for(const ext of ['.js','.jsx',''])if(fs.existsSync(target+ext)&&fs.statSync(target+ext).isFile()){const f=path.relative(root,target+ext);return mocks[f]||load(f,mocks);}}
  return normal(name);};
 mod._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true}},module:{type:'commonjs'}}).code,filename);
 return mod.exports;
}
// Minimal Supabase query builder over in-memory tables.
function fakeSupabase(tables){
 const calls=[];
 function from(table){
  const st={table,filters:[],op:'select',row:null};
  const rows=()=>(tables[table]||[]).filter(r=>st.filters.every(([k,v])=>r[k]===v));
  const run=()=>{calls.push({table,op:st.op});
   if(st.op==='upsert'){const list=tables[table]||(tables[table]=[]);if(list.some(r=>r.key===st.row.key))return {data:[],error:null};list.push({...st.row});return {data:[{key:st.row.key}],error:null};}
   if(st.op==='update'){const hit=rows();hit.forEach(r=>Object.assign(r,st.row));return {data:hit.map(r=>({key:r.key})),error:null};}
   return {data:rows().map(r=>({...r})),error:null};};
  const q={select(){return q;},eq(k,v){st.filters.push([k,v]);return q;},
   upsert(row){st.op='upsert';st.row=row;return q;},update(row){st.op='update';st.row=row;return q;},
   async maybeSingle(){const r=run();return {data:r.data[0]||null,error:null};},
   then(res,rej){return Promise.resolve(run()).then(res,rej);}};
  return q;
 }
 return {from,rpc:async(name,args)=>({data:(tables.roster||[]).filter(r=>r.school===args.p_school),error:null}),calls};
}
function harness(){
 const tables={success_config:[{key:'schoolLink:'+ACCESS,value:JSON.stringify({school:SCHOOL,scope:'school-success'}),revision:''}],success_members:[],
  roster:[{school:SCHOOL,name:'Asha Verma'},{school:SCHOOL,name:'Ravi Kumar'}]};
 const db=fakeSupabase(tables);
 const database={service:()=>db,checked:async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data;},localDatabase:()=>({prepare:()=>({all:async()=>({results:[]}),first:async()=>null,bind(){return this;}})})};
 const mocks={'lib/school-success/database.js':database,'lib/school-success/database':database};
 const server=load('lib/school-success/server.js',mocks);
 const pin=load('lib/school-success/teacher-pin.js',mocks);
 const r2=load('lib/school-success/r2-evidence.js');
 const withServer={...mocks,'lib/school-success/server.js':server,'lib/school-success/teacher-pin.js':pin};
 const pinRoute=load('app/api/school-success/teacher-pin/route.js',withServer);
 const post=async(body,headers={})=>{const res=await pinRoute.POST(new Request('http://app.test/api/school-success/teacher-pin',{method:'POST',headers:{'content-type':'application/json','X-School-Link':ACCESS,...headers},body:JSON.stringify(body)}));return {status:res.status,body:await res.json()};};
 // identify() through server.actor for a request carrying the school link, teacher and session headers.
 const whoAmI=(teacher,session)=>server.withRequest(new Request('http://app.test/x',{headers:{'X-School-Link':ACCESS,...(teacher?{'X-Teacher':encodeURIComponent(teacher)}:{}),...(session?{'X-Teacher-Session':session}:{})}}),()=>server.actor());
 return {tables,db,server,pin,r2,post,whoAmI,mocks:withServer};
}
async function firstSignIn(h,teacher='Asha Verma',newPin='482915'){
 const login=await h.post({action:'login',teacher,pin:'123456'});
 assert.equal(login.status,200);assert.equal(login.body.mustChange,true);assert.equal(login.body.session,undefined,'the default PIN never opens the portal');
 const created=await h.post({action:'create',teacher,changeTicket:login.body.changeTicket,newPin});
 assert.equal(created.status,200,JSON.stringify(created.body));return created.body.session;
}

test('PIN rules reject short, default and easy PINs; hashes verify only the right PIN',async()=>{
 const {pin}=harness();
 for(const bad of ['12345','1234567','abcdef','123456','000000','999999','234567','987654'])assert.ok(pin.pinProblem(bad),bad);
 assert.equal(pin.pinProblem('482915'),'');
 const stored=await pin.hashPin('482915');
 assert.ok(!JSON.stringify(stored).includes('482915'),'only a salted hash is stored');
 assert.equal(await pin.verifyPin('482915',stored),true);assert.equal(await pin.verifyPin('482916',stored),false);
});

test('first sign-in: default PIN → create own PIN → signed in; then only the own PIN works',async()=>{
 const h=harness();
 await assert.rejects(h.whoAmI('Asha Verma'),/401:Enter your PIN/,'a school link alone no longer opens a teacher');
 const session=await firstSignIn(h);
 const a=await h.whoAmI('Asha Verma',session);
 assert.equal(a.name,'Asha Verma');assert.equal(a.role,'school-teacher');assert.equal(a.school,SCHOOL);
 assert.match(a.email,/^school-link-[0-9a-f]{32}@school-portal\.invalid$/,'same submitter identity as before, so earlier lessons stay linked');
 assert.equal((await h.post({action:'login',teacher:'Asha Verma',pin:'123456'})).status,401,'the default PIN stops working once a PIN is created');
 const again=await h.post({action:'login',teacher:'Asha Verma',pin:'482915'});
 assert.equal(again.status,200);assert.ok(again.body.session);
 const stored=h.tables.success_config.find(r=>r.key.startsWith('teacherPin:'));
 assert.ok(stored&&!stored.value.includes('482915')&&!stored.key.includes('Asha'),'stored hashed, keyed by a digest');
});

test('a session opens only its own teacher and school link; the school view without a teacher still works',async()=>{
 const h=harness(),session=await firstSignIn(h);
 await assert.rejects(h.whoAmI('Ravi Kumar',session),/401/,'another teacher');
 await assert.rejects(h.whoAmI('Asha Verma','not-a-token'),/401/,'forged token');
 const forged=await h.r2.seal({kind:'teacher-session',link:'other',school:SCHOOL,teacher:'Asha Verma',version:1,exp:Date.now()+60000},SECRET);
 await assert.rejects(h.whoAmI('Asha Verma',forged),/401/,'session for another school link');
 const ticketAsSession=(await h.post({action:'login',teacher:'Ravi Kumar',pin:'123456'})).body.changeTicket;
 await assert.rejects(h.whoAmI('Ravi Kumar',ticketAsSession),/401/,'a PIN-change ticket is not a session');
 const school=await h.whoAmI('',null);assert.equal(school.name,'');assert.deepEqual(school.teachers,['Asha Verma','Ravi Kumar']);
 assert.equal((await h.post({action:'login',teacher:'Someone Else',pin:'123456'})).status,403);
});

test('five wrong PINs lock the teacher for 15 minutes; an administrator reset unlocks and returns to the starting PIN',async t=>{
 const h=harness();await firstSignIn(h);
 for(let i=1;i<=4;i++){const r=await h.post({action:'login',teacher:'Asha Verma',pin:'111112'});assert.equal(r.status,401);assert.match(r.body.error,new RegExp((5-i)+' tr'));}
 const locked=await h.post({action:'login',teacher:'Asha Verma',pin:'111112'});assert.equal(locked.status,429);
 assert.equal((await h.post({action:'login',teacher:'Asha Verma',pin:'482915'})).status,429,'even the right PIN waits while locked');
 const store=h.pin.configStore(h.db);
 assert.equal(await h.pin.checkPin({store,school:SCHOOL,teacher:'Asha Verma',pin:'482915',now:Date.now()+16*60000}).then(r=>r.mustChange),false,'unlocks after 15 minutes');
 await h.pin.resetPin({store,school:SCHOOL,teacher:'Asha Verma',by:'admin@example.test'});
 const r=await h.post({action:'login',teacher:'Asha Verma',pin:'123456'});assert.equal(r.status,200);assert.equal(r.body.mustChange,true);
});

test('changing or resetting a PIN signs out every earlier session',async()=>{
 const h=harness(),first=await firstSignIn(h);
 const changed=await h.post({action:'change',teacher:'Asha Verma',currentPin:'482915',newPin:'739204'},{'X-Teacher-Session':first});
 assert.equal(changed.status,200,JSON.stringify(changed.body));
 await assert.rejects(h.whoAmI('Asha Verma',first),/401/,'old session ended');
 assert.equal((await h.whoAmI('Asha Verma',changed.body.session)).name,'Asha Verma');
 assert.equal((await h.post({action:'change',teacher:'Asha Verma',currentPin:'000001',newPin:'551982'},{'X-Teacher-Session':changed.body.session})).status,401,'needs the current PIN');
 assert.equal((await h.post({action:'change',teacher:'Asha Verma',currentPin:'739204',newPin:'551982'})).status,401,'needs a session');
 await h.pin.resetPin({store:h.pin.configStore(h.db),school:SCHOOL,teacher:'Asha Verma',by:'admin@example.test'});
 await assert.rejects(h.whoAmI('Asha Verma',changed.body.session),/401/,'reset ends the session');
});

test('a PIN-change ticket is single-purpose and expires with any PIN change',async()=>{
 const h=harness();
 const login=await h.post({action:'login',teacher:'Ravi Kumar',pin:'123456'});
 assert.equal((await h.post({action:'create',teacher:'Asha Verma',changeTicket:login.body.changeTicket,newPin:'482915'})).status,401,'not for another teacher');
 assert.equal((await h.post({action:'create',teacher:'Ravi Kumar',changeTicket:login.body.changeTicket,newPin:'123456'})).status,400,'default PIN refused');
 assert.equal((await h.post({action:'create',teacher:'Ravi Kumar',changeTicket:login.body.changeTicket,newPin:'615283'})).status,200);
 assert.equal((await h.post({action:'create',teacher:'Ravi Kumar',changeTicket:login.body.changeTicket,newPin:'827364'})).status,409,'cannot be reused to overwrite the new PIN');
});

test('administrators list status, reset a PIN and set the school starting PIN, only for their schools',async()=>{
 const h=harness();await firstSignIn(h);
 const state={actor:{role:'admin',email:'admin@example.test',allowedSchools:[SCHOOL]}};
 const server={...h.mocks['lib/school-success/server.js'],actor:async()=>state.actor};
 const route=load('app/api/school-success/teacher-pins/route.js',{...h.mocks,'@/lib/school-success/server':server,'lib/school-success/server.js':server});
 const call=async body=>{const res=await route.POST(new Request('http://app.test/api/school-success/teacher-pins',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));return {status:res.status,body:await res.json()};};
 let list=await call({action:'list',school:SCHOOL});
 assert.deepEqual(list.body.teachers.map(r=>[r.teacher,r.status]),[['Asha Verma','active'],['Ravi Kumar','default']]);
 assert.ok(!JSON.stringify(list.body).match(/hash|salt/),'no PIN material leaves the server');
 assert.equal((await call({action:'reset',school:SCHOOL,teacher:'Asha Verma'})).status,200);
 list=await call({action:'list',school:SCHOOL});assert.equal(list.body.teachers[0].status,'default');assert.equal(list.body.teachers[0].resetBy,'admin@example.test');
 assert.equal((await call({action:'setDefault',school:SCHOOL,pin:'202611'})).status,200);
 assert.equal((await h.post({action:'login',teacher:'Ravi Kumar',pin:'123456'})).status,401,'old starting PIN no longer works');
 assert.equal((await h.post({action:'login',teacher:'Ravi Kumar',pin:'202611'})).body.mustChange,true);
 state.actor={role:'admin',email:'other@example.test',allowedSchools:['Another School']};
 assert.equal((await call({action:'list',school:SCHOOL})).status,403);
 state.actor={role:'school-teacher',name:'Asha Verma',school:SCHOOL};
 assert.equal((await call({action:'reset',school:SCHOOL,teacher:'Ravi Kumar'})).status,403,'teachers cannot reset PINs');
});
