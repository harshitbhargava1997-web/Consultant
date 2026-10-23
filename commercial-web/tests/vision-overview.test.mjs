import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadOverviewTotals} from '../lib/overview.js';
import {activeSchoolError,changeSchoolStatus} from '../lib/school-lifecycle.js';

function database({failure=false,archived=false}={}){
 const calls=[];
 return {calls,from(table){
  const call={table,ops:[]};calls.push(call);
  const q=new Proxy({}, {get(_,key){
   if(key==='then')return (resolve,reject)=>Promise.resolve(result()).then(resolve,reject);
   return (...args)=>{call.ops.push([key,...args]);return q;};
  }});
  function result(){
   if(failure)return {error:{message:'database unavailable'}};
   if(table==='literacy_memberships'){
    const range=call.ops.find(x=>x[0]==='range');
    // 1,205 memberships, 1,200 distinct teachers, including cross-school assignments.
    return {data:Array.from({length:1205},(_,i)=>({user_id:'teacher-'+(i%1200)})).slice(range[1],range[2]+1)};
   }
   if(table==='literacy_consultant_assignments')return {data:[{consultant_user_id:'a'},{consultant_user_id:'a'},{consultant_user_id:'b'}]};
   if(call.ops.some(x=>x[0]==='maybeSingle'))return {data:{id:'12345678-1234-4234-8234-123456789abc',archived_at:archived?'2026-10-23':null,name:'Test'}};
   return {count:table==='literacy_students'?5001:table==='literacy_consultants'?2:8};
  }
  return q;
 }};
}
test('overview uses exact active-school counts and paginates unique teachers beyond 1,000 rows',async()=>{
 const db=database(),totals=await loadOverviewTotals(db,{isAdmin:true});
 assert.deepEqual(totals,{schools:8,teachers:1200,students:5001,consultants:2});
 assert.equal(db.calls.filter(x=>x.table==='literacy_memberships').length,3);
 assert.ok(db.calls.find(x=>x.table==='literacy_students').ops.some(x=>x[0]==='select'&&x[2].head&&x[2].count==='exact'));
 assert.ok(db.calls.every(x=>!x.table.startsWith('success_')));
 assert.ok(db.calls.filter(x=>x.table!=='literacy_consultants').every(x=>x.ops.some(op=>op[0]==='is'&&op[1].endsWith('archived_at'))));
});
test('non-admin overview is school-scoped and does not disclose unassigned consultants',async()=>{
 const db=database();assert.equal((await loadOverviewTotals(db,{isAdmin:false,schoolIds:['allowed']})).consultants,2);
 for(const call of db.calls)assert.ok(call.ops.some(x=>x[0]==='in'&&x[2][0]==='allowed'));
 assert.ok(!db.calls.some(x=>x.table==='literacy_consultants'));
 const empty=database();assert.deepEqual(await loadOverviewTotals(empty,{isAdmin:false}),{schools:0,teachers:0,students:0,consultants:0});assert.equal(empty.calls.length,0);
});
test('failed totals are not presented as zero',async()=>{
 await assert.rejects(()=>loadOverviewTotals(database({failure:true}),{isAdmin:true}),/unavailable/);
});
const id='12345678-1234-4234-8234-123456789abc',actor={isAdmin:true,user:{id:'admin'}};
test('only super admin can change school status, and invalid IDs never reach the database',async()=>{
 const db=database();assert.equal((await changeSchoolStatus(db,{...actor,isAdmin:false},id,true)).status,403);
 assert.equal((await changeSchoolStatus(db,actor,'invalid',true)).status,400);assert.equal(db.calls.length,0);
});
test('delete and restore only update lifecycle metadata; no historical rows are deleted',async()=>{
 for(const archived of [true,false]){
  const db=database(),result=await changeSchoolStatus(db,actor,id,archived);assert.equal(result.school.id,id);
  assert.equal(db.calls.length,1);assert.equal(db.calls[0].table,'literacy_schools');
  const update=db.calls[0].ops.find(x=>x[0]==='update')[1];assert.deepEqual(Object.keys(update).sort(),['archived_at','archived_by']);
  assert.equal(update.archived_by,archived?'admin':null);assert.equal(Boolean(update.archived_at),archived);
  assert.ok(!db.calls[0].ops.some(x=>x[0]==='delete'));
 }
 assert.equal((await activeSchoolError(database({archived:true}),id)).status,404);
 assert.equal(await activeSchoolError(database(),id),null);
 assert.equal((await activeSchoolError(database({failure:true}),id)).status,503);
});
test('duplicate consultant navigation is removed but allocation and other workspaces remain',()=>{
 const root=readFileSync(new URL('../app/page.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(root,/id:"consultants"|page==="consultants"|const ConsultantManagement=/);
 for(const id of ['assessment-structure','training','competencies','school-success','consultant'])assert.ok(root.includes('id:"'+id+'"'));
 const users=readFileSync(new URL('../app/SchoolManagementWorkspace.jsx',import.meta.url),'utf8');assert.match(users,/tab==="consultants"&&<ConsultantManagement/);
});
test('school-scoped privileged routes reject deleted schools, including Vision teacher links',()=>{
 for(const route of ['training','digital-content','assessment-evidence','implementation','progress','students','permissions','consultants']){
  assert.match(readFileSync(new URL('../app/api/'+route+'/route.js',import.meta.url),'utf8'),/await activeSchoolError\(/,route);
 }
 for(const file of ['app/api/bulk/route.js','lib/teacher-portal/server.js'])assert.match(readFileSync(new URL('../'+file,import.meta.url),'utf8'),/\.is\(['"]archived_at['"],null\)/);
});
