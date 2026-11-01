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
 assert.equal(formatClosure({achievement:'  Children blended ab.  '}),'What did students learn or achieve?\nChildren blended ab.');
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
