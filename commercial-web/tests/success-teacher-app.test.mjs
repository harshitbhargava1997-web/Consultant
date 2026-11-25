// Teacher app (school-link teachers): plan reader sections, date filter, greeting and the Submit button text.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'next/dist/build/swc/index.js';
import {parsePlanText} from '../lib/school-success/plan-text.js';
import {formatReflection} from '../lib/school-success/teacher-flow.js';
import {withPlanning} from '../lib/school-success/planning-guide.js';
const load=(file,from,to,names)=>{const src=readFileSync(new URL(file,import.meta.url),'utf8');const part=src.slice(src.indexOf(from),src.indexOf(to));
 const code=transformSync(part+'\nmodule.exports={'+names.join(',')+'};',{jsc:{parser:{syntax:'ecmascript',jsx:true}},module:{type:'commonjs'}}).code;const m={exports:{}};new Function('module','exports',code)(m,m.exports);return m.exports;};
const app=load('../app/school-success/ui/teacher-app.jsx','const addDays','const classLabel',['weekStart','greeting','todaysLessons']);
const ev=load('../app/school-success/ui/lesson-evidence.jsx','export function submitSummary','// One chosen file',['submitSummary']);

test('a plan saved by the lesson plan form reads back as its sections, with classwork and homework separate',()=>{
 const p=withPlanning({grade:'Grade 2',subject:'English',topic:'LP 15'},{answers:{objective:'Describe a picture.',materials:'Picture chart',teacher:'Model sentences.',student:'Feely bag game.',practice:'Write 3 sentences.',review:'Ask two children.',classwork:'Workbook p. 42'}});
 assert.deepEqual(parsePlanText(p.reflection).map(s=>[s.key,s.text]),[['objective','Describe a picture.'],['materials','Picture chart'],['teacher','Model sentences.'],['student','Feely bag game.'],['practice','Write 3 sentences.'],['review','Ask two children.'],['classwork','Workbook p. 42']]);
});
test('empty sections are skipped and free-form notes are kept unchanged',()=>{
 assert.deepEqual(parsePlanText(formatReflection({objective:'Only this.'})),[{key:'objective',text:'Only this.'}]);
 assert.deepEqual(parsePlanText('Old notes\nsecond line'),[{key:'notes',text:'Old notes\nsecond line'}]);
 assert.deepEqual(parsePlanText(''),[]);
});
test('week start and today\'s lessons (the Home date filters are tested in success-day-periods.test.mjs)',()=>{
 const L=(id,d)=>({id,plannedOn:d,periods:[{}]});
 const summary={today:'2026-11-24',lessons:[L('a','2026-11-24'),L('b','2026-11-23'),L('c','2026-11-21'),L('d','2026-11-02'),L('e','2026-10-30'),L('f','2026-11-25')]};
 assert.equal(app.weekStart('2026-11-24'),'2026-11-23');assert.equal(app.weekStart('2026-11-29'),'2026-11-23');assert.equal(app.weekStart('2026-11-23'),'2026-11-23');
 assert.deepEqual(app.todaysLessons(summary).map(l=>l.id),['a']);
});
test('greeting follows the time of day in English and Hindi',()=>{
 assert.equal(app.greeting(8),'Good morning');assert.equal(app.greeting(14),'Good afternoon');assert.equal(app.greeting(19),'Good evening');
 assert.equal(app.greeting(8,'hi'),'सुप्रभात');
});
test('the Submit button says what will be sent',()=>{
 const f=n=>Array.from({length:n},()=>({}));
 assert.equal(ev.submitSummary({},{}),'Submit classroom evidence');
 assert.equal(ev.submitSummary({a:f(2),b:f(1)},{}),'Submit 3 files');
 assert.equal(ev.submitSummary({a:f(1)},{a:'Went well'}),'Submit 1 file + reflection');
 assert.equal(ev.submitSummary({},{a:'Went well'}),'Submit reflection');
});
