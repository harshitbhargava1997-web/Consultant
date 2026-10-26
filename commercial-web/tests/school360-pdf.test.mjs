import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {school360Fixture,from,to} from './fixtures/school360.js';import {buildSchoolPortfolio} from '../lib/school-success/school-portfolio.js';import {createSchoolPortfolioPdf} from '../lib/school-success/school-portfolio-pdf.js';
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
