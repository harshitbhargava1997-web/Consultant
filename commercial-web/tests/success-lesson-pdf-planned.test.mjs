// Lesson PDFs by planned date (owner decision, 28 November 2026): lessons chosen and ordered by the day they were
// planned for (then period), both dates on every lesson, the review type in the index, and each weekly review
// printed once after the last lesson it covers, with the others pointing to its page.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {appendWeeklyReview,appendRubric,readRubricRows} from '../lib/school-success/lesson-review-store.js';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords,filterLessons} from '../lib/school-success/lesson-records.js';
import {createLessonDocumentationPdf} from '../lib/school-success/lesson-report-pdf.js';
import {recordQuery} from '../lib/school-success/read-query.js';

const S='Sunrise Public School';
const rec=(id,date,saved,grade,section,subject,topic)=>({id,Type:'Classroom Reflection',Center:S,Institution:S,FullName:'Asha Verma',Grade:grade,Section:section,Subject:subject,Book:topic,submission_id:'s'+id,lesson_period_id:'p'+id,planned_lesson_on:date,preparation_saved_at:saved,lesson_stage:'preparation_saved',lesson_reflection:'Why — learning objective\nChildren learn '+topic+'.',StartTime:date+'T00:00:00'});
const records=[
 rec(101,'2026-11-23','2026-11-22T15:10:00','Grade 2','A','English','Naming words'),   // planned Mon, saved Sunday
 rec(102,'2026-11-23','2026-11-22T15:20:00','Grade 4','B','Mathematics','Halves'),
 rec(103,'2026-11-24','2026-11-22T15:30:00','Grade 2','A','English','Action words'),
 rec(104,'2026-11-26','2026-11-28T10:00:00','Grade 2','A','English','CVC words'),      // written two days late
 rec(105,'2026-11-20','2026-11-23T09:00:00','Grade 2','A','English','Revision'),       // saved in range, planned before
 rec(106,'2026-11-30','2026-11-24T09:00:00','Grade 2','A','English','Story time')];    // saved in range, planned after
function table(){const rows=new Map();
 return {request:async(path,method='GET',body)=>{if(method==='POST'){const out=[];for(const r of [].concat(body))if(!rows.has(r.id)){rows.set(r.id,{...r});out.push({id:r.id});}return out;}return [];},
  all:async(_t,_o,q)=>{const like=[...String(q.or).matchAll(/id\.like\.([^*,]+)\*/g)].map(m=>m[1]);return [...rows.values()].filter(r=>like.some(p=>r.id.startsWith(p)));}};}
async function lessons(){
 const db=table();
 await appendWeeklyReview({school:S,teacher:'Asha Verma',grade:'Grade 2',section:'A',subject:'English',weekStart:'2026-11-23',weekEnd:'2026-11-29',recordIds:['101','103','104'],reviewer:'p@mobile.schoolsuccess.in',reviewerName:'Meera Rao',reviewerRole:'Principal',requestId:'22222222-2222-4222-8222-222222222222',
  review:{planning:{level:'A',note:'Outcomes and checks line up.'},execution:{level:'B',note:'Add a written check.'},focus:'UniqueFocusSentence every day.'}},db.request);
 await appendRubric({recordId:'103',school:S,reviewer:'c@x.test',reviewerName:'Harshit',reviewerRole:'Consultant',requestId:'33333333-3333-4333-8333-333333333333',review:{planning:{level:'A',note:'Good use of mime.'}}},db.request);
 await appendRubric({recordId:'102',school:S,reviewer:'c@x.test',reviewerName:'Harshit',reviewerRole:'Consultant',requestId:'44444444-4444-4444-8444-444444444444',review:{execution:{level:'B',note:'Use fraction strips.'}}},db.request);
 const reviews=await readRubricRows(records.map(r=>String(r.id)),{school:'eq.'+S},db.all);
 const {entries}=await mapLive({records,reviews,notes:[]},'https://media.test');
 return buildLessonRecords(entries,'2026-11-23','2026-11-28',{scope:'planned'});
}
const pdfText=doc=>{const dir=mkdtempSync(join(tmpdir(),'planned-'));try{const f=join(dir,'r.pdf');writeFileSync(f,Buffer.from(doc.output('arraybuffer')));return execFileSync('pdftotext',['-layout',f,'-'],{encoding:'utf8'});}finally{rmSync(dir,{recursive:true,force:true});}};

