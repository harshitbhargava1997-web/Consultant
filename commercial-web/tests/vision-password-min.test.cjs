// First-sign-in password: School Success school leaders may use 6 characters; every other Vision account needs 12.
// The route is real; Supabase is an in-memory fake. No real accounts are touched.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc'),root=path.resolve(__dirname,'..');
function load(file,mocks){const filename=path.join(root,file),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const normal=mod.require.bind(mod);mod.require=name=>mocks[name]||normal(name.startsWith('@/')?path.join(root,name.slice(2)):name);
 mod._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}).code,filename);return mod.exports;}
function harness(user){
 const updates=[];
 const client={auth:{getUser:async()=>({data:{user},error:null}),admin:{updateUserById:async(id,patch)=>{updates.push(patch);return {error:null};}},signInWithPassword:async()=>({data:{user},error:null}),signOut:async()=>({})}};
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='x';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='y';
 const route=load('app/api/password-changed/route.js',{'@supabase/supabase-js':{createClient:()=>client}});
 const call=async password=>{const res=await route.POST(new Request('http://app.test/api/password-changed',{method:'POST',headers:{authorization:'Bearer t','content-type':'application/json'},body:JSON.stringify({password})}));return {status:res.status,body:await res.json()};};
 return {call,updates};
}
test('every account (school leaders, teachers, consultants) sets a first password of at least 6 characters; shorter is refused',async()=>{
 for(const user of [{id:'u1',email:'9800000001@mobile.schoolsuccess.in',app_metadata:{must_change_password:true,school_success_leader:true}},{id:'u2',email:'teacher@example.test',app_metadata:{must_change_password:true}}]){
  const h=harness(user);
  const short=await h.call('12345');assert.equal(short.status,400);assert.match(short.body.error,/6 to 128/);assert.equal(h.updates.length,0);
  const ok=await h.call('482915');assert.equal(ok.status,200,'6 digits are accepted');
  assert.deepEqual(h.updates,[{password:'482915',app_metadata:{...user.app_metadata,must_change_password:false}}]);
  assert.equal((await h.call('x'.repeat(129))).status,400,'at most 128');
 }
});
test('the shared rule: 6 to 128 characters, digits allowed, no letter or symbol requirement',async()=>{
 const {validPassword}=await import('../lib/password-policy.js');
 assert.equal(validPassword('123456'),true);assert.equal(validPassword('abcdef'),true);assert.equal(validPassword('12345'),false);
 assert.equal(validPassword('x'.repeat(128)),true);assert.equal(validPassword('x'.repeat(129)),false);assert.equal(validPassword(123456),false);
});
test('backup path: after the browser sets the new password, signing in with it clears "must change"; a wrong one does not',async()=>{
 const user={id:'u3',email:'9800000003@mobile.schoolsuccess.in',app_metadata:{must_change_password:true,school_success_leader:true}};
 const updates=[],signIns=[];let accept=true;
 const client={auth:{getUser:async()=>({data:{user:null},error:{status:401,code:'bad_jwt'}}),admin:{updateUserById:async(id,patch)=>{updates.push([id,patch]);return {error:null};}},
  signInWithPassword:async c=>{signIns.push(c);return accept?{data:{user},error:null}:{data:{user:null},error:{status:400,code:'invalid_credentials'}};},signOut:async()=>({})}};
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://fixture.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='x';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='y';
 const route=load('app/api/password-changed/route.js',{'@supabase/supabase-js':{createClient:()=>client}});
 const call=async(body,auth='Bearer t')=>{const res=await route.POST(new Request('http://app.test/api/password-changed',{method:'POST',headers:{...(auth?{authorization:auth}:{}),'content-type':'application/json'},body:JSON.stringify(body)}));return {status:res.status,body:await res.json()};};
 const bad=await call({password:'482915'});assert.equal(bad.status,401);assert.match(bad.body.error,/could not be verified/);assert.equal(updates.length,0);
 const none=await call({password:'482915'},'');assert.equal(none.status,401);assert.match(none.body.error,/expired/);
 const ok=await call({password:'482915',confirm:'new-password',login:user.email},'');
 assert.equal(ok.status,200);assert.deepEqual(signIns.at(-1),{email:user.email,password:'482915'});
 assert.deepEqual(updates,[['u3',{app_metadata:{must_change_password:false,school_success_leader:true}}]],'only the flag is cleared; the password itself was set by the person');
 accept=false;const wrong=await call({password:'000000',confirm:'new-password',login:user.email},'');assert.equal(wrong.status,401);assert.equal(updates.length,1);
 assert.equal((await call({password:'12',confirm:'new-password',login:user.email},'')).status,400);
});
