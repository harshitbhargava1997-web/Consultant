import test from 'node:test';
import assert from 'node:assert/strict';
import {formatClosure} from '../lib/closure-reflection.js';
import {submissionSchema,submissionRecords} from '../lib/school-success/teacher-submissions.js';
import {assertEvidenceMatches} from '../lib/school-success/lesson-workflow.js';
import {filesSchema} from '../lib/teacher-portal/domain.js';
import {buildProfiles,defaultReportSettings,reportSettingsSchema} from '../lib/school-success/reports.js';
import {fileCategory} from '../lib/school-success/school-portfolio.js';
import {splitStoredFiles} from '../lib/report-sequence.js';
const id='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222';
test('closure accepts partial prompts without inventing answers',()=>{
 assert.equal(formatClosure({}),'');
 assert.equal(formatClosure({achievement:'  Children blended ab.  '}),'Did students achieve the learning outcome, and what went well in your class?\nChildren blended ab.');
});
test('closure files append through existing evidence workflow without replacing preparation audio or text',()=>{
 const s=submissionSchema.parse({id,school:'School',teacher:'Teacher',date:'2026-11-01',periods:[{id:periodId,grade:'LKG',subject:'English',topic:'VC blending',reflection:'Original preparation'}],files:[{id,periodId,category:'closure',name:'After-class-reflection.pdf',size:100}]});
 assertEvidenceMatches({...s,files:[]},s);
 const [row]=submissionRecords(s,'actor','https://storage.example');
 assert.equal(row.lesson_reflection,'Original preparation');assert.equal(row.Voice_Note_Link,'');assert.match(row.Video_Evidence_1,/\/closure\//);
 assert.equal(filesSchema.parse(s.files)[0].category,'closure');
 assert.throws(()=>assertEvidenceMatches({...s,files:[]},{...s,periods:[{...s.periods[0],id}]}),/original lesson/);
});
test('closure report files stay distinct and do not inflate classroom activity KPI',()=>{
 const file={column:'Video_Evidence_1',url:'https://storage.example/closure/file.pdf'};
 const [p]=buildProfiles([{id,kind:'submission',school:'School',teacher:'Teacher',date:'2026-11-01',files:[file]}],[],'2026-11-01','2026-11-01',defaultReportSettings);
 assert.equal(p.evidence[0].actual,0);assert.equal(p.closures.length,1);assert.equal(fileCategory(file),'closure');
 assert.deepEqual(splitStoredFiles([file]).map(g=>g.label),['After-class reflections']);
 const old=structuredClone(defaultReportSettings);delete old.sections.closure;
 assert.equal(reportSettingsSchema.parse(old).sections.closure,true);
});
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createReportPdf} from '../lib/school-success/report-pdf.js';
import {createSchoolPortfolioPdf} from '../lib/school-success/school-portfolio-pdf.js';
import {buildSchoolPortfolio} from '../lib/school-success/school-portfolio.js';
test('Teacher and School 360 PDF controls omit closure headings and links when disabled',()=>{
 const entries=[{id,kind:'submission',school:'School',teacher:'Teacher',date:'2026-11-01',grade:'LKG',subject:'English',topic:'VC blending',files:[{column:'Video_Evidence_1',url:'https://storage.example/closure/file.pdf'}]}];
 const settings=structuredClone(defaultReportSettings),profiles=buildProfiles(entries,[],'2026-11-01','2026-11-01',settings);
 const dir=mkdtempSync(join(tmpdir(),'closure-'));
 const extract=pdf=>{const path=join(dir,'report.pdf');writeFileSync(path,Buffer.from(pdf.output('arraybuffer')));return execFileSync('pdftotext',[path,'-'],{encoding:'utf8'});};
 try{
 assert.match(extract(createReportPdf(profiles,'2026-11-01','2026-11-01',settings)),/After-class reflections/);
 settings.sections.closure=false;
 assert.doesNotMatch(extract(createReportPdf(profiles,'2026-11-01','2026-11-01',settings)),/After-class reflections/);
 const model=buildSchoolPortfolio({entries,roster:[{school:'School',name:'Teacher'}],reportSettings:settings},'2026-11-01','2026-11-01');
 const options={...model,from:'2026-11-01',to:'2026-11-01',detail:true,includeEvidence:true};
 assert.match(extract(createSchoolPortfolioPdf(options)),/After-class reflections/);
 assert.doesNotMatch(extract(createSchoolPortfolioPdf({...options,options:{categories:{closure:false}}})),/After-class reflections/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

import {closurePrompts,CLOSURE_RECORDING_SLOT,closureRecordingAttachment} from '../lib/closure-reflection.js';
import {classroomEvidenceCategories} from '../lib/classroom-evidence.js';
import {lessonFromRows} from '../lib/school-success/lesson-workflow.js';
import {reportEvidenceGroups} from '../lib/report-sequence.js';
test('two reflections retain outcome review and remedial planning in the saved text',()=>{
 assert.equal(closurePrompts.length,2);
 const text=formatClosure({achievement:'बच्चों ने लक्ष्य प्राप्त किया।',nextStep:'Support Riya with blending practice.'});
 assert.match(text,/Did students achieve the learning outcome/);assert.match(text,/बच्चों ने लक्ष्य प्राप्त किया/);
 assert.match(text,/Which students need support/);assert.match(text,/Support Riya/);
});
test('re-recording closure audio replaces only the pending recording and retains uploaded evidence',()=>{
 const work={id:'work',category:'writing',file:new File(['work'],'student.pdf')};
 const first=closureRecordingAttachment([work],new File(['first'],'After-class-reflection.webm'),'recording-id');
 const next=closureRecordingAttachment(first,new File(['second'],'After-class-reflection.m4a'),'new-id');
 assert.equal(next.length,2);assert.equal(next[0],work);assert.equal(next[1].id,'recording-id');assert.equal(next[1].category,'closure');assert.equal(next[1].slot,CLOSURE_RECORDING_SLOT);assert.equal(next[1].file.name,'After-class-reflection.m4a');
});
test('remedial support survives upload validation, saved-lesson reload and report links without inflating activity counts',()=>{
 assert.deepEqual(Object.keys(classroomEvidenceCategories),['activity','writing','remedial','portfolio']);
 const s=submissionSchema.parse({id,school:'School',teacher:'Teacher',date:'2026-11-01',periods:[{id:periodId,grade:'LKG',subject:'English',topic:'VC blending',reflection:'Original preparation'}],files:[{id,periodId,category:'remedial',name:'Blending-support.pdf',size:100}]});
 assert.equal(filesSchema.parse(s.files)[0].category,'remedial');
 assertEvidenceMatches({...s,files:[]},s);
 const [row]=submissionRecords(s,'actor','https://storage.example');assert.match(row.Video_Evidence_1,/\/remedial\//);
 const saved=lessonFromRows([{...row,planned_lesson_on:s.date,lesson_stage:'evidence_submitted',lesson_version:1}]);
 assert.equal(saved.files[0].category,classroomEvidenceCategories.remedial);
 const file={column:'Video_Evidence_1',url:row.Video_Evidence_1};
 const [profile]=buildProfiles([{id,kind:'submission',school:'School',teacher:'Teacher',date:s.date,files:[file]}],[],s.date,s.date,defaultReportSettings);
 assert.equal(profile.evidence[0].actual,0);assert.equal(profile.remedials.length,1);assert.equal(fileCategory(file),'remedial');
 assert(reportEvidenceGroups(profile).some(group=>group.label.startsWith('Remedial')&&group.files[0].url===file.url));
 assert.equal(splitStoredFiles([file])[0].label,'Remedial plans / support shared with students');
 // Previously saved categories remain valid, even though they are no longer upload choices.
 for(const category of ['closure','lesson_plan','phonics','event_pictures'])assert.equal(submissionSchema.parse({...s,files:[{...s.files[0],category}]}).files[0].category,category);
});
