import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotScopeSchema,snapshotId,sealSnapshot,openSnapshot,assertPdfBytes,sha256Hex,isSnapshotId,snapshotFilename,contentDisposition,MAX_SNAPSHOT_BYTES} from '../lib/school-success/report-snapshots.js';
import {buildDocumentationLinks,storeSnapshot,MAX_DOCUMENTATION_GROUPS} from '../lib/school-success/lesson-snapshots.js';
import {openLessonSnapshot} from '../lib/school-success/snapshot-viewer.js';
import {safeReturnPath} from '../lib/return-path.js';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords} from '../lib/school-success/lesson-records.js';
import {raw,base,from,to} from './fixtures/lesson-records.mjs';

const SECRET='unit-test-secret';
const pdf=(text='hello')=>new TextEncoder().encode(`%PDF-1.3\n${text}\n%%EOF\n`);
const scope=(over={})=>snapshotScopeSchema.parse({kind:'teacher-lesson-documentation',school:'Alpha School',teacher:'Asha',grade:'Grade 2',section:'A',subject:'English',from,to,generatedAt:'2026-11-17T06:00:00.000Z',...over});
const entriesP=mapLive(raw(),base).then(m=>m.entries);

test('snapshots are encrypted, bound to their ID and tamper-evident',async()=>{
 const bytes=pdf('class notes'),sha=await sha256Hex(bytes),id=await snapshotId(SECRET,scope(),sha);
 assert.ok(isSnapshotId(id));
 const meta={v:1,id,...scope(),sha256:sha,size:bytes.length};
 const envelope=await sealSnapshot(SECRET,id,meta,bytes);
 assert.ok(!Buffer.from(envelope).includes(Buffer.from('%PDF')),'stored object is ciphertext');
 assert.ok(!Buffer.from(envelope).includes(Buffer.from('Alpha School')),'scope is not readable in storage');
 const opened=await openSnapshot(SECRET,id,envelope);
 assert.deepEqual(Buffer.from(opened.pdf),Buffer.from(bytes));assert.equal(opened.meta.school,'Alpha School');
 const otherId=await snapshotId(SECRET,scope({teacher:'Bina'}),sha);
 await assert.rejects(openSnapshot(SECRET,otherId,envelope),/not found/,'cannot be replayed under another ID');
 const flipped=new Uint8Array(envelope);flipped[flipped.length-5]^=1;
 await assert.rejects(openSnapshot(SECRET,id,flipped),/not found/);
 await assert.rejects(openSnapshot('other-secret',id,envelope),/not found/);
});

test('snapshot IDs repeat only for identical scope and bytes',async()=>{
 const sha=await sha256Hex(pdf());
 assert.equal(await snapshotId(SECRET,scope(),sha),await snapshotId(SECRET,scope(),sha));
 for(const change of [{school:'Beta School'},{teacher:'Bina'},{grade:'Grade 3'},{section:'B'},{subject:'Hindi'},{from:'2026-10-21'},{to:'2026-10-30'},{generatedAt:'2026-11-18T06:00:00.000Z'}])
  assert.notEqual(await snapshotId(SECRET,scope(change),sha),await snapshotId(SECRET,scope(),sha),JSON.stringify(change));
 assert.notEqual(await snapshotId(SECRET,scope(),await sha256Hex(pdf('changed'))),await snapshotId(SECRET,scope(),sha));
 assert.notEqual(await snapshotId('other',scope(),sha),await snapshotId(SECRET,scope(),sha),'not predictable without the server secret');
});

test('scope, PDF and size are validated; filenames are safe',()=>{
 assert.throws(()=>scope({from:'2026-01-01',to:'2026-06-30'}));assert.throws(()=>scope({teacher:''}));assert.throws(()=>scope({extra:1}));
 assert.throws(()=>assertPdfBytes(new TextEncoder().encode('<html>')),/complete PDF/);
 assert.throws(()=>assertPdfBytes(new Uint8Array(MAX_SNAPSHOT_BYTES+1)),/4 MB/);
 assertPdfBytes(pdf());
 const meta={...scope({teacher:'आशा "Asha" / Verma',section:'A'})};
 assert.equal(snapshotFilename(meta),`Lesson_Documentation_Asha_Verma_Grade_2_A_English_${from}_${to}.pdf`);
 assert.match(contentDisposition(meta),/^inline; filename="Lesson_Documentation_[^"]+\.pdf"; filename\*=UTF-8''/);
 assert.match(contentDisposition(meta,true),/^attachment;/);
});

