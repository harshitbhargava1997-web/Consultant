import test from 'node:test';
import assert from 'node:assert/strict';
import {groupLessonRows,lessonReportFiles,visionLessonRows} from '../lib/lesson-groups.js';
import {buildProfiles,defaultReportSettings} from '../lib/school-success/reports.js';
const base={kind:'submission',school:'A',teacher:'Teacher',grade:'LKG',subject:'English',topic:'Blending',plannedDate:'2026-10-20',recordId:'one'};
const rows=[{...base,id:'one:update2',date:'2026-10-23',conductedOn:'2026-10-21',stage:'evidence_submitted',files:[{url:'https://example.com/photo2',column:'Video_Evidence_1'}]},{...base,id:'one:prep',date:'2026-10-19',stage:'preparation_saved',files:[{url:'https://example.com/plan',column:'Lesson_Plan_Picture'}]},{...base,id:'one:update1',date:'2026-10-21',conductedOn:'2026-10-21',stage:'evidence_submitted',files:[{url:'https://example.com/photo1',column:'Video_Evidence_1'}]},{...base,recordId:'different',id:'different',date:'2026-10-22',files:[]}];
test('same-titled lessons stay distinct while preparation and repeated updates retain their explicit association',()=>{
 const [profile]=buildProfiles(rows,[],'2026-10-19','2026-10-23',defaultReportSettings),lessons=profile.lessonGroups[0].subjects[0].lessons;
 assert.equal(lessons.length,2);const own=lessons.find(l=>l.rows.length===3);assert.equal(own.date,'2026-10-20');
 assert.deepEqual(lessonReportFiles(own,defaultReportSettings).map(f=>f.url),['https://example.com/plan','https://example.com/photo1','https://example.com/photo2']);
 for(const lessonPlan of [true,false])for(const evidence of [true,false]){const settings=structuredClone(defaultReportSettings);Object.assign(settings.sections,{lessonPlan,evidence});const files=lessonReportFiles(own,settings);assert.equal(files.filter(f=>f.stage==='Lesson preparation').length,lessonPlan?1:0);assert.equal(files.filter(f=>f.stage==='Classroom evidence').length,evidence?2:0);}
});
test('grade, subject and date order is stable across input order and missing metadata is explicit',()=>{
 const input=[{...base,id:'a',grade:'Grade 10'},{...base,id:'b',grade:'Grade 2'},{...base,id:'c',subject:'Hindi'},{...base,id:'d',grade:'Nursery'},{...base,id:'e',grade:'',subject:''},{...base,id:'f'}].map(({recordId,...r})=>r);
 const a=groupLessonRows(input),b=groupLessonRows(input.slice().reverse());assert.deepEqual(a,b);assert.deepEqual(a.map(g=>g.grade),['Nursery','LKG','Grade 2','Grade 10','Grade not recorded']);
 assert.deepEqual(a[1].subjects.map(s=>s.subject),['English','Hindi']);
});
test('Vision periods and teachers keep separate lesson identities even when titles and dates match',()=>{
 const periods=[{id:'a',grade:'LKG',subject:'Reading',topic:'Same'},{id:'b',grade:'UKG',subject:'Writing',topic:'Same'}];
 const grouped=groupLessonRows(visionLessonRows([{id:'lesson1',planned_on:'2026-10-20',periods},{id:'lesson2',planned_on:'2026-10-20',periods}]));assert.equal(grouped.length,2);assert.equal(grouped[0].subjects[0].lessons.length,2);
});
