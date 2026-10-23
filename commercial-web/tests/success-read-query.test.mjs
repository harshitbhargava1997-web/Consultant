import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readScope,recordQuery,readAllPages} from '../lib/school-success/read-query.js';

test('school and teacher predicates reach the database without broadening the date predicate',()=>{
 const a={role:'admin',allowedSchools:['School, "A"']},q=recordQuery('2026-10-01','2026-10-23',a);
 assert.match(q.or,/StartTime.gte.2026-10-01T00:00:00/);assert.match(q.and,/Center.in/);assert.match(q.and,/Center.is.null/);assert.match(q.and,/School, \\"A\\"/);
 assert.deepEqual(readScope({role:'admin',allowedSchools:null},true),{});
 assert.deepEqual(readScope({role:'school-teacher',allowedSchools:['S'],school:'S',name:'Teacher',email:'uploader'},true),{Center:'eq."S"',FullName:'eq."Teacher"',Uploaded_By:'eq."uploader"'});
 assert.throws(()=>readScope({allowedSchools:[]}),/No assigned/);
});
test('bounded parallel pagination retains every ordered row without requesting absent pages',async()=>{
 let running=0,peak=0;const calls=[],rows=Array.from({length:107},(_,i)=>i);
 const result=await readAllPages(async(offset,count)=>{calls.push(offset);running++;peak=Math.max(peak,running);await new Promise(resolve=>setTimeout(resolve,2));running--;return{rows:rows.slice(offset,offset+10),count:count?rows.length:null};},{pageSize:10,concurrency:4});
 assert.deepEqual(result,rows);assert.equal(new Set(calls).size,calls.length);assert.equal(Math.max(...calls),100);assert(peak<=4&&peak>1);
});
test('unknown totals and overflow fail safely without silently dropping records',async()=>{
 const rows=Array.from({length:27},(_,i)=>i);
 assert.deepEqual(await readAllPages(async n=>({rows:rows.slice(n,n+10),count:null}),{pageSize:10}),rows);
 await assert.rejects(()=>readAllPages(async()=>({rows:[1,2],count:21}),{pageSize:2,maxRows:20}),/Too many/);
 await assert.rejects(()=>readAllPages(async n=>({rows:[n,n+1],count:null}),{pageSize:2,maxRows:6}),/Too many/);
});