test('export renders and stores one PDF per exact teacher/class/section/subject group before linking',async()=>{
 const entries=await entriesP,rendered=[],stored=[];
 const links=await buildDocumentationLinks({entries,from,to,teacherKeys:[JSON.stringify(['Alpha School','Asha']),JSON.stringify(['Beta School','Asha'])],generatedAt:'2026-11-17T06:00:00.000Z',
  render:async lessons=>{rendered.push(lessons.map(l=>l.recordId));return pdf(lessons.map(l=>l.recordId).join(','));},
  store:async(bytes,s)=>{stored.push(s);return {url:'https://app.test/school-success/report/'+stored.length};}});
 assert.deepEqual(rendered,[['101'],['150'],['102'],['201']],'each PDF contains exactly its group, in submission order');
 assert.deepEqual(stored.map(s=>[s.school,s.teacher,s.grade,s.section,s.subject,s.from,s.to]),[['Alpha School','Asha','Grade 2','A','English',from,to],['Alpha School','Asha','Grade 2','A','Mathematics',from,to],['Alpha School','Asha','Grade 3','B','Hindi',from,to],['Beta School','Asha','Grade 2','A','English',from,to]]);
 assert.deepEqual(links.get(JSON.stringify(['Alpha School','Asha'])).map(g=>[g.subject,g.lessons,g.url]),[['English',1,'https://app.test/school-success/report/1'],['Mathematics',1,'https://app.test/school-success/report/2'],['Hindi',1,'https://app.test/school-success/report/3']]);
 assert.ok(!links.has(JSON.stringify(['Alpha School','Bina'])),'only the exported teachers');
 // The rendered lessons are the same records the Teacher Lesson PDF selects.
 const expected=buildLessonRecords(entries,from,to).filter(l=>l.teacherKey===JSON.stringify(['Alpha School','Asha'])&&l.subject==='Hindi');
 assert.deepEqual(rendered[2],expected.map(l=>l.recordId));
});

test('transient storage failures retry; permanent or persistent failures stop the whole export',async()=>{
 const entries=await entriesP,teacherKeys=[JSON.stringify(['Alpha School','Asha'])],common={entries,from,to,teacherKeys,generatedAt:'2026-11-17T06:00:00.000Z',render:async l=>pdf(l[0].recordId),wait:async()=>{}};
 let calls=0;
 const ok=await buildDocumentationLinks({...common,store:async()=>{calls++;if(calls===1)throw Error('network');return {url:'u'+calls};}});
 assert.equal([...ok.values()][0].length,3);assert.equal(calls,4,'one retry for the first group');
 let permanentCalls=0;
 await assert.rejects(buildDocumentationLinks({...common,store:async(b,s)=>{if(s.subject==='Hindi'){permanentCalls++;throw Object.assign(Error('School is outside your assignment'),{permanent:true});}return {url:'x'};}}),/could not be prepared for 1 group, so no report was created.*Grade 3 B · Hindi: School is outside your assignment/);
 assert.equal(permanentCalls,1,'permanent errors are not retried');
 let attempts=0;
 await assert.rejects(buildDocumentationLinks({...common,store:async()=>{attempts++;throw Error('503');}}),/3 groups/);
 assert.equal(attempts,9,'three attempts per group, then stop');
});

test('oversized PDFs fall back to fewer thumbnails, then links only; every export renders afresh for its new links',async()=>{
 const entries=await entriesP,levels=[];let stores=0,resets=0;
 const big=new Uint8Array(4_100_000);big.set(pdf());
 const common={entries,from,to,teacherKeys:[JSON.stringify(['Beta School','Asha'])],generatedAt:'2026-11-17T06:00:00.000Z',store:async()=>({id:'s',url:'u'+(++stores)}),begin:()=>({linkFor:u=>u,reset(){resets++;}})};
 await buildDocumentationLinks({...common,render:async(l,{thumbnailsPerSection})=>{levels.push(thumbnailsPerSection);return thumbnailsPerSection>2?big:pdf();}});
 assert.deepEqual(levels,[6,2]);assert.equal(resets,2,'the evidence manifest is reset before each fallback render');
 await buildDocumentationLinks({...common,render:async()=>pdf()});
 assert.equal(stores,2,'a second export renders and stores again (its links are new)');
 await assert.rejects(buildDocumentationLinks({...common,render:async()=>big}),/larger than 4 MB even without photo thumbnails/);
});

