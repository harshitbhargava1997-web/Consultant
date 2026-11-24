// Who gave a review: new reviews save the reviewer's name and role; older ones fall back to their sign-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {appendRubric,readRubricRows} from '../lib/school-success/lesson-review-store.js';
import {reviewerRole,reviewerLabel,reviewerFromSignIn,feedbackTextWithReviewer} from '../lib/school-success/lesson-reviews.js';
const review={planning:{level:'A',note:'Clear outcome.'}};
function store(){const rows=new Map();return {rows,request:async(url,method,row)=>{if(method==='POST'){if(rows.has(row.id))return [];rows.set(row.id,row);return [{id:row.id}];}const id=new URL('http://x'+url.slice(url.indexOf('?'))).searchParams.get('id').slice(3);return rows.has(id)?[rows.get(id)]:[];}};}
test('a review saves the reviewer’s name and role, reads them back, and a retry stays idempotent',async()=>{
 const s=store(),req='11111111-2222-4333-8444-555555555555';
 const args={recordId:'101',school:'Alpha',reviewer:'9800000001@mobile.schoolsuccess.in',reviewerName:'Meera Rao',reviewerRole:'Principal',requestId:req,review};
 assert.deepEqual(await appendRubric(args,s.request),{saved:true});
 assert.deepEqual(await appendRubric(args,s.request),{saved:true,alreadySaved:true});
 const [row]=await readRubricRows(['101'],{},async()=>[...s.rows.values()]);
 assert.deepEqual(row.by,{name:'Meera Rao',role:'Principal'});assert.match(row.feedback,/Planning · A/);
});
test('older reviews without a name fall back to their sign-in: school leader or School Success team',async()=>{
 const s=store();
 await appendRubric({recordId:'102',school:'Alpha',reviewer:'consultant@example.test',requestId:'11111111-2222-4333-8444-555555555556',review},s.request);
 await appendRubric({recordId:'102',school:'Alpha',reviewer:'9800000002@mobile.schoolsuccess.in',requestId:'11111111-2222-4333-8444-555555555557',review},s.request);
 const rows=await readRubricRows(['102'],{},async()=>[...s.rows.values()]);
 assert.deepEqual(rows.map(r=>r.by.role).sort(),['School Success team','School leader']);
 assert.equal(reviewerFromSignIn(''),null);
});
test('roles and labels',()=>{
 assert.equal(reviewerRole({isSuperAdmin:true}),'Super Admin');
 assert.equal(reviewerRole({leader:true,title:'Coordinator'}),'Coordinator');
 assert.equal(reviewerRole({leader:true}),'School leader');
 assert.equal(reviewerRole({role:'admin'}),'Consultant');
 assert.equal(reviewerLabel({name:'Meera Rao',role:'Principal'}),'Meera Rao, Principal');
 assert.equal(reviewerLabel({name:'',role:'School leader'}),'School leader');
 assert.equal(feedbackTextWithReviewer([{text:'Planning · A',date:'',by:{name:'Meera Rao',role:'Principal'}}]),'Planning · A\n— Meera Rao, Principal');
 assert.equal(feedbackTextWithReviewer([{text:'Old note',date:''}]),'Old note','no reviewer, no line');
});
