// Feedback tab filters: when it was given, class, subject, who gave it, and Noted / not yet noted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {feedbackFilterOptions,filterFeedback,feedbackDay} from '../lib/school-success/feedback-filters.js';
const F=(id,date,grade,section,subject,by,notedAt='')=>({lessonId:id,recordId:id,key:'k'+id,date,grade,section,subject,topic:'Topic '+id,by,text:'Feedback '+id,notedAt});
const items=[
 F('1','2026-11-25T09:30:00.000Z','Grade 2','A','English','Meera Rao, Principal'),
 F('2','2026-11-23T06:00:00.000Z','Grade 3','B','Hindi','School Success team','2026-11-24T05:00:00.000Z'),
 F('3','2026-11-10T06:00:00.000Z','Grade 2','A','Mathematics','Meera Rao, Principal','2026-11-11T05:00:00.000Z'),
 F('4','2026-10-28T06:00:00.000Z','Grade 2','A','English','Anil Shah, Coordinator'),
 F('5','2026-11-24T06:00:00.000Z','LKG','Not Applicable','Phonics / Literacy','School Success team')
];
const ids=list=>list.map(f=>f.recordId);

test('choices come from the feedback the teacher has received',()=>{
 assert.deepEqual(feedbackFilterOptions(items),{classes:['Grade 2 A','Grade 3 B','LKG'],subjects:['English','Hindi','Mathematics','Phonics / Literacy'],reviewers:['Anil Shah, Coordinator','Meera Rao, Principal','School Success team']});
 assert.deepEqual(feedbackFilterOptions(undefined),{classes:[],subjects:[],reviewers:[]});
 assert.equal(feedbackDay(items[0]),'2026-11-25');
});

test('when it was given: all, this week (Monday–Sunday), this month, a chosen range',()=>{
 const today='2026-11-25';
 assert.deepEqual(ids(filterFeedback(items,{when:'all',today})),['1','2','3','4','5']);
 assert.deepEqual(ids(filterFeedback(items,{when:'week',today})),['1','2','5']);
 assert.deepEqual(ids(filterFeedback(items,{when:'month',today})),['1','2','3','5']);
 assert.deepEqual(ids(filterFeedback(items,{when:'range',today,range:{from:'2026-11-12',to:'2026-10-01'}})),['3','4'],'reversed dates still work');
});

test('class, subject, reviewer and Noted status combine',()=>{
 assert.deepEqual(ids(filterFeedback(items,{cls:'Grade 2 A'})),['1','3','4']);
 assert.deepEqual(ids(filterFeedback(items,{cls:'Grade 2 A',subject:'English'})),['1','4']);
 assert.deepEqual(ids(filterFeedback(items,{by:'Meera Rao, Principal'})),['1','3']);
 assert.deepEqual(ids(filterFeedback(items,{status:'new'})),['1','4','5'],'not yet noted');
 assert.deepEqual(ids(filterFeedback(items,{status:'noted'})),['2','3']);
 assert.deepEqual(ids(filterFeedback(items,{when:'month',today:'2026-11-25',by:'Meera Rao, Principal',status:'new'})),['1']);
 assert.deepEqual(ids(filterFeedback(items,{cls:'LKG'})),['5'],'a class with no section');
});
