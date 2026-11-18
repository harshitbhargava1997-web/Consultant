// Consolidated-report links: viewer flow for both access modes (report and file), link building and
// parsing, evidence scoping, the per-export access session and export error semantics.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openReportAccess} from '../lib/school-success/report-viewer.js';
import {parseShareLink,reportLink,evidenceLink,evidenceKeyFromUrl,evidenceKeyInScope,isEvidenceKey,newShareSecret,isShareSecret,sealShareRecord,openShareRecord,sameDigest} from '../lib/school-success/report-shares.js';
import {createReportAccess,reportAccessSession} from '../lib/school-success/lesson-snapshots.js';
const ID='0b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f60',SECRET='A'.repeat(43),MEDIA='https://pub-media.r2.dev';
const ok=url=>async()=>Response.json({url,filename:'Lesson_Documentation.pdf'});

test('anyone-with-the-link: the secret comes only from the #fragment, is POSTed, and never put into a URL (report and file)',async()=>{
 for(const n of [null,'3']){
  const sent=[],went=[];
  const r=await openReportAccess({mode:'link',id:ID,n,hash:'#'+SECRET,request:async b=>{sent.push(b);return ok('https://signed.example/x')();},navigate:u=>went.push(u)});
  assert.equal(r.state,'opening');assert.deepEqual(sent,[{secret:SECRET}]);assert.deepEqual(went,['https://signed.example/x']);
 }
 const nav=()=>assert.fail('must not navigate');
 assert.match((await openReportAccess({mode:'link',id:ID,hash:'',request:()=>assert.fail(),navigate:nav})).message,/incomplete/);
 assert.equal((await openReportAccess({mode:'link',id:ID,hash:'#'+SECRET,request:async()=>Response.json({error:'This link has been revoked by the school.'},{status:410}),navigate:nav})).state,'revoked');
 assert.match((await openReportAccess({mode:'link',id:ID,n:'2',hash:'#'+SECRET,request:async()=>Response.json({error:'This file link is not valid.'},{status:404}),navigate:nav})).message,/file link is not valid/);
 assert.match((await openReportAccess({mode:'link',id:ID,hash:'#'+SECRET,request:async()=>{throw new TypeError('Load failed');},navigate:nav})).message,/could not be reached/);
 assert.match((await openReportAccess({mode:'link',id:ID,n:'x',hash:'#'+SECRET,request:()=>assert.fail(),navigate:nav})).message,/not valid/);
});

test('require-school-sign-in: signed-out readers go to Vision sign-in and come back to the same report or file; no secret is used',async()=>{
 const path=`/school-success/secure/${ID}/file/4`,went=[];
 const r=await openReportAccess({mode:'signin',id:ID,n:'4',hash:'#ignored',pagePath:path,getSession:async()=>null,request:()=>assert.fail('no request while signed out'),navigate:u=>went.push(u)});
 assert.equal(r.state,'signin');assert.deepEqual(went,['/?next='+encodeURIComponent(path)]);
 const sent=[],nav=[];
 assert.equal((await openReportAccess({mode:'signin',id:ID,pagePath:path,getSession:async()=>({}),request:async b=>{sent.push(b);return ok('/api/x?ticket=t')();},navigate:u=>nav.push(u)})).state,'opening');
 assert.deepEqual(sent,[{}],'sign-in mode sends no secret');assert.deepEqual(nav,['/api/x?ticket=t']);
 const expired=[];assert.equal((await openReportAccess({mode:'signin',id:ID,pagePath:path,getSession:async()=>({}),request:async()=>Response.json({error:'Sign in'},{status:401}),navigate:u=>expired.push(u)})).state,'signin','an expired session goes back to sign-in');
 assert.match((await openReportAccess({mode:'signin',id:ID,pagePath:path,getSession:async()=>({}),request:async()=>Response.json({error:'School is outside your assignment'},{status:403}),navigate:()=>assert.fail()})).message,/outside your assignment/);
});

test('links: report and file links per mode; secrets only in fragments; parsing accepts both modes',()=>{
 assert.equal(reportLink('https://v.test','link',ID,SECRET),`https://v.test/school-success/shared/${ID}#${SECRET}`);
 assert.equal(reportLink('https://v.test','signin',ID,null),`https://v.test/school-success/secure/${ID}`);
 assert.equal(evidenceLink('https://v.test','link',ID,7,SECRET),`https://v.test/school-success/shared/${ID}/file/7#${SECRET}`);
 assert.equal(evidenceLink('https://v.test','signin',ID,7,null),`https://v.test/school-success/secure/${ID}/file/7`);
 assert.equal(parseShareLink(`https://v.test/school-success/secure/${ID}`),ID);assert.equal(parseShareLink(`https://v.test/school-success/shared/${ID}/file/2#x`),ID);
 assert.equal(parseShareLink(`https://v.test/school-success/report/${ID}`),null);
 const a=newShareSecret();assert.ok(isShareSecret(a)&&a!==newShareSecret());
});

