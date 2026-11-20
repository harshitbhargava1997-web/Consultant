// Server-only. File selection never accepts JSON. The only client-assisted JSON write is for
// the exact validated reflection in this lesson, with a signed checksum and no-overwrite condition.
import {createHash} from 'node:crypto';
import {presignUpload} from './r2-upload.js';
import {r2Diagnostics, describeR2, logR2Failure} from './r2-evidence.js';
import {retryable} from './storage-upload.js';
import {mapLimited} from './parallel.js';

const type = 'application/json';
export async function reflectionUploadTicket(config, doc) {
 const constraints = {'Content-MD5': createHash('md5').update(doc.text, 'utf8').digest('base64'), 'If-None-Match': '*'};
 const url = await presignUpload(config, doc.key, type, constraints);
 return {url, text: doc.text, headers: {'Content-Type': type, ...constraints}};
}

async function storageError(op, response) {
 const detail = response ? await r2Diagnostics(op, response) : {op, status: 0, code: 'NetworkError', requestId: ''};
 const message = response ? describeR2(detail) : 'storage connection interrupted';
 const error = Error('503:Written reflection could not be saved (' + message + ').');
 error.detail = detail;
 error.transient = !response || retryable(detail) || detail.status === 409 || detail.status === 412;
 return error;
}

async function storageRequest(op, send) {
 try { return await send(); }
 catch { throw await storageError(op); }
}

async function matchesBytes(body, expected) {
 if (!body) return false;
 let offset = 0;
 // A streamed response can omit Content-Length. Stop reading as soon as it differs or exceeds the expected size.
 for await (const chunk of body) {
  const end = offset + chunk.byteLength;
  if (end > expected.length || !expected.subarray(offset, end).equals(chunk)) return false;
  offset = end;
 }
 return offset === expected.length;
}

async function confirmed(doc, get) {
 const res = await storageRequest('GET', () => get(doc.key));
 if (res.status === 404) { await res.body?.cancel(); return false; }
 if (!res.ok) throw await storageError('GET', res);
 const length = res.headers.get('content-length');
 const mismatch = () => Error('409:The saved reflection differs from this update. Your lesson was not changed.');
 if (length !== null && Number(length) !== doc.size) { await res.body?.cancel(); throw mismatch(); }
 const same = await storageRequest('GET', () => matchesBytes(res.body, Buffer.from(doc.text, 'utf8')));
 if (!same) throw mismatch();
 return true;
}

async function storeDocument(doc, get, put, wait) {
 for (let attempt = 1; ; attempt++) {
  try {
   if (await confirmed(doc, get)) return;
   // Also serves already-open forms and browsers that lost the direct upload.
   const headers = {'Content-Type': type, 'Content-Length': String(doc.size), 'If-None-Match': '*'};
   const res = await storageRequest('PUT', () => put(doc.key, doc.text, headers));
   if (!res.ok) throw await storageError('PUT', res);
   await res.body?.cancel();
   return;
  } catch (error) {
   if (!error.transient) throw error;
   if (attempt === 3) {
    // Storage may have accepted the last PUT even if its response was lost.
    if (error.detail.op === 'PUT' && await confirmed(doc, get)) return;
    throw error;
   }
   await wait(200 * attempt);
  }
 }
}

export async function storeReflectionDocuments(docs, {get, put, wait = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
 try {
  await mapLimited(docs, doc => storeDocument(doc, get, put, wait), 3);
 } catch (error) {
  if (error.detail) logR2Failure('written-reflection', error.detail);
  throw error;
 }
}
