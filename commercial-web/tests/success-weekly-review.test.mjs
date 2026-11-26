// Weekly review (owner decision, 26 November 2026): storage, the week view, and how it reaches lessons and reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import {appendWeeklyReview,readRubricRows,weeklyKey} from '../lib/school-success/lesson-review-store.js';
import {weekGroups} from '../lib/school-success/weekly-review.js';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords} from '../lib/school-success/lesson-records.js';
import {buildSchoolPortfolio} from '../lib/school-success/school-portfolio.js';
import {weeklyRequest} from '../lib/school-success/lesson-reviews.js';

// success_entries in memory, with the PostgREST calls the store makes.
function table(){const rows=new Map();
 const request=async(path,method='GET',body)=>{const u=new URL('http://x'+path);
  if(method==='POST'){const list=Array.isArray(body)?body:[body],added=[];for(const r of list)if(!rows.has(r.id)){rows.set(r.id,{...r});added.push({id:r.id});}return added;}
  const ids=(u.searchParams.get('id')||'').replace(/^in\.\(|\)$/g,'').split(',');return ids.map(id=>rows.get(id)).filter(Boolean).map(r=>({id:r.id,owner:r.owner,payload:r.payload}));};
 const all=async(_t,_o,q)=>{const like=[...String(q.or).matchAll(/id\.like\.([^*,]+)\*/g)].map(m=>m[1]);return [...rows.values()].filter(r=>r.kind===q.kind.slice(3)&&like.some(p=>r.id.startsWith(p)));};
 return {rows,request,all};}
const S='Sunrise Public School',T='Asha Verma',RID='11111111-1111-4111-8111-111111111111';
const review={planning:{level:'A',note:'Outcomes match the activities all week.'},execution:{level:'B',note:'More pair work in practice.'},focus:'Use exit tickets every day.'};
const save=(db,extra={})=>appendWeeklyReview({school:S,teacher:T,grade:'Grade 2',section:'A',subject:'English',weekStart:'2026-11-23',weekEnd:'2026-11-29',recordIds:['101','102','103'],reviewer:'consultant@example.test',reviewerName:'Harshit',reviewerRole:'Consultant',requestId:RID,review,...extra},db.request);

test('a weekly review is stored once per covered period, with one shared key and readable text',async()=>{
 const db=table();
 assert.deepEqual(await save(db),{saved:true,periods:3});
 assert.deepEqual([...db.rows.keys()].sort(),['lesson-review-101-weekly-'+RID,'lesson-review-102-weekly-'+RID,'lesson-review-103-weekly-'+RID]);
 const rows=await readRubricRows(['101','102','103','104'],{school:'eq.'+S},db.all);
 assert.deepEqual(rows.map(r=>r.record_id).sort(),['101','102','103']);
 assert.ok(rows.every(r=>r.review_id===weeklyKey(RID)),'one key for the whole week');
 assert.equal(rows[0].feedback,'Weekly review · 23 Nov – 29 Nov 2026 · Grade 2 A · English (3 periods)\n\nPlanning · A (Strong practice)\nOutcomes match the activities all week.\n\nExecution · B (Developing)\nMore pair work in practice.\n\nFocus for next week\nUse exit tickets every day.');
 assert.deepEqual(rows[0].by,{name:'Harshit',role:'Consultant'});
 assert.deepEqual(rows[0].weekly.recordIds,['101','102','103']);
});

test('a retry of the same save changes nothing; different feedback under the same request is refused',async()=>{
 const db=table();await save(db);
 assert.deepEqual(await save(db),{saved:true,alreadySaved:true,periods:3});
 await assert.rejects(save(db,{review:{...review,focus:'Something else'}}),/409:This weekly review was already submitted/);
 await assert.rejects(save(db,{recordIds:[]}),/no lessons in this week/);
 await assert.rejects(save(db,{review:{focus:'Only a focus'}}),/planning, execution or both/);
 await assert.rejects(save(db,{review:{planning:review.planning}}),/focus/i);
});

