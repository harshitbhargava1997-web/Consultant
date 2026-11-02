import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
import {fiveSets,wordType,wordCue} from '../lib/taught-word-grids.js';
test('every published Dolch word has a group; tricky words have a teaching cue',()=>{
 const sql=fs.readFileSync(new URL('../migrations/dolch-sight-words.sql',import.meta.url),'utf8');
 const words=[...sql.matchAll(/'sight-word', '([^']+)'/g)].map(m=>m[1]);assert.equal(words.length,92);
 for(const w of words){assert.ok(['phonetic','tricky'].includes(wordType(w)),w);if(wordType(w)==='tricky')assert.ok(wordCue(w));}
 assert.equal(wordType('said'),'tricky');assert.equal(wordType('ship'),'unclassified');assert.equal(wordType('black'),'phonetic');
});
test('five-pattern sets cover the bank and only pad the final group with earlier review items',()=>{
 for(const count of [8,13,20]){const bank=Array.from({length:count},(_,i)=>i);const groups=fiveSets(bank);assert.deepEqual([...new Set(groups.flat())],bank);assert.ok(groups.every(g=>g.length===5&&new Set(g).size===5));}
});
