// Week overview and the "Academic reviews" sections of the Teacher 360° and School 360° PDFs (owner decision,
// 26 November 2026). A lesson counts as reviewed when it has a single-period or a weekly review.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {appendWeeklyReview,readRubricRows,appendRubric} from '../lib/school-success/lesson-review-store.js';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords} from '../lib/school-success/lesson-records.js';
import {weekOverview} from '../lib/school-success/weekly-review.js';
import {reviewSummary,reviewSummaryByTeacher} from '../lib/school-success/review-summary.js';
import {buildProfiles,defaultReportSettings} from '../lib/school-success/reports.js';
import {createReportPdf} from '../lib/school-success/report-pdf.js';
import {buildSchoolPortfolio} from '../lib/school-success/school-portfolio.js';
import {createSchoolPortfolioPdf} from '../lib/school-success/school-portfolio-pdf.js';

const S='Sunrise Public School';
function table(){const rows=new Map();
 const request=async(path,method='GET',body)=>{if(method==='POST'){const out=[];for(const r of [].concat(body))if(!rows.has(r.id)){rows.set(r.id,{...r});out.push({id:r.id});}return out;}return [];};
 const all=async(_t,_o,q)=>{const like=[...String(q.or).matchAll(/id\.like\.([^*,]+)\*/g)].map(m=>m[1]);return [...rows.values()].filter(r=>like.some(p=>r.id.startsWith(p)));};
 return {request,all};}
const rec=(id,teacher,date,grade,section,subject)=>({id,Type:'Classroom Reflection',Center:S,Institution:S,FullName:teacher,Grade:grade,Section:section,Subject:subject,Book:'Topic '+id,submission_id:'s'+id,lesson_period_id:'p'+id,planned_lesson_on:date,preparation_saved_at:date+'T03:00:00',lesson_stage:'preparation_saved',lesson_reflection:'Why — learning objective\nx',StartTime:date+'T00:00:00'});
const records=[rec(110,'Asha Verma','2026-11-25','Grade 4','B','Mathematics'),rec(101,'Asha Verma','2026-11-23','Grade 2','A','English'),rec(102,'Asha Verma','2026-11-24','Grade 2','A','English'),rec(103,'Asha Verma','2026-11-24','Grade 3','B','Hindi'),
 rec(201,'Ravi Kumar','2026-11-25','Grade 4','B','Mathematics'),rec(202,'Ravi Kumar','2026-11-26','Grade 4','B','Mathematics')];
async function setup(){
 const db=table();
 await appendWeeklyReview({school:S,teacher:'Asha Verma',grade:'Grade 2',section:'A',subject:'English',weekStart:'2026-11-23',weekEnd:'2026-11-29',recordIds:['101','102'],reviewer:'c@x.test',reviewerName:'Harshit',reviewerRole:'Consultant',requestId:'22222222-2222-4222-8222-222222222222',
  review:{planning:{level:'A',note:'Clear outcomes.'},execution:{level:'B',note:'Add a written check.'},focus:'Exit tickets daily.'}},db.request);
 await appendWeeklyReview({school:S,teacher:'Ravi Kumar',grade:'Grade 4',section:'B',subject:'Mathematics',weekStart:'2026-11-23',weekEnd:'2026-11-29',recordIds:['202'],reviewer:'c@x.test',reviewerName:'Harshit',reviewerRole:'Consultant',requestId:'44444444-4444-4444-8444-444444444444',review:{planning:{level:'B',note:'Ok.'},focus:'Place-value cards.'}},db.request);
 await appendRubric({recordId:'201',school:S,reviewer:'p@mobile.schoolsuccess.in',reviewerName:'Meera Rao',reviewerRole:'Principal',requestId:'33333333-3333-4333-8333-333333333333',review:{planning:{level:'B',note:'Good start.'}}},db.request);
 const reviews=await readRubricRows(records.map(r=>String(r.id)),{school:'eq.'+S},db.all);
 const {entries}=await mapLive({records,reviews,notes:[],roster:[{school:S,name:'Asha Verma'},{school:S,name:'Ravi Kumar'},{school:S,name:'Neha Singh'}]},'https://media.test');
 return {reviews,entries};
}