test('requests: a week, and a save with ratings and a focus',()=>{
 assert.ok(weeklyRequest.safeParse({action:'week',school:S,teacher:T,week:'2026-11-25'}).success);
 assert.ok(!weeklyRequest.safeParse({action:'week',school:S,teacher:T,week:'2026-11-31'}).success);
 assert.ok(!weeklyRequest.safeParse({action:'save',school:S,teacher:T,week:'2026-11-23',grade:'Grade 2',section:'A',subject:'English',requestId:RID,review,recordIds:['999']}).success,'the browser cannot choose the covered periods');
});

// Lesson records as the server reads them for one teacher's week.
const rec=(id,date,grade,section,subject,topic,extra={})=>({id,Type:'Classroom Reflection',Center:S,Institution:S,FullName:T,Grade:grade,Section:section,Subject:subject,Book:topic,submission_id:'s'+id,lesson_period_id:'p'+id,planned_lesson_on:date,preparation_saved_at:date+'T03:00:00',lesson_stage:'preparation_saved',lesson_reflection:'Why — learning objective\nTopic '+topic,StartTime:date+'T00:00:00',...extra});
const records=[rec(101,'2026-11-23','Grade 2','A','English','LP 12'),rec(104,'2026-11-23','Grade 3','B','Hindi','मात्रा'),rec(102,'2026-11-24','Grade 2','A','English','LP 13',{Video_Evidence_1:'https://media.test/x/activity/a.jpg'}),rec(103,'2026-11-26','Grade 2','A','English','LP 14'),rec(105,'2026-11-30','Grade 2','A','English','Next week')];

test('the week view groups by class and subject and keeps each period’s number for the day',async()=>{
 const db=table();await save(db);const reviews=await readRubricRows(records.map(r=>String(r.id)),{school:'eq.'+S},db.all);
 const {entries}=await mapLive({records,reviews,notes:[]},'https://media.test');
 const view=weekGroups(buildLessonRecords(entries,'0001-01-01','9999-12-31',{scope:'all'}),reviews,'2026-11-25');
 assert.deepEqual([view.from,view.to],['2026-11-23','2026-11-29']);
 assert.deepEqual(view.groups.map(g=>[g.grade+' '+g.section+' '+g.subject,g.periods,g.withEvidence,g.reviews.length]),[['Grade 2 A English',3,1,1],['Grade 3 B Hindi',1,0,0]]);
 assert.deepEqual(view.groups[0].lessons.map(l=>[l.plannedDate,l.dayNumber,l.recordId]),[['2026-11-23',1,'101'],['2026-11-24',1,'102'],['2026-11-26',1,'103']]);
 assert.equal(view.groups[1].lessons[0].dayNumber,2,'Hindi was the second period saved on Monday');
 assert.equal(view.groups[0].reviews[0].periods,3);assert.match(view.groups[0].reviews[0].text,/^Weekly review · 23 Nov – 29 Nov 2026/);
});

test('every covered period counts as reviewed; one "Noted" covers the whole weekly review',async()=>{
 const db=table();await save(db);const reviews=await readRubricRows(records.map(r=>String(r.id)),{school:'eq.'+S},db.all);
 const notes=[{record_id:'101',school:S,key:weeklyKey(RID),noted_at:'2026-11-30T05:00:00.000Z'}];
 const {entries}=await mapLive({records,reviews,notes,roster:[{school:S,name:T}]},'https://media.test');
 const lessons=buildLessonRecords(entries,'2026-11-01','2026-11-30');
 const by=id=>lessons.find(l=>l.recordId===id);
 for(const id of ['101','102','103']){assert.equal(by(id).feedback.weekly.weekStart,'2026-11-23',id);assert.equal(by(id).feedbackNoted?.all,true,'noted '+id);}
 assert.equal(by('104').feedback,null,'Hindi was not in the English weekly review');assert.equal(by('105').feedback,null,'next week is not covered');
 const school=buildSchoolPortfolio({entries,roster:[{school:S,name:T}],directory:{archives:[]}},'2026-11-01','2026-11-30').schools[0];
 assert.equal(school.pendingReview,2,'only the Hindi lesson and next week’s lesson are awaiting review');
});
