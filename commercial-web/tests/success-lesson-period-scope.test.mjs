import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords,filterLessons,lessonSummary} from '../lib/school-success/lesson-records.js';
import {createLessonDocumentationPdf} from '../lib/school-success/lesson-report-pdf.js';
import {buildSchoolPortfolio} from '../lib/school-success/school-portfolio.js';
import {buildProfiles,defaultReportSettings} from '../lib/school-success/reports.js';
import {raw,rawRecords,reviews,url,base,from,to} from './fixtures/lesson-records.mjs';

// Period under test: 20–31 Oct 2026 (IST). Teacher "Chitra" at Alpha School.
const A='Alpha School',T='Chitra',common={Center:A,Institution:A,FullName:T,Role:'teacher',Type:'Classroom Reflection',Duration_Min:0,lesson_version:2,Grade:'Grade 4',Section:'A',Subject:'English'};
const f=(id,cat,name)=>url(A,T,'d','s'+id,'p'+id,cat,name);
const lesson=(id,{prep,events=[],prepFiles={},topic='Topic '+id})=>({...common,id,Book:topic,submission_id:'s'+id,lesson_period_id:'p'+id,planned_lesson_on:prep.slice(0,10),preparation_saved_at:prep,submitted_at:prep,
 implementation_date:prep.slice(0,10),StartTime:prep.slice(0,10)+'T00:00:00',lesson_stage:events.length?'evidence_submitted':'preparation_saved',lesson_reflection:'Why — learning objective\nObjective for '+id,materials_notes:'',
 Voice_Note_Link:(prepFiles.voice||[]).map(n=>f(id,'voice',n)).join(','),Lesson_Plan_Picture:(prepFiles.plan||[]).map(n=>f(id,'lesson_plan',n)).join(','),
 Video_Evidence_1:'',Writing_Sample_Link:'',
 lesson_evidence_history:events.map((e,i)=>({id:'e'+id+'-'+i,at:e.at,conductedOn:e.at.slice(0,10),files:{Video_Evidence_1:(e.activity||[]).map(n=>f(id,'activity',n)).join(','),Writing_Sample_Link:(e.writing||[]).map(n=>f(id,'writing',n)).join(',')}}))});
const extra=[
 // Prepared in the period; one upload in the period, two after it (one only just after IST midnight on 31 Oct).
 lesson(301,{prep:'2026-10-28T05:00:00',prepFiles:{voice:['v301.wav']},events:[{at:'2026-10-30T06:00:00',activity:['oct.jpg']},{at:'2026-10-31T19:00:00',activity:['boundary-late.jpg']},{at:'2026-11-03T06:00:00',activity:['nov.jpg'],writing:['nov-w.jpg']}]}),
 // Prepared before the period; evidence inside it (one only just after IST midnight on 20 Oct).
 lesson(302,{prep:'2026-09-25T05:00:00',prepFiles:{voice:['sep.wav'],plan:['sep-plan.pdf']},events:[{at:'2026-10-19T19:00:00',activity:['boundary-early.jpg']},{at:'2026-10-22T06:00:00',activity:['act-oct.jpg']}]}),
 // Entirely after the period.
 lesson(303,{prep:'2026-11-05T05:00:00',events:[{at:'2026-11-06T06:00:00',activity:['later.jpg']}]}),
 // A file first sent before the period and re-sent inside it.
 lesson(304,{prep:'2026-10-05T05:00:00',events:[{at:'2026-10-06T06:00:00',activity:['resend.jpg']},{at:'2026-10-25T06:00:00',activity:['resend.jpg']}]})
];
const extraReviews=[{record_id:'301',school:A,teacher:T,status:'Reviewed',feedback:'Reviewed in November.',reviewer:'x@example.test',updated_at:'2026-11-04T06:00:00+00:00'},{record_id:'302',school:A,teacher:T,status:'Reviewed',feedback:'Reviewed in October.',reviewer:'x@example.test',updated_at:'2026-10-23T06:00:00+00:00'}];
const input=()=>({...raw(),records:[...rawRecords(),...extra],reviews:[...reviews,...extraReviews],roster:[...raw().roster,{school:A,name:T}]});
const entriesP=mapLive(input(),base).then(m=>m.entries);
const chitra=JSON.stringify([A,T]);
const names=list=>list.map(x=>x.url.split('/').pop());
const pdfText=doc=>{const dir=mkdtempSync(join(tmpdir(),'scope-pdf-'));try{const p=join(dir,'r.pdf');writeFileSync(p,Buffer.from(doc.output('arraybuffer')));return execFileSync('pdftotext',['-layout',p,'-'],{encoding:'utf8'});}finally{rmSync(dir,{recursive:true,force:true});}};
const uris=doc=>[...doc.output().matchAll(/\/URI \(([^)]*)\)/g)].map(m=>m[1].split('/').pop());

test('evidence and reviews submitted after the period are excluded from the period view and disclosed',async()=>{
 const lessons=filterLessons(buildLessonRecords(await entriesP,from,to),{teacher:chitra}),l=lessons.find(x=>x.recordId==='301');
 assert.deepEqual(names(l.activities),['oct.jpg']);assert.deepEqual(l.writing,[]);
 assert.deepEqual(names(l.audio),['v301.wav']);
 assert.equal(l.feedback,null);assert.equal(l.reviewOutsidePeriod,true);
 assert.equal(l.outsidePeriodFiles,3,'boundary-late.jpg (1 Nov IST), nov.jpg and nov-w.jpg');
 assert.equal(l.activities[0].label,'Classroom activity 1');
 assert.equal(l.conductedOn,'2026-10-30','taught date comes from in-period activity only');
 assert.equal(buildLessonRecords(await entriesP,from,to,{scope:'all'}).find(x=>x.recordId==='301').conductedOn,'2026-11-03');
});

