// School leader home (redesign, 26 November 2026): date ranges; one card per teacher with their subject weeks
// (reviewed or awaiting) and a "No plan yet" flag; and one Feedback list of weekly and period reviews.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rangeFor,initials,leaderHome,feedbackItems,dayNumbers} from '../lib/school-success/leader-home.js';

test('date ranges: this week from Monday, last week Monday to Saturday, this month, chosen dates in order',()=>{
 assert.deepEqual(rangeFor('week','2026-11-24'),{from:'2026-11-23',to:'2026-11-24'});
 assert.deepEqual(rangeFor('week','2026-11-29'),{from:'2026-11-23',to:'2026-11-29'},'Sunday belongs to the week that started on Monday');
 assert.deepEqual(rangeFor('last','2026-11-24'),{from:'2026-11-16',to:'2026-11-21'});
 assert.deepEqual(rangeFor('month','2026-11-24'),{from:'2026-11-01',to:'2026-11-24'});
 assert.deepEqual(rangeFor('range','2026-11-24',{from:'2026-11-20',to:'2026-11-10'}),{from:'2026-11-10',to:'2026-11-20'});
 assert.deepEqual(rangeFor('range','2026-11-24',{}),{from:'',to:''});
 assert.equal(initials('Meera Rao'),'MR');
});

const weekly={weekStart:'2026-11-23',weekEnd:'2026-11-29',grade:'Grade 2',section:'A',subject:'English',periods:2,review:null};
const W={key:'w1',text:'Weekly review · 23 Nov – 29 Nov 2026 · Grade 2 A · English (2 periods)\n\nPlanning · A\n\nFocus for next week\nExit tickets',date:'2026-11-25T06:00:00.000Z',by:'Meera Rao, Principal',weekly};
const L=o=>({key:o.recordId,school:'S',grade:'Grade 2',section:'A',topic:'Topic '+o.recordId,activities:[],writing:[],remedial:[],portfolio:[],feedback:null,reviews:[],...o});
const lessons=[
 L({recordId:'11',teacher:'Asha',subject:'English',plannedDate:'2026-11-23',activities:[{},{}],feedback:{weekly},reviews:[{...W,notedAt:'2026-11-26T04:00:00.000Z'}]}),
 L({recordId:'12',teacher:'Asha',subject:'English',plannedDate:'2026-11-24',writing:[{}],feedback:{weekly},reviews:[W]}),
 L({recordId:'13',teacher:'Asha',subject:'Hindi',section:'B',grade:'Grade 3',plannedDate:'2026-11-24'}),
 L({recordId:'21',teacher:'Ravi',subject:'Mathematics',grade:'Grade 4',section:'B',plannedDate:'2026-11-24',activities:[{}],feedback:{text:'x'},
  reviews:[{key:'p1',text:'Planning · B\nGood place-value cards.',date:'2026-11-24T10:00:00.000Z',by:'Harshit, School Success',weekly:null,notedAt:''}]}),
 L({recordId:'22',teacher:'Ravi',subject:'Science',grade:'Grade 4',section:'B',plannedDate:'2026-11-24'}),
 L({recordId:'31',teacher:'Meena',subject:'English',plannedDate:'2026-11-18'})];
const roster=['Asha','Ravi','Meena','Sunil'].map(name=>({school:'S',name}));
const week={from:'2026-11-23',to:'2026-11-25'};

test('each teacher shows their subjects for the week, reviewed or awaiting; teachers without a plan are flagged last',()=>{
 const h=leaderHome(lessons,roster,week);
 assert.deepEqual(h.teachers.map(t=>t.name),['Asha','Ravi','Meena','Sunil'],'planners first, then teachers with no plan');
 const asha=h.teachers[0];
 assert.equal(asha.periods,3);assert.equal(asha.reviewed,2);assert.equal(asha.lastDate,'2026-11-24');
 assert.deepEqual(asha.subjects.map(s=>[s.subject,s.periods,s.reviewed,s.done,s.weekly]),[['English',2,2,true,true],['Hindi',1,0,false,false]]);
 assert.equal(asha.subjects[0].week,'2026-11-23');
 assert.equal(asha.subjects[0].group,JSON.stringify(['Grade 2','A','English']),'the same key the weekly review screen uses');
 const meena=h.teachers.find(t=>t.name==='Meena');
 assert.equal(meena.periods,0);assert.equal(meena.lastPlan,'2026-11-18');
 assert.equal(h.teachers.find(t=>t.name==='Sunil').lastPlan,'');
 assert.equal(h.planned,2);assert.equal(h.staff,4);assert.equal(h.files,4);
 assert.equal(h.subjects,4);assert.equal(h.awaiting,2,'Hindi (Asha) and Science (Ravi)');
 assert.deepEqual([h.next.teacher,h.next.subject,h.next.week],['Asha','Hindi','2026-11-23'],'"Review now" opens the first subject awaiting review');
 assert.equal(h.multiWeek,false);
});

