// Performance probes use expiring QA identities; no credentials are written to output.
import readline from 'node:readline';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const rl=readline.createInterface({input:process.stdin});
let key,runId,base,fixture,publicHeaders,adminBaseline;
async function qa(action){const r=await fetch('https://amtjvwroaennfypurkji.supabase.co/functions/v1/school-success-module-qa',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({action,runId}),signal:AbortSignal.timeout(90000)}),v=await r.json();if(!r.ok)throw Error(v.error);return v;}
async function api(path,headers,body){const start=performance.now(),r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...headers,...body===undefined?{}:{Origin:base,'Content-Type':'application/json'}},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)}),text=await r.text();let data;try{data=JSON.parse(text);}catch{throw Error('Non-JSON '+r.status+' '+path);}return {status:r.status,data,ms:Math.round(performance.now()-start),bytes:Buffer.byteLength(text),timing:r.headers.get('server-timing'),region:r.headers.get('x-vercel-id')?.split('::').slice(0,2).join('::')};}
async function measure(label,identityPath='/api/consultants?summary=1'){const rows=[];for(const [name,path,headers] of [['Vision identity',identityPath,{Authorization:'Bearer '+fixture.users.admin.token}],['School Success admin','/api/school-success/portal?from=2026-10-01&to=2026-10-23',{Authorization:'Bearer '+fixture.users.admin.token}],['School Success teacher','/api/school-success/portal?from=2026-10-01&to=2026-10-23',publicHeaders]]){
 const r=await api(path,headers);assert.equal(r.status,200,JSON.stringify(r.data));if(name==='School Success admin'){const normalized={entries:r.data.entries,archivedEntries:r.data.archivedEntries,roster:r.data.roster,archivedRoster:r.data.archivedRoster,reportSettings:r.data.reportSettings,calendars:r.data.calendars,crmArchive:r.data.crmArchive};const digest=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');if(!adminBaseline)adminBaseline=digest;else assert.equal(digest,adminBaseline,'Admin report/directory data changed during performance optimization');}
 rows.push({label,name,ms:r.ms,bytes:r.bytes,timing:r.timing,region:r.region,entries:r.data.entries?.length});}
 console.log(JSON.stringify(rows));}
console.log('Ready for performance configuration.');
for await(const line of rl){try{const msg=JSON.parse(line);if(!fixture){key=msg.key;runId=msg.runId;base=msg.base;fixture=await qa(msg.resume?'resume':'setup');const link=await api('/api/school-success/portal',{Authorization:'Bearer '+fixture.users.admin.token},{action:'schoolLink',school:fixture.schools[0].name});assert.equal(link.status,200);publicHeaders={'X-School-Link':new URL(link.data.url).searchParams.get('access'),'X-Teacher':encodeURIComponent('QA Teacher A')};console.log(JSON.stringify({qaRun:runId,browserLink:link.data.url}));}
 if(msg.base)base=msg.base;
 if(msg.mode==='cleanup'){console.log(JSON.stringify({cleanup:await qa('cleanup')}));break;}
 if(msg.mode==='workspace'){
  const admin=await api('/api/workspace',{Authorization:'Bearer '+fixture.users.admin.token});assert.equal(admin.status,200);assert.equal(admin.data.admin,true);assert(admin.data.schools.length>=8);assert.equal(admin.data.successAccess,true);
  for(const who of ['teacher','otherTeacher','consultant']){const own=await api('/api/workspace',{Authorization:'Bearer '+fixture.users[who].token});assert.equal(own.status,200);assert.equal(own.data.admin,false);assert.deepEqual(own.data.schools,[]);assert.deepEqual(own.data.memberships,[]);assert.deepEqual(own.data.permissionsByRole,{});}
  assert.equal((await api('/api/workspace',{})).status,401);console.log('PASS combined workspace identity: administrator, unassigned users and anonymous denial');continue;
 }
 await measure(msg.label||'measurement',msg.identityPath);
}catch(e){console.log('FAILED '+e.message);}console.log('Ready.');}
