import test from 'node:test';import assert from 'node:assert/strict';import {examItems,priorPatternRatings} from '../lib/ukg-exams.js';
test('forms isolate examples and overlapping sl belongs to both teaching groups',()=>{
 const items=['blend-sl','ukg-form-b-blend-sl','ukg-form-b-blend-tr','ukg-form-c-blend-sk'].map(code=>({code,grapheme:code.slice(-2),family:'consonant-blend'}));
 for(const group of ['s','l'])assert.deepEqual(examItems(items,'consonant-blend','b',group),[items[1]]);
 assert.deepEqual(examItems(items,'consonant-blend','b','r'),[items[2]]);
});
test('targeted retest carries a sound gap between examples but not between pronunciations',()=>{
 const items=[{id:1,code:'vowel-oo-long'},{id:2,code:'ukg-form-b-vowel-oo-long'},{id:3,code:'vowel-oo-short'}];
 const p=priorPatternRatings([{item_id:2,competency_id:'x',rating:'Developing',observation_dimension:'sound'},{item_id:1,competency_id:'x',rating:'Independent'}],items,'x');
 assert.equal(p.get('vowel-oo-long::sound'),'Developing');assert.equal(p.get('vowel-oo-long::reading'),'Independent');assert.equal(p.has('vowel-oo-short::sound'),false);
});
