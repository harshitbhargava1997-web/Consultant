import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords,filterLessons,defaultLessonSections,MAX_LESSONS_PER_PDF} from '../lib/school-success/lesson-records.js';
import {createLessonDocumentationPdf,hasDevanagari} from '../lib/school-success/lesson-report-pdf.js';
import {raw,base,from,to} from './fixtures/lesson-records.mjs';

const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
function stubRaster(){const calls=[];return {calls,width:(t,size)=>t.length*size*0.18,wrap:(t)=>String(t).split('\n'),line(t,size){calls.push(t);return {data:PNG,width:t.length*size*0.18,height:size*0.3528*1.45};}};}
const lessonsP=mapLive(raw(),base).then(m=>buildLessonRecords(m.entries,from,to));
const asha=JSON.stringify(['Alpha School','Asha']);
function pdfText(doc){const dir=mkdtempSync(join(tmpdir(),'lesson-pdf-'));try{const path=join(dir,'r.pdf');writeFileSync(path,Buffer.from(doc.output('arraybuffer')));return {text:execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'}),info:execFileSync('pdfinfo',[path],{encoding:'utf8'})};}finally{rmSync(dir,{recursive:true,force:true});}}
const uris=doc=>[...doc.output().matchAll(/\/URI \(([^)]*)\)/g)].map(m=>m[1]);
const make=async(kind,options={})=>{const lessons=await lessonsP,raster=stubRaster();const list=options.lessons||(kind==='school'?filterLessons(lessons,{school:'Alpha School'}):kind==='teacher'?filterLessons(lessons,{teacher:asha}):[lessons.find(l=>l.recordId==='101')]);const doc=createLessonDocumentationPdf({kind,lessons:list,from,to,raster,generatedAt:new Date('2026-11-17T06:00:00Z'),...options});return {doc,raster,...pdfText(doc)};};

test('teacher PDF: cover, chronological index and lessons in original submission order',async()=>{
 const {text,info}=await make('teacher');
 assert.match(text,/Teacher Lesson Documentation/);assert.match(text,/CHRONOLOGICAL LESSON INDEX/);
 const pages=Number(/Pages:\s+(\d+)/.exec(info)[1]);
 assert.match(text,new RegExp(`Page 1 of ${pages}`));assert.match(text,new RegExp(`Page ${pages} of ${pages}`));
 const body=text.split('\f').slice(2).join('\f');
 assert.ok(body.indexOf('Counting in tens')<body.indexOf('Blending CVC words'),'earliest submission first');
 assert.match(text,/LESSON 1 OF 3/);assert.match(text,/LESSON 3 OF 3/);
 assert.doesNotMatch(text,/Letter sounds|Beta objective/,'other teachers and schools are excluded');
});

test('individual lesson PDF keeps the approved section order and its own evidence only',async()=>{
 const {text,doc}=await make('lesson');
 const order=['Lesson plan','Learning objective','Classroom activities','Student written work','Audio recordings','Teacher reflections','Academic Review'].map(h=>text.indexOf(h.toUpperCase())>=0?text.indexOf(h.toUpperCase()):text.indexOf(h));
 assert.ok(order.every(i=>i>=0),JSON.stringify(order));
 assert.deepEqual([...order].sort((a,b)=>a-b),order);
 assert.doesNotMatch(text,/CFU|Check for understanding/i);
 const links=uris(doc);
 assert.ok(links.some(u=>u.endsWith('v1.wav'))&&links.some(u=>u.endsWith('v2.wav')),'both recordings are clickable');
 assert.ok(!links.some(u=>u.endsWith('h1.wav')),'another lesson’s recording is not attached');
 assert.match(text,/Lesson preparation recording 1[\s\S]*Lesson preparation recording 2/);
 assert.match(text,/Reviewed 27 Oct 2026/);assert.match(text,/Strong modelling/);
 assert.doesNotMatch(text,/consultant@example\.test/);
});

test('optional sections can be excluded without affecting the lesson plan core',async()=>{
 const off={...defaultLessonSections,activities:false,writing:false,audio:false,reflections:false,feedback:false};
 const {text,doc}=await make('lesson',{sections:off});
 assert.match(text,/LESSON PLAN/);assert.match(text,/Teacher activity/);
 for(const heading of ['CLASSROOM ACTIVITIES','STUDENT WRITTEN WORK','AUDIO RECORDINGS','TEACHER REFLECTIONS','Strong modelling'])assert.ok(!text.includes(heading),heading);
 assert.deepEqual(uris(doc).filter(u=>/\.(wav|jpg|png)$/.test(u)),[]);
 assert.ok(uris(doc).some(u=>u.endsWith('plan.pdf')),'lesson plan document stays');
 const only=await make('lesson',{sections:{...off,audio:true}});
 assert.match(only.text,/AUDIO RECORDINGS/);assert.doesNotMatch(only.text,/CLASSROOM ACTIVITIES/);
});

test('each file appears once, as a thumbnail when embedded or as a link otherwise',async()=>{
 const lessons=await lessonsP,lesson=lessons.find(l=>l.recordId==='101');
 const images=new Map([[lesson.activities[0].url,{data:PNG,width:1,height:1,format:'PNG'}]]);
 const {text,doc}=await make('lesson',{images});
 assert.equal((text.match(/Classroom activity 1/g)||[]).length,1);assert.equal((text.match(/Classroom activity 2/g)||[]).length,1);
 const links=uris(doc);
 assert.equal(links.filter(u=>u.endsWith('a1.jpg')).length,1);assert.equal(links.filter(u=>u.endsWith('a2.png')).length,1);
 assert.match(text,/Open original/);
});

test('Devanagari text is shaped through the canvas rasteriser, never written as broken PDF text',async()=>{
 const {text,raster}=await make('teacher');
 assert.equal(hasDevanagari(text),false,'no unshaped Devanagari glyph runs in the text layer');
 assert.ok(raster.calls.some(t=>t.includes('मात्रा वाले शब्द')),'topic rendered via canvas');
 assert.ok(raster.calls.some(t=>t.includes('बच्चे मात्राओं')),'plan text rendered via canvas');
 assert.ok(!raster.calls.some(t=>/^Blending CVC words$/.test(t)),'English stays as selectable text');
 assert.match(text,/Blending CVC words/);
});

test('school PDF groups School → Teacher → Class/Subject and links the index to lesson pages',async()=>{
 const {text,doc}=await make('school');
 assert.match(text,/School Lesson Documentation/);assert.match(text,/TEACHER OVERVIEW/);assert.match(text,/CLASS AND SUBJECT BREAKDOWN/);assert.match(text,/LESSON INDEX/);
 const overview=text.split('\f')[1];assert.match(overview,/Asha\s+3\s+3/);assert.match(overview,/Bina\s+1\s+0/);
 assert.doesNotMatch(text,/Beta objective/,'same-name teacher at another school is excluded');
 assert.ok((doc.output().match(/\/Dest /g)||[]).length>=4,'index rows link to lesson pages');
 assert.match(text,/Teacher: Asha|TEACHER\s+Asha/);
});

test('long plans flow across pages with consistent footers and no empty trailing page',async()=>{
 const lessons=await lessonsP,base=lessons.find(l=>l.recordId==='150');
 const long={...base,plan:{fields:[{key:'teacher',label:'Teacher activity',text:Array.from({length:120},(_,i)=>`Step ${i+1}: model the routine, check understanding and give feedback.`).join(' ')}],notes:''}};
 const {text,info}=await make('lesson',{lessons:[long]});
 const pages=Number(/Pages:\s+(\d+)/.exec(info)[1]);assert.ok(pages>=2);
 const sheets=text.split('\f').filter(p=>p.trim());assert.equal(sheets.length,pages);
 sheets.forEach((p,i)=>assert.match(p,new RegExp(`Page ${i+1} of ${pages}`)));
 assert.match(text,/Step 120:/);
});

test('scope guards reject mixed teachers, mixed schools and oversized PDFs',async()=>{
 const lessons=await lessonsP;
 assert.throws(()=>createLessonDocumentationPdf({kind:'teacher',lessons,from,to}),/one teacher/);
 assert.throws(()=>createLessonDocumentationPdf({kind:'school',lessons,from,to}),/one school/);
 assert.throws(()=>createLessonDocumentationPdf({kind:'lesson',lessons:lessons.slice(0,2),from,to}),/one lesson/);
 assert.throws(()=>createLessonDocumentationPdf({kind:'teacher',lessons:[],from,to}),/No lessons/);
 const many=Array.from({length:MAX_LESSONS_PER_PDF+1},(_,i)=>({...lessons[0],key:'k'+i,recordId:String(i)}));
 assert.throws(()=>createLessonDocumentationPdf({kind:'teacher',lessons:many,from,to}),/Narrow/);
});
