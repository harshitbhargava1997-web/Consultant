// Type of class period (owner decision, 28 November 2026): regular lesson, remedial class, substitute class.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {withPlanning,planningIssue,guideFor} from '../lib/school-success/planning-guide.js';
import {periodTypeOf} from '../lib/school-success/period-types.js';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords,parseLessonPlan} from '../lib/school-success/lesson-records.js';
import {evidenceFiles} from '../lib/school-success/lesson-plan-items.js';
import {reviewSummary} from '../lib/school-success/review-summary.js';
import {buildProfiles,defaultReportSettings} from '../lib/school-success/reports.js';
import {submissionStats} from '../lib/school-success/school-portfolio.js';
import {leaderHome} from '../lib/school-success/leader-home.js';
import {weekGroups,planningOf} from '../lib/school-success/weekly-review.js';
import {createLessonDocumentationPdf} from '../lib/school-success/lesson-report-pdf.js';
import {parsePlanText} from '../lib/school-success/plan-text.js';

const S='Sunrise Public School';
const plan=(type,answers)=>withPlanning({grade:'Grade 3',section:'B',subject:'Mathematics',topic:'T'},{periodType:type,answers}).reflection;
const rec=(id,reflection,topic)=>({id,Type:'Classroom Reflection',Center:S,Institution:S,FullName:'Asha Verma',Grade:'Grade 3',Section:'B',Subject:'Mathematics',Book:topic,submission_id:'s'+id,lesson_period_id:'p'+id,planned_lesson_on:'2026-12-01',preparation_saved_at:'2026-11-30T14:00:00',lesson_stage:'preparation_saved',lesson_reflection:reflection,StartTime:'2026-12-01T00:00:00'});
async function lessons(){
 const records=[rec(1,plan('regular',{objective:'Add 2-digit numbers.'}),'Addition'),rec(2,plan('remedial',{children:'6 children',support:'Bundle sticks into tens.'}),'Carrying in addition'),rec(3,plan('substitute',{done:'Read the story aloud.'}),'Story reading')];
 const {entries}=await mapLive({records},'https://media.test');
 return {entries,list:buildLessonRecords(entries,'2026-12-01','2026-12-01',{scope:'planned'})};
}

test('the plan form saves the type with short answers; regular plans are unchanged',()=>{
 assert.equal(plan('remedial',{children:'6',support:'Sticks',objective:'not saved'}),'Period type\nRemedial class\n\nChildren in this group\n6\n\nSupport activity\nSticks');
 assert.equal(plan('substitute',{done:'Read aloud.'}),'Period type\nSubstitute class\n\nWhat was done in this class\nRead aloud.');
 assert.doesNotMatch(plan('regular',{objective:'X'}),/Period type/);
 assert.deepEqual([periodTypeOf(plan('remedial',{})),periodTypeOf(plan('substitute',{})),periodTypeOf('Why — learning objective\nX'),periodTypeOf('')],['remedial','substitute','regular','regular']);
 assert.deepEqual(guideFor('remedial').map(g=>g[0]),['children','support']);assert.deepEqual(guideFor('substitute').map(g=>g[0]),['done']);assert.equal(guideFor('regular').length,7);
 assert.equal(planningIssue({grade:'Grade 3',subject:'Mathematics',topic:'T',periodType:'substitute',answers:{}}),'','class, subject and topic are enough');
});

test('lessons carry their type, and the plan shows the short answers',async()=>{
 const {list}=await lessons();
 assert.deepEqual(list.map(l=>[l.dayNumber,l.periodType]),[[1,'regular'],[2,'remedial'],[3,'substitute']]);
 assert.deepEqual(list[1].plan.fields.map(f=>[f.label,f.text]),[['Children in this group','6 children'],['Support activity','Bundle sticks into tens.']]);
 assert.equal(parseLessonPlan(plan('substitute',{done:'Read.'})).fields[0].label,'What was done in this class');
 assert.deepEqual(parsePlanText(plan('remedial',{children:'6',support:'S'})).map(s=>s.key),['periodType','children','support'],'the teacher\'s plan reader');
});

test('Teacher 360° and School 360°: a remedial plan counts under Remedial support, a substitute class not at all',async()=>{
 const {entries}=await lessons(),rows=entries.filter(e=>e.stage==='preparation_saved'||e.feedStage==='Lesson preparation');
 const items=id=>evidenceFiles(rows.find(r=>String(r.recordId)===String(id)));
 assert.ok(items(1).some(f=>f.lessonPlan));assert.ok(items(2).some(f=>f.remedialPlan&&f.category==='remedial')&&!items(2).some(f=>f.lessonPlan));assert.equal(items(3).length,0);
 const [p]=buildProfiles(entries,[{school:S,name:'Asha Verma'}],'2026-11-30','2026-12-01',defaultReportSettings); // Teacher 360° counts plans by the day they were saved
 const ev=Object.fromEntries(p.evidence.map(e=>[e.label,e.actual]));
 assert.equal(ev['Lesson plans submitted'],1);assert.equal(ev['Remedial support'],1);
 const stats=submissionStats(entries.filter(e=>e.kind==='submission'));
 assert.equal(stats.categories.preparation,1);assert.equal(stats.categories.remedial,1);
 const r=reviewSummary(entries);assert.equal(r.lessons,2,'a substitute class is not counted for review');
});

test('review screens: substitutes are never awaiting review or part of a weekly review',async()=>{
 const {list}=await lessons();
 const h=leaderHome(list,[{school:S,name:'Asha Verma'}],{from:'2026-11-30',to:'2026-12-05'});
 assert.equal(h.teachers[0].periods,2);assert.equal(h.awaiting,1);
 const g=weekGroups(list,[],'2026-12-01').groups[0];
 assert.deepEqual(g.lessons.map(l=>planningOf(l).periodType),['regular','remedial','substitute']);
 assert.equal(planningOf(g.lessons[2]).period,3);
});

test('lesson PDF names remedial and substitute periods',async()=>{
 const {list}=await lessons();
 const dir=mkdtempSync(join(tmpdir(),'ptype-'));
 try{const f=join(dir,'r.pdf');writeFileSync(f,Buffer.from(createLessonDocumentationPdf({kind:'teacher',lessons:list,from:'2026-12-01',to:'2026-12-01'}).output('arraybuffer')));
  const text=execFileSync('pdftotext',['-layout',f,'-'],{encoding:'utf8'}).replace(/\s+/g,' ');
  assert.match(text,/Remedial class/);assert.match(text,/Substitute class/);assert.match(text,/Story reading .*Substitute/);
  assert.match(text,/PERIOD 2 · REMEDIAL CLASS/i);assert.match(text,/Children in this group/);assert.match(text,/What was done in this/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
