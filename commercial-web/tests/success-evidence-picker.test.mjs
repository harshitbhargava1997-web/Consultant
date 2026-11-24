// Add evidence: the lesson-day dropdown lists lessons planned up to today (newest first); period labels.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'next/dist/build/swc/index.js';
const src=readFileSync(new URL('../app/school-success/ui/lesson-evidence.jsx',import.meta.url),'utf8');
// Load only the two pure helpers (the component itself needs a browser).
const pick=name=>src.slice(src.indexOf('export function '+name),src.indexOf('\n}\n',src.indexOf('export function '+name))+2);
const code=transformSync(pick('evidenceDayChoices')+pick('periodLabel'),{jsc:{parser:{syntax:'ecmascript'}},module:{type:'commonjs'}}).code;
const mod={exports:{}};new Function('module','exports',code)(mod,mod.exports);
const {evidenceDayChoices,periodLabel}=mod.exports;
test('day dropdown: lessons planned on or before today, newest first; future and unlinked lessons left out',()=>{
 const lessons=[{id:'a',plannedOn:'2026-11-20',resumeToken:'ta',periods:[{}]},{id:'b',plannedOn:'2026-11-24',resumeToken:'tb',periods:[{}]},{id:'c',plannedOn:'2026-11-25',resumeToken:'tc',periods:[{}]},{id:'d',plannedOn:'2026-11-22',periods:[{}]}];
 assert.deepEqual(evidenceDayChoices(lessons,'2026-11-24').map(l=>l.id),['b','a']);
 assert.deepEqual(evidenceDayChoices(undefined,'2026-11-24'),[]);
});
test('period labels show class, section and subject; "Not Applicable" sections are hidden',()=>{
 assert.equal(periodLabel({grade:'Grade 2',section:'A',subject:'English'},0),'Period 1 · Grade 2 A · English');
 assert.equal(periodLabel({grade:'Grade 5',section:'Not Applicable',subject:'Mathematics'},2),'Period 3 · Grade 5 · Mathematics');
 assert.equal(periodLabel({grade:'Grade 2',section:'A',subject:'English'},1,'hi'),'कालांश 2 · Grade 2 A · English');
});
