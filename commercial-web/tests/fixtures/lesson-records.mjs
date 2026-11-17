// Synthetic School Success records shaped like teacher_records rows. No real school data.
import {formatReflection} from '../../lib/school-success/teacher-flow.js';
export const base='https://media.example.test';
export const from='2026-10-20',to='2026-10-31';
const path=(school,teacher,day,submission,period,category,name)=>`schools/${encodeURIComponent(school)}/teachers/${encodeURIComponent(teacher)}/${day}/submission_${submission}/implementation_${period}/${category}/${name}`;
export const url=(...parts)=>base+'/'+path(...parts).split('/').map(encodeURIComponent).join('/');

const longPlan={objective:'Children will blend CVC words aloud and read them independently.',materials:'Picture cards, letter tiles and the class word wall.',teacher:'Model blending with three sounds, then ask pairs to blend new words. '.repeat(6).trim(),student:'Pairs blend words using tiles and read them to a partner.',practice:'Workbook page 14, items 1 to 6.',review:'Homework: read five words at home with a parent.'};
const hindiPlan={objective:'बच्चे मात्राओं को पहचानकर शब्द पढ़ेंगे।',teacher:'शिक्षक कहानी सुनाकर नए शब्द बोर्ड पर लिखेंगे।',student:'Students read the words aloud in pairs.',review:'गृहकार्य: पाँच शब्द लिखें।'};

