// R2 storage operations for lesson-documentation PDF snapshots, shared by the store/view routes and the
// real-storage self-check (scripts/r2-snapshot-selfcheck.mjs), so the check exercises production code.
// Snapshots are written once (content-derived ID, HEAD then PUT with If-None-Match: *) and never replaced.
import {r2Request,r2Diagnostics,describeR2,logR2Failure} from './r2-evidence.js';
import {sealSnapshot,openSnapshot,snapshotId,snapshotKey,sha256Hex} from './report-snapshots.js';
import {shareKey,revokedKey,newShareSecret,secretDigest,sealShareRecord,openShareRecord} from './report-shares.js';

async function storageFailure(stage,op,res,message,advice){
 const d=await r2Diagnostics(op,res);logR2Failure(stage,d);
 const error=Error(`503:${message} (${describeR2(d)}). ${advice}`);error.r2=d;return error;
}
const discard=res=>{try{res.body?.cancel();}catch{}};

// Only 404 means "absent"; any other unsuccessful answer (403, 5xx, …) is surfaced, never treated as
// permission to upload.
export async function snapshotExists(config,key,stage,advice='Retry the export.'){
 const res=await r2Request(config,key,'HEAD');discard(res);
 if(res.ok)return true;
 if(res.status===404)return false;
 throw await storageFailure(stage,'HEAD',res,'Report storage could not be checked',advice);
}

export async function storeSnapshotObject({config,secret,scope,pdf,createdBy,storedAt=new Date().toISOString()}){
 const sha256=await sha256Hex(pdf),id=await snapshotId(secret,scope,sha256),key=snapshotKey(id);
 if(await snapshotExists(config,key,'snapshot-precheck'))return {id,key,created:false};
 const envelope=await sealSnapshot(secret,id,{v:1,id,...scope,sha256,size:pdf.length,createdBy,storedAt},pdf);
 const put=await r2Request(config,key,'PUT',envelope,{'Content-Type':'application/octet-stream','If-None-Match':'*'});
 // 412: a concurrent identical request created it first; the content-derived ID guarantees the same PDF.
 if(!put.ok&&put.status!==412)throw await storageFailure('snapshot-put','PUT',put,'Lesson documentation could not be stored','Retry the export.');
 discard(put);
 if(!(await snapshotExists(config,key,'snapshot-confirm')))throw Error('503:Lesson documentation could not be confirmed in storage. Retry the export.');
 return {id,key,created:put.ok};
}

export async function loadSnapshotObject({config,secret,id}){
 const key=snapshotKey(id),res=await r2Request(config,key,'GET');
 if(res.status===404){discard(res);throw Error('404:Lesson documentation not found');}
 if(!res.ok)throw await storageFailure('snapshot-get','GET',res,'Lesson documentation could not be read from storage','Try again shortly.');
 return openSnapshot(secret,id,await res.arrayBuffer());
}

// ── Sharing links (see report-shares.js) ─────────────────────────────────────────────────────────────
// Records and revocation markers are written once (If-None-Match: *) and never replaced.
async function putOnce(config,key,body,stage,message){
 const put=await r2Request(config,key,'PUT',body,{'Content-Type':'application/octet-stream','If-None-Match':'*'});
 if(!put.ok&&put.status!==412)throw await storageFailure(stage,'PUT',put,message,'Try again.');
 discard(put);
 if(!(await snapshotExists(config,key,stage+'-confirm','Try again.')))throw Error(`503:${message}. Try again.`);
 return put.ok;
}
export async function createShareObject({config,secret,snapshotId,school,createdBy,createdAt=new Date().toISOString()}){
 const id=crypto.randomUUID(),shareSecret=newShareSecret();
 const record={v:1,id,snapshotId,school,secretSha256:await secretDigest(shareSecret),createdBy,createdAt};
 await putOnce(config,shareKey(id),await sealShareRecord(secret,id,'share',record),'share-put','The sharing link could not be saved');
 return {id,shareSecret,record};
}
export async function loadShareObject({config,secret,id}){
 const res=await r2Request(config,shareKey(id),'GET');
 if(res.status===404){discard(res);throw Error('404:This sharing link is not valid');}
 if(!res.ok)throw await storageFailure('share-get','GET',res,'The sharing link could not be checked','Try again shortly.');
 return openShareRecord(secret,id,'share',await res.arrayBuffer());
}
// Fails closed: anything other than "marker absent" (404) or "present" (200) refuses access.
export async function shareRevocation({config,secret,id}){
 const res=await r2Request(config,revokedKey(id),'GET');
 if(res.status===404){discard(res);return null;}
 if(!res.ok)throw await storageFailure('share-revocation','GET',res,'The sharing link could not be checked','Try again shortly.');
 try{return await openShareRecord(secret,id,'revoked',await res.arrayBuffer());}catch{return {id,revokedAt:null};}
}
export async function revokeShareObject({config,secret,id,revokedBy,revokedAt=new Date().toISOString()}){
 const created=await putOnce(config,revokedKey(id),await sealShareRecord(secret,id,'revoked',{v:1,id,revokedBy,revokedAt}),'share-revoke','The sharing link could not be revoked');
 return {revoked:true,alreadyRevoked:!created};
}