test('lessons are chosen by planned date and ordered by day, then period',async()=>{
 const list=await lessons();
 assert.deepEqual(list.map(l=>[l.plannedDate,l.dayNumber,l.topic]),[['2026-11-23',1,'Naming words'],['2026-11-23',2,'Halves'],['2026-11-24',1,'Action words'],['2026-11-26',1,'CVC words']],
  'a lesson saved in the dates but planned outside them is left out; one saved on Sunday for Monday is in');
 assert.ok(list.every(l=>l.scope==='planned'));
 assert.equal(list.find(l=>l.topic==='CVC words').submittedAt.slice(0,10),'2026-11-28','its submission date stays on it');
});

test('the PDF index shows the review type and the weekly review once, after its last lesson',async()=>{
 const list=await lessons();
 const text=pdfText(createLessonDocumentationPdf({kind:'teacher',lessons:list,from:'2026-11-23',to:'2026-11-28'})),flat=text.replace(/\s+/g,' ');
 assert.match(flat,/BY PLANNED DATE/);assert.match(flat,/MONDAY 23 NOV/);assert.match(flat,/THURSDAY 26 NOV/);
 assert.match(flat,/Naming words .*Weekly .*Halves .*Period .*Action words .*Weekly \+ Period .*CVC words .*Weekly .*Weekly review · Grade 2 A · English · 23 Nov – 29 Nov 2026 · covers 3 lessons/);
 assert.equal((flat.match(/UniqueFocusSentence/g)||[]).length,1,'the weekly review text is printed once');
 assert.equal((flat.match(/see page \d+/g)||[]).length,2,'the two earlier lessons point to it');
 assert.match(flat,/printed below/);
 assert.match(flat,/Good use of mime/,'a period review stays with its own lesson');
 assert.match(flat,/PLANNED FOR .*PLAN SUBMITTED/);assert.match(flat,/Lessons planned for 23 Nov 2026 – 28 Nov 2026/);
 assert.doesNotMatch(flat,/Revision|Story time/);
});

test('one class and subject (Teacher 360° report): the weekly review is still printed once',async()=>{
 const eng=filterLessons(await lessons(),{subject:'English'});
 const flat=pdfText(createLessonDocumentationPdf({kind:'teacher',lessons:eng,from:'2026-11-23',to:'2026-11-28'})).replace(/\s+/g,' ');
 assert.equal((flat.match(/UniqueFocusSentence/g)||[]).length,1);
 assert.doesNotMatch(flat,/Halves/);
});

test('lessons planned for the dates are read, even when saved before them',()=>{
 const q=recordQuery('2026-11-23','2026-11-28',{role:'admin',allowedSchools:[S]});
 assert.match(q.or,/and\(planned_lesson_on\.gte\.2026-11-23,planned_lesson_on\.lte\.2026-11-28\)/);
});

test('week overview: each lesson says when its plan was submitted against its planned day, and if it is reviewed',async()=>{
 const {planningOf}=await import('../lib/school-success/weekly-review.js');
 const L=(planned,saved,feedback=null)=>({recordId:'1',plannedDate:planned,dayNumber:2,topic:'T',submittedAt:saved,feedback,reviews:feedback?.weekly?[{weekly:{}}]:[]});
 assert.deepEqual([planningOf(L('2026-11-23','2026-11-22T15:10:00.000Z')).timing,planningOf(L('2026-11-23','2026-11-22T20:00:00.000Z')).timing],['ahead','same'],'21:00 UTC on the 22nd is 23 Nov in India');
 const late=planningOf(L('2026-11-24','2026-11-26T05:00:00.000Z',{weekly:{weekStart:'2026-11-23'}}));
 assert.deepEqual([late.timing,late.daysLate,late.reviewed,late.weekly,late.period],['late',2,true,true,2]);
 assert.equal(planningOf(L('2026-11-24','')).timing,null);
});
