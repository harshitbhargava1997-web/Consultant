// Faster saving from phones: lesson-plan PDF pages as JPEG, large photos resized before upload, and a timing line
// per save request that carries no teacher, school, lesson or file details.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc'),root=path.resolve(__dirname,'..');
function load(file,mocks={}){const filename=path.join(root,file),mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 const normal=mod.require.bind(mod);mod.require=name=>mocks[name]||normal(name.startsWith('@/')?path.join(root,name.slice(2)):name);
 mod._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}).code,filename);return mod.exports;}
const P=load('lib/school-success/shrink-photo.js');
const MB=1024*1024;
function fakeCanvas(outSize){const calls={};return {calls,make:(w,h)=>({width:w,height:h,getContext:()=>({fillRect(){calls.filled=true;},drawImage(_b,_x,_y,dw,dh){calls.drawn=[dw,dh];},set fillStyle(v){calls.fill=v;}}),toBlob(cb,type,q){calls.type=type;calls.quality=q;cb(outSize==null?null:new Blob([new Uint8Array(outSize)],{type}));}})};}
const photo=(size,type='image/jpeg',name='IMG_2041.jpeg')=>new File([new Uint8Array(size)],name,{type,lastModified:1700000000000});

test('photos are resized so the longest side is at most 2048 px, keeping their shape',()=>{
 assert.deepEqual(P.targetSize(4000,3000),{width:2048,height:1536});
 assert.deepEqual(P.targetSize(3000,4000),{width:1536,height:2048});
 assert.deepEqual(P.targetSize(1200,900),{width:1200,height:900},'smaller photos are never enlarged');
 assert.equal(P.jpegName('class.PNG'),'class.jpg');assert.equal(P.jpegName('IMG_1.jpeg'),'IMG_1.jpg');assert.equal(P.jpegName('board.webp'),'board.jpg');
});

test('a large phone photo is sent as a smaller JPEG with the same file date',async()=>{
 const c=fakeCanvas(600*1024),decoded={width:4032,height:3024,close(){decoded.closed=true;}};
 const out=await P.shrinkPhoto(photo(5*MB),{decode:async()=>decoded,makeCanvas:c.make});
 assert.equal(out.type,'image/jpeg');assert.equal(out.name,'IMG_2041.jpg');assert.equal(out.size,600*1024);assert.equal(out.lastModified,1700000000000);
 assert.deepEqual(c.calls.drawn,[2048,1536]);assert.equal(c.calls.quality,0.85);assert.equal(c.calls.fill,'#ffffff');assert.ok(decoded.closed);
});

test('videos, PDFs, audio, small photos and failed resizes are sent unchanged',async()=>{
 const never=async()=>{throw Error('should not decode');};
 for(const f of [photo(20*MB,'video/mp4','class.mp4'),photo(3*MB,'application/pdf','plan.pdf'),photo(2*MB,'audio/mpeg','note.mp3'),photo(900*1024)])
  assert.equal(await P.shrinkPhoto(f,{decode:never}),f,f.name);
 const big=photo(4*MB);
 assert.equal(await P.shrinkPhoto(big,{decode:never}),big,'a photo the browser cannot read');
 assert.equal(await P.shrinkPhoto(big,{decode:async()=>({width:4000,height:3000}),makeCanvas:fakeCanvas(null).make}),big,'no JPEG produced');
 assert.equal(await P.shrinkPhoto(big,{decode:async()=>({width:4000,height:3000}),makeCanvas:fakeCanvas(5*MB).make}),big,'resizing would not make it smaller');
});

test('lesson-plan PDF pages are embedded as JPEG, not PNG',()=>{
 const src=fs.readFileSync(path.join(root,'lib/school-success/preparation-pdf.js'),'utf8');
 assert.match(src,/toDataURL\('image\/jpeg', 0\.92\), 'JPEG'/);assert.doesNotMatch(src,/image\/png/);
});

test('the evidence form uploads the resized copy and keeps it for a retry',()=>{
 const src=fs.readFileSync(path.join(root,'app/school-success/ui/lesson-evidence.jsx'),'utf8');
 assert.match(src,/items\.forEach\(uploadable\)/,'resizing starts when photos are chosen');
 assert.match(src,/const all = await Promise\.all\(chosen\.map\(async f => \(\{ \.\.\.f, file: await uploadable\(f\) \}\)\)\)/,'sizes sent to the server are those of the uploaded copy');
 assert.match(src,/shrunk\.current\.clear\(\)/);
});

test('each save request logs one timing line with no teacher, school, lesson or file details',async()=>{
 const logs=[],orig=console.info;console.info=m=>logs.push(m);
 try{
  const route=load('app/api/school-success/evidence/route.js',{
   '@/lib/school-success/server':{withRequest:(r,fn)=>fn(),checkOrigin(){},actor:async()=>({role:'school-teacher',school:'Sunrise Public School',name:'Asha Verma',email:'school-link-abc@school-portal.invalid'}),assertConsultant(){},database:()=>({}),
    failure:e=>Response.json({error:e.message},{status:400})},
   '@/lib/school-success/r2-evidence':{loadR2Config:async()=>({SUPABASE_GATEWAY_TOKEN:'x'}),seal:async()=>'',unseal:async()=>({}),r2UploadsConfigured:()=>true,r2Request:async()=>{}},
   '@/lib/school-success/live':{gateway:async()=>({rows:[]}),publicBase:()=>''}});
  const res=await route.POST(new Request('https://schoolsuccess.in/api/school-success/evidence',{method:'POST',body:JSON.stringify({action:'findLessons',date:'2026-11-25'})}));
  assert.equal(res.status,200);
 }finally{console.info=orig;}
 assert.equal(logs.length,1);
 const line=logs[0];assert.match(line,/^school-success timing \{/);
 const data=JSON.parse(line.replace('school-success timing ',''));
 assert.deepEqual(Object.keys(data).sort(),['action','authMs','route','status','totalMs']);
 assert.equal(data.action,'findLessons');assert.equal(data.status,200);
 for(const secret of ['Sunrise','Asha','school-link','2026-11-25'])assert.ok(!line.includes(secret),secret);
});

test('a refused sign-in is reported before anything else, even if storage settings fail too',async()=>{
 const orig=console.info;console.info=()=>{};
 try{
  const route=load('app/api/school-success/evidence/route.js',{
   '@/lib/school-success/server':{withRequest:(r,fn)=>fn(),checkOrigin(){},actor:async()=>{throw Error('401:Enter your PIN to continue.');},assertConsultant(){},database:()=>({}),
    failure:e=>Response.json({error:e.message},{status:Number(e.message.slice(0,3))||400})},
   '@/lib/school-success/r2-evidence':{loadR2Config:async()=>{throw Error('503:storage down');},seal:async()=>'',unseal:async()=>({}),r2UploadsConfigured:()=>true,r2Request:async()=>{}},
   '@/lib/school-success/live':{gateway:async()=>({rows:[]}),publicBase:()=>''}});
  const res=await route.POST(new Request('https://schoolsuccess.in/api/school-success/evidence',{method:'POST',body:'{}'}));
  assert.equal(res.status,401);assert.match((await res.json()).error,/PIN/);
 }finally{console.info=orig;}
});
