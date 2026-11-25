// Lesson records and the lesson documentation PDF use the same evidence categories, in the same order, as
// Teacher 360° "Teacher evidence"; previous-portal items come last and are labelled as such.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {buildLessonRecords,lessonSummary,visibleLessonSections,lessonEvidenceFiles,optionalLessonSections} from '../lib/school-success/lesson-records.js';
import {buildProfiles,defaultReportSettings,evidenceNames} from '../lib/school-success/reports.js';
import {createLessonDocumentationPdf} from '../lib/school-success/lesson-report-pdf.js';
const S='Sunrise Public School',T='Asha Verma',M='https://media.example.test/schools/S/teachers/A/2026-11-03/submission_s/implementation_p';
const f=(column,path)=>({key:column+':'+path,column,url:M+'/'+path,name:column,category:column});
const row=(id,date,stage,files,extra={})=>({kind:'submission',id,recordId:'501',school:S,teacher:T,date,grade:'Grade 2',section:'A',subject:'English',topic:'Naming words',plannedDate:'2026-11-03',reflection:'Why — learning objective\nName objects',materials:'',stage,feedStage:stage==='preparation_saved'?'Lesson preparation':'Classroom evidence',files,review:'',...extra});
const entries=[
 row('501:preparation','2026-11-03','preparation_saved',[f('Voice_Note_Link','voice/v1.webm')]),
 row('501:e1','2026-11-04','evidence_submitted',[f('Video_Evidence_1','activity/a1.jpg'),f('Video_Evidence_2','activity/a2.jpg'),f('Writing_Sample_Link','writing/w1.jpg'),f('Video_Evidence_3','remedial/r1.pdf'),f('Portfolio_Evidence_Link','portfolio/p1.pdf'),f('Video_Evidence_1','closure/c1.pdf'),f('Phonics_Evidence_Link','phonics/ph1.jpg')])
];
const pdfText=doc=>{const dir=mkdtempSync(join(tmpdir(),'cat-'));try{const file=join(dir,'r.pdf');writeFileSync(file,Buffer.from(doc.output('arraybuffer')));return execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});}finally{rmSync(dir,{recursive:true,force:true});}};

test('the section list follows the Teacher evidence categories, then the review, then the previous portal',()=>{
 assert.deepEqual(optionalLessonSections.map(([,l])=>l),['Classroom activities','Student written work','Remedial support','After-class reflections','Student portfolio / assessment','Academic Review','Audio recordings (previous portal)','Other evidence (previous portal)']);
 assert.deepEqual(evidenceNames.slice(1),['Classroom activities','Student written work','Remedial support','After-class reflections','Student portfolio / assessment']);
});

test('lesson records count each category exactly as Teacher 360° does',()=>{
 const [lesson]=buildLessonRecords(entries,'2026-11-01','2026-11-30'),s=lessonSummary([lesson]);
 const [p]=buildProfiles(entries,[{school:S,name:T}],'2026-11-01','2026-11-30',defaultReportSettings);
 const teacher360=Object.fromEntries(p.evidence.map(e=>[e.label,e.actual]));
 assert.deepEqual({activities:s.activities,writing:s.writing,remedial:s.remedial,reflections:s.reflections,portfolio:s.portfolio},
  {activities:teacher360['Classroom activities'],writing:teacher360['Student written work'],remedial:teacher360['Remedial support'],reflections:teacher360['After-class reflections'],portfolio:teacher360['Student portfolio / assessment']});
 assert.deepEqual([s.activities,s.writing,s.remedial,s.reflections,s.portfolio,s.audio],[2,1,1,1,1,1]);
 assert.equal(lesson.additional.length,1,'phonics evidence from the previous portal');
 assert.equal(lessonEvidenceFiles(lesson).length,8,'every file is still included once for report access');
});

test('a saved "Further classroom evidence" choice still applies to remedial support and portfolio',()=>{
 const [lesson]=buildLessonRecords(entries,'2026-11-01','2026-11-30');
 const v=visibleLessonSections(lesson,{additional:false});
 assert.equal(v.remedial,false);assert.equal(v.portfolio,false);assert.equal(v.additional,false);
 const own=visibleLessonSections(lesson,{additional:false,remedial:true,portfolio:true});
 assert.equal(own.remedial,true);assert.equal(own.portfolio,true);
});

test('the lesson documentation PDF shows the same summary and sections, previous-portal items last',()=>{
 const [lesson]=buildLessonRecords(entries,'2026-11-01','2026-11-30');
 const text=pdfText(createLessonDocumentationPdf({kind:'teacher',lessons:[lesson],from:'2026-11-01',to:'2026-11-30'}));
 const summary=text.slice(0,text.indexOf('About this report'.toUpperCase())>0?text.indexOf('ABOUT THIS REPORT'):text.indexOf('About this report'));
 for(const label of ['Classroom activities','Student written work','Remedial support','After-class reflections','Student portfolio /','Lessons with Academic'])assert.ok(summary.includes(label),label);
 assert.ok(!/Teacher reflections|Classroom activity files/.test(text));
 const heading=h=>text.indexOf(h.toUpperCase());
 const order=['Classroom activities','Student written work','Remedial support','After-class reflections','Student portfolio / assessment','Audio recordings (previous portal)','Other evidence (previous portal)'].map(heading);
 assert.ok(order.every(i=>i>0),JSON.stringify(order));
 assert.deepEqual([...order].sort((a,b)=>a-b),order);
});
