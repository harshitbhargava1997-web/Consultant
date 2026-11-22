import test from 'node:test';import assert from 'node:assert/strict';
import {guide,requiredKeys,withPlanning,planningIssue,planSubmissions,planProblem,schoolDays,nextSchoolDay,isSunday,MAX_WEEKLY_DAYS} from '../lib/school-success/planning-guide.js';
import {parseLessonPlan} from '../lib/school-success/lesson-records.js';
import {submissionSchema} from '../lib/school-success/teacher-submissions.js';
const id=()=>crypto.randomUUID();
const answersFor=text=>Object.fromEntries(guide.map(([key])=>[key,text]));
const block=(extra={})=>withPlanning({id:id(),submissionId:id(),grade:'',section:'A',subject:'',topic:'LP 12 — Leaves',...extra},{answers:answersFor('Children sort leaves and explain.'),answerLanguage:'en'});

test('fields follow the lesson order with I do / We do / You do, no field is labelled optional, and three are required',async()=>{
 assert.deepEqual(guide.map(g=>g[0]),['objective','materials','teacher','student','practice','review','classwork']);
 assert.deepEqual(guide.map(g=>g[1][0]),['Learning outcome','Teaching-learning materials','Teacher activity (I do)','Student activity and participation (We do)','Practice and apply (You do)','Check learning and next steps','Classwork and homework']);
 for(const [key,titles,placeholders,max] of guide){
  assert.equal(titles.length,2,key);assert.equal(placeholders.length,2,key);assert.ok(placeholders.every(Boolean),key);assert.ok(max>0,key);
  assert.ok(!titles.some(t=>/optional|वैकल्पिक/i.test(t)),'no "optional" label: '+key);
 }
 assert.deepEqual(requiredKeys,[],'no planning field is mandatory');
 const mod=await import('../lib/school-success/planning-guide.js');assert.equal(mod.blooms,undefined);assert.equal(mod.homework,undefined);
});

test('answers keep the existing saved lesson structure in English and Hindi; classwork and homework come after the learning check',()=>{
 for(const lang of ['en','hi']){
  const answers={...answersFor(lang==='hi'?'बच्चे पत्तियाँ छाँटेंगे।':'Children sort leaves.'),review:'Ask each child to explain.',classwork:'Workbook page 12. Homework: observe a leaf at home.'};
  const p=withPlanning({id:id(),grade:'Grade 2',section:'A',subject:'EVS',topic:'Leaves'},{answers,answerLanguage:lang});
  assert.equal(planningIssue(p),'');
  const parsed=JSON.stringify(parseLessonPlan(p.reflection,p.materials));
  for(const v of Object.values(answers))assert.ok(parsed.includes(v),v);
  assert.ok(p.reflection.indexOf(answers.review)<p.reflection.indexOf(answers.classwork),'classwork and homework after the review');
  submissionSchema.parse({id:id(),school:'Alpha',teacher:'Asha',date:'2026-11-23',periods:[p],files:[]});
 }
 const maxed=withPlanning({grade:'Grade 2',subject:'English',topic:'Leaves'},{answerLanguage:'hi',answers:Object.fromEntries(guide.map(([k,,,max])=>[k,'अ'.repeat(max)]))});
 assert.equal(planningIssue(maxed),'');assert.ok(maxed.reflection.length<=5000,'maximum answers fit the existing limit');
 const old=withPlanning({grade:'Grade 2',subject:'EVS',topic:'Leaves'},{answers:{objective:'x',homework:'Earlier draft homework'},answerLanguage:'en'});
 assert.match(old.reflection,/Classwork and homework:\nEarlier draft homework/,'earlier drafts keep their homework');
});

test('no planning field is mandatory; only class, subject and topic identify the lesson',()=>{
 const empty=withPlanning({grade:'Grade 2',subject:'EVS',topic:'Leaves'},{answers:{},answerLanguage:'en'});
 assert.equal(planningIssue(empty),'','a plan may be submitted with every field blank');
 submissionSchema.parse({id:id(),school:'Alpha',teacher:'Asha',date:'2026-11-23',periods:[{id:id(),...empty}],files:[]});
 assert.equal(planningIssue({...empty,topic:' '}),'details');
 assert.equal(planningIssue({...empty,subject:''}),'details');
 assert.equal(planningIssue({...empty,date:''},{needsDate:true}),'date');
});

test('school days skip Sundays',()=>{
 assert.equal(isSunday('2026-11-22'),true);
 assert.equal(nextSchoolDay('2026-11-21'),'2026-11-23','Saturday → Monday');
 assert.deepEqual(schoolDays('2026-11-22',3),['2026-11-23','2026-11-24','2026-11-25']);
 assert.deepEqual(schoolDays('2026-11-26',4),['2026-11-26','2026-11-27','2026-11-28','2026-11-30']);
});

test('a daily plan is one submission for one date with several periods, each with its own class and subject',()=>{
 const blocks=[block({grade:'Grade 2',section:'A',subject:'English'}),block({grade:'Grade 1',section:'B',subject:'Mathematics'})];
 const shared={submissionId:id(),grade:'',section:'A',subject:''};
 const subs=planSubmissions({type:'daily',date:'2026-11-23',shared,blocks,school:'Alpha',teacher:'Asha'});
 assert.equal(subs.length,1);assert.equal(subs[0].id,shared.submissionId);assert.equal(subs[0].date,'2026-11-23');
 assert.deepEqual(subs[0].periods.map(p=>[p.grade,p.section,p.subject]),[['Grade 2','A','English'],['Grade 1','B','Mathematics']]);
 for(const p of subs[0].periods){assert.equal(p.answers,undefined);assert.equal(p.submissionId,undefined);assert.equal(p.date,undefined);}
 submissionSchema.parse({...subs[0],files:[]});
 assert.equal(planProblem({type:'daily',date:'',shared,blocks}),'date');
 assert.equal(planProblem({type:'daily',date:'2026-11-23',shared,blocks}),'');
});

test('a weekly subject plan saves one submission per day, each with its own date and the shared class and subject',()=>{
 const shared={submissionId:id(),grade:'Grade 2',section:'A',subject:'English'};
 const days=schoolDays('2026-11-23',5),blocks=days.map((date,i)=>block({date,topic:'LP '+(12+i)}));
 const subs=planSubmissions({type:'weekly',shared,blocks,school:'Alpha',teacher:'Asha'});
 assert.equal(subs.length,5);
 assert.deepEqual(subs.map(s=>s.date),days);
 assert.deepEqual(subs.map(s=>s.id),blocks.map(b=>b.submissionId),'stable submission IDs make retries safe');
 assert.equal(new Set(subs.map(s=>s.id)).size,5);
 for(const [i,s] of subs.entries()){
  assert.equal(s.periods.length,1);const [p]=s.periods;
  assert.deepEqual([p.grade,p.section,p.subject,p.topic,p.id],['Grade 2','A','English','LP '+(12+i),blocks[i].id]);
  submissionSchema.parse({...s,files:[]});
 }
 assert.equal(planProblem({type:'weekly',shared,blocks}),'');
 assert.equal(planProblem({type:'weekly',shared:{...shared,subject:''},blocks}),'subject');
 assert.equal(planProblem({type:'weekly',shared,blocks:[blocks[0],{...blocks[1],date:blocks[0].date}]}),'duplicate-date');
 assert.equal(planProblem({type:'weekly',shared,blocks:Array.from({length:MAX_WEEKLY_DAYS+1},(_,i)=>block({date:'2026-12-0'+(i+1)}))}),'count');
});
