import test from 'node:test';
import assert from 'node:assert/strict';
import {mapLimited} from '../lib/school-success/parallel.js';
import {requestJson} from '../lib/school-success/request-json.js';
import {uploadEvidenceFile} from '../lib/school-success/storage-upload.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
test('uploads are bounded and drain after failure before the form can retry', async () => {
 const gates = [], started = [], finished = [];
 const job = mapLimited([0,1,2,3,4], async value => {
  started.push(value);
  await new Promise(resolve => { gates[value] = resolve; });
  finished.push(value);
  if (value === 1) throw Error('interrupted');
  return value;
 });
 let done = false;
 const result = job.catch(error => {done = true; return error;});
 await tick(); assert.deepEqual(started, [0,1,2]);
 gates[1](); await tick(); assert.equal(done, false);
 gates[0](); gates[2]();
 assert.match((await result).message, /interrupted/);
 assert.deepEqual(started, [0,1,2]); assert.equal(finished.length, 3);
 assert.deepEqual(await mapLimited([1,2,3,4,5], async n => n*2), [2,4,6,8,10]);
});

test('lost save responses retry the same immutable request and recover one receipt', async () => {
 const saved = new Set(), ids = [], delays = [];
 const requestId = crypto.randomUUID();
 const result = await requestJson(async () => {
  ids.push(requestId); saved.add(requestId);
  if (ids.length === 1) throw TypeError('Load failed');
  if (ids.length === 2) return new Response(new ReadableStream({start(c) {c.error(TypeError('response interrupted'));}}));
  return Response.json({saved: true, id: requestId});
 }, {wait: async n => delays.push(n)});
 assert.equal(result.id, requestId); assert.equal(saved.size,1);
 assert.deepEqual(ids,[requestId,requestId,requestId]); assert.equal(delays.length,2);
});

test('permission and missing-file responses return without retry, while transient outages are bounded', async () => {
 for (const status of [401,403,409]) {
  let calls=0;
  await assert.rejects(requestJson(async () => {calls++;return Response.json({error:'Check file',fileId:'f'}, {status});}),
   error => error.status===status && error.fileId==='f');
  assert.equal(calls,1);
 }
 let calls=0;
 await assert.rejects(requestJson(async()=>{calls++;throw TypeError('Load failed');},{wait:async()=>{}}),/Connection interrupted/);
 assert.equal(calls,3);
});

test('bundled permissions avoid a ticket request; failed ticket requests also recover', async () => {
 let tickets=0, puts=0;
 const initialTicket={url:'https://storage.example.test/object',contentType:'image/jpeg',file:'activity'};
 const timeout=AbortSignal.timeout;
 try {
  AbortSignal.timeout=undefined; // Older clients still support AbortController.
  const ok=await uploadEvidenceFile({initialTicket,body:new Blob(['abc']),fetchTicket:async()=>{tickets++;throw Error('unneeded');},
   put:async(_url,init)=>{assert.ok(init.signal instanceof AbortSignal);puts++;return new Response(null,{status:200});}});
  assert.equal(ok.status,200);assert.equal(tickets,0);assert.equal(puts,1);
 } finally {AbortSignal.timeout=timeout;}
 const retry=await uploadEvidenceFile({body:new Blob(['abc']),wait:async()=>{},
  fetchTicket:async()=>{tickets++;if(tickets===1)throw TypeError('Load failed');return Response.json(initialTicket);},
  put:async()=>new Response(null,{status:200})});
 assert.equal(retry.status,200);assert.equal(tickets,2);
});
