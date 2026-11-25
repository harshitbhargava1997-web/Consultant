// Lesson plans are counted from the lesson records, not from files. Older plans (saved with a generated PDF)
// must count exactly as before; new plans (saved without a PDF) must count the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {buildProfiles,defaultReportSettings} from '../lib/school-success/reports.js';
import {buildSchoolPortfolio,filterSchoolEvidence,submissionStats} from '../lib/school-success/school-portfolio.js';
import {evidenceFiles,isGeneratedPreparationPdf,isLessonPlanRecord} from '../lib/school-success/lesson-plan-items.js';
const require=createRequire(import.meta.url),entries=require('./fixtures/plan-count-entries.cjs');
const S='Sunrise Public School',roster=['Asha Verma','Ravi Kumar','Meena Shah'].map(name=>({school:S,name}));
const view=newLessons=>{
 const e=entries({newLessons}),profiles=buildProfiles(e,roster,'2026-11-01','2026-11-30',defaultReportSettings);
 const s=buildSchoolPortfolio({entries:e,roster,directory:{archives:[]},reportSettings:defaultReportSettings},'2026-11-01','2026-11-30').schools[0];
 return {plans:Object.fromEntries(profiles.map(p=>[p.name,p.evidence[0].actual])),activities:Object.fromEntries(profiles.map(p=>[p.name,p.evidence[1].actual])),
  school:{prepared:s.preparations,planItems:s.categories.preparation,files:s.files,teachersWithFiles:s.teachersWithFiles,classroomLessons:s.classroomLessons,planFilterRows:filterSchoolEvidence(s.submissions,{category:'preparation'}).length},profiles,s};
};

test('older lessons count exactly as before this change (numbers recorded from the previous code)',()=>{
 const v=view(false);
 assert.deepEqual(v.plans,{'Asha Verma':2,'Meena Shah':4,'Ravi Kumar':1});
 assert.deepEqual(v.activities,{'Asha Verma':1,'Meena Shah':0,'Ravi Kumar':0});
 assert.deepEqual(v.school,{prepared:4,planItems:7,files:8,teachersWithFiles:3,classroomLessons:1,planFilterRows:5});
});

test('new lesson plans saved without a PDF are counted in Teacher 360° and School 360°',()=>{
 const v=view(true);
 assert.deepEqual(v.plans,{'Asha Verma':3,'Meena Shah':4,'Ravi Kumar':2});
 assert.deepEqual(v.school,{prepared:6,planItems:9,files:9,teachersWithFiles:3,classroomLessons:2,planFilterRows:7},'saved plans count as lesson plans, not as uploaded files');
 // Every prepared lesson in the period gives exactly one plan item, plus uploaded plan photos/documents.
 const asha=v.profiles.find(p=>p.name==='Asha Verma').evidence[0].files;
 assert.equal(asha.length,3);
 assert.deepEqual(asha.filter(f=>f.lessonPlan).map(f=>[f.recordId,f.url]),[['301','']],'the new plan: one item, no file link');
 assert.equal(asha.filter(f=>isGeneratedPreparationPdf(f.url)).length,2,'older plans keep their PDF links');
});

test('a plan that already has a plan file is left as it was; a plan never counts twice',()=>{
 const rows=entries({newLessons:false});
 const both=rows.find(r=>r.id==='104:preparation');
 assert.equal(evidenceFiles(both),both.files,'older plan with its PDF and an uploaded document: unchanged');
 const older=rows.find(r=>r.id==='101:preparation');
 assert.equal(evidenceFiles(older),older.files,'older plan with its PDF: unchanged');
 // A plan saved with only an uploaded plan file (any file name) also stays as it was.
 const uploaded={...older,files:[{key:'Lesson_Plan_Picture:9:0',column:'Lesson_Plan_Picture',url:'https://media.test/plan.pdf'}]};
 assert.equal(evidenceFiles(uploaded),uploaded.files);
 const legacy=rows.find(r=>r.id==='201');
 assert.ok(!isLessonPlanRecord(legacy));assert.equal(evidenceFiles(legacy),legacy.files,'previous-portal rows are unchanged');
 // A new plan with no written text still counts as one saved plan.
 const blank={...rows.find(r=>r.id==='103:preparation'),files:[]};
 assert.equal(evidenceFiles(blank).filter(f=>f.lessonPlan).length,1);
 // Only saved lesson plans get a plan item: classroom evidence rows do not.
 assert.equal(evidenceFiles(rows.find(r=>r.id==='101:e1')).some(f=>f.lessonPlan),false);
});

test('plans outside the report dates are not counted',()=>{
 const stats=submissionStats(entries({newLessons:true}).filter(r=>r.date>='2026-11-01'));
 assert.equal(stats.categories.preparation,9);
 const v=view(true);assert.ok(!v.profiles.some(p=>p.evidence[0].files.some(f=>f.recordId==='105')));
});

test('saving a lesson plan no longer builds or uploads a PDF',()=>{
 const src=fs.readFileSync(new URL('../app/school-success/ui/teacher-portal.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(src,/preparation-pdf|preparationPdf|evidence\/upload/);
 assert.match(src,/action: 'prepare', mode: 'preparation', submission \}/);
});

test('School 360° PDF lists new plans as saved plans (text) next to older plan files',async()=>{
 const {createSchoolPortfolioPdf}=await import('../lib/school-success/school-portfolio-pdf.js');
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{execFileSync}=await import('node:child_process');
 const v=view(true),dir=mkdtempSync(join(tmpdir(),'plans-'));
 try{
  const file=join(dir,'school.pdf');
  writeFileSync(file,Buffer.from(createSchoolPortfolioPdf({schools:[v.s],from:'2026-11-01',to:'2026-11-30',settings:defaultReportSettings,detail:true,includeEvidence:true}).output('arraybuffer')));
  const text=execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});
  assert.match(text,/Lesson plans/);
  assert.equal((text.match(/Saved plan \(text\)/g)||[]).length,2,'the two new plans');
  assert.ok((text.match(/Open file/g)||[]).length>=5,'older plan PDFs and uploaded plan photos keep their links');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