test('evidence scoping: only media-bucket keys are routed; internal objects never; school/teacher must match',()=>{
 const url=MEDIA+'/schools/Alpha%2520School/teachers/AKANSHA%2520PAL/2026-11-05/submission_x/implementation_y/activity/p.jpg';
 assert.equal(evidenceKeyFromUrl(url,MEDIA),'schools/Alpha%20School/teachers/AKANSHA%20PAL/2026-11-05/submission_x/implementation_y/activity/p.jpg');
 assert.equal(evidenceKeyFromUrl('https://drive.example.com/file/1',MEDIA),null,'other websites keep their own links');
 assert.equal(evidenceKeyFromUrl(MEDIA+'/school-success/report-snapshots/v1/a.bin',MEDIA),null);
 assert.equal(evidenceKeyFromUrl(MEDIA+'/a/../b.jpg',MEDIA),'b.jpg','URL dot segments are resolved by the URL parser');assert.equal(evidenceKeyFromUrl(MEDIA+'/schools/x%2F..%2F..%2Fschool-success/y.jpg',MEDIA),null,'encoded traversal is refused');
 for(const bad of ['','/abs','a//b','a/../b','school-success/report-shares/v1/x.bin','portal-connection-check/x.txt'])assert.equal(isEvidenceKey(bad),false,bad);
 const key='schools/Alpha%20School/teachers/AKANSHA%20PAL/2026-11-05/x.jpg';
 assert.equal(evidenceKeyInScope(key,'Alpha School','AKANSHA PAL'),true);
 assert.equal(evidenceKeyInScope(key,'Beta School','AKANSHA PAL'),false);assert.equal(evidenceKeyInScope(key,'Alpha School','Other Teacher'),false);
 assert.equal(evidenceKeyInScope('legacy/uploads/x.jpg','Alpha School','AKANSHA PAL'),true,'legacy keys without school/teacher in the path');
});

test('per-export access session: fresh ID and secret, deduplicated evidence manifest, reset between renders',()=>{
 let n=0;const s1=reportAccessSession({mode:'link',origin:'https://v.test',mediaBase:MEDIA,newId:()=>[ID,'1b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f60'][n++],newSecret:newShareSecret});
 const photo=MEDIA+'/schools/A/teachers/T/p.jpg',audio=MEDIA+'/schools/A/teachers/T/a.m4a',ext='https://drive.example.com/x';
 assert.equal(s1.linkFor(photo),`https://v.test/school-success/shared/${ID}/file/0#${s1.secret}`);
 assert.equal(s1.linkFor(audio),`https://v.test/school-success/shared/${ID}/file/1#${s1.secret}`);
 assert.equal(s1.linkFor(photo),`https://v.test/school-success/shared/${ID}/file/0#${s1.secret}`,'same file, same index');
 assert.equal(s1.linkFor(ext),ext);assert.deepEqual(s1.evidence,['schools/A/teachers/T/p.jpg','schools/A/teachers/T/a.m4a']);
 s1.reset();assert.deepEqual(s1.evidence,[]);
 const s2=reportAccessSession({mode:'signin',origin:'https://v.test',mediaBase:MEDIA,newId:()=>'1b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f60'});
 assert.equal(s2.secret,null);assert.equal(s2.url(),'https://v.test/school-success/secure/1b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f60');
 assert.equal(s2.linkFor(photo),'https://v.test/school-success/secure/1b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f60/file/0');
});

test('records are bound to their ID and purpose; export errors are permanent only for 4xx',async()=>{
 const env=await sealShareRecord('k',ID,'share',{id:ID,snapshotId:'s'});
 assert.deepEqual(await openShareRecord('k',ID,'share',env),{id:ID,snapshotId:'s'});
 await assert.rejects(openShareRecord('k',ID,'revoked',env),/^Error: 404:/);
 assert.ok(sameDigest('ab','ab')&&!sameDigest('ab','ac'));
 const fetcher=status=>async()=>Response.json({error:'x'},{status});
 await assert.rejects(createReportAccess(fetcher(403),{}),e=>e.permanent===true);
 await assert.rejects(createReportAccess(fetcher(503),{}),e=>e.permanent===false);
 let sent;await createReportAccess(async(url,init)=>{sent={url,body:JSON.parse(init.body)};return Response.json({id:ID});},{id:ID,mode:'link'});
 assert.equal(sent.url,'/api/school-success/report-shares');assert.deepEqual(sent.body,{id:ID,mode:'link'});
});
