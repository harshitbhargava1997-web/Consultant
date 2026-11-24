// School leader dashboard: date ranges, and who planned / what needs review / feedback given, by teacher and subject.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'next/dist/build/swc/index.js';
const src=readFileSync(new URL('../app/school-success/ui/leader-app.jsx',import.meta.url),'utf8');
const part=src.slice(src.indexOf('const addDays'),src.indexOf('function evidenceLine'));
const code=transformSync(part+'\nmodule.exports={rangeFor,leaderView,initials,MAX_RANGE_DAYS};',{jsc:{parser:{syntax:'ecmascript',jsx:true}},module:{type:'commonjs'}}).code;
const m={exports:{}};new Function('module','exports',code)(m,m.exports);const {rangeFor,leaderView,initials}=m.exports;

test('date ranges: this week from Monday, last week Monday to Saturday, this month, chosen dates in order',()=>{
 assert.deepEqual(rangeFor('week','2026-11-24'),{from:'2026-11-23',to:'2026-11-24'});
 assert.deepEqual(rangeFor('week','2026-11-29'),{from:'2026-11-23',to:'2026-11-29'},'Sunday belongs to the week that started on Monday');
 assert.deepEqual(rangeFor('last','2026-11-24'),{from:'2026-11-16',to:'2026-11-21'});
 assert.deepEqual(rangeFor('month','2026-11-24'),{from:'2026-11-01',to:'2026-11-24'});
 assert.deepEqual(rangeFor('range','2026-11-24',{from:'2026-11-20',to:'2026-11-10'}),{from:'2026-11-10',to:'2026-11-20'});
 assert.deepEqual(rangeFor('range','2026-11-24',{}),{from:'',to:''});
});

const L=(o)=>({key:o.teacher+o.topic,recordId:'1',school:'S',grade:'Grade 2',section:'A',activities:[],writing:[],additional:[],feedback:null,feedbackNoted:null,reviewOutsidePeriod:false,...o});
const roster=['Asha','Ravi','Meena','Sunil'].map(name=>({school:'S',name}));
const lessons=[
 L({teacher:'Asha',subject:'English',topic:'LP 15',plannedDate:'2026-11-24',activities:[{},{}],writing:[{}]}),
 L({teacher:'Asha',subject:'English',topic:'LP 14',plannedDate:'2026-11-23',activities:[{}],feedback:{text:'Planning · A',date:'2026-11-24T06:00:00Z'},feedbackNoted:{notedAt:'2026-11-24T07:00:00Z',all:true}}),
 L({teacher:'Sunil',subject:'Mathematics',topic:'LP 9',plannedDate:'2026-11-23'}),
 L({teacher:'Meena',subject:'English',topic:'LP 3',plannedDate:'2026-11-24',feedback:{text:'Execution · B',date:'2026-11-24T08:00:00Z'}})];
const earlier=[...lessons,L({teacher:'Ravi',subject:'Mathematics',topic:'LP 7',plannedDate:'2026-11-19'})];

test('the dashboard counts planners, evidence, reviews, and lists what needs review and who has not planned',()=>{
 const v=leaderView(lessons,roster,{},earlier);
 assert.equal(v.teachers,4);assert.equal(v.planned,3);assert.equal(v.files,4);assert.equal(v.reviewed,2);
 assert.deepEqual(v.toReview.map(l=>l.topic),['LP 15'],'evidence without feedback; lessons without evidence are not listed');
 assert.deepEqual(v.noPlan,[{name:'Ravi',lastPlan:'2026-11-19'}]);
 assert.deepEqual(v.feedback.map(l=>l.topic),['LP 3','LP 14'],'newest feedback first');
 assert.deepEqual(v.lessons.map(l=>l.topic),['LP 15','LP 3','LP 14','LP 9'],'newest lesson first, then teacher name');
});

test('teacher and subject filters narrow every list, including who has not planned',()=>{
 const asha=leaderView(lessons,roster,{teacher:'Asha'},earlier);
 assert.equal(asha.teachers,1);assert.equal(asha.planned,1);assert.deepEqual(asha.noPlan,[]);assert.equal(asha.lessons.length,2);
 const maths=leaderView(lessons,roster,{subject:'Mathematics'},earlier);
 assert.deepEqual(maths.lessons.map(l=>l.teacher),['Sunil']);
 assert.deepEqual(maths.noPlan.map(t=>t.name),['Asha','Meena','Ravi'],'no Maths plan this week');
 assert.equal(maths.noPlan.find(t=>t.name==='Ravi').lastPlan,'2026-11-19','last Maths plan');
 assert.equal(maths.noPlan.find(t=>t.name==='Asha').lastPlan,'','Asha has no Maths plan');
 assert.equal(initials('Meera Rao'),'MR');
});
