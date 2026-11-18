// Browser upload of one evidence file: ticket (presigned PUT) from the server, then PUT straight to R2.
// Distinguishes a storage rejection (R2 answered, readable through CORS) from a network/CORS failure
// (fetch throws), retries transient answers with a fresh ticket, and reports safe diagnostics only:
// file kind, HTTP status, R2 error code, request reference, attempt. Never the signed URL, tokens,
// file names, contents or teacher details. The browser sets Content-Length from the Blob itself.
export const UPLOAD_ATTEMPTS=3;
export const uploadLabels={
 'generated-preparation-pdf':'lesson preparation PDF',lesson_plan:'lesson plan file',voice:'voice note',
 activity:'classroom activity file',writing:'student writing file',phonics:'phonics file',portfolio:'portfolio file',
 remedial:'remedial file',event:'event picture',closure:'after-class reflection',file:'file'};
const label=kind=>uploadLabels[kind]||'file';
const safeCode=v=>/^[A-Za-z0-9.]{1,64}$/.test(v||'')?v:'';
const safeRef=v=>String(v||'').replace(/[^A-Za-z0-9-]/g,'').slice(0,64);

// R2 error bodies are S3-style XML; CORS exposes only ETag, so the reference comes from the body if present.
export async function storageOutcome(res){
 let text='';try{text=(await res.text()).slice(0,4096);}catch{}
 return {kind:'storage',status:res.status,code:safeCode((text.match(/<Code>([^<]*)<\/Code>/)||[])[1]),ref:safeRef((text.match(/<RequestId>([^<]*)<\/RequestId>/)||[])[1]||res.headers.get('cf-ray'))};
}
export const retryable=o=>o.kind==='network'||o.status>=500||[408,429].includes(o.status)||['RequestTimeout','SlowDown','InternalError','ServiceUnavailable'].includes(o.code);
export function uploadMessage(o){
 const what=label(o.file),keep='Your lesson details and selected files are kept on this page — save again to retry.';
 if(o.kind==='network')return `Storage upload failed: the ${what} could not reach storage (network connection lost or the browser blocked the upload). ${keep}`;
 return `Storage upload failed: storage refused the ${what} (R2 ${o.status}${o.code?' '+o.code:''}${o.ref?', ref '+o.ref:''}). ${keep}`;
}

// fetchTicket(): Promise<Response> for POST /api/school-success/evidence/upload (already authenticated).
// put(url, init) is the browser fetch; report(outcome) is fire-and-forget.
export async function uploadEvidenceFile({fetchTicket,put=fetch,body,report=()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=UPLOAD_ATTEMPTS}){
 let outcome;
 for(let attempt=1;attempt<=attempts;attempt++){
  const ticket=await fetchTicket();
  if(!ticket.ok)return ticket; // permission/validation errors from our own API keep their message
  const value=await ticket.json(),file=value.file||'file';
  try{
   const res=await put(value.url,{method:'PUT',headers:{'Content-Type':value.contentType},body});
   if(res.ok){try{res.body?.cancel();}catch{}return Response.json({ok:true,attempts:attempt});}
   outcome={...await storageOutcome(res),file,attempt};
  }catch{outcome={kind:'network',status:0,code:'',ref:'',file,attempt};}
  const last=attempt===attempts||!retryable(outcome);
  try{report({...outcome,final:last});}catch{}
  if(last)break;
  await wait(1500*attempt);
 }
 return Response.json({error:uploadMessage(outcome),upload:outcome},{status:502});
}

// The server prepared the exact JSON and signed its checksum and no-overwrite condition. If this
// transfer is interrupted (or an earlier attempt already wrote it), commit verifies or stores it.
export async function transferWrittenReflections(tickets, put = fetch) {
 for (const {url, headers, text} of tickets) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
   const response = await put(url, {method: 'PUT', body: new Blob([text], {type: headers['Content-Type']}),
    headers, signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer'});
   await response.body?.cancel();
   if (!response.ok && response.status !== 412) return;
  } catch {
   // A blocked storage origin should add at most one timeout for the entire lesson.
   return;
  } finally { clearTimeout(timer); }
 }
}
