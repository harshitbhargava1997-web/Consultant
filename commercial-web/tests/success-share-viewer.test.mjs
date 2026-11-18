// Sharing-link helpers: viewer page logic, link parsing, export-side creation and the usage-PDF wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import {openSharedLesson} from '../lib/school-success/share-viewer.js';
import {parseShareLink,shareLink,isShareSecret,newShareSecret,sealShareRecord,openShareRecord,sameDigest} from '../lib/school-success/report-shares.js';
import {createShareLink} from '../lib/school-success/lesson-snapshots.js';
const ID='0b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f60',SECRET='A'.repeat(43);

test('viewer: the secret comes only from the fragment and is posted, never put in a URL',async()=>{
 const calls=[],went=[];
 const state=await openSharedLesson({id:ID,hash:'#'+SECRET,request:async(id,secret)=>{calls.push([id,secret]);return Response.json({url:'/api/school-success/report-shares/'+ID+'?ticket=t',downloadUrl:'/x&download=1',filename:'Lesson_Documentation.pdf'});},navigate:u=>went.push(u)});
 assert.deepEqual(calls,[[ID,SECRET]]);assert.deepEqual(went,['/api/school-success/report-shares/'+ID+'?ticket=t']);assert.equal(state.state,'opening');
 assert.ok(!went[0].includes(SECRET));
});
test('viewer: incomplete, revoked, invalid and unreachable links show clear messages and never navigate',async()=>{
 const nav=()=>assert.fail('must not navigate');
 assert.match((await openSharedLesson({id:ID,hash:'',request:()=>assert.fail(),navigate:nav})).message,/incomplete/);
 assert.match((await openSharedLesson({id:'nope',hash:'#'+SECRET,request:()=>assert.fail(),navigate:nav})).message,/incomplete/);
 const r410=await openSharedLesson({id:ID,hash:'#'+SECRET,request:async()=>Response.json({error:'This sharing link has been revoked by the school. Ask the sender for a new link.'},{status:410}),navigate:nav});
 assert.equal(r410.state,'revoked');assert.match(r410.message,/revoked/);
 assert.match((await openSharedLesson({id:ID,hash:'#'+SECRET,request:async()=>Response.json({error:'This sharing link is not valid. Ask the sender for a new link.'},{status:404}),navigate:nav})).message,/not valid/);
 assert.match((await openSharedLesson({id:ID,hash:'#'+SECRET,request:async()=>{throw new TypeError('Load failed');},navigate:nav})).message,/could not be reached/);
});
test('links: build and parse; secrets are 256-bit base64url; records are bound to their share ID and purpose',async()=>{
 const link=shareLink('https://vision.example',ID,SECRET);
 assert.equal(link,`https://vision.example/school-success/shared/${ID}#${SECRET}`);
 assert.equal(parseShareLink(link),ID);assert.equal(parseShareLink('https://x/school-success/report/'+ID),null,'private links are not share links');assert.equal(parseShareLink('nonsense'),null);
 const a=newShareSecret(),b=newShareSecret();assert.ok(isShareSecret(a)&&a!==b);
 const env=await sealShareRecord('k',ID,'share',{id:ID,snapshotId:'s'});
 assert.deepEqual(await openShareRecord('k',ID,'share',env),{id:ID,snapshotId:'s'});
 await assert.rejects(openShareRecord('k',ID,'revoked',env),/^Error: 404:/,'a share record cannot pose as a revocation marker');
 await assert.rejects(openShareRecord('other-key',ID,'share',env),/^Error: 404:/);
 assert.ok(sameDigest('ab','ab')&&!sameDigest('ab','ac')&&!sameDigest('ab','abc'));
});
test('export: share creation errors are permanent for 4xx (no retries) and retryable otherwise',async()=>{
 const fetcher=status=>async()=>Response.json({error:'x'},{status});
 await assert.rejects(createShareLink(fetcher(403),ID),e=>e.permanent===true);
 await assert.rejects(createShareLink(fetcher(503),ID),e=>e.permanent===false);
 await assert.rejects(createShareLink(fetcher(429),ID),e=>e.permanent===false);
 let sent;const ok=await createShareLink(async(url,init)=>{sent={url,init};return Response.json({id:ID,secret:SECRET,path:'/school-success/shared/'+ID});},'snap');
 assert.equal(ok.id,ID);assert.equal(sent.url,'/api/school-success/report-shares');assert.deepEqual(JSON.parse(sent.init.body),{snapshotId:'snap'});
});
