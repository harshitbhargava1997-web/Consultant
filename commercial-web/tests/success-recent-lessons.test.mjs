// Teacher home "Recent lessons": every lesson planned up to today (with or without evidence), newest first.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'next/dist/build/swc/index.js';
const src=readFileSync(new URL('../app/school-success/ui/teacher-summary.jsx',import.meta.url),'utf8');
const pick=name=>src.slice(src.indexOf('export function '+name),src.indexOf('\n}\n',src.indexOf('export function '+name))+2);
const code=transformSync(pick('recentLessons')+pick('monthStats'),{jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}).code;
const mod={exports:{}};new Function('module','exports',code)(mod,mod.exports);
const {recentLessons,monthStats}=mod.exports;
const L=(id,plannedOn,evidence,periods=1)=>({id,plannedOn,evidence,periods:Array.from({length:periods},()=>({evidence}))});
const summary={today:'2026-11-24',feedback:[],lessons:[L('a','2026-11-20',true),L('b','2026-11-24',false),L('c','2026-11-26',false),L('d','2026-11-23',false,2)]};
test('recent lessons include lessons with and without evidence, exclude future ones, newest first',()=>{
 assert.deepEqual(recentLessons(summary).map(l=>l.id),['b','d','a']);
 assert.deepEqual(recentLessons(null),[]);
});
test('the month strip counts periods with evidence, without implying every lesson needs it',()=>{
 const s=monthStats(summary);assert.equal(s.withEvidence,1);assert.equal(s.planned,5,'class periods, a two-period lesson counts twice');assert.equal(s.upcoming,1);
});
test('no "needing evidence" or overdue wording remains on the teacher home',()=>{
 assert.doesNotMatch(src,/needing evidence|प्रमाण बाकी|All caught up/);
 assert.doesNotMatch(readFileSync(new URL('../app/school-success/ui/lesson-evidence.jsx',import.meta.url),'utf8'),/evidence needed/);
});
