import test from 'node:test';
import assert from 'node:assert/strict';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords,filterLessons,lessonSummary,groupLessons,classSubjectBreakdown,parseLessonPlan,visibleLessonSections,lessonFilterOptions,formatStamp,compareLessons,lessonEvidenceFiles} from '../lib/school-success/lesson-records.js';
import {buildSchoolPortfolio,submissionStats,filterSchoolEvidence} from '../lib/school-success/school-portfolio.js';
import {chronologicalRows} from '../lib/report-sequence.js';
import {raw,rawRecords,base,from,to} from './fixtures/lesson-records.mjs';

const load=async(input=raw())=>(await mapLive(input,base)).entries;
const byId=(lessons,id)=>lessons.find(l=>l.recordId===id);

test('lessons are ordered by original submission time, earliest first, not by id, plan date or later evidence',async()=>{
 const lessons=buildLessonRecords(await load(),from,to);
 assert.deepEqual(lessons.map(l=>l.recordId),['150','101','102','201','90']);
 assert.equal(byId(lessons,'101').submittedAt,'2026-10-22T04:15:00.000Z');
 // A later evidence upload changes evidence_submitted_at/implementation_date, never the lesson position.
 const records=rawRecords();records.find(r=>r.id===150).evidence_submitted_at='2026-10-30T10:00:00';records.find(r=>r.id===150).implementation_date='2026-10-30';
 const again=buildLessonRecords(await load({...raw(),records}),from,to);
 assert.deepEqual(again.map(l=>l.recordId),['150','101','102','201','90']);
 // Equal timestamps fall back to the stable record id.
 assert.ok(compareLessons(byId(lessons,'101'),byId(lessons,'102'))<0);
 assert.equal(formatStamp('2026-10-22T04:15:00.000Z'),'22 Oct 2026, 9:45 am IST');
});

test('existing feed ordering keys are unchanged by the new lesson fields',async()=>{
 const entries=await load(),feed=entries.filter(r=>r.kind==='submission');
 for(const r of feed){assert.equal(r.submittedAt,undefined);assert.equal(r.submitted_at,undefined);}
 assert.deepEqual(chronologicalRows(feed).map(r=>r.id),chronologicalRows(feed.map(r=>({...r,preparationSavedAt:undefined,lessonSubmittedAt:undefined,evidenceEventAt:undefined}))).map(r=>r.id));
});

test('evidence stays with its own lesson row; no matching by name, date or topic',async()=>{
 const lessons=buildLessonRecords(await load(),from,to),asha=byId(lessons,'101'),hindi=byId(lessons,'102'),beta=byId(lessons,'201');
 assert.deepEqual(asha.activities.map(f=>f.label),['Classroom activity 1','Classroom activity 2']);
 assert.ok(asha.activities.every(f=>f.url.includes('implementation_aaaaaaaa')));
 assert.equal(asha.writing.length,1);assert.equal(hindi.writing.length,0);
 // Beta's Asha has the same name, grade, subject, topic and date but is a different lesson at another school.
 assert.equal(beta.writing.length,1);assert.match(beta.writing[0].url,/beta\.jpg$/);assert.equal(beta.feedback,null);
 assert.notEqual(asha.teacherKey,beta.teacherKey);
 // Consultant observations have no lesson identity and are never attached.
 for(const l of lessons)assert.ok(![...l.activities,...l.remedial,...l.portfolio,...l.reflections].some(f=>/Observation/.test(f.label)));
 assert.equal(lessons.some(l=>l.recordId==='7'),false);
});

