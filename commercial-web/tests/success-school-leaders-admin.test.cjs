// Super Admin manages school leaders from School Success. The route, grant schema and phone normalisation are real;
// the sign-in service and settings store are in memory. No real accounts are created.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc'),root=path.resolve(__dirname,'..');
const S='Sunrise Public School';
function load(file,mocks){
 const filename=path.join(root,file),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const normal=mod.require.bind(mod);mod.require=n=>mocks[n]||normal(n.startsWith('@/')?path.join(root,n.slice(2)):n);
 mod._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}).code,filename);return mod.exports;
}
function harness(){
 const users=new Map(),config=new Map(),admins=new Set(),audit=[],state={actor:{role:'admin',isSuperAdmin:true,email:'super@example.test',userId:'00000000-0000-4000-8000-000000000001'}};
 let n=0;const uid=()=>'aaaaaaaa-bbbb-4ccc-8ddd-'+String(++n).padStart(12,'0');
 const auth={admin:{
  listUsers:async()=>({data:{users:[...users.values()]},error:null}),
  getUserById:async id=>({data:{user:users.get(id)||null},error:null}),
  createUser:async u=>{if(u.password.length<6)return {data:null,error:{message:'Password should be at least 6 characters'}};const user={id:uid(),phone:u.phone.replace('+',''),phone_confirmed_at:'x',user_metadata:u.user_metadata,app_metadata:u.app_metadata};users.set(user.id,user);return {data:{user},error:null};},
  updateUserById:async(id,patch)=>{const u=users.get(id);Object.assign(u,{app_metadata:patch.app_metadata||u.app_metadata,password:patch.password});return {data:{user:u},error:null};},
  deleteUser:async id=>{users.delete(id);return {error:null};}}};
 const from=table=>{const f=[];const q={select(){return q;},eq(k,v){f.push([k,v]);return q;},like(){return q;},
  async maybeSingle(){if(table==='literacy_platform_admins')return {data:admins.has(f[0][1])?{user_id:f[0][1]}:null,error:null};return {data:null,error:null};},
  then(res,rej){return Promise.resolve({data:table==='success_config'?[...config.entries()].map(([key,value])=>({key,value})):[],error:null}).then(res,rej);}};return q;};
 const db={batch:async stmts=>{for(const s of stmts)s.run();},prepare:sql=>({bind:(...args)=>({run:()=>{if(sql.includes('portal_config'))config.set(args[0],args[1]);else audit.push(args[2]);}})})};
 const server={withRequest:(req,fn)=>fn(),actor:async()=>state.actor,database:()=>db,checkOrigin(){},failure:e=>{const m=String(e.message||e),status=Number(m.match(/^(401|403|409|429|503):/)?.[1]||400);return Response.json({error:m.replace(/^\d+:/,'')},{status});}};
 const route=load('app/api/school-success/school-leaders/route.js',{'@/lib/school-success/server':server,'@/lib/school-success/database':{service:()=>({auth,from}),checked:async q=>(await q).data},'@/lib/school-success/module-schools':{moduleSchools:async()=>[S,'Green Valley School']}});
 const call=async body=>{const res=await route.POST(new Request('http://app.test/x',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));return {status:res.status,body:await res.json()};};
 const grant=id=>JSON.parse(config.get('moduleAccess:'+id)||'null');
 return {users,config,admins,audit,state,call,grant};
}
const add=(h,extra={})=>h.call({action:'add',school:S,name:'Meera Rao',title:'Principal',mobile:'98765 43210',password:'123456',...extra});

test('Super Admin adds a principal: mobile sign-in with starting password 123456 and School leader access to that school',async()=>{
 const h=harness(),r=await add(h);
 assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.created,true);
 const [u]=[...h.users.values()];
 assert.equal(u.phone,'919876543210');assert.equal(u.user_metadata.full_name,'Meera Rao');
 assert.deepEqual([u.app_metadata.must_change_password,u.app_metadata.school_success_leader],[true,true],'must change the starting password at first sign-in');
 assert.deepEqual(h.grant(u.id),{...h.grant(u.id),userId:u.id,enabled:true,schools:[S],role:'leader',title:'Principal'});
 const list=await h.call({action:'list',school:S});
 assert.deepEqual(list.body.leaders.map(l=>[l.name,l.title,l.mobile,l.status,l.managed]),[['Meera Rao','Principal','+919876543210','Waiting for first sign-in',true]]);
 assert.deepEqual(h.audit,['grant-school-leader']);
});

test('an existing account with that mobile number is linked, not duplicated; consultants and Super Admins are refused',async()=>{
 const h=harness();await add(h);
 const again=await add(h,{school:'Green Valley School',title:'Coordinator'});
 assert.equal(again.body.created,false);assert.equal(h.users.size,1);
 const [u]=[...h.users.values()];assert.deepEqual(h.grant(u.id).schools,[S,'Green Valley School']);
 h.config.set('moduleAccess:'+u.id,JSON.stringify({userId:u.id,enabled:true,schools:[S],role:'consultant'}));
 assert.equal((await add(h)).status,409,'already a consultant');
 h.config.delete('moduleAccess:'+u.id);h.admins.add(u.id);
 assert.equal((await add(h)).status,409,'Super Admin account');
});

test('reset returns to the starting password with a forced change; only for sign-ins created here; remove drops this school only',async()=>{
 const h=harness();await add(h);const [u]=[...h.users.values()];
 u.app_metadata.must_change_password=false;
 assert.equal((await h.call({action:'reset',school:S,userId:u.id,password:'123456'})).status,200);
 assert.equal(u.password,'123456');assert.equal(u.app_metadata.must_change_password,true);
 u.app_metadata.school_success_leader=false;
 assert.equal((await h.call({action:'reset',school:S,userId:u.id,password:'123456'})).status,403,'accounts made elsewhere are reset where they were made');
 await add(h,{school:'Green Valley School'});
 assert.equal((await h.call({action:'remove',school:S,userId:u.id})).status,200);
 assert.deepEqual(h.grant(u.id).schools,['Green Valley School']);assert.equal(h.users.has(u.id),true,'the sign-in itself is kept');
 assert.equal((await h.call({action:'remove',school:'Green Valley School',userId:u.id})).status,200);
 assert.equal(h.grant(u.id).enabled,false);
});

test('only Super Admin can manage school leaders; inputs are validated',async()=>{
 const h=harness();
 for(const actor of [{role:'admin',isSuperAdmin:false},{role:'admin',leader:true,isSuperAdmin:false},{role:'school-teacher'}]){h.state.actor=actor;assert.equal((await add(h)).status,403);}
 h.state.actor={role:'admin',isSuperAdmin:true,email:'s@x',userId:'x'};
 assert.equal((await add(h,{mobile:'12345'})).status,400);
 assert.equal((await add(h,{school:'Unknown School'})).status,400);
 assert.equal((await add(h,{password:'123'})).status,400);
 assert.equal(h.users.size,0);
});
