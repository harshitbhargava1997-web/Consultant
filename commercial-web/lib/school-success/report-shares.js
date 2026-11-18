// Sharing links for lesson-documentation PDF snapshots (approved: a recipient holding the link may view
// that one exported PDF without a portal account).
//
// A share is a separate credential, never the snapshot ID itself:
//   • share ID: random UUID (names the share record; useless on its own);
//   • secret: 256 random bits, carried in the link's #fragment (browsers never send fragments to servers,
//     so it stays out of request logs) and stored only as a SHA-256 digest.
// The share record {snapshotId, school, secretSha256, createdBy, createdAt} is AES-256-GCM encrypted
// (HKDF from SCHOOL_SUCCESS_SIGNING_KEY, own info string, AAD = share ID) in the existing bucket, like
// snapshots. Revocation writes an immutable encrypted marker beside it, checked on every open.
export const SHARE_PREFIX='school-success/report-shares/v1/';
export const SHARE_TICKET_TTL_MS=2*60*1000;
const MAGIC=new TextEncoder().encode('SSS1');
const enc=new TextEncoder(),dec=new TextDecoder();
export const isShareId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export const isShareSecret=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{43}$/.test(s);
const check=id=>{if(!isShareId(id))throw Error('404:This sharing link is not valid');return id;};
export const shareKey=id=>SHARE_PREFIX+check(id)+'.bin';
export const revokedKey=id=>SHARE_PREFIX+check(id)+'.revoked';
export const sharePagePath=id=>'/school-success/shared/'+check(id);
export const shareLink=(origin,id,secret)=>new URL(sharePagePath(id),origin).href+'#'+secret;
// Accepts a pasted sharing link and returns its share ID (the secret is not needed to manage a share).
export function parseShareLink(text){const m=String(text||'').match(/\/school-success\/(?:shared|secure)\/([0-9a-f-]{36})(?:[/?#]|$)/);return m&&isShareId(m[1])?m[1]:null;}

const b64url=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
export const newShareSecret=()=>b64url(crypto.getRandomValues(new Uint8Array(32)));
const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
export const secretDigest=async secret=>hex(await crypto.subtle.digest('SHA-256',enc.encode(secret)));
export function sameDigest(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}

async function key(secret){
 if(!secret)throw Error('503:Report sharing is not configured');
 const base=await crypto.subtle.importKey('raw',enc.encode(secret),'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('school-success'),info:enc.encode('report-share-aes-v1')},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
// Envelope: "SSS1" | 12-byte IV | AES-GCM(JSON), AAD = "<purpose>:<share ID>".
export async function sealShareRecord(secret,id,purpose,value){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(purpose+':'+check(id))},await key(secret),enc.encode(JSON.stringify(value))));
 const out=new Uint8Array(4+12+cipher.length);out.set(MAGIC,0);out.set(iv,4);out.set(cipher,16);return out;
}
export async function openShareRecord(secret,id,purpose,envelope){
 const bytes=new Uint8Array(envelope);
 if(bytes.length<4+12+16||dec.decode(bytes.subarray(0,4))!=='SSS1')throw Error('404:This sharing link is not valid');
 let value;
 try{value=JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(4,16),additionalData:enc.encode(purpose+':'+check(id))},await key(secret),bytes.subarray(16))));}
 catch{throw Error('404:This sharing link is not valid');}
 if(value?.id!==id)throw Error('404:This sharing link is not valid');
 return value;
}

// ── Consolidated-report access records (v2) ──────────────────────────────────────────────────────────
// One record per exported teacher/class/subject group: the full-evidence snapshot, its school and
// teacher, the access mode and the exact storage keys of the evidence the PDF links to. Evidence links
// inside the PDF go through the same record, so the chosen mode governs the report AND its evidence.
//   'link'   — anyone holding the link (secret in the #fragment) may open it, no account;
//   'signin' — School Success sign-in with access to the record's school is required.
export const ACCESS_MODES=['link','signin'];
export const MAX_EVIDENCE_PER_REPORT=2000;
// Lifetime of the signed storage URL handed out for one file after the access check. Storage validates
// only the signature and this expiry, so an already-issued URL keeps working for at most this long, even
// if the report is revoked meanwhile; every new open of a file link is checked again.
export const FILE_URL_TTL_SECONDS=900;
export const securePagePath=id=>'/school-success/secure/'+check(id);
export function reportLink(origin,mode,id,secret){return mode==='signin'?new URL(securePagePath(id),origin).href:shareLink(origin,id,secret);}
export function evidenceLink(origin,mode,id,n,secret){
 const path=(mode==='signin'?securePagePath(id):sharePagePath(id))+'/file/'+n;
 return new URL(path,origin).href+(mode==='signin'?'':'#'+secret);
}
// Storage key of an evidence URL served from the media bucket, or null for anything else.
export function evidenceKeyFromUrl(url,mediaBase){
 try{
  const u=new URL(url),b=new URL(String(mediaBase).replace(/\/$/,'')+'/');
  if(u.origin!==b.origin||!u.pathname.startsWith(b.pathname)||u.search||u.hash)return null;
  const key=u.pathname.slice(b.pathname.length).split('/').map(decodeURIComponent).join('/');
  return isEvidenceKey(key)?key:null;
 }catch{return null;}
}
const INTERNAL=['school-success/report-snapshots/','school-success/report-shares/','portal-connection-check/'];
export function isEvidenceKey(key){
 return typeof key==='string'&&key.length>0&&key.length<=1024&&!key.startsWith('/')&&!key.split('/').some(s=>s===''||s==='.'||s==='..')&&!INTERNAL.some(p=>key.startsWith(p))&&!/[\u0000-\u001f]/.test(key);
}
// Standard evidence keys name their school and teacher (schools/<school>/teachers/<teacher>/…); such a
// key must belong to the report's own school and teacher. Other (legacy) keys are accepted as included.
export function evidenceKeyInScope(key,school,teacher){
 if(!key.startsWith('schools/'))return true;
 const [,s,t,name]=key.split('/');
 try{return decodeURIComponent(s)===school&&t==='teachers'&&decodeURIComponent(name)===teacher;}catch{return false;}
}
