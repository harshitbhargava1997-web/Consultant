import test from 'node:test';
import assert from 'node:assert/strict';
import {attachSpeechSession} from '../lib/school-success/speech-session.js';
function fixture(){let active=true,scheduled,starts=0;const errors=[];const r={start(){starts++;},abort(){}};const session=attachSpeechSession(r,{active:()=>active,onUnavailable:e=>errors.push(e),schedule:fn=>{scheduled=fn;return 1;},cancel:()=>{scheduled=null;}});return {r,session,errors,tick:()=>scheduled?.(),stop:()=>{active=false;},starts:()=>starts};}
test('silence restarts recognition without ending recording',()=>{const f=fixture();f.session.start();f.r.onerror({error:'no-speech'});f.r.onend();f.tick();assert.equal(f.starts(),2);assert.deepEqual(f.errors,[]);});
test('network failures retry twice then leave audio available with an explicit warning',()=>{const f=fixture();for(let i=0;i<3;i++){f.r.onerror({error:'network'});f.r.onend();f.tick();}assert.equal(f.starts(),2);assert.deepEqual(f.errors,['network']);});
test('permission rejection does not retry endlessly',()=>{const f=fixture();f.r.onerror({error:'not-allowed'});f.r.onend();f.tick();assert.equal(f.starts(),0);assert.deepEqual(f.errors,['not-allowed']);});
test('stop and unmount cancel queued recognition restart',()=>{const f=fixture();f.r.onend();f.stop();f.tick();assert.equal(f.starts(),0);f.session.dispose();assert.equal(f.r.onend,null);assert.equal(f.r.onresult,null);});
test('synchronous recognition failure is reported without throwing away audio',()=>{const f=fixture();f.r.start=()=>{throw Error('service unavailable');};assert.doesNotThrow(()=>f.session.start());assert.deepEqual(f.errors,['service unavailable']);});
