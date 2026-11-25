// Short school links: schoolsuccess.in/<school-name>-<4-digit code>. Name slugs, one auto-generated code per
// school (different for every school), the page that opens them, and the browser helpers that read them.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc'),root=path.resolve(__dirname,'..');
function load(file,mocks={}){const filename=path.join(root,file),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const normal=mod.require.bind(mod);mod.require=name=>mocks[name]||normal(name.startsWith('@/')?path.join(root,name.slice(2)):name);
 mod._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code,filename);return mod.exports;}
const L=load('lib/school-success/short-link.js');
const A1='3f9a1c2e-7b4d-4e8a-9c61-2d5f0b8e4a17',A2='5b2e9d10-1c3a-4f7e-8d22-6a9b0c4e7f31';
// The same insert-only / compare-and-set behaviour as configStore on success_config.
function memoryStore(){const rows=new Map();let n=0;return {rows,
 async get(k){const r=rows.get(k);return r?{value:JSON.parse(r.value),revision:r.revision}:null;},
 async put(k,v,rev){const r=rows.get(k);if(rev===null){if(r)return false;}else if(!r||r.revision!==rev)return false;rows.set(k,{value:JSON.stringify(v),revision:String(++n)});return true;}};}
const codes=list=>{let i=0;return ()=>list[Math.min(i++,list.length-1)];};

test('school names become short, readable link names',()=>{
 assert.equal(L.shortSlug('Sunrise Public School'),'sunrise-public-school');
 assert.equal(L.shortSlug("St. Mary's Sr. Sec. School, Jaipur"),'st-marys-sr-sec-school-jaipur');
 assert.equal(L.shortSlug('  École   Saint-Joseph  '),'ecole-saint-joseph');
 assert.equal(L.shortSlug('Delhi Public School International Senior Secondary Wing'),'delhi-public-school-international');
 assert.ok(L.shortSlug('Delhi Public School International Senior Secondary Wing').length<=34);
 assert.equal(L.shortSlug('सरस्वती विद्या मंदिर'),'school','names with no Latin letters still get a link');
 assert.equal(L.shortSlug('Supercalifragilisticexpialidociousandmorewords Academy').length,34);
});

test('link IDs: name, then a 4-digit code; nothing else is accepted',()=>{
 for(const ok of ['sunrise-public-school-4821','school-1000','a-9999'])assert.ok(L.isShortId(ok),ok);
 for(const bad of ['sunrise','sunrise-482','sunrise-48210','sunrise-0821','Sunrise-4821','sunrise--4821','-sunrise-4821','sunrise_4821','school-success','teacher-portal','api','favicon.ico','a'.repeat(40)+'-4821',null,4821])assert.ok(!L.isShortId(bad),String(bad));
});

test('each school gets one short link, created once, with its own code',async()=>{
 const store=memoryStore();
 const id=await L.ensureShortLink(store,{access:A1,school:'Sunrise Public School'},{code:codes([4821])});
 assert.equal(id,'sunrise-public-school-4821');
 assert.equal(await L.ensureShortLink(store,{access:A1,school:'Sunrise Public School'},{code:codes([7777])}),id,'asking again returns the same link');
 assert.deepEqual(await L.resolveShortLink(store,id),{access:A1,school:'Sunrise Public School'});
 // A second school whose first random code is already taken gets the next free one: codes never repeat.
 const id2=await L.ensureShortLink(store,{access:A2,school:'Green Valley School'},{code:codes([4821,4821,3307])});
 assert.equal(id2,'green-valley-school-3307');
 assert.deepEqual(await L.resolveShortLink(store,id2),{access:A2,school:'Green Valley School'});
 assert.equal(store.rows.size,6);
});

test('two administrators creating the same school link at once end with one link',async()=>{
 const store=memoryStore();
 const [a,b]=await Promise.all([L.ensureShortLink(store,{access:A1,school:'Sunrise'},{code:codes([1111])}),L.ensureShortLink(store,{access:A1,school:'Sunrise'},{code:codes([1111,2222])})]);
 assert.equal(a,b);
 assert.equal((await store.get('shortLinkFor:'+A1)).value.id,a);
});

test('unknown, malformed or damaged short links open nothing',async()=>{
 const store=memoryStore();
 assert.equal(await L.resolveShortLink(store,'sunrise-4821'),null);
 assert.equal(await L.resolveShortLink(store,'../school-success'),null);
 await store.put('shortLink:broken-1234',{access:'not-a-token',school:'X'},null);
 assert.equal(await L.resolveShortLink(store,'broken-1234'),null);
});

test('when every code tried is taken, the administrator is asked to try again',async()=>{
 const store=memoryStore();await store.put('shortCode:1234',{id:'x-1234'},null);
 await assert.rejects(L.ensureShortLink(store,{access:A1,school:'Sunrise'},{code:()=>1234}),/503:Could not create a short link/);
});