test('over several weeks a subject is listed once per week, newest week first',()=>{
 const h=leaderHome(lessons,roster,{from:'2026-11-16',to:'2026-11-25'});
 assert.equal(h.multiWeek,true);
 const meena=h.teachers.find(t=>t.name==='Meena');
 assert.deepEqual(meena.subjects.map(s=>[s.subject,s.week]),[['English','2026-11-16']]);
 assert.equal(h.planned,3);
});

test('a teacher on a lesson but missing from the roster is still shown',()=>{
 const h=leaderHome(lessons,roster.filter(r=>r.name!=='Ravi'),week);
 assert.ok(h.teachers.some(t=>t.name==='Ravi'));
});

test('feedback lists weekly and period reviews separately; a weekly review is listed once with its noted date',()=>{
 const items=feedbackItems(lessons,week);
 assert.deepEqual(items.map(i=>[i.type,i.teacher,i.title]),[['weekly','Asha','Weekly review'],['period','Ravi','Period 1 · 24 Nov 2026']]);
 const [w,p]=items;
 assert.equal(w.detail,'Grade 2 A · English · 23 Nov – 29 Nov 2026 · 2 periods');
 assert.equal(w.text,'Planning · A\n\nFocus for next week\nExit tickets','the heading is shown once, not inside the text');
 assert.equal(w.notedAt,'2026-11-26T04:00:00.000Z','noted on one covered period counts for the weekly review');
 assert.deepEqual([w.week,w.group],['2026-11-23',JSON.stringify(['Grade 2','A','English'])],'"Open week" goes to this subject\'s week');
 assert.equal(p.detail,'Grade 4 B · Mathematics · Topic 21');assert.equal(p.by,'Harshit, School Success');assert.equal(p.day,'2026-11-24');
});

test('feedback filters: review type, teacher, subject, noted, and review date',()=>{
 assert.deepEqual(feedbackItems(lessons,week,{type:'weekly'}).map(i=>i.teacher),['Asha']);
 assert.deepEqual(feedbackItems(lessons,week,{type:'period'}).map(i=>i.teacher),['Ravi']);
 assert.deepEqual(feedbackItems(lessons,week,{teacher:'Ravi'}).map(i=>i.type),['period']);
 assert.deepEqual(feedbackItems(lessons,week,{subject:'English'}).map(i=>i.type),['weekly']);
 assert.deepEqual(feedbackItems(lessons,week,{noted:'noted'}).map(i=>i.teacher),['Asha']);
 assert.deepEqual(feedbackItems(lessons,week,{noted:'waiting'}).map(i=>i.teacher),['Ravi']);
 assert.equal(feedbackItems(lessons,{from:'2026-11-26',to:'2026-11-30'}).length,0,'reviews given before these dates are not listed');
});

test('period numbers follow save order on each teacher\'s day',()=>{
 const n=dayNumbers(lessons);
 assert.equal(n.get('12'),1);assert.equal(n.get('13'),2);assert.equal(n.get('21'),1);assert.equal(n.get('22'),2);
});

test('the principal home no longer repeats the old lists, and has the four bottom tabs',()=>{
 const src=readFileSync(new URL('../app/school-success/ui/leader-app.jsx',import.meta.url),'utf8');
 for(const gone of ['New evidence to review','Lesson plans</h3>','Feedback given','No plan yet</h3>'])assert.ok(!src.includes(gone),gone+' removed');
 for(const tab of ["'This week'","'Day'","'Weekly'","'Feedback'"])assert.ok(src.includes(tab),tab+' tab');
 assert.match(src,/No plan yet/,'shown as a flag on the teacher');
 assert.match(src,/Weekly reviews<\/option>/);assert.match(src,/Period reviews<\/option>/);
});
