import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {activeTeacherNames,readModuleGrant,moduleGrantSchema} from '../lib/school-success/module-access.js';

test('School Success roster is independent of Vision mappings and excludes archives',()=>{
 const roster=[{school:'S',name:'A'},{school:'S',name:'B'},{school:'Other',name:'Foreign'}],members=[{school:'S',name:'A',role:'teacher'},{school:'S',name:'C',role:'teacher'},{school:'S',name:'Admin',role:'admin'}];
 assert.deepEqual(activeTeacherNames(roster,members,'S'),['A','B','C']);
 assert.deepEqual(activeTeacherNames(roster,members,'S',[{kind:'teacher',school:'S',teacher:'B',archived:true}]),['A','C']);
 assert.deepEqual(activeTeacherNames(roster,members,'S',[{kind:'school',school:'S',archived:true}]),[]);
});
test('consultant access requires an explicit enabled user ID grant with schools',()=>{
 const userId=randomUUID(),grant={userId,schools:['S','S'],enabled:true};
 assert.deepEqual(readModuleGrant(JSON.stringify(grant),userId).schools,['S']);
 assert.equal(readModuleGrant(grant,randomUUID()),null);
 assert.equal(readModuleGrant({...grant,enabled:false},userId),null);
 assert.equal(readModuleGrant({...grant,schools:[]},userId),null);
 assert.equal(readModuleGrant('invalid',userId),null);
 assert.equal(moduleGrantSchema.safeParse({...grant,userId:'Same name'}).success,false);
});
