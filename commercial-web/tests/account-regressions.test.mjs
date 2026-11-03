import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizePhone} from '../lib/auth.js';
test('teacher mobile login accepts Indian local and international formatted numbers',()=>{
 for(const s of ['9876543210','09876543210','91 98765 43210','+91 (98765) 43210'])assert.equal(normalizePhone(s),'+919876543210');
 assert.equal(normalizePhone('+44 7700-900123'),'+447700900123');
});
test('invalid text must never silently resolve to a different login',()=>{
 for(const s of ['abc1234567890','98765a43210','98765/43210','++919876543210','98765.43210','123',''])assert.equal(normalizePhone(s),'');
});
test('no provisioning route opts new accounts out of first-login password change',()=>{
 for(const route of ['admin','bulk','consultants']){
 const src=readFileSync(new URL('../app/api/'+route+'/route.js',import.meta.url),'utf8');
 assert.doesNotMatch(src,/must_change_password\s*:\s*false/);assert.match(src,/must_change_password\s*:\s*true/);
 }
});
