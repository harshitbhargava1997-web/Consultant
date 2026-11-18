// Stored lesson-documentation PDF snapshots for links inside Teacher 360° usage PDFs.
//
// Storage: the existing R2 bucket (server credentials only). The bucket is publicly readable, so every
// snapshot is encrypted with AES-256-GCM before upload; a URL guessed or copied from storage yields only
// ciphertext. The key is derived (HKDF-SHA-256) from the existing server secret SCHOOL_SUCCESS_SIGNING_KEY,
// and the snapshot ID is the authenticated data, so an envelope cannot be replayed under another ID.
// The scope (school, teacher, class, section, subject, period) travels inside the encrypted envelope and
// is checked against the reader's School Success grant on every open. No database table is required.
import {z} from 'zod';

export const SNAPSHOT_PREFIX='school-success/report-snapshots/v1/';
// Vercel Functions accept and return at most ~4.5 MB per request/response; keep PDFs under that.
export const MAX_SNAPSHOT_BYTES=4_000_000;
export const TICKET_TTL_MS=2*60*1000;
const MAGIC=new TextEncoder().encode('SSR1');
const enc=new TextEncoder(),dec=new TextDecoder();
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
const text=z.string().max(200);
export const snapshotScopeSchema=z.object({
 kind:z.literal('teacher-lesson-documentation'),school:text.min(1),teacher:text.min(1),grade:text,section:text,subject:text,
 from:day,to:day,generatedAt:z.string().datetime(),includeArchived:z.boolean().default(false),
 // 'full': complete evidence, opened only with school sign-in. 'shareable': redacted copy (no student
 // evidence, attachment links, reflection or review text) that may be opened through a sharing link.
 variant:z.enum(['full','shareable']).default('full')
}).strict().refine(s=>s.from<=s.to&&(Date.parse(s.to)-Date.parse(s.from))/86400000<=99,'Use a reporting period of at most 100 days');
export const isSnapshotId=id=>typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id);
export const snapshotKey=id=>{if(!isSnapshotId(id))throw Error('404:Lesson documentation not found');return SNAPSHOT_PREFIX+id+'.bin';};
export const snapshotPagePath=id=>'/school-success/report/'+id;

const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
export const sha256Hex=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
async function hkdf(secret,info,usages,algorithm){
 if(!secret)throw Error('503:Report snapshots are not configured');
 const base=await crypto.subtle.importKey('raw',enc.encode(secret),'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('school-success'),info:enc.encode(info)},base,algorithm,false,usages);
}
const aesKey=secret=>hkdf(secret,'report-snapshot-aes-v1',['encrypt','decrypt'],{name:'AES-GCM',length:256});
const idKey=secret=>hkdf(secret,'report-snapshot-id-v1',['sign'],{name:'HMAC',hash:'SHA-256',length:256});

// Deterministic, unguessable ID: retries of identical bytes and scope map to the same snapshot (no
// duplicates); any other content or scope gets a different ID, so stored snapshots are never replaced.
export async function snapshotId(secret,scope,pdfSha256){
 const mac=new Uint8Array(await crypto.subtle.sign('HMAC',await idKey(secret),enc.encode(JSON.stringify([scope.kind,scope.school,scope.teacher,scope.grade,scope.section,scope.subject,scope.from,scope.to,scope.generatedAt,scope.includeArchived,...(scope.variant==='shareable'?['shareable']:[]),pdfSha256]))));
 mac[6]=(mac[6]&0x0f)|0x40;mac[8]=(mac[8]&0x3f)|0x80;const h=hex(mac.slice(0,16));
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

export function assertPdfBytes(bytes){
 if(!(bytes instanceof Uint8Array)||!bytes.length)throw Error('Lesson documentation PDF is empty');
 if(bytes.length>MAX_SNAPSHOT_BYTES)throw Error('413:Lesson documentation PDF is larger than 4 MB');
 if(dec.decode(bytes.subarray(0,5))!=='%PDF-'||!dec.decode(bytes.subarray(Math.max(0,bytes.length-1024))).includes('%%EOF'))throw Error('Lesson documentation must be a complete PDF');
}

// Envelope: "SSR1" | 12-byte IV | AES-GCM( u32 metadata length | metadata JSON | PDF ), AAD = snapshot ID.
export async function sealSnapshot(secret,id,meta,pdf){
 const metaBytes=enc.encode(JSON.stringify(meta)),plain=new Uint8Array(4+metaBytes.length+pdf.length);
 new DataView(plain.buffer).setUint32(0,metaBytes.length);plain.set(metaBytes,4);plain.set(pdf,4+metaBytes.length);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(id)},await aesKey(secret),plain));
 const out=new Uint8Array(MAGIC.length+iv.length+cipher.length);out.set(MAGIC,0);out.set(iv,MAGIC.length);out.set(cipher,MAGIC.length+iv.length);return out;
}
export async function openSnapshot(secret,id,envelope){
 const bytes=new Uint8Array(envelope);
 if(bytes.length<MAGIC.length+12+16||dec.decode(bytes.subarray(0,4))!=='SSR1')throw Error('404:Lesson documentation not found');
 let plain;
 try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(4,16),additionalData:enc.encode(id)},await aesKey(secret),bytes.subarray(16)));}
 catch{throw Error('404:Lesson documentation not found');}
 const length=new DataView(plain.buffer,plain.byteOffset).getUint32(0),meta=JSON.parse(dec.decode(plain.subarray(4,4+length))),pdf=plain.subarray(4+length);
 if(meta.id!==id||await sha256Hex(pdf)!==meta.sha256)throw Error('404:Lesson documentation not found');
 return {meta,pdf};
}

// Server-side guard for the shareable copy: it must not carry link annotations (attachment links).
export function assertShareablePdf(bytes){
 if(dec.decode(bytes).includes('/URI'))throw Error('The shareable copy must not contain attachment links. Export it again.');
}
export function snapshotFilename(meta){
 const part=(s,f)=>String(s||'').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,50)||f;
 return ['Lesson_Documentation',part(meta.teacher,'Teacher'),part(meta.grade,'Class'),meta.section&&meta.section!=='Not Applicable'?part(meta.section,''):'',part(meta.subject,'Subject'),meta.from,meta.to,meta.variant==='shareable'?'Shareable':''].filter(Boolean).join('_')+'.pdf';
}
export function contentDisposition(meta,download=false){
 const name=snapshotFilename(meta);
 return `${download?'attachment':'inline'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
