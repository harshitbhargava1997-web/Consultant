// Subjects for new lesson plans (owner decision, 26 November 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {teacherSubjects} from '../lib/school-success/teacher-flow.js';
import {planningIssue,planProblem} from '../lib/school-success/planning-guide.js';

test('"All Subjects Together" and the three play options are gone; play, stories and rhymes, art and craft are offered',()=>{
 for(const gone of ['All Subjects Together','Play Activity','Play Time','Play Based'])assert.ok(!teacherSubjects.includes(gone),gone);
 for(const added of ['Play-based activities (gross and fine motor)','Stories and rhymes','Art and craft'])assert.ok(teacherSubjects.includes(added),added);
 for(const kept of ['Phonics / Literacy','Mathematics','Numeracy','English','Hindi','Environmental Studies (EVS)'])assert.ok(teacherSubjects.includes(kept),kept);
 assert.equal(new Set(teacherSubjects).size,teacherSubjects.length);
});

test('an older draft with a removed subject must choose a subject before saving',()=>{
 const block={grade:'Nursery',section:'A',subject:'All Subjects Together',topic:'Colours',answers:{}};
 assert.equal(planningIssue(block),'details');
 assert.equal(planningIssue({...block,subject:'Art and craft'}),'');
 const weekly={type:'weekly',shared:{grade:'LKG',section:'A',subject:'Play Time'},blocks:[{date:'2026-11-27'}]};
 assert.equal(planProblem(weekly),'subject');
 assert.notEqual(planProblem({...weekly,shared:{...weekly.shared,subject:'Play-based activities (gross and fine motor)'}}),'subject');
});
