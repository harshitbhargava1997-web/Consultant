import test from 'node:test';import assert from 'node:assert/strict';
import {buildSchoolPortfolio,portfolioTotals,filterPortfolioSchools,filterSchoolEvidence,portfolioExportRows} from '../lib/school-success/school-portfolio.js';
import {school360Fixture,from,to} from './fixtures/school360.js';
test('portfolio includes zero-usage teachers and empty schools without merging same-name teachers across schools',()=>{
 const model=buildSchoolPortfolio(school360Fixture(),from,to),alpha=model.schools.find(s=>s.name==='Alpha School'),beta=model.schools.find(s=>s.name==='Beta School'),empty=model.schools.find(s=>s.name==='Empty School');
 assert.equal(model.schools.length,3);assert.equal(alpha.teachers,2);assert.equal(beta.teachers,2);assert.equal(alpha.withUsage,1);assert.equal(alpha.participation,50);assert.equal(empty.teachers,0);assert.equal(empty.participation,null);
 assert.notEqual(alpha.profiles[0].key,beta.profiles[0].key);assert.equal(alpha.metrics[1].actual,90);assert.equal(beta.metrics[1].actual,12);
 assert.deepEqual(portfolioTotals(model.schools),{schools:3,teachers:4,withUsage:2,files:5,preparations:1,pendingReview:1});
});
test('school targets reuse Teacher 360 calendars and repeated evidence updates count one lesson',()=>{
 const {schools}=buildSchoolPortfolio(school360Fixture(),from,to),alpha=schools[0];
 assert.equal(alpha.days,2);assert.equal(alpha.metrics[0].target,40);assert.equal(alpha.preparations,1);assert.equal(alpha.classroomLessons,1);assert.equal(alpha.files,5);assert.equal(alpha.pendingReview,1);
 const data=school360Fixture();data.entries=data.entries.map(r=>r.recordId==='lesson-1'?{...r,review:'Reviewed carefully'}:r);
 assert.equal(buildSchoolPortfolio(data,from,to).schools[0].pendingReview,0);
});
test('archives are excluded by default and restore to historical report scope only when selected',()=>{
 const data=school360Fixture(),active=buildSchoolPortfolio(data,from,to),historical=buildSchoolPortfolio(data,from,to,{includeArchived:true});
 assert.equal(active.profiles.length,4);assert.equal(historical.profiles.length,6);assert.equal(historical.schools.length,4);assert.equal(historical.schools.find(s=>s.name==='Archived School').metrics[1].actual,100);
});
test('portfolio filters and evidence filters respect school, date, category, teacher and review status',()=>{
 const model=buildSchoolPortfolio(school360Fixture(),from,to),alpha=model.schools[0];
 assert.deepEqual(filterPortfolioSchools(model.schools,{status:'no-usage'}).map(s=>s.name),['Empty School']);
 assert.deepEqual(filterPortfolioSchools(model.schools,{school:'Beta School'}).map(s=>s.name),['Beta School']);
 assert.equal(filterPortfolioSchools(model.schools,{query:'Alpha'}).length,1);
 assert.deepEqual(filterSchoolEvidence(alpha.submissions,{category:'phonics'}).map(r=>r.id),['lesson-1:update-2']);
 assert.equal(filterSchoolEvidence(alpha.submissions,{teacher:'Bina'}).length,0);assert.equal(filterSchoolEvidence(alpha.submissions,{review:'reviewed'}).length,0);
 assert.deepEqual(filterSchoolEvidence(alpha.submissions).map(r=>r.date),[from,'2026-10-23',to]);assert.equal(filterSchoolEvidence(alpha.submissions,{query:'Alpha School'}).length,3);
});
test('CSV summaries preserve time formatting, separate modules and omit disabled sections',()=>{
 const data=school360Fixture(),model=buildSchoolPortfolio(data,from,to),rows=portfolioExportRows(model.schools,model.settings);
 assert.equal(rows[0]['Book usage time'],'1 hr 30 min');assert.equal(rows[0]['E-books time'],'20 min');assert.equal(rows[0]['Additional Materials time'],'15 min');assert.equal(rows[2]['Book usage time'],'0 min');
 assert.deepEqual(Object.keys(rows[0]),Object.keys(rows[2]));assert.ok(!JSON.stringify(rows).includes('media.example'));
 data.reportSettings={...model.settings,quantitative:false,sections:{...model.settings.sections,additional:false,ebooks:false,evidence:false}};
 const reduced=buildSchoolPortfolio(data,from,to),record=portfolioExportRows(reduced.schools,reduced.settings)[0];
 assert.ok(!Object.keys(record).some(k=>/Additional|E-books|targets|\bfiles\b|awaiting review/i.test(k)));
});