test('week overview: each teacher’s class-and-subject weeks with periods, periods reviewed and weekly review status',async()=>{
 const {reviews,entries}=await setup();
 const v=weekOverview(buildLessonRecords(entries,'0001-01-01','9999-12-31',{scope:'all'}),reviews,'2026-11-26');
 assert.deepEqual([v.from,v.to],['2026-11-23','2026-11-29']);
 assert.deepEqual(v.teachers.map(t=>[t.teacher,t.groups.map(g=>[g.subject,g.periods,g.reviewedPeriods,g.weeklyReviewed])]),[
  ['Asha Verma',[['English',2,2,true],['Hindi',1,0,false],['Mathematics',1,0,false]]],['Ravi Kumar',[['Mathematics',2,2,true]]]],'Ravi’s Grade 4 B Mathematics weekly review never marks Asha’s Grade 4 B Mathematics');
});

test('review summary: reviewed one by one or by a weekly review; weekly reviews listed once with ratings and focus',async()=>{
 const {entries}=await setup();
 const asha=reviewSummary(entries.filter(r=>r.teacher==='Asha Verma'));
 assert.deepEqual([asha.lessons,asha.reviewed,asha.awaiting,asha.single,asha.weeklyCovered],[4,2,2,0,2]);
 assert.equal(asha.weekly.length,1);
 assert.deepEqual(asha.weekly[0],{...asha.weekly[0],week:'23 Nov – 29 Nov 2026',cls:'Grade 2 A · English',periods:2,by:'Harshit, Consultant',planning:'A · Strong practice',execution:'B · Developing',focus:'Exit tickets daily.'});
 const byTeacher=reviewSummaryByTeacher(entries,['Neha Singh']);
 assert.deepEqual(byTeacher.map(t=>[t.teacher,t.lessons,t.reviewed,t.awaiting,t.weekly.length]),[['Asha Verma',4,2,2,1],['Neha Singh',0,0,0,0],['Ravi Kumar',2,2,0,1]]);
});

const pdfText=doc=>{const dir=mkdtempSync(join(tmpdir(),'rev-'));try{const f=join(dir,'r.pdf');writeFileSync(f,Buffer.from(doc.output('arraybuffer')));return execFileSync('pdftotext',['-layout',f,'-'],{encoding:'utf8'});}finally{rmSync(dir,{recursive:true,force:true});}};

test('Teacher 360° PDF: Academic reviews on the school page and each teacher page',async()=>{
 const {entries}=await setup(),roster=[{school:S,name:'Asha Verma'},{school:S,name:'Ravi Kumar'}];
 const profiles=buildProfiles(entries,roster,'2026-11-23','2026-11-29',defaultReportSettings);
 const text=pdfText(createReportPdf(profiles,'2026-11-23','2026-11-29',defaultReportSettings)).replace(/[ \t]+/g,' ');
 assert.match(text,/Academic reviews/);
 assert.match(text,/Asha Verma 4 2 2 1/,'school page: lessons, reviewed, awaiting, weekly reviews');
 assert.match(text,/Ravi Kumar 2 2 0 1/);
 assert.match(text,/23 Nov – 29 Nov/);assert.match(text,/Exit tickets daily\./);assert.match(text,/A · Strong/);
 
 const off=structuredClone(defaultReportSettings);off.sections.evidence=false;
 assert.doesNotMatch(pdfText(createReportPdf(profiles,'2026-11-23','2026-11-29',off)),/Academic reviews/,'follows the evidence section setting');
});

test('School 360° PDF: Academic reviews for the school and by teacher, with weekly reviews',async()=>{
 const {entries}=await setup(),roster=[{school:S,name:'Asha Verma'},{school:S,name:'Ravi Kumar'},{school:S,name:'Neha Singh'}];
 const model=buildSchoolPortfolio({entries,roster,directory:{archives:[]}},'2026-11-23','2026-11-29');
 const text=pdfText(createSchoolPortfolioPdf({schools:model.schools,from:'2026-11-23',to:'2026-11-29',settings:model.settings,detail:true})).replace(/[ \t]+/g,' ');
 assert.match(text,/Academic reviews/);assert.match(text,/Sunrise Public School 6 4 2 2/,'school: lessons, reviewed, awaiting, weekly reviews');
 assert.match(text,/Academic reviews by teacher/);assert.match(text,/Neha Singh 0 0 0 0 0/);
 assert.match(text,/Weekly reviews/);assert.match(text,/Exit tickets daily\./);
});
