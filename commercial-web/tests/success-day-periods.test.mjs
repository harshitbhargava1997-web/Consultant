// A day planned in several saves is shown as one day with Period 1, 2, 3, 4 (save order) on Home, the Plan screen
// and Add evidence; Home filters by date range, class and subject (owner request, 25 November 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {planDays,periodsOn,planFilterOptions,filterPlanDays,chipRange,weekRange,monthRange,classOf} from '../lib/school-success/day-periods.js';

const P=(grade,section,subject,topic,evidence=false)=>({grade,section,subject,topic,evidence});
// The server lists lessons by planned date, then by first saved record; `order` is that first record.
const lessons=[
 {id:'s-later',plannedOn:'2026-11-25',order:120,resumeToken:'t-later',periods:[P('Grade 4','B','Mathematics','Fractions')]},
 {id:'s-first',plannedOn:'2026-11-25',order:101,resumeToken:'t-first',periods:[P('Grade 2','A','English','CVC words',true),P('Grade 3','B','Hindi','मात्रा'),P('Grade 2','A','EVS','Plants')]},
 {id:'s-mon',plannedOn:'2026-11-23',order:90,resumeToken:'t-mon',periods:[P('Grade 2','A','English','Rhymes')]},
 {id:'s-fri',plannedOn:'2026-11-28',order:130,resumeToken:'t-fri',periods:[P('Grade 2','A','English','Story time')]},
 {id:'s-oct',plannedOn:'2026-10-30',order:50,resumeToken:'t-oct',periods:[P('LKG','Not Applicable','Phonics / Literacy','Letter a')]},
 {id:'s-dec',plannedOn:'2026-12-01',order:140,resumeToken:'t-dec',periods:[P('Grade 2','A','English','Next month')]}
];

test('a day planned in two saves reads Period 1, 2, 3 then Period 4, in save order',()=>{
 const day=periodsOn(lessons,'2026-11-25');
 assert.deepEqual(day.map(x=>[x.number,x.period.subject,x.lesson.resumeToken,x.index]),[[1,'English','t-first',0],[2,'Hindi','t-first',1],[3,'EVS','t-first',2],[4,'Mathematics','t-later',0]]);
 assert.deepEqual(periodsOn(lessons,'2026-11-26'),[]);
 // Without a server order the list order is kept.
 const noOrder=lessons.map(({order,...l})=>l);
 assert.deepEqual(periodsOn(noOrder,'2026-11-25').map(x=>x.number+':'+x.period.subject),['1:Mathematics','2:English','3:Hindi','4:EVS']);
 assert.deepEqual(planDays(lessons).map(d=>d.date),['2026-10-30','2026-11-23','2026-11-25','2026-11-28','2026-12-01']);
});

test('This week is Monday to Sunday (upcoming days included); This month is the whole month',()=>{
 assert.deepEqual(weekRange('2026-11-25'),{from:'2026-11-23',to:'2026-11-29'});
 assert.deepEqual(weekRange('2026-11-29'),{from:'2026-11-23',to:'2026-11-29'},'Sunday belongs to the week that started on Monday');
 assert.deepEqual(monthRange('2026-11-25'),{from:'2026-11-01',to:'2026-11-30'});
 assert.deepEqual(monthRange('2028-02-10'),{from:'2028-02-01',to:'2028-02-29'});
 const dates=f=>filterPlanDays(lessons,chipRange(f,'2026-11-25')).map(d=>d.date);
 assert.deepEqual(dates('today'),['2026-11-25']);
 assert.deepEqual(dates('week'),['2026-11-28','2026-11-25','2026-11-23'],'Friday’s plan shows in This week');
 assert.deepEqual(dates('month'),['2026-11-28','2026-11-25','2026-11-23']);
 assert.deepEqual(filterPlanDays(lessons,chipRange('range','2026-11-25',{from:'2026-12-01',to:'2026-10-01'})).map(d=>d.date),['2026-12-01','2026-11-28','2026-11-25','2026-11-23','2026-10-30'],'reversed dates still work');
});

test('class and subject filters keep each period’s number for the day',()=>{
 const o=planFilterOptions(lessons);
 assert.deepEqual(o.classes,['Grade 2 A','Grade 3 B','Grade 4 B','LKG']);
 assert.deepEqual(o.subjects,['English','EVS','Hindi','Mathematics','Phonics / Literacy']);
 assert.equal(classOf(P('LKG','Not Applicable')),'LKG');
 const maths=filterPlanDays(lessons,{...chipRange('week','2026-11-25'),subject:'Mathematics'});
 assert.deepEqual(maths.map(d=>[d.date,d.periods.map(x=>x.number)]),[['2026-11-25',[4]]],'still Period 4 when filtered');
 const g2=filterPlanDays(lessons,{...chipRange('week','2026-11-25'),cls:'Grade 2 A'});
 assert.deepEqual(g2.map(d=>[d.date,d.periods.map(x=>x.number+':'+x.period.subject)]),[['2026-11-28',['1:English']],['2026-11-25',['1:English','3:EVS']],['2026-11-23',['1:English']]]);
 const both=filterPlanDays(lessons,{...chipRange('month','2026-11-25'),cls:'Grade 2 A',subject:'EVS'});
 assert.deepEqual(both.map(d=>d.date),['2026-11-25']);
 assert.deepEqual(filterPlanDays(lessons,{cls:'Grade 9 Z'}),[]);
 // Each period opens its own plan: lesson token and its position in that lesson.
 const hindi=filterPlanDays(lessons,{subject:'Hindi'})[0].periods[0];
 assert.deepEqual([hindi.lesson.resumeToken,hindi.index,hindi.number],['t-first',1,2]);
});

test('Tomorrow shows only the next day’s periods, numbered as on that day',()=>{
 assert.deepEqual(chipRange('tomorrow','2026-11-25'),{from:'2026-11-26',to:'2026-11-26'});
 assert.deepEqual(chipRange('tomorrow','2026-11-30'),{from:'2026-12-01',to:'2026-12-01'},'month end');
 const tomorrow=filterPlanDays(lessons,chipRange('tomorrow','2026-11-30'));
 assert.deepEqual(tomorrow.map(d=>[d.date,d.periods.map(x=>x.number+':'+x.period.topic)]),[['2026-12-01',['1:Next month']]]);
 assert.deepEqual(filterPlanDays(lessons,chipRange('tomorrow','2026-11-25')),[],'nothing planned for 26 Nov');
});
