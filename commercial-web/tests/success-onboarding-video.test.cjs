// Teacher "How to use" video: link parsing, progress records, and who may record / set / read them.
// The route, the PIN store and the video helpers are real; success_config is an in-memory table.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc'),root=path.resolve(__dirname,'..');
function load(file,mocks){const filename=path.join(root,file),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const normal=mod.require.bind(mod);mod.require=name=>mocks[name]||normal(name.startsWith('@/')?path.join(root,name.slice(2)):name);
 mod._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}).code,filename);return mod.exports;}
const V=load('lib/school-success/onboarding-video.js',{});
const S='Sunrise Public School';
function fakeDb(){const rows=new Map();
 const q=(state)=>{const api={select(){return api;},eq(k,v){state.f.push([k,v]);return api;},in(k,vs){state.in=[k,vs];return api;},
  async maybeSingle(){const r=[...rows.values()].find(r=>state.f.every(([k,v])=>r[k]===v));return {data:r?{...r}:null,error:null};},
  then(res,rej){let data;
   if(state.op==='upsert'){if(rows.has(state.row.key))data=[];else{rows.set(state.row.key,{...state.row});data=[{key:state.row.key}];}}
   else if(state.op==='update'){const r=[...rows.values()].find(r=>state.f.every(([k,v])=>r[k]===v));if(r){Object.assign(r,state.row);data=[{key:r.key}];}else data=[];}
   else data=[...rows.values()].filter(r=>!state.in||state.in[1].includes(r[state.in[0]])).map(r=>({...r}));
   return Promise.resolve({data,error:null}).then(res,rej);}};return api;};
 return {rows,from(){return {select(){return q({f:[],op:'select'}).select();},upsert(row){return q({f:[],op:'upsert',row});},update(row){return q({f:[],op:'update',row});}};}};}
function harness(actor){const db=fakeDb(),state={actor};
 const server={withRequest:(r,fn)=>fn(),checkOrigin(){},actor:async()=>state.actor,assertSchool:(a,s)=>{if(!s||a.allowedSchools&&!a.allowedSchools.includes(s))throw Error('403:Unassigned school');},
  schoolTeachers:async()=>['Asha Verma','Ravi Kumar'],failure:e=>{const m=String(e.message||e),status=Number(m.match(/^(401|403|409|503):/)?.[1]||400);return Response.json({error:m.replace(/^\d+:/,'')},{status});}};
 const database={service:()=>db,checked:async q=>{const {data,error}=await q;if(error)throw Error(error.message);return data;}};
 const route=load('app/api/school-success/onboarding-video/route.js',{'@/lib/school-success/server':server,'@/lib/school-success/database':database});
 const call=async body=>{const res=await route.POST(new Request('http://app.test/x',{method:'POST',body:JSON.stringify(body)}));return {status:res.status,body:await res.json()};};
 return {db,state,call};}
const admin={role:'admin',isSuperAdmin:true,email:'owner@example.test'},teacher={role:'school-teacher',school:S,name:'Asha Verma',email:'link'};

test('YouTube links of every usual shape give the video ID; anything else is refused',()=>{
 for(const u of ['https://youtu.be/dQw4w9WgXcQ','https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3s','https://m.youtube.com/watch?v=dQw4w9WgXcQ','https://www.youtube.com/shorts/dQw4w9WgXcQ','https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ','dQw4w9WgXcQ'])assert.equal(V.parseYouTubeId(u),'dQw4w9WgXcQ',u);
 for(const u of ['https://example.com/watch?v=dQw4w9WgXcQ','not a link','https://youtu.be/short'])assert.equal(V.parseYouTubeId(u),'',u);
});
test('progress: percentage only rises, watch time adds capped played seconds, finishing is recorded once',()=>{
 let p=V.mergeProgress(null,{school:S,teacher:'A',videoId:'v1',event:'open'},'2026-11-25T10:00:00Z');
 assert.deepEqual([p.maxPercent,p.watchSeconds,p.completedAt,p.firstOpenedAt],[0,0,null,'2026-11-25T10:00:00Z']);
 p=V.mergeProgress(p,{school:S,teacher:'A',videoId:'v1',event:'progress',percent:40,played:900},'2026-11-25T10:01:00Z');
 assert.deepEqual([p.maxPercent,p.watchSeconds],[40,120],'one update adds at most 120 seconds');
 p=V.mergeProgress(p,{school:S,teacher:'A',videoId:'v1',event:'progress',percent:10,played:15},'2026-11-25T10:02:00Z');assert.equal(p.maxPercent,40);
 p=V.mergeProgress(p,{school:S,teacher:'A',videoId:'v1',event:'ended',played:30},'2026-11-25T10:05:00Z');
 assert.deepEqual([p.maxPercent,p.completedAt],[100,'2026-11-25T10:05:00Z']);
 assert.equal(V.mergeProgress(p,{school:S,teacher:'A',videoId:'v1',event:'progress',percent:50},'2026-11-26T09:00:00Z').completedAt,'2026-11-25T10:05:00Z');
 const fresh=V.mergeProgress(p,{school:S,teacher:'A',videoId:'v2',event:'open'},'2026-11-27T09:00:00Z');assert.equal(fresh.completedAt,null,'a new video starts over');
});
test('Super Admin sets the link; a teacher records only their own viewing; the report shows it per teacher',async()=>{
 const h=harness(admin);
 assert.equal((await h.call({action:'setVideo',url:'https://example.com/x'})).status,400);
 assert.equal((await h.call({action:'setVideo',url:'https://youtu.be/dQw4w9WgXcQ'})).body.videoId,'dQw4w9WgXcQ');
 h.state.actor=teacher;
 assert.deepEqual((await h.call({action:'get'})).body,{videoId:'dQw4w9WgXcQ',watched:false});
 await h.call({action:'progress',event:'open'});await h.call({action:'progress',event:'progress',percent:60,played:30});
 assert.equal((await h.call({action:'progress',event:'ended',played:20})).body.watched,true);
 assert.equal((await h.call({action:'get'})).body.watched,true);
 assert.equal((await h.call({action:'setVideo',url:'https://youtu.be/aaaaaaaaaaa'})).status,403,'teachers cannot change the video');
 assert.equal((await h.call({action:'report',school:S})).status,403,'teachers cannot read the report');
 h.state.actor=admin;const r=(await h.call({action:'report',school:S})).body;
 assert.deepEqual(r.teachers.map(t=>[t.teacher,t.status,t.maxPercent,t.watchSeconds]),[['Asha Verma','Watched',100,50],['Ravi Kumar','Not opened',0,0]]);
 assert.equal((await h.call({action:'progress',event:'open'})).status,403,'staff cannot record a teacher’s viewing');
 h.state.actor={role:'admin',leader:true,isSuperAdmin:false,allowedSchools:[S]};
 assert.equal((await h.call({action:'report',school:S})).status,403,'school leaders and consultants cannot read it');
 h.state.actor=admin;await h.call({action:'setVideo',url:'https://youtu.be/bbbbbbbbbbb'});
 assert.equal((await h.call({action:'report',school:S})).body.teachers[0].status,'Not opened','a new video needs watching again');
 h.state.actor=teacher;assert.equal((await h.call({action:'get'})).body.watched,false);
});
test('with no video set, teachers go straight to the portal and nothing is recorded',async()=>{
 const h=harness(teacher);
 assert.deepEqual((await h.call({action:'get'})).body,{videoId:''});
 assert.deepEqual((await h.call({action:'progress',event:'open'})).body,{ok:true,watched:false});
 assert.equal(h.db.rows.size,0);
});
