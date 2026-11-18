// Real-storage check of consolidated lesson-report links, end to end through the REAL routes (store,
// create, open, serve, file, manage) against the real bucket. Only the signed-in user is substituted.
// Synthetic school/teacher/evidence only; no teacher records are touched. Prints statuses, sizes and
// booleans only — never signed URLs, secrets, credentials or keys of real data.
//   node scripts/r2-report-access-selfcheck.cjs --write-synthetic
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {transformSync}=require('next/dist/build/swc');
const root=path.resolve(__dirname,'..'),out=(step,data)=>console.log('ACCESSCHECK '+JSON.stringify({step,...data}));
const results=[],check=(step,pass,data={})=>{results.push(pass);out(step,{pass,...data});};
if(!process.argv.includes('--write-synthetic')){console.log('Refusing to run without --write-synthetic');process.exit(2);}
const PHOTO=Buffer.from('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','base64'),WRITING=Buffer.from('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','base64');
function wav(seconds=2,rate=16000){const n=seconds*rate,b=Buffer.alloc(44+n*2);b.write('RIFF',0);b.writeUInt32LE(36+n*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(8000*Math.sin(2*Math.PI*440*i/rate)),44+i*2);return b;}
const AUDIO=wav();
const jpegSize=b=>{for(let i=2;i<b.length-9;){if(b[i]!==0xff)return null;const m=b[i+1],len=b.readUInt16BE(i+2);if(m>=0xc0&&m<=0xc3)return {width:b.readUInt16BE(i+7),height:b.readUInt16BE(i+5)};i+=2+len;}return null;};
const wavInfo=b=>b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WAVE'?{channels:b.readUInt16LE(22),rate:b.readUInt32LE(24),seconds:Number((b.readUInt32LE(40)/b.readUInt32LE(28)).toFixed(2))}:null;
const state={actor:null};
(async()=>{
 const real=s=>require(path.join(root,s));
 // Same helpers as lib/school-success/server.js (copied verbatim); only actor() is substituted.
 const {localDatabase:db}=real('lib/school-success/database.js');
 const server={database:()=>db(),
  assertSchool(a,school){if(!school||a.allowedSchools&&!a.allowedSchools.includes(school))throw Error('403:School is outside your assignment');},
  checkOrigin(req){const o=req.headers.get('Origin');if(o&&o!==new URL(req.url).origin)throw Error('403:Cross-origin request rejected');},
  failure(e){const message=String(e.message||e),status=Number(message.match(/^(401|403|409|413|503):/)?.[1]||400);return Response.json({error:message.replace(/^\d+:/,'')},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}};
 const mocks={'@/lib/school-success/server':{...server,withRequest:(r,f)=>f(),actor:async()=>{if(!state.actor)throw Error('401:Sign in to Vision to open the School Success folder');return state.actor;}}};
 const load=file=>{const fn=path.join(root,file),o=transformSync(fs.readFileSync(fn,'utf8'),{filename:fn,jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}),m=new Module(fn,module);m.filename=fn;m.paths=Module._nodeModulePaths(path.dirname(fn));const n=m.require.bind(m);m.require=x=>mocks[x]||n(x.startsWith('@/')?path.join(root,x.slice(2)):x);m._compile(o.code,fn);return m.exports;};
 const R={store:load('app/api/school-success/report-snapshots/route.js'),create:load('app/api/school-success/report-shares/route.js'),share:load('app/api/school-success/report-shares/[id]/route.js'),file:load('app/api/school-success/report-shares/[id]/file/[n]/route.js'),manage:load('app/api/school-success/report-shares/[id]/manage/route.js')};
 const {env}=real('lib/school-success/environment.js'),{localDatabase}=real('lib/school-success/database.js'),{loadR2Config,r2Request}=real('lib/school-success/r2-evidence.js'),{presignDownload}=real('lib/school-success/r2-upload.js');
 const shares=real('lib/school-success/report-shares.js'),{reportAccessSession,unavailableEvidence}=real('lib/school-success/lesson-snapshots.js');
 const {mapLive}=real('lib/school-success/live-mapping.js'),{buildLessonRecords}=real('lib/school-success/lesson-records.js'),{createLessonDocumentationPdf}=real('lib/school-success/lesson-report-pdf.js');
 const {attachReflectionText,reflectionDocument,reflectionFileId}=real('lib/school-success/reflection-text.js');
 const config=await loadR2Config(env,localDatabase()),media=config.R2_PUBLIC_BASE_URL;
 out('environment',{supabase:Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),storage:Boolean(config.R2_ACCESS_KEY_ID),mediaBase:Boolean(media)});
 const SCHOOL='ZZ Synthetic Report Check',TEACHER='Synthetic Teacher',run=Date.now().toString(36),day='2026-11-18';
 const sub=crypto.randomUUID(),per=crypto.randomUUID(),upd=crypto.randomUUID();
 const key=(c,f)=>`schools/${encodeURIComponent(SCHOOL)}/teachers/${encodeURIComponent(TEACHER)}/${day}/submission_${sub}/implementation_${per}/${c}/${f}`;
 const files={photo:{key:key('activity',run+'-class-photo.jpg'),bytes:PHOTO,type:'image/jpeg'},writing:{key:key('writing',run+'-writing-sample.jpg'),bytes:WRITING,type:'image/jpeg'},audio:{key:key('voice',run+'-class-recording.wav'),bytes:AUDIO,type:'audio/wav'}};
 for(const [name,f] of Object.entries(files)){const put=await r2Request(config,f.key,'PUT',f.bytes,{'Content-Type':f.type,'If-None-Match':'*'});out('synthetic-evidence-put',{file:name,status:put.status,bytes:f.bytes.length});}
 const url=k=>media.replace(/\/$/,'')+'/'+k.split('/').map(encodeURIComponent).join('/');
 const rid=await reflectionFileId(upd,per),reflUrl=url(key('closure',rid+'.json'));
 const record={id:900001,Center:SCHOOL,Institution:SCHOOL,FullName:TEACHER,Role:'teacher',Type:'Classroom Reflection',Grade:'Grade 2',Section:'A',Subject:'English',Book:'Synthetic storage check lesson',Duration_Min:0,submission_id:sub,lesson_period_id:per,planned_lesson_on:day,preparation_saved_at:day+'T03:30:00',submitted_at:day+'T03:30:00',implementation_date:day,StartTime:day+'T00:00:00',lesson_stage:'evidence_submitted',lesson_reflection:'Why — learning objective\nSynthetic objective.',materials_notes:'',lesson_version:2,
  Voice_Note_Link:url(files.audio.key),Lesson_Plan_Picture:'',Video_Evidence_1:url(files.photo.key),Video_Evidence_2:reflUrl,Video_Evidence_3:'',Writing_Sample_Link:url(files.writing.key),
  lesson_evidence_history:[{id:upd,at:day+'T06:00:00',conductedOn:day,files:{Video_Evidence_1:[url(files.photo.key),reflUrl].join(','),Writing_Sample_Link:url(files.writing.key)}}]};
 const mapped=await mapLive({records:[record],reviews:[{record_id:'900001',feedback:'Synthetic reviewer feedback for the storage check.',updated_at:day+'T09:00:00'}],roster:[]},media);
 const doc=JSON.stringify(reflectionDocument({submissionId:sub,periodId:per,updateId:upd,conductedOn:day,savedAt:day+'T06:00:00.000Z',answers:{achievement:'Synthetic written reflection.',nextStep:'Synthetic next step.'}}));
 await attachReflectionText(mapped.entries,async x=>{if(x!==reflUrl)throw Error('missing');return doc;});
 const lessons=buildLessonRecords(mapped.entries,day,day);
 check('lesson-has-all-evidence',lessons.length===1&&lessons[0].activities.length===1&&lessons[0].writing.length===1&&lessons[0].audio.length===1&&(lessons[0].writtenReflections||[]).length===1&&Boolean(lessons[0].feedback),{activities:lessons[0]?.activities.length,writing:lessons[0]?.writing.length,audio:lessons[0]?.audio.length,reflections:(lessons[0]?.writtenReflections||[]).length,feedback:Boolean(lessons[0]?.feedback)});
 check('no-unavailable-files',unavailableEvidence(lessons,media).length===0);
 const ADMIN={role:'admin',email:'selfcheck@synthetic.invalid',allowedSchools:[SCHOOL]},OTHER={role:'admin',email:'other@synthetic.invalid',allowedSchools:['ZZ Another School']};
 const json=async r=>({status:r.status,body:await r.json().catch(()=>({}))});
 const origin='https://vision-school-commercial-staging.vercel.app',appReq=(p,init)=>new Request(origin+p,init),P=(id,n)=>({params:Promise.resolve({id,n})});
 const issued={};
 for(const mode of ['link','signin']){
  const session=reportAccessSession({mode,origin,mediaBase:media,newSecret:shares.newShareSecret});
  const pdf=new Uint8Array(createLessonDocumentationPdf({kind:'teacher',lessons,from:day,to:day,raster:null,generatedAt:new Date(),linkFor:session.linkFor}).output('arraybuffer'));
  const scope={kind:'teacher-lesson-documentation',school:SCHOOL,teacher:TEACHER,grade:'Grade 2',section:'A',subject:'English',from:day,to:day,generatedAt:new Date().toISOString(),includeArchived:false,variant:'full'};
  state.actor=ADMIN;
  const stored=await json(await R.store.POST(appReq('/api/school-success/report-snapshots',{method:'POST',headers:{'Content-Type':'application/pdf','X-Snapshot-Scope':Buffer.from(JSON.stringify(scope)).toString('base64url')},body:pdf})));
  const created=await json(await R.create.POST(appReq('/api/school-success/report-shares',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:session.id,mode,snapshotId:stored.body.id,secretSha256:session.secret?await shares.secretDigest(session.secret):null,evidence:[...session.evidence]})})));
  check(mode+':report-created',stored.status===200&&created.status===200,{store:stored.status,create:created.status,files:session.evidence.length});
  state.actor=null;
  const body=mode==='link'?{secret:session.secret}:{};
  if(mode==='signin'){const so=await json(await R.share.POST(appReq('/api/school-success/report-shares/'+session.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({})}),P(session.id)));
   state.actor=OTHER;const ot=await json(await R.share.POST(appReq('/api/school-success/report-shares/'+session.id,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),P(session.id)));
   check('signin:requires-authorized-account',so.status===401&&ot.status===403,{signedOut:so.status,otherSchool:ot.status});state.actor=ADMIN;}
  const opened=await json(await R.share.POST(appReq('/api/school-success/report-shares/'+session.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),P(session.id)));
  const served=await R.share.GET(appReq(opened.body.url||'/x'),P(session.id)),servedBytes=Buffer.from(await served.arrayBuffer());
  check(mode+':report-opens'+(mode==='link'?'-signed-out':'-after-sign-in'),opened.status===200&&served.status===200&&Buffer.compare(servedBytes,Buffer.from(pdf))===0,{open:opened.status,serve:served.status,type:served.headers.get('content-type'),bytes:servedBytes.length});
  // File links taken from the served PDF itself.
  const links=[...new Set((servedBytes.toString('latin1').match(/\/URI \(([^)]*)\)/g)||[]).map(s=>s.slice(6,-1)))];
  check(mode+':pdf-links-only-through-the-report',links.length===3&&links.every(l=>l.startsWith(origin+(mode==='link'?'/school-success/shared/':'/school-success/secure/')+session.id+'/file/')),{links:links.length});
  for(const l of links){
   const u=new URL(l),n=u.pathname.split('/').pop(),secret=u.hash.slice(1)||undefined;
   if(mode==='signin'){state.actor=null;const so=await json(await R.file.POST(appReq(u.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),P(session.id,n)));check('signin:file-'+n+'-requires-sign-in',so.status===401,{status:so.status});state.actor=ADMIN;}
   const f=await json(await R.file.POST(appReq(u.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(secret?{secret}:{})}),P(session.id,n)));
   const signed=new URL(f.body.url),res=await fetch(f.body.url),got=Buffer.from(await res.arrayBuffer());
   const which=Object.entries(files).find(([,x])=>Buffer.compare(x.bytes,got)===0)?.[0]||'mismatch';
   const detail=which==='audio'?{wav:wavInfo(got)}:which==='mismatch'?{}:{jpeg:jpegSize(got)};
   let range=null;if(which==='audio'){const r=await fetch(f.body.url,{headers:{Range:'bytes=0-99'}});range={status:r.status,bytes:(await r.arrayBuffer()).byteLength};}
   check(mode+':file-'+n+'-'+which,f.status===200&&res.status===200&&which!=='mismatch',{route:f.status,storage:res.status,contentType:res.headers.get('content-type'),bytes:got.length,expiresSeconds:Number(signed.searchParams.get('X-Amz-Expires')),...detail,...(range?{range}:{})});
   issued[mode]=issued[mode]||f.body.url;
  }
  issued[mode+'Id']=session.id;issued[mode+'Body']=body;
 }
 // Revocation: new opens of the report and its files stop; an already-issued file URL keeps working until it expires.
 state.actor=ADMIN;
 const rv=await json(await R.manage.POST(appReq('/api/school-success/report-shares/'+issued.linkId+'/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'revoke'})}),P(issued.linkId)));
 state.actor=null;
 const ro=await json(await R.share.POST(appReq('/api/school-success/report-shares/'+issued.linkId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(issued.linkBody)}),P(issued.linkId)));
 const rf=await json(await R.file.POST(appReq('/api/school-success/report-shares/'+issued.linkId+'/file/0',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(issued.linkBody)}),P(issued.linkId,'0')));
 const stillIssued=await fetch(issued.link);
 const signedAt=new URL(issued.link).searchParams.get('X-Amz-Date'),ttl=Number(new URL(issued.link).searchParams.get('X-Amz-Expires'));
 check('revocation-stops-report-and-files',rv.status===200&&ro.status===410&&rf.status===410,{revoke:rv.status,reportAfter:ro.status,fileAfter:rf.status});
 out('already-issued-file-url-after-revocation',{storageStatus:stillIssued.status,validForSecondsFromIssue:ttl,issuedAtUtc:signedAt});
 // Expiry is enforced by storage: a URL issued with a 5-second lifetime works, then is refused.
 const shortUrl=await presignDownload(config,files.photo.key,5),now=await fetch(shortUrl);await now.arrayBuffer();
 await new Promise(r=>setTimeout(r,8000));const later=await fetch(shortUrl),code=((await later.text()).match(/<Code>([A-Za-z]+)<\/Code>/)||[])[1]||'';
 check('storage-enforces-expiry',now.status===200&&later.status===403,{beforeExpiry:now.status,afterExpiry:later.status,code});
 // A file outside the media storage would be named to the exporter, not linked.
 const ext=[{...lessons[0],activities:[{...lessons[0].activities[0],url:'https://drive.example.com/file/1'}]}];
 check('outside-file-is-named-before-export',unavailableEvidence(ext,media).length===1,{named:unavailableEvidence(ext,media).map(f=>f.where)});
})().then(()=>{const pass=results.length&&results.every(Boolean);console.log('ACCESSCHECK RESULT '+(pass?'PASS':'FAIL'));process.exitCode=pass?0:1;}).catch(e=>{out('fatal',{error:String(e?.message||e).replace(/^\d+:/,'').slice(0,300)});console.log('ACCESSCHECK RESULT FAIL');process.exitCode=1;});