export function rawRecords(){
 const A='Alpha School',B='Beta School';
 const s1='11111111-1111-4111-8111-111111111111',p1='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',p2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const s2='22222222-2222-4222-8222-222222222222',p3='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
 const s3='33333333-3333-4333-8333-333333333333',p4='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
 const common={Role:'teacher',Type:'Classroom Reflection',Duration_Min:0,lesson_version:2};
 return [
  // Asha (Alpha): two periods in one submission, prepared 22 Oct; evidence for period 1 added twice later.
  {...common,id:101,Center:A,Institution:A,FullName:'Asha',Grade:'Grade 2',Section:'A',Subject:'English',Book:'Blending CVC words',submission_id:s1,lesson_period_id:p1,
   planned_lesson_on:'2026-10-23',preparation_saved_at:'2026-10-22T04:15:00',submitted_at:'2026-10-22T04:15:00',implementation_date:'2026-10-24',StartTime:'2026-10-24T00:00:00',conducted_on:'2026-10-24',lesson_stage:'evidence_submitted',evidence_submitted_at:'2026-10-26T06:00:00',
   lesson_reflection:formatReflection(longPlan),materials_notes:longPlan.materials,
   Voice_Note_Link:[url(A,'Asha','2026-10-23',s1,p1,'voice','v1.wav'),url(A,'Asha','2026-10-23',s1,p1,'voice','v2.wav')].join(','),
   Lesson_Plan_Picture:url(A,'Asha','2026-10-23',s1,p1,'lesson_plan','plan.pdf'),
   Video_Evidence_1:url(A,'Asha','2026-10-23',s1,p1,'activity','a1.jpg'),Video_Evidence_2:url(A,'Asha','2026-10-23',s1,p1,'closure','reflection.pdf'),Video_Evidence_3:[url(A,'Asha','2026-10-23',s1,p1,'activity','a2.png'),url(A,'Asha','2026-10-23',s1,p1,'closure','reflection.wav')].join(','),
   Writing_Sample_Link:url(A,'Asha','2026-10-23',s1,p1,'writing','w1.jpg'),
   lesson_evidence_history:[
    {id:'e1',at:'2026-10-24T08:00:00',conductedOn:'2026-10-24',files:{Video_Evidence_1:url(A,'Asha','2026-10-23',s1,p1,'activity','a1.jpg'),Video_Evidence_2:url(A,'Asha','2026-10-23',s1,p1,'closure','reflection.pdf'),Writing_Sample_Link:url(A,'Asha','2026-10-23',s1,p1,'writing','w1.jpg')}},
    {id:'e2',at:'2026-10-26T06:00:00',conductedOn:'2026-10-24',files:{Video_Evidence_1:url(A,'Asha','2026-10-23',s1,p1,'activity','a1.jpg'),Video_Evidence_3:[url(A,'Asha','2026-10-23',s1,p1,'activity','a2.png'),url(A,'Asha','2026-10-23',s1,p1,'closure','reflection.wav')].join(',')}}]},
  {...common,id:102,Center:A,Institution:A,FullName:'Asha',Grade:'Grade 3',Section:'B',Subject:'Hindi',Book:'मात्रा वाले शब्द',submission_id:s1,lesson_period_id:p2,
   planned_lesson_on:'2026-10-23',preparation_saved_at:'2026-10-22T04:15:00',submitted_at:'2026-10-22T04:15:00',implementation_date:'2026-10-23',StartTime:'2026-10-23T00:00:00',lesson_stage:'preparation_saved',
   lesson_reflection:formatReflection(hindiPlan),materials_notes:'',Voice_Note_Link:url(A,'Asha','2026-10-23',s1,p2,'voice','h1.wav'),lesson_evidence_history:[]},
  // Asha (Alpha): earlier-submitted lesson with a HIGHER id, planned later. Submission time must win.
  {...common,id:150,Center:A,Institution:A,FullName:'Asha',Grade:'Grade 2',Section:'A',Subject:'Mathematics',Book:'Counting in tens',submission_id:s2,lesson_period_id:p3,
   planned_lesson_on:'2026-10-27',preparation_saved_at:'2026-10-21T03:00:00',submitted_at:'2026-10-21T03:00:00',implementation_date:'2026-10-27',StartTime:'2026-10-27T00:00:00',lesson_stage:'preparation_saved',
   lesson_reflection:'Free-text plan written before structured prompts.',materials_notes:'Bead strings',lesson_evidence_history:[]},
  // Same teacher name at another school: must never merge with Alpha's Asha.
  {...common,id:201,Center:B,Institution:B,FullName:'Asha',Grade:'Grade 2',Section:'A',Subject:'English',Book:'Blending CVC words',submission_id:s3,lesson_period_id:p4,
   planned_lesson_on:'2026-10-23',preparation_saved_at:'2026-10-22T04:15:00',submitted_at:'2026-10-22T04:15:00',implementation_date:'2026-10-23',StartTime:'2026-10-23T00:00:00',lesson_stage:'preparation_saved',
   lesson_reflection:formatReflection({objective:'Beta objective'}),materials_notes:'',Writing_Sample_Link:url(B,'Asha','2026-10-23',s3,p4,'writing','beta.jpg'),lesson_evidence_history:[]},
  // Older copied record without lesson stage: files on the same row are its evidence.
  {...common,id:90,Center:A,Institution:A,FullName:'Bina',Grade:'LKG',Section:'',Subject:'Phonics / Literacy',Book:'Letter sounds',implementation_date:'2026-10-25',StartTime:'2026-10-25T00:00:00',submitted_at:'2026-10-25T09:00:00',
   lesson_reflection:'',materials_notes:'',Video_Evidence_1:url(A,'Bina','2026-10-25','legacy','legacy','activity','old.mp4'),Phonics_Evidence_Link:url(A,'Bina','2026-10-25','legacy','legacy','phonics','ph.jpg')},
  // Outside the period: must not appear.
  {...common,id:80,Center:A,Institution:A,FullName:'Bina',Grade:'LKG',Subject:'English',Book:'Old lesson',implementation_date:'2026-09-01',StartTime:'2026-09-01T00:00:00',submitted_at:'2026-09-01T09:00:00',Video_Evidence_1:url(A,'Bina','2026-09-01','x','x','activity','sep.jpg')}
 ];
}
export const reviews=[{record_id:'101',school:'Alpha School',teacher:'Asha',status:'Reviewed',feedback:'Strong modelling. Next, give pairs a timed blending challenge.',reviewer:'consultant@example.test',updated_at:'2026-10-27T10:30:00+00:00'}];
// Consultant observation that resembles lesson 101 by school/teacher/date/topic but has no lesson identity.
export const visits=[{id:7,school:'Alpha School',teacher:'Asha',class_section:'Grade 2',subject:'English',topic:'Blending CVC words',visit_date:'2026-10-24',high_points:'Observation only',recommendations:'',flow_of_class:''}];
export const raw=()=>({records:rawRecords(),reviews,visits,roster:[{school:'Alpha School',name:'Asha'},{school:'Alpha School',name:'Bina'},{school:'Beta School',name:'Asha'}]});
