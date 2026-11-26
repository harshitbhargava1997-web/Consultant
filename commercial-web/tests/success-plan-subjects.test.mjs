// Subjects for new lesson plans depend on the class (owner decision, 26 November 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import {teacherSubjects,subjectsFor,prePrimarySubjects,primarySubjects} from '../lib/school-success/teacher-flow.js';
import {planningIssue,planProblem} from '../lib/school-success/planning-guide.js';

test('pre-primary (Nursery, LKG, UKG) subjects',()=>{
 const pre=['Phonics / Literacy','Numeracy','Environmental Studies (EVS)','Gross and fine motor activities','Stories and rhymes','Art and craft','Hindi','Playtime','Extracurricular / co-curricular'];
 for(const g of ['Nursery','LKG','UKG'])assert.deepEqual(subjectsFor(g),pre,g);
 assert.deepEqual(prePrimarySubjects,pre);
});

test('primary (Grades 1–5) subjects',()=>{
 const primary=['Environmental Studies (EVS)','English','Mathematics','Hindi','Computer','General Knowledge (GK)','English Grammar','Science','Social Science','Extracurricular / co-curricular','Phonics / Literacy','Stories and rhymes','Art and craft'];
 for(const g of ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5'])assert.deepEqual(subjectsFor(g),primary,g);
 assert.deepEqual(primarySubjects,primary);
});

test('removed subjects are not offered anywhere; before a class is chosen every subject is listed once',()=>{
 for(const gone of ['All Subjects Together','Play Activity','Play Time','Play Based','Play-based activities (gross and fine motor)'])assert.ok(!teacherSubjects.includes(gone),gone);
 assert.deepEqual(subjectsFor(''),teacherSubjects);
 assert.equal(new Set(teacherSubjects).size,teacherSubjects.length);
 assert.ok(!subjectsFor('Nursery').includes('Mathematics')&&!subjectsFor('Grade 3').includes('Playtime'));
});

test('a plan’s subject must be offered for its class: older drafts and changed classes choose again',()=>{
 const block={grade:'Nursery',section:'A',subject:'All Subjects Together',topic:'Colours',answers:{}};
 assert.equal(planningIssue(block),'details','removed subject');
 assert.equal(planningIssue({...block,subject:'Art and craft'}),'');
 assert.equal(planningIssue({...block,subject:'Mathematics'}),'details','a primary subject on a Nursery plan');
 assert.equal(planningIssue({...block,grade:'Grade 2',subject:'Mathematics'}),'');
 const weekly={type:'weekly',shared:{grade:'LKG',section:'A',subject:'Play Time'},blocks:[{date:'2026-11-27'}]};
 assert.equal(planProblem(weekly),'subject');
 assert.notEqual(planProblem({...weekly,shared:{...weekly.shared,subject:'Gross and fine motor activities'}}),'subject');
 assert.equal(planProblem({...weekly,shared:{...weekly.shared,grade:'Grade 4',subject:'Playtime'}}),'subject');
});
