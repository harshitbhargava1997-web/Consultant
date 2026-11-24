// School Success sign-in: mobile numbers use their internal sign-in address first; messages are School Success's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'next/dist/build/swc/index.js';
import {isEmail,normalizePhone,mobileLoginEmail} from '../lib/auth.js';
const src=readFileSync(new URL('../app/school-success/ui/success-sign-in.jsx',import.meta.url),'utf8');
const part=src.slice(src.indexOf('export function signInMessage'),src.indexOf('function Brand'));
const code=transformSync(part+'\nmodule.exports={signInMessage,signInWithLogin};',{jsc:{parser:{syntax:'ecmascript',jsx:true}},module:{type:'commonjs'}}).code;
const m={exports:{}};new Function('module','exports','isEmail','normalizePhone','mobileLoginEmail',code)(m,m.exports,isEmail,normalizePhone,mobileLoginEmail);
const fake=results=>{const calls=[];return {calls,auth:{signInWithPassword:async c=>{calls.push(c);return results.shift()||{error:null};}}};};
test('a mobile number signs in through its internal address, then phone; email signs in directly',async()=>{
 const ok=fake([{error:null}]);await m.exports.signInWithLogin(ok,'98000 00001','123456');
 assert.deepEqual(ok.calls,[{email:mobileLoginEmail(normalizePhone('9800000001')),password:'123456'}]);
 const both=fake([{error:{message:'Invalid login credentials'}},{error:{message:'Phone logins are disabled'}}]);
 await assert.rejects(m.exports.signInWithLogin(both,'9800000001','x'),/mobile number or password is not correct/);
 assert.equal(both.calls.length,2);assert.ok(both.calls[1].phone);
 const mail=fake([{error:null}]);await m.exports.signInWithLogin(mail,'Principal@School.test','123456');assert.deepEqual(mail.calls,[{email:'principal@school.test',password:'123456'}]);
 await assert.rejects(m.exports.signInWithLogin(fake([]),'12345','x'),/10-digit mobile number/);
});
test('sign-in messages never mention Vision',()=>{
 for(const e of [{message:'Invalid login credentials'},{message:'Email not confirmed'},{message:'Too many requests'}])assert.doesNotMatch(m.exports.signInMessage(e),/vision/i);
 assert.doesNotMatch(src.split('\n').filter(l=>!l.trim().startsWith('//')).join('\n'),/Vision/,'the School Success sign-in screen does not mention Vision');
});