test('the complete-history view of the same lesson includes everything with stable labels',async()=>{
 const l=buildLessonRecords(await entriesP,from,to,{scope:'all'}).find(x=>x.recordId==='301');
 assert.deepEqual(l.activities.map(x=>[x.label,x.url.split('/').pop()]),[['Classroom activity 1','oct.jpg'],['Classroom activity 2','boundary-late.jpg'],['Classroom activity 3','nov.jpg']]);
 assert.deepEqual(names(l.writing),['nov-w.jpg']);
 assert.equal(l.feedback.text,'Reviewed in November.');assert.equal(l.outsidePeriodFiles,0);assert.equal(l.reviewOutsidePeriod,false);
 assert.throws(()=>buildLessonRecords([],from,to,{scope:'everything'}),/Unknown/);
});

test('a lesson prepared before the period appears for its in-period evidence without its earlier files',async()=>{
 const l=buildLessonRecords(await entriesP,from,to).find(x=>x.recordId==='302');
 assert.ok(l,'included because evidence was submitted in the period');
 assert.equal(l.planSubmittedInPeriod,false);
 assert.deepEqual(l.plan.fields.map(x=>x.text),['Objective for 302'],'lesson plan text is always shown');
 assert.deepEqual(l.planFiles,[]);assert.deepEqual(l.audio,[]);
 assert.deepEqual(names(l.activities),['boundary-early.jpg','act-oct.jpg'],'20 Oct 00:30 IST is inside the period');
 assert.equal(l.feedback.text,'Reviewed in October.');assert.equal(l.outsidePeriodFiles,2);
});

test('lessons with no activity in the period are excluded; re-sent files count once with their original date',async()=>{
 const lessons=buildLessonRecords(await entriesP,from,to);
 assert.equal(lessons.some(l=>l.recordId==='303'),false);
 const resent=lessons.find(l=>l.recordId==='304');
 assert.deepEqual(names(resent.activities),['resend.jpg']);assert.equal(resent.activities[0].addedOn,'2026-10-06');assert.equal(resent.outsidePeriodFiles,0);
 assert.equal(buildLessonRecords(await entriesP,'2026-11-01','2026-11-30').some(l=>l.recordId==='303'),true);
});

test('period counts agree with the existing School 360° and Teacher 360° calculations',async()=>{
 const entries=await entriesP,lessons=buildLessonRecords(entries,from,to);
 const model=buildSchoolPortfolio({entries,roster:input().roster,directory:{archives:[]}},from,to),alpha=model.schools.find(s=>s.name===A);
 const alphaLessons=filterLessons(lessons,{school:A});
 const files=new Set(alphaLessons.flatMap(l=>[l.planFiles,l.activities,l.writing,l.audio,l.reflections,l.additional].flat().map(x=>x.url)));
 assert.equal(files.size,alpha.files,'unique files match School 360°');
 assert.equal(lessonSummary(alphaLessons).plansSubmitted,alpha.preparations,'lesson plans match School 360° prepared lessons');
 const profile=buildProfiles(entries,input().roster,from,to,defaultReportSettings).find(p=>p.school===A&&p.name===T);
 const mine=filterLessons(lessons,{teacher:chitra}),summary=lessonSummary(mine);
 assert.equal(summary.activities,profile.evidence[1].actual,'classroom activities match Teacher 360°');
 assert.equal(summary.writing,profile.evidence[2].actual,'student written work matches Teacher 360°');
});

test('consolidated PDFs state the period rule and exclude out-of-period files; complete history is per lesson only',async()=>{
 const entries=await entriesP,period=filterLessons(buildLessonRecords(entries,from,to),{teacher:chitra});
 const doc=createLessonDocumentationPdf({kind:'teacher',lessons:period,from,to}),text=pdfText(doc),links=uris(doc);
 assert.match(text,/appear only when they were submitted or recorded in this period/);
 assert.match(text,/Outside this reporting period: 3 files and the Academic Review/);
 for(const name of ['nov.jpg','nov-w.jpg','boundary-late.jpg','sep.wav','sep-plan.pdf','later.jpg'])assert.ok(!links.includes(name),name);
 for(const name of ['oct.jpg','boundary-early.jpg','act-oct.jpg','resend.jpg','v301.wav'])assert.ok(links.includes(name),name);
 assert.doesNotMatch(text,/Reviewed in November/);assert.match(text,/Reviewed in October/);
 const full=filterLessons(buildLessonRecords(entries,from,to,{scope:'all'}),{teacher:chitra});
 assert.throws(()=>createLessonDocumentationPdf({kind:'teacher',lessons:full,from,to}),/selected period only/);
 const one=createLessonDocumentationPdf({kind:'lesson',lessons:[full.find(l=>l.recordId==='301')],from,to}),oneText=pdfText(one);
 assert.match(oneText,/Complete lesson history/);assert.match(oneText,/Reviewed in November/);
 assert.ok(['nov.jpg','nov-w.jpg','boundary-late.jpg'].every(n=>uris(one).includes(n)));
 const scoped=pdfText(createLessonDocumentationPdf({kind:'lesson',lessons:[period.find(l=>l.recordId==='301')],from,to}));
 assert.match(scoped,/Reporting period/);assert.match(scoped,/Outside this reporting period/);
});
