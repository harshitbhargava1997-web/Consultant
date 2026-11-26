// Review screens show the teacher's written after-class reflection as text (not the saved file), and a reviewer
// is never shown by their sign-in email or mobile number.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords} from '../lib/school-success/lesson-records.js';
import {weekGroups} from '../lib/school-success/weekly-review.js';
import {attachReflectionText,reflectionDocument} from '../lib/school-success/reflection-text.js';
import {reviewerLabel,reviewerName} from '../lib/school-success/lesson-reviews.js';

const S='Life',T='Harshit Life',sub='8f8bcc24-0573-4016-824b-c6f5edd776e0',period='3a595d33-fd29-43f4-8894-9891737e7a9e',upd='73b74d1a-dd98-4025-b51b-ae403a405246',file='5d0f0c1e-2c3a-4b4c-9d5e-6f7a8b9c0d1e';
const url=`https://media.test/schools/Life/teachers/Harshit%20Life/2026-11-23/submission_${sub}/implementation_${period}/closure/${file}.json`;
const doc=reflectionDocument({submissionId:sub,periodId:period,updateId:upd,conductedOn:'2026-11-22',answers:{achievement:'Most children read the words.',nextStep:'Five need more practice.'}});
const record={id:501,Type:'Classroom Reflection',Center:S,Institution:S,FullName:T,Grade:'Nursery',Section:'A',Subject:'English',Book:'Colours',submission_id:sub,lesson_period_id:period,planned_lesson_on:'2026-11-23',preparation_saved_at:'2026-11-22T03:00:00',lesson_stage:'evidence_submitted',conducted_on:'2026-11-22',evidence_submitted_at:'2026-11-22T09:00:00',lesson_reflection:'Why — learning objective\nName colours',Video_Evidence_1:url,lesson_evidence_history:[{id:upd,at:'2026-11-22T09:00:00',conductedOn:'2026-11-22',files:{Video_Evidence_1:url}}],StartTime:'2026-11-23T00:00:00'};

test('the week view shows the written reflection’s answers once the saved file is read',async()=>{
 const {entries}=await mapLive({records:[record],reviews:[],notes:[]},'https://media.test');
 const before=weekGroups(buildLessonRecords(entries,'0001-01-01','9999-12-31',{scope:'all'}),[],'2026-11-23').groups[0].lessons[0];
 assert.equal((before.writtenReflections||[]).length,0,'without the text only a link to the file exists (the reported problem)');
 await attachReflectionText(entries,async u=>{assert.equal(u,url);return JSON.stringify(doc);});
 const lesson=weekGroups(buildLessonRecords(entries,'0001-01-01','9999-12-31',{scope:'all'}),[],'2026-11-23').groups[0].lessons[0];
 assert.deepEqual(lesson.writtenReflections.map(r=>r.answers),[{achievement:'Most children read the words.',nextStep:'Five need more practice.'}]);
 assert.equal(lesson.reflections.length,0,'no "open saved text" link remains');
});

test('reviewers are named, never shown by sign-in email or mobile number',()=>{
 assert.equal(reviewerName('harshitbhargava1997@gmail.com'),'');assert.equal(reviewerName('+91 98000 00001'),'');assert.equal(reviewerName('Meera Rao'),'Meera Rao');
 assert.equal(reviewerLabel({name:'harshitbhargava1997@gmail.com',role:'Super Admin'}),'Super Admin','reviews saved earlier with an email');
 assert.equal(reviewerLabel({name:'Meera Rao',role:'Principal'}),'Meera Rao, Principal');
});
