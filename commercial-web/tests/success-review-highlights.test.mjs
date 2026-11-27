// Yellow highlights and edited reviews (owner decision, 27 November 2026): sentence splitting, toggling, the latest
// version of each review, and who may edit.
import test from 'node:test';
import assert from 'node:assert/strict';
import {sentences,toggleMark,markKey,lessonMarks} from '../lib/school-success/highlights.js';
import {latestVersions} from '../lib/school-success/lesson-review-store.js';
import {mayEditReview,feedbackTextWithReviewer,rubricReview} from '../lib/school-success/lesson-reviews.js';

test('plans split into tappable sentences, in English and Hindi, and at line breaks',()=>{
 assert.deepEqual(sentences('In pairs, children label objects. Then they read the labels aloud!'),['In pairs, children label objects.','Then they read the labels aloud!']);
 assert.deepEqual(sentences('बच्चे शब्द पढ़ेंगे। फिर लिखेंगे।'),['बच्चे शब्द पढ़ेंगे।','फिर लिखेंगे।']);
 assert.deepEqual(sentences('Workbook page 14\nExit ticket: 3 words'),['Workbook page 14','Exit ticket: 3 words']);
 assert.deepEqual(sentences('Say "Good job." Then clap.'),['Say "Good job."','Then clap.']);
 assert.deepEqual(sentences(''),[]);
});

test('tapping a sentence marks it; tapping again removes it',()=>{
 const m={record:'101',field:'objective',text:'Name 10 objects.'};
 let list=toggleMark([],m);assert.deepEqual(list,[m]);
 list=toggleMark(list,{...m,text:' Name 10 objects. '});assert.deepEqual(list,[],'same sentence, trimmed');
 const lesson={recordId:'101',reviews:[{highlights:[m,{...m,record:'102'}]}]};
 assert.deepEqual([...lessonMarks(lesson)],[markKey(m)],'only this lesson\'s highlights');
 assert.equal(rubricReview.safeParse({planning:{level:'A',note:'ok'},highlights:[{record:'101',field:'reflection.achievement',text:'x'}]}).success,true);
 assert.equal(rubricReview.safeParse({planning:{level:'A',note:'ok'},highlights:[{record:'abc',field:'objective',text:'x'}]}).success,false);
});

test('each review shows its latest version, credited to who gave it and who changed it; sign-ins are dropped',()=>{
 const by=n=>({name:n,role:'Principal'});
 const rows=[
  {record_id:'1',review_id:'lesson-review-1-a',root:'',updated_at:'2026-11-24T05:00:00Z',feedback:'first',by:by('Meera'),owner:'m@x'},
  {record_id:'1',review_id:'lesson-review-1-b',root:'lesson-review-1-a',updated_at:'2026-11-26T05:00:00Z',feedback:'second',by:by('Ravi'),owner:'r@x'},
  {record_id:'1',review_id:'lesson-review-1-c',root:'lesson-review-1-a',updated_at:'2026-11-27T05:00:00Z',feedback:'third',by:by('Asha'),owner:'a@x'},
  {record_id:'1',review_id:'lesson-review-1-z',root:'',updated_at:'2026-11-25T05:00:00Z',feedback:'other',by:by('Meera'),owner:'m@x'},
  {record_id:'2',review_id:'weekly-w',root:'',updated_at:'2026-11-24T05:00:00Z',feedback:'week',by:by('Meera'),owner:'m@x'},
  {record_id:'2',review_id:'weekly-w2',root:'weekly-w',updated_at:'2026-11-25T05:00:00Z',feedback:'week 2',by:by('Ravi'),owner:'r@x'}];
 const out=latestVersions(rows);
 assert.equal(out.length,3);
 const a=out.find(r=>r.root==='lesson-review-1-a');
 assert.equal(a.feedback,'third');assert.equal(a.review_id,'lesson-review-1-c');assert.equal(a.by.name,'Meera');
 assert.equal(a.edited.by.name,'Asha');assert.equal(a.edited.versions,3);assert.equal(a.given_at,'2026-11-24T05:00:00Z');
 assert.equal(out.find(r=>r.root==='lesson-review-1-z').edited,undefined,'an unedited review');
 assert.equal(out.find(r=>r.record_id==='2').feedback,'week 2');
 assert.ok(out.every(r=>!('owner' in r)),'sign-ins never leave the server read');
});

test('who may edit a review',()=>{
 const consultant={role:'admin',email:'c@x',name:'Harshit'},leader={role:'admin',leader:true,title:'Coordinator',email:'9@mobile.schoolsuccess.in'},owner={role:'admin',isSuperAdmin:true};
 const byLeader={by:{name:'Meera',role:'Principal'},owner:'8@mobile.schoolsuccess.in'},byConsultant={by:{name:'Harshit',role:'Consultant'},owner:'c@x'};
 assert.equal(mayEditReview(owner,byConsultant),true);assert.equal(mayEditReview(owner,byLeader),true);
 assert.equal(mayEditReview(leader,byLeader),true);assert.equal(mayEditReview(leader,byConsultant),false);
 assert.equal(mayEditReview(leader,{by:{name:'',role:'School management'}}),true);
 assert.equal(mayEditReview(leader,{owner:'7@mobile.schoolsuccess.in'}),true,'older leader reviews: mobile sign-in');
 assert.equal(mayEditReview(consultant,byConsultant),true);assert.equal(mayEditReview(consultant,{...byConsultant,owner:'other@x'}),false);
 assert.equal(mayEditReview(consultant,byLeader),false);assert.equal(mayEditReview(consultant,{by:{name:'Owner',role:'Super Admin'}}),false);
 assert.equal(mayEditReview(consultant,{by:{name:'Harshit',role:'Consultant'}}),true,'screens: matched by name to show Edit');
 assert.equal(mayEditReview({role:'school-teacher'},byLeader),false);
});

test('the review text names who changed it',()=>{
 const t=feedbackTextWithReviewer([{text:'Planning · A',date:'2026-11-27',by:{name:'Harshit',role:'Consultant'},editedBy:{name:'Meera Rao',role:'Principal'}}]);
 assert.equal(t,'Planning · A\n— Harshit, Consultant · updated by Meera Rao, Principal');
 assert.equal(feedbackTextWithReviewer([{text:'x',by:{name:'A',role:'Principal'},editedBy:{name:'A',role:'Principal'}}]),'x\n— A, Principal · updated');
});
