import test from 'node:test';import assert from 'node:assert/strict';
import {chronologicalRows,reportEvidenceGroups,splitStoredFiles} from '../lib/report-sequence.js';
import {buildProfiles,defaultReportSettings} from '../lib/school-success/reports.js';
test('flat reports and history follow dates while keeping same-day preparation before its evidence',()=>{
 const rows=[{id:'last',date:'2026-10-23'},{id:'evidence',date:'2026-10-22',stage:'evidence_submitted'},{id:'prep',date:'2026-10-22',stage:'preparation_saved'},{id:'first',date:'2026-10-21'}];
 assert.deepEqual(chronologicalRows(rows).map(r=>r.id),['first','prep','evidence','last']);assert.equal(rows[0].id,'last');
 assert.deepEqual(chronologicalRows([{id:2,planned_on:'2026-10-23'},{id:1,planned_on:'2026-10-21'}]).map(r=>r.id),[1,2]);
});
test('stored lesson PDFs and audio are separate report lists without changing evidence KPI counts',()=>{
 const rows=[{id:'later',kind:'submission',school:'School',teacher:'Teacher',date:'2026-10-23',files:[{column:'Voice_Note_Link',url:'https://example.com/audio2'}]},{id:'earlier',kind:'submission',school:'School',teacher:'Teacher',date:'2026-10-21',files:[{column:'Lesson_Plan_Picture',url:'https://example.com/plan'},{column:'Voice_Note_Link',url:'https://example.com/audio1'},{column:'Video_Evidence_1',url:'https://example.com/activity'}]}];
 const [p]=buildProfiles(rows,[],'2026-10-21','2026-10-23',defaultReportSettings),groups=reportEvidenceGroups(p);assert.equal(p.evidence[2].actual,3);
 assert.deepEqual(groups.find(g=>g.label==='Lesson preparation PDFs').files.map(f=>f.url),['https://example.com/plan']);assert.deepEqual(groups.find(g=>g.label==='Audio recordings').files.map(f=>f.url),['https://example.com/audio1','https://example.com/audio2']);assert.equal(groups.find(g=>g.label==='Activity files').files.length,1);assert.equal(p.lessonGroups,undefined);
 const native=splitStoredFiles([{category:'voice',name:'Reflection.wav'},{category:'lesson_plan',name:'Preparation.pdf'},{category:'activity',name:'Classroom.png'}]);assert.deepEqual(native.map(g=>g.label),['Lesson preparation PDFs','Audio recordings','']);
});
