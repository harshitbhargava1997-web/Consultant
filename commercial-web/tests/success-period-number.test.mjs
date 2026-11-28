// Real period number (owner decision, 28 November 2026): the teacher chooses which period of the day (1–8) a lesson
// is taught in; P-numbers everywhere follow it. Older plans keep the save order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {periodNumberOf,assignPeriodNumbers,nextFreePeriod,periodNumberText} from '../lib/school-success/period-number.js';
import {withPlanning,planText,planSubmissions} from '../lib/school-success/planning-guide.js';
import {periodTypeOf} from '../lib/school-success/period-types.js';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords,parseLessonPlan} from '../lib/school-success/lesson-records.js';
import {parsePlanText} from '../lib/school-success/plan-text.js';
import {weekGroups,planningOf} from '../lib/school-success/weekly-review.js';
import {dayNumbers,feedbackItems} from '../lib/school-success/leader-home.js';
import {planDays} from '../lib/school-success/day-periods.js';
import {createLessonDocumentationPdf} from '../lib/school-success/lesson-report-pdf.js';

const S='Sunrise Public School',A='Asha Verma';
const text=(n,type='regular',answers={objective:'Children add 2-digit numbers.'})=>withPlanning({grade:'Grade 3',section:'B',subject:'Mathematics',topic:'T'},{periodNumber:n,periodType:type,answers,answerLanguage:'en'}).reflection;
const rec=(id,reflection,subject,topic,date='2026-12-01')=>({id,Type:'Classroom Reflection',Center:S,Institution:S,FullName:A,Grade:'Grade 3',Section:'B',Subject:subject,Book:topic,submission_id:'s'+id,lesson_period_id:'p'+id,planned_lesson_on:date,preparation_saved_at:'2026-11-28T14:00:00',lesson_stage:'preparation_saved',lesson_reflection:reflection,StartTime:date+'T00:00:00'});
// Saved in this order: English (weekly plan, Period 4), Hindi (Period 2), an older plan without a number, Maths (Period 5).
const records=[rec(11,text(4),'English','Opposites'),rec(12,text(2),'Hindi','मात्रा'),rec(13,'Why — learning objective\nOld plan','EVS','Plants'),rec(14,text(5,'remedial',{children:'6',support:'Sticks'}),'Mathematics','Carrying')];
async function lessons(){const {entries}=await mapLive({records},'https://media.test');return buildLessonRecords(entries,'2026-12-01','2026-12-01',{scope:'planned'});}

test('the period number is saved first in the plan text and read back', () => {
 assert.match(text(4),/^Period number\n4\n\nWhy — learning objective\n/);
 assert.match(text(5,'remedial',{children:'6',support:'S'}),/^Period number\n5\n\nPeriod type\nRemedial class\n/);
 assert.doesNotMatch(text(undefined),/Period number/,'no number chosen: unchanged plan text');
 assert.equal(periodNumberOf(text(7)),7);assert.equal(periodNumberOf('Period number\n9\n\nX'),0,'only 1–8');assert.equal(periodNumberOf('Why — learning objective\nPeriod number 4'),0);
 assert.equal(periodTypeOf(text(5,'remedial',{})),'remedial','the period type is still read');
 const plan=parseLessonPlan(text(4));assert.equal(plan.periodNumber,4);assert.deepEqual(plan.fields.map(f=>f.key),['objective']);assert.equal(plan.notes,'');
 assert.deepEqual(parsePlanText(text(4)).map(s=>s.key),['objective'],'the teacher\'s plan reader shows no "Period number" section');
 assert.equal(periodNumberText(3),'Period number\n3');assert.equal(periodNumberText(0),'');
});

test('numbering: chosen numbers kept, older plans take the free numbers in save order', () => {
 const items=[{id:'a',n:4},{id:'b',n:0},{id:'c',n:2},{id:'d',n:0}],m=assignPeriodNumbers(items,x=>x.n);
 assert.deepEqual(items.map(x=>m.get(x)),[4,1,2,3]);
 assert.deepEqual((()=>{const xs=[{n:0},{n:0}],r=assignPeriodNumbers(xs,x=>x.n);return xs.map(x=>r.get(x));})(),[1,2],'old days unchanged');
 assert.equal(nextFreePeriod([1,2,4]),3);assert.equal(nextFreePeriod([1,2,3,4,5,6,7,8]),0);
});

