import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../migrations/dolch-sight-words.sql',import.meta.url),'utf8');
for(const [grade,count,sets] of [['LKG',40,8],['UKG',52,11]]){
 test(grade+' taught sets cover each Dolch word exactly once before review',()=>{
  const rows=[...sql.matchAll(new RegExp("'DOLCH-"+grade+"-(\\d+)', 'sight-word', '([^']+)', '', '[^']+', 'Taught set (\\d+)'","g"))];
  assert.equal(rows.length,count);assert.equal(new Set(rows.map(r=>r[2])).size,count);
  rows.forEach(([_,sequence,word,set],i)=>{assert.equal(+sequence,i+1);assert.equal(+set,Math.floor(i/5)+1);});
  assert.equal(+rows.at(-1)[3],sets);
 });
}
