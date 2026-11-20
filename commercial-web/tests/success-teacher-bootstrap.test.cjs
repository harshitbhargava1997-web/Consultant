const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc'),root=path.resolve(__dirname,'..');
test('teacher landing skips historical records and reflections after authentication, while admin requests retain the full read', async () => {
 const state={actor:{role:'school-teacher',school:'Alpha',name:'Asha',teachers:['Asha','Ben'],allowedSchools:['Alpha']},reads:0};
 const mocks={
  '@/lib/school-success/server':{withRequest:(req,run)=>run(),actor:async()=>{if(!state.actor)throw Error('401:Sign in');return state.actor;},database:()=>({prepare:()=>({first:async()=>null,all:async()=>({results:[]})})}),
   streamJson:(data,init)=>Response.json(data,init),failure:error=>Response.json({error:error.message},{status:error.message.startsWith('401:')?401:400})},
  '@/lib/school-success/live':{publicBase:()=> 'https://media.example.test',gateway:async()=>{state.reads++;throw Error('full-read');}},
  '@/lib/school-success/r2-evidence':{loadR2Config:async()=>({}),r2UploadsConfigured:()=>true},
  '@/lib/school-success/directory':{loadArchives:async()=>[],isArchived:()=>false},
  '@/lib/school-success/crm-archive':{ensureCrmArchive:async()=>({ids:[]}),applyCrmArchive:x=>x}
 };
 const file=path.join(root,'app/api/school-success/portal/route.js'),mod=new Module(file,module);
 mod.filename=file;mod.paths=Module._nodeModulePaths(path.dirname(file));const normal=mod.require.bind(mod);
 mod.require=n=>mocks[n]||normal(n.startsWith('@/')?path.join(root,n.slice(2)):n);
 mod._compile(transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}).code,file);
 const request=()=>mod.exports.GET(new Request('http://app.test/api/school-success/portal?view=teacher&from=2026-11-01&to=2026-11-20'));
 const response=await request(),data=await response.json();
 assert.equal(response.status,200);assert.equal(state.reads,0);
 assert.equal(data.actor.name,'Asha');assert.equal(data.actor.allowedSchools,undefined);
 assert.deepEqual(data.roster,[{name:'Asha',school:'Alpha'},{name:'Ben',school:'Alpha'}]);
 assert.equal(data.uploadsEnabled,true);assert.deepEqual(data.entries,[]);
 state.actor=null;assert.equal((await request()).status,401);
 state.actor={role:'admin'};assert.equal((await request()).status,400);assert.equal(state.reads,1);
});