test('previous-portal voice notes are left out; after-class reflection recordings stay with reflections',async()=>{
 const lessons=buildLessonRecords(await load(),from,to),asha=byId(lessons,'101'),hindi=byId(lessons,'102');
 assert.equal(asha.audio,undefined);assert.equal(hindi.audio,undefined);
 assert.ok(!lessonEvidenceFiles(asha).some(f=>/\/voice\//.test(f.url))&&!lessonEvidenceFiles(hindi).length,'no voice notes in lesson evidence');
 assert.deepEqual(asha.reflections.map(f=>[f.label,f.kind,Boolean(f.legacy)]),[['Earlier after-class reflection (saved PDF)','PDF',true],['After-class reflection recording','Audio',false]]);
});

test('repeated evidence submissions do not duplicate files or inflate counts',async()=>{
 const entries=await load(),lessons=buildLessonRecords(entries,from,to),asha=byId(lessons,'101');
 const urls=[asha.planFiles,asha.activities,asha.writing,asha.remedial,asha.reflections,asha.portfolio].flat().map(f=>f.url);
 assert.equal(new Set(urls).size,urls.length);
 assert.equal(urls.length,6); // plan, 2 activities, 1 writing, reflection PDF and recording (previous-portal voice notes are left out)
 // a1.jpg was sent in two updates; it is one file.
 assert.equal(asha.activities.filter(f=>f.url.endsWith('a1.jpg')).length,1);
 // Lesson plan count matches the established School 360° preparation count.
 const model=buildSchoolPortfolio({entries,roster:raw().roster,directory:{archives:[]}},from,to);
 const alpha=model.schools.find(s=>s.name==='Alpha School');
 assert.equal(lessonSummary(lessons.filter(l=>l.school==='Alpha School')).plansSubmitted,alpha.preparations);
 assert.equal(submissionStats(alpha.submissions).preparations,3);
});

test('feedback is shown only for the reviewed lesson, labelled Academic Review with its date',async()=>{
 const lessons=buildLessonRecords(await load(),from,to);
 assert.deepEqual(byId(lessons,'101').feedback,{label:'Academic Review',text:'Strong modelling. Next, give pairs a timed blending challenge.\n— School Success team',date:'2026-10-27T10:30:00.000Z',by:'School Success team',key:'legacy:2026-10-27T10:30:00+00:00',weekly:null});
 assert.deepEqual(lessons.filter(l=>l.feedback).map(l=>l.recordId),['101']);
 assert.ok(!JSON.stringify(lessons).includes('consultant@example.test'),'reviewer emails are not carried into reports');
});

test('school, teacher, class and subject filters never cross schools',async()=>{
 const lessons=buildLessonRecords(await load(),from,to);
 const alphaAsha=filterLessons(lessons,{school:'Alpha School',teacher:JSON.stringify(['Alpha School','Asha'])});
 assert.deepEqual(alphaAsha.map(l=>l.recordId),['150','101','102']);
 assert.deepEqual(filterLessons(lessons,{teacher:JSON.stringify(['Beta School','Asha'])}).map(l=>l.recordId),['201']);
 assert.deepEqual(filterLessons(lessons,{grade:'Grade 2'}).map(l=>l.recordId),['150','101','201']);
 assert.deepEqual(filterLessons(lessons,{school:'Alpha School',grade:'Grade 2',subject:'English'}).map(l=>l.recordId),['101']);
 assert.deepEqual(lessonFilterOptions(alphaAsha),{grades:['Grade 2','Grade 3'],sections:['A','B'],subjects:['English','Hindi','Mathematics']});
 assert.deepEqual(filterLessons(lessons,{school:'Alpha School',grade:'Grade 2',section:'A'}).map(l=>l.recordId),['150','101']);
 assert.deepEqual(filterLessons(lessons,{school:'Alpha School',section:'B'}).map(l=>l.recordId),['102']);
 assert.equal(buildLessonRecords(await load(),'2026-09-01','2026-09-01').map(l=>l.recordId).join(),'80');
});

test('hierarchy and breakdown keep same-name teachers apart',async()=>{
 const lessons=buildLessonRecords(await load(),from,to),groups=groupLessons(lessons);
 assert.deepEqual(groups.map(g=>[g.school,g.teachers.map(t=>t.teacher+':'+t.lessons.length)]),[['Alpha School',['Asha:3','Bina:1']],['Beta School',['Asha:1']]]);
 assert.deepEqual(groups[0].teachers[0].classes.map(c=>[c.grade,c.subject,c.lessons.map(l=>l.recordId)]),[['Grade 2','English',['101']],['Grade 2','Mathematics',['150']],['Grade 3','Hindi',['102']]]);
 const breakdown=classSubjectBreakdown(lessons.filter(l=>l.school==='Alpha School'));
 assert.deepEqual(breakdown.find(r=>r.grade==='Grade 2'&&r.subject==='English'),{grade:'Grade 2',subject:'English',lessons:1,teachers:1,activities:2,writing:1,reflections:2});
});

test('lesson plan uses the stored prompt structure and never invents fields',()=>{
 const plan=parseLessonPlan('Why — learning objective\nRead CVC words\n\nPractice & apply\nWorkbook p. 4','Letter tiles');
 assert.deepEqual(plan.fields.map(f=>[f.label,f.text]),[['Learning outcome','Read CVC words'],['Teaching-learning materials','Letter tiles'],['Practice and apply (You do)','Workbook p. 4']]);
 assert.equal(plan.notes,'');
 assert.ok(!plan.fields.some(f=>/CFU|Check for understanding/i.test(f.label)));
 // Same headings as the teacher's plan form; classwork and homework (saved inside the review section) is its own field.
 const form=parseLessonPlan('Why — learning objective\nO\n\nTeaching-learning materials / resources\nM\n\nTeacher activity — how\nT\n\nStudent activity\nS\n\nPractice & apply\nP\n\nReview / next step\nR\nClasswork and homework:\nC');
 assert.deepEqual(form.fields.map(f=>[f.label,f.text]),[['Learning outcome','O'],['Teaching-learning materials','M'],['Teacher activity (I do)','T'],['Student activity and participation (We do)','S'],['Practice and apply (You do)','P'],['Check learning and next steps','R'],['Classwork and homework','C']]);
 assert.deepEqual(parseLessonPlan('Review / next step\nकक्षा कार्य और गृहकार्य:\nपृष्ठ 4').fields.map(f=>[f.key,f.text]),[['classwork','पृष्ठ 4']],'Hindi heading, no review text');
 const free=parseLessonPlan('Children practise sounds. Why — learning objective appears mid-sentence.','');
 assert.deepEqual(free.fields,[]);assert.match(free.notes,/mid-sentence/);
 assert.deepEqual(parseLessonPlan('',''),{fields:[],notes:'',periodType:'regular',periodNumber:0},'a plan without a period type is a regular lesson');
});

test('optional sections can be hidden without changing the lesson record',async()=>{
 const lessons=buildLessonRecords(await load(),from,to),asha=byId(lessons,'101'),before=JSON.stringify(asha);
 assert.deepEqual(visibleLessonSections(asha),{plan:true,activities:true,writing:true,remedial:false,portfolio:false,reflections:true,feedback:true});
 assert.deepEqual(visibleLessonSections(asha,{activities:false,writing:false,reflections:false,feedback:false}),{plan:true,activities:false,writing:false,remedial:false,portfolio:false,reflections:false,feedback:false});
 assert.equal(JSON.stringify(asha),before);
 // Missing evidence is omitted rather than shown as empty placeholders.
 assert.deepEqual(visibleLessonSections(byId(lessons,'150')),{plan:true,activities:false,writing:false,remedial:false,portfolio:false,reflections:false,feedback:false});
});

test('the existing School 360° evidence flow is unchanged by the lesson view',async()=>{
 const entries=await load(),model=buildSchoolPortfolio({entries,roster:raw().roster,directory:{archives:[]}},from,to);
 const alpha=model.schools.find(s=>s.name==='Alpha School');
 assert.deepEqual(filterSchoolEvidence(alpha.submissions).map(r=>r.id),['150:preparation','101:preparation','102:preparation','101:e1','90','101:e2']);
 assert.equal(alpha.files,submissionStats(alpha.submissions).files);
});
