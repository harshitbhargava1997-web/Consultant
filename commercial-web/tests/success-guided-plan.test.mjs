import test from 'node:test';import assert from 'node:assert/strict';
import {guide,blooms,withPlanning,planningIssue} from '../lib/school-success/planning-guide.js';
import {parseLessonPlan} from '../lib/school-success/lesson-records.js';
import {submissionSchema} from '../lib/school-success/teacher-submissions.js';
test('guided bilingual answers retain existing saved lesson structure, questions and homework',()=>{
 for(const lang of ['en','hi']){
  const answers=Object.fromEntries(guide.map(([key])=>[key,lang==='hi'?'बच्चे पत्तियाँ छाँटेंगे और कारण बताएँगे।':'Children sort leaves and explain.']));answers.questions='How are these leaves different?';answers.homework='Observe a leaf at home.';
  const p=withPlanning({id:crypto.randomUUID(),grade:'Grade 2',section:'A',subject:'EVS',topic:'Leaves'},{answers,answerLanguage:lang,bloomLevels:['analyse']});
  assert.equal(planningIssue(p),'');const parsed=parseLessonPlan(p.reflection,p.materials);
  assert.ok(JSON.stringify(parsed).includes(answers.questions));assert.ok(JSON.stringify(parsed).includes(answers.homework));
  submissionSchema.parse({id:crypto.randomUUID(),school:'Alpha',teacher:'Asha',date:'2026-11-21',periods:[p],files:[]});
  const switched=withPlanning(p,{answerLanguage:lang==='en'?'hi':'en'});assert.deepEqual(switched.answers,answers);
 }
});
test('incomplete starter blanks and unfilled Bloom questions cannot be submitted',()=>{
 const base={grade:'Grade 2',subject:'EVS',topic:'Leaves',answers:Object.fromEntries(guide.map(([k])=>[k,'Complete answer']))};
 assert.equal(planningIssue(withPlanning(base,{answers:{...base.answers,objective:'Students will ___'}})),'objective');
 assert.equal(planningIssue(withPlanning(base,{bloomLevels:['analyse']})),'teacher');
 assert.equal(planningIssue(withPlanning(base,{answers:{...base.answers,homework:'Do ___'}})),'practice');
 assert.equal(blooms.length,6);assert.ok(guide.every(c=>c.slice(1).every(pair=>pair.length===2)));
});
test('maximum guided answers and all thinking levels fit the existing submission limit',()=>{
 for(const answerLanguage of ['en','hi']){
  const p=withPlanning({grade:'Grade 2',subject:'English',topic:'Leaves'},{answerLanguage,bloomLevels:blooms.map(b=>b[0]),answers:{...Object.fromEntries(guide.map(([key])=>[key,'अ'.repeat(650)])),questions:'क'.repeat(450),homework:'ग'.repeat(300)}});
  assert.equal(planningIssue(p),'');assert.ok(p.reflection.length<=5000);
 }
});