test('bulk limits, bounded concurrency and progress reporting',async()=>{
 const entries=await entriesP,progress=[];let active=0,peak=0;
 await buildDocumentationLinks({entries,from,to,teacherKeys:[JSON.stringify(['Alpha School','Asha']),JSON.stringify(['Alpha School','Bina']),JSON.stringify(['Beta School','Asha'])],generatedAt:'2026-11-17T06:00:00.000Z',concurrency:2,
  render:async l=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return pdf(l[0].recordId);},store:async()=>({url:'u'}),onProgress:p=>progress.push(p.done+'/'+p.total)});
 assert.ok(peak<=2);assert.deepEqual(progress,['0/5','1/5','2/5','3/5','4/5','5/5']);
 assert.equal(MAX_DOCUMENTATION_GROUPS,300);
});

test('the browser upload sends raw PDF bytes with a scope header and flags permanent errors',async()=>{
 let seen;const s=scope({teacher:'आशा'});
 const result=await storeSnapshot(async(url,init)=>{seen={url,init};return Response.json({id:'x',url:'/school-success/report/x'});},pdf(),s);
 assert.equal(seen.url,'/api/school-success/report-snapshots');assert.equal(seen.init.headers['Content-Type'],'application/pdf');
 assert.deepEqual(JSON.parse(Buffer.from(seen.init.headers['X-Snapshot-Scope'],'base64url').toString('utf8')),s);assert.equal(result.url,'/school-success/report/x');
 await assert.rejects(storeSnapshot(async()=>Response.json({error:'School is outside your assignment'},{status:403}),pdf(),s),e=>e.permanent===true);
 await assert.rejects(storeSnapshot(async()=>Response.json({error:'busy'},{status:503}),pdf(),s),e=>!e.permanent);
});

test('the durable link signs readers in, returns to the PDF, and opens it directly when authorised',async()=>{
 const id='0f8e8f4c-1b2a-4c3d-9e4f-5a6b7c8d9e0f',nav=[];const navigate=u=>nav.push(u);
 const reply=(status,body)=>async()=>new Response(JSON.stringify(body),{status});
 assert.equal((await openLessonSnapshot({id:'../../etc',getSession:async()=>({}),request:reply(200,{}),navigate})).state,'error');
 assert.equal((await openLessonSnapshot({id,getSession:async()=>null,request:reply(200,{}),navigate})).state,'signin');
 assert.equal(nav.at(-1),'/?next=%2Fschool-success%2Freport%2F'+id);
 assert.equal(safeReturnPath(decodeURIComponent(nav.at(-1).slice(7)),'https://app.test'),'/school-success/report/'+id,'Vision returns to this PDF after sign-in');
 assert.equal((await openLessonSnapshot({id,getSession:async()=>({}),request:reply(401,{}),navigate})).state,'signin');
 assert.match((await openLessonSnapshot({id,getSession:async()=>({}),request:reply(403,{error:'School is outside your assignment'}),navigate})).message,/outside your assignment/);
 assert.match((await openLessonSnapshot({id,getSession:async()=>({}),request:reply(404,{}),navigate})).message,/could not be found/);
 const open=await openLessonSnapshot({id,getSession:async()=>({}),request:reply(200,{url:'/api/school-success/report-snapshots/'+id+'?ticket=t',downloadUrl:'d',filename:'f.pdf'}),navigate});
 assert.equal(open.state,'opening');assert.equal(nav.at(-1),'/api/school-success/report-snapshots/'+id+'?ticket=t');
 for(const bad of ['/school-success/report/not-an-id','/school-success/report/'+id+'/../../admin','https://evil.test/school-success/report/'+id])assert.equal(safeReturnPath(bad,'https://app.test'),'',bad);
});