test('the short-link page opens the teacher page with the school link; anything else is not found',async()=>{
 const store=memoryStore();await L.ensureShortLink(store,{access:A1,school:'Sunrise Public School'},{code:codes([4821])});
 const NOT_FOUND=Error('NEXT_NOT_FOUND');
 const Portal=()=>null;
 const page=load('app/[code]/page.jsx',{'next/navigation':{notFound(){throw NOT_FOUND;}},'../school-success/ui/portal':{__esModule:true,default:Portal},
  '@/lib/school-success/database':{service:()=>({})},'@/lib/school-success/teacher-pin':{configStore:()=>store},'../school-success/success.css':{}});
 assert.equal(page.dynamic,'force-dynamic');
 assert.deepEqual(page.metadata.robots,{index:false,follow:false});
 const el=await page.default({params:Promise.resolve({code:'sunrise-public-school-4821'})});
 const portal=el.props.children;
 assert.equal(portal.type,Portal);
 assert.deepEqual(portal.props.shortLink,{access:A1,school:'Sunrise Public School'});
 const upper=await page.default({params:Promise.resolve({code:'Sunrise-Public-School-4821'})});
 assert.deepEqual(upper.props.children.props.shortLink.access,A1,'capital letters typed by hand still work');
 for(const code of ['sunrise-public-school-4822','teacher','favicon.ico','sunrise%2F4821'])await assert.rejects(page.default({params:Promise.resolve({code})}),e=>e===NOT_FOUND,code);
});

test('on a short link the page reads the school link as if it were in the address',()=>{
 const P=load('lib/school-success/link-params.js');
 globalThis.location=new URL('https://schoolsuccess.in/sunrise-public-school-4821?resume=abc');
 try{
  assert.equal(P.linkParams().get('access'),null,'nothing before the page passes the link');
  P.setShortLink({access:A1,school:'Sunrise Public School'});
  const p=P.linkParams();
  assert.equal(p.get('access'),A1);assert.equal(p.get('school'),'Sunrise Public School');assert.equal(p.get('view'),'teacher');assert.equal(p.get('resume'),'abc');
  globalThis.location=new URL('https://schoolsuccess.in/school-success?school=Other&access='+A2+'&view=teacher');
  assert.equal(P.linkParams().get('access'),A2,'a full link in the address always wins');
 }finally{delete globalThis.location;}
});

test('saved "continue this lesson" links are kept on full and short school links only',()=>{
 const {savedLessonUrl}=load('lib/school-success/saved-lesson-url.js');
 const o='https://schoolsuccess.in';
 assert.ok(savedLessonUrl(o+'/school-success?access='+A1+'&resume=x',o));
 assert.ok(savedLessonUrl(o+'/sunrise-public-school-4821?resume=x&teacher=Asha',o));
 for(const bad of [o+'/sunrise-public-school-4821','https://evil.example/school-success?resume=x',o+'/teacher?resume=x','not a url'])assert.ok(!savedLessonUrl(bad,o),bad);
});

test('the school link action returns the short link next to the full link',async()=>{
 const store=memoryStore(),config=new Map();
 const db={prepare:sql=>({bind:(...args)=>({sql,args,async first(){return sql.startsWith('SELECT')?(config.has(args[0])?{value:config.get(args[0])}:null):null;}})}),
  async batch(qs){for(const q of qs)if(q.sql.startsWith('INSERT'))config.set(q.args[0],q.args[1]);}};
 const route=load('app/api/school-success/portal/route.js',{
  '@/lib/school-success/server':{withRequest:(r,fn)=>fn(),actor:async()=>({role:'admin',isSuperAdmin:true,email:'owner@example.test',allowedSchools:null}),database:()=>db,checkOrigin(){},
   assertSchool(){},assertConsultant(){},schoolTeachers:async()=>['Asha Verma'],streamJson:(d,i)=>Response.json(d,i),failure:e=>Response.json({error:e.message},{status:400})},
  '@/lib/school-success/directory':{loadArchives:async()=>[],isArchived:()=>false,archiveKey:()=>''},
  '@/lib/school-success/database':{service:()=>({})},'@/lib/school-success/teacher-pin':{configStore:()=>store},
  '@/lib/school-success/crm-archive':{ensureCrmArchive:async()=>({ids:[]}),applyCrmArchive:x=>x},
  '@/lib/school-success/live':{publicBase:()=>'https://media.example.test',gateway:async()=>{throw Error('not used');}},
  '@/lib/school-success/r2-evidence':{loadR2Config:async()=>({}),r2UploadsConfigured:()=>true,r2Request:async()=>{throw Error('not used');}}});
 const call=async()=>{const res=await route.POST(new Request('https://schoolsuccess.in/api/school-success/portal',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'schoolLink',school:'Sunrise Public School'})}));return {status:res.status,body:await res.json()};};
 const first=await call();
 assert.equal(first.status,200,JSON.stringify(first.body));
 assert.match(first.body.shortUrl,/^https:\/\/schoolsuccess\.in\/sunrise-public-school-[1-9]\d{3}$/);
 assert.match(first.body.url,/^https:\/\/schoolsuccess\.in\/school-success\?school=Sunrise\+Public\+School&access=[a-f0-9-]{36}&view=teacher$/);
 const second=await call();
 assert.deepEqual(second.body,first.body,'the same school always gets the same links');
 const access=new URL(first.body.url).searchParams.get('access');
 assert.deepEqual(await L.resolveShortLink(store,first.body.shortUrl.split('/').pop()),{access,school:'Sunrise Public School'});
});