test('weekly plan: each day takes "Usually period" unless changed; daily plan keeps each block\'s number', () => {
 const day=(date,extra={})=>withPlanning({id:crypto.randomUUID(),submissionId:crypto.randomUUID(),date,topic:'LP',answers:{objective:'O'},answerLanguage:'en',...extra},{});
 const subs=planSubmissions({type:'weekly',shared:{grade:'Grade 2',section:'A',subject:'English',periodNumber:4},blocks:[day('2026-11-30'),day('2026-12-04',{periodNumber:6})],school:S,teacher:A});
 assert.deepEqual(subs.map(s=>periodNumberOf(s.periods[0].reflection)),[4,6]);
 assert.ok(subs.every(s=>!('periodNumber' in s.periods[0])&&!('autoNumber' in s.periods[0])),'only the plan text carries the number');
 const daily=planSubmissions({type:'daily',date:'2026-12-01',shared:{submissionId:crypto.randomUUID()},blocks:[day('',{periodNumber:3,autoNumber:true,grade:'Grade 3',subject:'Hindi'}),day('',{periodNumber:1,grade:'Grade 3',subject:'English'})],school:S,teacher:A});
 assert.deepEqual(daily[0].periods.map(p=>periodNumberOf(p.reflection)),[3,1]);
});

test('lesson records, Week overview, day-wise review and principal feedback use the real period', async () => {
 const list=await lessons();
 assert.deepEqual(list.map(l=>[l.subject,l.dayNumber]),[['EVS',1],['Hindi',2],['English',4],['Mathematics',5]],'planned PDF order follows the timetable');
 const g=weekGroups(list,[],'2026-12-01');
 const all=g.groups.flatMap(x=>x.lessons).map(l=>[l.subject,planningOf(l).period]).sort((a,b)=>a[1]-b[1]);
 assert.deepEqual(all,[['EVS',1],['Hindi',2],['English',4],['Mathematics',5]]);
 const nums=dayNumbers(list);assert.deepEqual(list.map(l=>nums.get(l.key)),[1,2,4,5]);
 const reviewed=list.map(l=>l.subject==='English'?{...l,reviews:[{key:'r1',date:'2026-12-01T10:00:00Z',text:'Good',by:{name:'Meera Rao',role:'Principal'}}]}:l);
 assert.match(feedbackItems(reviewed,{from:'2026-12-01',to:'2026-12-01'})[0].title,/^Period 4 · /);
});

test('teacher Home and Evidence: periods listed by their real number', () => {
 const lessons=[
  {id:'w1',plannedOn:'2026-12-01',order:11,periods:[{grade:'Grade 2',subject:'English',topic:'Opposites',number:4}]},
  {id:'d1',plannedOn:'2026-12-01',order:12,periods:[{grade:'Grade 3',subject:'Hindi',topic:'मात्रा',number:2},{grade:'Grade 3',subject:'EVS',topic:'Plants',number:0}]}];
 const [day]=planDays(lessons);
 assert.deepEqual(day.periods.map(x=>[x.number,x.period.subject,x.index]),[[1,'EVS',1],[2,'Hindi',0],[4,'English',0]]);
});

test('lesson PDF shows the real period', async () => {
 const list=await lessons(),dir=mkdtempSync(join(tmpdir(),'pnum-'));
 try{const f=join(dir,'p.pdf');writeFileSync(f,Buffer.from(createLessonDocumentationPdf({kind:'teacher',lessons:list,from:'2026-12-01',to:'2026-12-01'}).output('arraybuffer')));
  const t=execFileSync('pdftotext',['-layout',f,'-'],{encoding:'utf8'}).replace(/\s+/g,' ');
  assert.match(t,/PERIOD 4 Opposites/);assert.match(t,/P5 Carrying/);assert.doesNotMatch(t,/Period number/i);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
