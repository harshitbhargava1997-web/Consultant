import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {school360Fixture,from,to} from './fixtures/school360.js';import {buildSchoolPortfolio,portfolioPdfSettings,portfolioComparison} from '../lib/school-success/school-portfolio.js';import {createSchoolPortfolioPdf} from '../lib/school-success/school-portfolio-pdf.js';
function extract(options){const dir=mkdtempSync(join(tmpdir(),'school360-'));try{const file=join(dir,'report.pdf');writeFileSync(file,Buffer.from(createSchoolPortfolioPdf(options).output('arraybuffer')));return execFileSync('pdftotext',['-layout',file,'-'],{encoding:'utf8'});}finally{rmSync(dir,{recursive:true,force:true});}}
test('portfolio PDF includes every school and quantitative totals without evidence appendix or observations',()=>{
 const data=school360Fixture(),model=buildSchoolPortfolio(data,from,to),text=extract({...model,from,to,includeEvidence:true,includeObservations:true,rawObservations:data.entries});
 for(const value of ['Alpha School','Beta School','Empty School','1 hr 30 min','20 min','15 min'])assert.ok(text.includes(value),value);
 assert.ok(!text.includes('Open submitted file'));assert.ok(!text.includes('Observation marker'));
});
test('school PDF adds ordered evidence links and independent selected observations',()=>{
 const data=school360Fixture(),model=buildSchoolPortfolio(data,from,to),options={schools:[model.schools[0]],settings:model.settings,from,to,detail:true,includeEvidence:true,rawObservations:data.entries};
 const text=extract(options),order=['Lesson preparation PDFs','Audio recordings','Classroom activities','Writing samples','Phonics evidence'];for(let i=1;i<order.length;i++)assert.ok(text.indexOf(order[i-1])<text.indexOf(order[i]),order[i]);
 assert.ok(!text.includes('Observation marker'));assert.ok(extract({...options,includeObservations:true}).includes('Observation marker'));assert.ok(!text.includes('Beta School'));
});
test('disabled report sections and benchmarks disappear from school PDF',()=>{
 const model=buildSchoolPortfolio(school360Fixture(),from,to),settings={...model.settings,quantitative:false,sections:{...model.settings.sections,additional:false,ebooks:false,lessonPlan:false,evidence:false}};
 const text=extract({schools:model.schools,settings,from,to});assert.ok(!/Additional Materials|E-books|Lesson preparation|usage targets|Unique files|Awaiting review/.test(text));assert.ok(text.includes('Book usage'));
});
test('School 360 export choices independently exclude modules, counts and file categories without changing defaults',()=>{
 const data=school360Fixture(),model=buildSchoolPortfolio(data,from,to),before=JSON.stringify(model.settings);
 const options={modules:{book:false,additional:false,ebooks:false,lessonPlan:false},targets:false,counts:{preparations:false,classroomLessons:false,files:false,teachersWithFiles:false,pendingReview:false},categories:{preparation:false,audio:false,activity:false,writing:false,phonics:true}};
 const settings=portfolioPdfSettings(model.settings,options),text=extract({schools:[model.schools[0]],settings,options,from,to,detail:true,includeEvidence:true});
 for(const absent of ['Book usage','Lesson preparation','Additional Materials','E-books','Prepared lessons','Classroom lessons with evidence','Unique files','Unique uploaded files','Audio recordings','Writing samples','Classroom activities','usage targets'])assert.ok(!text.includes(absent),absent);
 assert.ok(text.includes('Phonics evidence'));assert.equal(JSON.stringify(model.settings),before);
});
test('period comparison keeps dates beneath periods, isolates current school scope and handles no previous usage',()=>{
 const model=buildSchoolPortfolio(school360Fixture(),from,to),comparison={schools:[],from:'2026-10-01',to:'2026-10-10'};
 const text=extract({schools:[model.schools[0]],settings:model.settings,from,to,comparison});
 for(const value of ['Period comparison','Previous period','Current period','2026-10-01 to 2026-10-10','2026-10-22 to 2026-10-24','+1 hr 30 min','0 sessions','Prepared lessons comparison'])assert.ok(text.includes(value),value);
 assert.ok(!text.includes('Beta School'));assert.equal(portfolioComparison(model.schools,[])[0].previous,null);
 assert.throws(()=>createSchoolPortfolioPdf({...model,from,to,comparison:{...comparison,to:from}}),/must not overlap/);
});
