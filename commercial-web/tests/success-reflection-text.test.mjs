import {storeReflectionDocuments,reflectionUploadTicket} from '../lib/school-success/reflection-storage.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {formatClosure} from '../lib/closure-reflection.js';
import {parseClosureText,reflectionFileId,planReflectionDocuments,attachReflectionText,reflectionDocument,isReflectionTextUrl,REFLECTION_DOCUMENT_TYPE} from '../lib/school-success/reflection-text.js';
import {submissionSchema,evidencePlan,submissionRecords} from '../lib/school-success/teacher-submissions.js';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords,isGeneratedPreparationPdf,visibleLessonSections} from '../lib/school-success/lesson-records.js';
import {createLessonDocumentationPdf} from '../lib/school-success/lesson-report-pdf.js';

const base='https://media.example.test',S='Alpha School',T='Asha';
const sub='11111111-1111-4111-8111-111111111111',P1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',P2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U1='c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1',U2='c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
const submission=()=>submissionSchema.parse({id:sub,school:S,teacher:T,date:'2026-10-21',periods:[{id:P1,grade:'Grade 2',section:'A',subject:'Hindi',topic:'मात्रा'},{id:P2,grade:'Grade 2',section:'A',subject:'English',topic:'CVC'}],files:[{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',periodId:P1,category:'activity',name:'photo.jpg',size:10}]});
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const raster=()=>{const calls=[];return {calls,width:(t,s)=>t.length*s*0.18,wrap:t=>String(t).split('\n'),line(t,s){calls.push(t);return {data:PNG,width:t.length*s*0.18,height:s*0.5};}};};
const pdfText=doc=>{const dir=mkdtempSync(join(tmpdir(),'refl-'));try{const p=join(dir,'r.pdf');writeFileSync(p,Buffer.from(doc.output('arraybuffer')));return execFileSync('pdftotext',['-layout',p,'-'],{encoding:'utf8'});}finally{rmSync(dir,{recursive:true,force:true});}};

test('the two prompts are split from the editor text; Hindi, mixed text and untitled text are kept',()=>{
 const hindi='बच्चों ने मात्रा पहचानी। Most children read 5 words.';
 assert.deepEqual(parseClosureText(formatClosure({achievement:hindi,nextStep:'Ravi और Meena को दोबारा अभ्यास।\nSmall group on Monday.'})),{achievement:hindi,nextStep:'Ravi और Meena को दोबारा अभ्यास।\nSmall group on Monday.'});
 assert.deepEqual(parseClosureText(formatClosure({nextStep:'Only the second answer'})),{achievement:'',nextStep:'Only the second answer'});
 assert.deepEqual(parseClosureText('Typed without headings'),{achievement:'Typed without headings',nextStep:''});
});

test('server plans one reflection document per period, keyed in that period’s closure folder; browsers upload only their own files',async()=>{
 const reflections=[{periodId:P1,answers:{achievement:'बहुत अच्छा',nextStep:'Group practice'}}];
 const planned=await planReflectionDocuments({submission:submission(),reflections,updateId:U1,conductedOn:'2026-10-22',evidencePlan,submissionSchema});
 assert.equal(planned.docs.length,1);
 const doc=planned.docs[0];
 assert.match(doc.key,new RegExp(`submission_${sub}/implementation_${P1}/closure/${doc.id}\\.json$`));
 const parsed=JSON.parse(doc.text);
 assert.equal(parsed.type,REFLECTION_DOCUMENT_TYPE);assert.deepEqual(parsed.answers,{achievement:'बहुत अच्छा',nextStep:'Group practice'});
 assert.equal(parsed.updateId,U1);assert.equal(parsed.periodId,P1);assert.equal(parsed.conductedOn,'2026-10-22');
 assert.deepEqual(planned.uploads.map(f=>f.name),['photo.jpg'],'only the selected photo gets an ordinary attachment ticket');
 const file=planned.submission.files.find(f=>f.id===doc.id);
 assert.deepEqual([file.category,file.size],['closure',new TextEncoder().encode(doc.text).length]);
 // The row columns the RPC appends to history include the reflection with the activity photo.
 const row=submissionRecords(planned.submission,'teacher@example.test',base).find(r=>r.lesson_period_id===P1);
 assert.ok([row.Video_Evidence_1,row.Video_Evidence_2,row.Video_Evidence_3].join(',').includes(`/closure/${doc.id}.json`));
});

test('reflection identity is content-addressed: same answers → same object; any change → a new object',async()=>{
 const plan=answers=>planReflectionDocuments({submission:submission(),reflections:[{periodId:P1,answers}],updateId:U1,conductedOn:'2026-10-22',evidencePlan,submissionSchema});
 const a=(await plan({achievement:'Same'})).docs[0],b=(await plan({achievement:'Same'})).docs[0],c=(await plan({achievement:'Different'})).docs[0];
 assert.deepEqual([a.id,a.text],[b.id,b.text],'identical retries produce identical bytes at the same key');
 assert.notEqual(a.id,c.id);assert.notEqual(a.key,c.key);
 assert.ok(!('savedAt' in JSON.parse(a.text)),'no clock values in stored content');
 assert.notEqual(await reflectionFileId(U1,P1,'h'),await reflectionFileId(U2,P1,'h'));assert.notEqual(await reflectionFileId(U1,P1,'h'),await reflectionFileId(U1,P2,'h'));
 assert.match(a.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('reflection storage confirms exact bytes and never overwrites a saved answer',async()=>{
 const store=new Map(),calls=[],wait=async()=>{};
 const get=async k=>store.has(k)?new Response(store.get(k)):new Response(null,{status:404});
 const put=async(k,body,headers)=>{
  calls.push(k);
  assert.equal(headers['If-None-Match'],'*');assert.equal(headers['Content-Length'],String(Buffer.byteLength(body)));
  if(store.has(k))return new Response(null,{status:412});
  store.set(k,body);return new Response(null,{status:200});
 };
 const text='{"a":"हिंदी"}',doc={key:'k1',text,size:Buffer.byteLength(text)};
 await storeReflectionDocuments([doc],{put,get,wait});await storeReflectionDocuments([doc],{put,get,wait});
 assert.deepEqual(calls,['k1']);
 store.set('k1',text.replace('द','ब'));
 await assert.rejects(storeReflectionDocuments([doc],{put,get,wait}),/differs from this update/);
 assert.deepEqual(calls,['k1']);
 store.clear();
 await storeReflectionDocuments([doc],{get,wait,put:async(k,body)=>{store.set(k,body);return new Response(null,{status:412});}});
 store.clear();
 await storeReflectionDocuments([doc],{get,wait,put:async(k,body)=>{store.set(k,body);throw Error('response lost');}});
 assert.equal(store.get('k1'),text);
});

test('a reflection upload signs its exact checksum, content type and create-only condition',async()=>{
 const config={R2_ENDPOINT_URL:'https://fixture.r2.cloudflarestorage.com',R2_BUCKET_NAME:'onelern-media',R2_ACCESS_KEY_ID:'fixture',R2_SECRET_ACCESS_KEY:'test',R2_PUBLIC_BASE_URL:'https://media.example.test'};
 const doc={key:'schools/S/teachers/T/closure/synthetic.json',text:'{"answer":"हिंदी"}'};
 const {createHash}=await import('node:crypto');
 const ticket=await reflectionUploadTicket(config,doc),url=new URL(ticket.url);
 assert.equal(ticket.text,doc.text);assert.equal(ticket.headers['Content-MD5'],createHash('md5').update(doc.text).digest('base64'));
 assert.equal(ticket.headers['If-None-Match'],'*');
 const signed=url.searchParams.get('X-Amz-SignedHeaders').split(';');
 for(const name of ['content-type','content-md5','if-none-match'])assert.ok(signed.includes(name),name);
 assert.equal(url.pathname,'/onelern-media/'+doc.key);assert.equal(url.searchParams.get('X-Amz-Expires'),'900');
});

test('reflection input is validated: own periods only, non-empty, bounded length, no extra fields',async()=>{
 const plan=reflections=>planReflectionDocuments({submission:submission(),reflections,updateId:U1,conductedOn:'2026-10-22',evidencePlan,submissionSchema});
 await assert.rejects(plan([{periodId:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',answers:{achievement:'x'}}]),/belong to a class period/);
 await assert.rejects(plan([{periodId:P1,answers:{achievement:'  ',nextStep:''}}]),/at least one/);
 await assert.rejects(plan([{periodId:P1,answers:{achievement:'x'.repeat(4001)}}]));
 await assert.rejects(plan([{periodId:P1,answers:{achievement:'x',url:'https://evil'}}]));
 await assert.rejects(plan([{periodId:P1,answers:{achievement:'a'}},{periodId:P1,answers:{achievement:'b'}}]),/One reflection per class period/);
 assert.deepEqual((await plan(null)).docs,[]);
});

test('read path attaches only valid reflection documents and leaves failures as links',async()=>{
 const good=`${base}/x/submission_${sub}/implementation_${P1}/closure/${await reflectionFileId(U1,P1)}.json`,bad=`${base}/x/implementation_${P1}/closure/${await reflectionFileId(U2,P1)}.json`;
 const body=JSON.stringify(reflectionDocument({submissionId:sub,periodId:P1,updateId:U1,conductedOn:'2026-10-22',answers:{achievement:'Done',nextStep:''}}));
 const entries=[{kind:'submission',files:[{url:good},{url:bad},{url:`${base}/x/closure/legacy.pdf`}]},{kind:'usage',files:[{url:good}]}];
 const fetched=[];
 const result=await attachReflectionText(entries,async url=>{fetched.push(url);if(url===good)return body;return '{"type":"other"}';});
 assert.deepEqual(result,{requested:2,loaded:1});
 assert.deepEqual(entries[0].files[0].reflection.answers,{achievement:'Done',nextStep:''});
 assert.equal(entries[0].files[1].reflectionUnavailable,true);assert.equal(entries[0].files[2].reflection,undefined);
 assert.equal(entries[1].files[0].reflection,undefined,'only submission entries are enriched');
 assert.ok(!fetched.some(u=>u.endsWith('.pdf')),'PDFs are never fetched');
 assert.equal(isReflectionTextUrl(`${base}/x/closure/notes.json`),false,'only server-shaped names count as reflection text');
});

// Synthetic lesson: preparation (generated PDF + an uploaded plan photo), an earlier PDF-only reflection,
// a written reflection in the period and another after it.
async function lessonEntries({planText=true}={}){
 const url=(cat,name)=>`${base}/schools/${encodeURIComponent(S)}/teachers/${T}/d/submission_${sub}/implementation_${P1}/${cat}/${name}`;
 const generated=url('lesson_plan',P1+'.pdf'),photo=url('lesson_plan','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.jpg'),legacy=url('closure','ffffffff-ffff-4fff-8fff-ffffffffffff.pdf');
 const inside=url('closure',(await reflectionFileId(U1,P1))+'.json'),after=url('closure',(await reflectionFileId(U2,P1))+'.json'),act=url('activity','a.jpg');
 const record={id:501,Center:S,Institution:S,FullName:T,Role:'teacher',Type:'Classroom Reflection',Grade:'Grade 2',Section:'A',Subject:'Hindi',Book:'मात्रा वाले शब्द',Duration_Min:0,submission_id:sub,lesson_period_id:P1,planned_lesson_on:'2026-10-21',preparation_saved_at:'2026-10-20T05:00:00',submitted_at:'2026-10-20T05:00:00',implementation_date:'2026-10-22',StartTime:'2026-10-22T00:00:00',lesson_stage:'evidence_submitted',
  lesson_reflection:planText?'Why — learning objective\nपढ़ना और लिखना':'',materials_notes:'',lesson_version:3,Voice_Note_Link:'',Lesson_Plan_Picture:[generated,photo].join(','),Video_Evidence_1:legacy,Video_Evidence_2:act,Video_Evidence_3:[inside,after].join(','),
  lesson_evidence_history:[{id:'e0',at:'2026-10-21T06:00:00',conductedOn:'2026-10-21',files:{Video_Evidence_1:legacy}},{id:'e1',at:'2026-10-22T06:00:00',conductedOn:'2026-10-22',files:{Video_Evidence_1:[act,inside].join(',')}},{id:'e2',at:'2026-11-02T06:00:00',conductedOn:'2026-11-02',files:{Video_Evidence_1:after}}]};
 const entries=(await mapLive({records:[record],reviews:[],roster:[]},base)).entries;
 const doc=(u,a,on)=>JSON.stringify(reflectionDocument({submissionId:sub,periodId:P1,updateId:u,conductedOn:on,answers:a}));
 await attachReflectionText(entries,async u=>u===inside?doc(U1,{achievement:'बच्चों ने मात्रा पहचानी। Most read 5 words.',nextStep:'Ravi needs support with ि.'},'2026-10-22'):u===after?doc(U2,{achievement:'November follow-up',nextStep:''},'2026-11-02'):(()=>{throw Error('missing');})());
 return {entries,generated,photo,legacy};
}

test('generated preparation PDF is hidden only when its plan text is shown; uploads and fallbacks stay',async()=>{
 const {entries,generated,photo}=await lessonEntries();
 assert.equal(isGeneratedPreparationPdf(generated),true);assert.equal(isGeneratedPreparationPdf(photo),false);
 assert.equal(isGeneratedPreparationPdf(generated.replace(P1+'.pdf','Lesson-preparation-1.pdf')),false,'names alone are not trusted');
 const lesson=buildLessonRecords(entries,'2026-10-20','2026-10-31')[0];
 assert.deepEqual(lesson.planFiles.map(f=>f.url),[photo]);
 const noText=buildLessonRecords((await lessonEntries({planText:false})).entries,'2026-10-20','2026-10-31')[0];
 assert.deepEqual(noText.planFiles.map(f=>[f.label,f.url]),[['Saved lesson plan (PDF)',generated],['Lesson plan photo',photo]]);
 assert.equal(visibleLessonSections(noText).plan,true);
});

test('written reflections show as dated text within the period; history and legacy PDFs are preserved',async()=>{
 const {entries,legacy}=await lessonEntries();
 const period=buildLessonRecords(entries,'2026-10-20','2026-10-31')[0];
 assert.deepEqual(period.writtenReflections.map(r=>[r.date,r.answers.achievement]),[['2026-10-22','बच्चों ने मात्रा पहचानी। Most read 5 words.']]);
 assert.deepEqual(period.reflections.map(f=>[f.label,f.url,f.legacy]),[['Earlier after-class reflection (saved PDF)',legacy,true]]);
 assert.equal(period.outsidePeriodFiles,1,'the November reflection is disclosed, not shown');
 const all=buildLessonRecords(entries,'2026-10-20','2026-10-31',{scope:'all'})[0];
 assert.deepEqual(all.writtenReflections.map(r=>r.answers.achievement),['बच्चों ने मात्रा पहचानी। Most read 5 words.','November follow-up']);
 assert.deepEqual(all.writtenReflections.map(r=>r.label),['Written reflection 1','Written reflection 2']);
 assert.equal(buildLessonRecords(entries,'2026-11-01','2026-11-30').length,1,'later reflection makes the lesson appear in November');
});

test('lesson PDFs print written reflections inline (Hindi via canvas) and keep legacy links',async()=>{
 const {entries,legacy}=await lessonEntries(),lesson=buildLessonRecords(entries,'2026-10-20','2026-10-31')[0],r=raster();
 const doc=createLessonDocumentationPdf({kind:'teacher',lessons:[lesson],from:'2026-10-20',to:'2026-10-31',raster:r}),text=pdfText(doc);
 assert.match(text,/AFTER-CLASS REFLECTIONS/);assert.match(text,/Written reflection/);
 assert.match(text,/Did students achieve the learning outcome/);
 assert.ok(r.calls.some(t=>t.includes('बच्चों ने मात्रा पहचानी')),'Hindi answer drawn through the canvas');
 assert.ok(r.calls.some(t=>t.includes('Ravi needs support')),'mixed-script answer drawn through the canvas');
 assert.doesNotMatch(text,/November follow-up/);
 assert.ok(doc.output().includes(legacy.split('/').pop()),'legacy PDF stays linked');
 assert.match(text,/Earlier reflections were saved as PDFs/);
 assert.doesNotMatch(text,/closure\/[0-9a-f-]{36}\.json/);
});
