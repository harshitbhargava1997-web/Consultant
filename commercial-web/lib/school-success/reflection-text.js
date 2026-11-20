// Written after-class reflections for School Success, stored as small JSON documents.
//
// Why JSON objects in the lesson's evidence folder (no database migration):
// the append-only evidence RPC records file URLs per dated update in
// teacher_records.lesson_evidence_history. Writing the reflection as a server-built
// document in the same `.../implementation_<period>/closure/` path gives it the same
// lesson identity, update date, idempotency (update ID) and access rules as the
// reflection PDFs it replaces. The server builds the canonical document. A teacher can transfer
// only those signed bytes, and cannot submit a JSON attachment of their own.
import {z} from 'zod';
import {closurePrompts} from '../closure-reflection.js';

export const REFLECTION_DOCUMENT_TYPE='school-success/after-class-reflection@1';
export const REFLECTION_FILE_NAME='after-class-reflection.json';
export const REFLECTION_ANSWER_LIMIT=4000;
export const MAX_REFLECTION_BYTES=64*1024;

const answer=z.string().max(REFLECTION_ANSWER_LIMIT).transform(s=>s.replace(/\r\n?/g,'\n').trim());
export const reflectionAnswersSchema=z.object({achievement:answer.default(''),nextStep:answer.default('')}).strict()
 .refine(a=>a.achievement||a.nextStep,'Write at least one after-class reflection answer.');
export const reflectionInputSchema=z.array(z.object({periodId:z.string().uuid(),answers:reflectionAnswersSchema}).strict()).max(10)
 .refine(list=>new Set(list.map(r=>r.periodId)).size===list.length,'One reflection per class period');
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const reflectionDocumentSchema=z.object({
 type:z.literal(REFLECTION_DOCUMENT_TYPE),submissionId:z.string().uuid(),periodId:z.string().uuid(),updateId:z.string().uuid(),
 conductedOn:day,savedAt:z.string().datetime().optional(), // savedAt only in early drafts; the save time is the history event time
 prompts:z.array(z.object({key:z.enum(['achievement','nextStep']),label:z.string().max(300)})).max(2),
 answers:z.object({achievement:z.string().max(REFLECTION_ANSWER_LIMIT),nextStep:z.string().max(REFLECTION_ANSWER_LIMIT)})
});

// Deterministic content (no clock values): identical answers always produce identical bytes.
export function reflectionDocument({submissionId,periodId,updateId,conductedOn,answers}){
 return reflectionDocumentSchema.parse({type:REFLECTION_DOCUMENT_TYPE,submissionId,periodId,updateId,conductedOn,
  prompts:closurePrompts.map(([key,label])=>({key,label})),answers:{achievement:answers.achievement||'',nextStep:answers.nextStep||''}});
}
export const reflectionBytes=doc=>new TextEncoder().encode(JSON.stringify(doc));

export async function sha256Hex(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
// Content-addressed file ID: (update, period, SHA-256 of the exact document). Identical retries map to the
// same object with identical bytes; different answers always map to a different object, so accepted
// content can never be overwritten by a conflicting or stale submission.
export async function reflectionFileId(updateId,periodId,contentHash){
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('reflection:'+updateId+':'+periodId+':'+contentHash)));
 hash[6]=(hash[6]&0x0f)|0x40;hash[8]=(hash[8]&0x3f)|0x80;
 const hex=[...hash.slice(0,16)].map(b=>b.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function isReflectionTextUrl(url){
 try{const path=decodeURIComponent(new URL(url).pathname);return /\/closure\/[0-9a-f-]{36}\.json$/i.test(path);}catch{return false;}
}

// The editor emits the two prompts in the fixed formatClosure() layout; split it back by the exact labels.
export function parseClosureText(text=''){
 const lines=String(text).replace(/\r\n?/g,'\n').split('\n'),labels=new Map(closurePrompts.map(([key,label])=>[label,key])),parts={achievement:[],nextStep:[]};
 let current=null;const loose=[];
 for(const line of lines){const key=labels.get(line.trim());if(key){current=key;continue;}(current?parts[current]:loose).push(line);}
 const join=l=>l.join('\n').trim();
 const answers={achievement:join(parts.achievement),nextStep:join(parts.nextStep)};
 // Text typed without the prompt headings is kept, never dropped.
 if(join(loose))answers.achievement=[join(loose),answers.achievement].filter(Boolean).join('\n\n');
 return answers;
}

// Attach validated reflection text to submission entry files. `fetchText(url)` returns the stored
// body or throws; failures leave the file as a link so nothing is hidden.
export async function attachReflectionText(entries,fetchText,{limit=400,concurrency=6}={}){
 const byUrl=new Map();
 for(const entry of entries||[])if(entry?.kind==='submission')for(const file of entry.files||[])if(file?.url&&isReflectionTextUrl(file.url)){
  if(!byUrl.has(file.url))byUrl.set(file.url,[]);byUrl.get(file.url).push(file);
 }
 const urls=[...byUrl.keys()].slice(0,limit),results=new Map();
 for(let i=0;i<urls.length;i+=concurrency)await Promise.all(urls.slice(i,i+concurrency).map(async url=>{
  try{
   const body=await fetchText(url);
   if(typeof body!=='string'||new TextEncoder().encode(body).length>MAX_REFLECTION_BYTES)throw Error('size');
   const doc=reflectionDocumentSchema.parse(JSON.parse(body));
   results.set(url,{answers:doc.answers,prompts:doc.prompts,conductedOn:doc.conductedOn,updateId:doc.updateId});
  }catch{results.set(url,null);}
 }));
 for(const [url,files] of byUrl)for(const file of files){const value=results.get(url);if(value)file.reflection=value;else file.reflectionUnavailable=true;}
 return {requested:byUrl.size,loaded:[...results.values()].filter(Boolean).length};
}

// Server-side planning for one evidence update: validates the answers against the lesson's periods,
// builds each reflection document and adds it to the submission's file list as a closure file.
// Deterministic for the same (submission, answers, updateId, conductedOn), so commit can rebuild and verify it.
// `evidencePlan` and `submissionSchema` are passed in to avoid a circular import.
export async function planReflectionDocuments({submission,reflections,updateId,conductedOn,evidencePlan,submissionSchema}){
 const input=reflections==null?[]:reflectionInputSchema.parse(reflections);
 if(input.some(r=>!submission.periods.some(p=>p.id===r.periodId)))throw Error('403:Reflection must belong to a class period of this lesson');
 if(!input.length)return {submission,docs:[],uploads:evidencePlan(submission)};
 const docs=[];
 for(const r of input){
  const text=JSON.stringify(reflectionDocument({submissionId:submission.id,periodId:r.periodId,updateId,conductedOn,answers:r.answers})),sha256=await sha256Hex(text);
  docs.push({id:await reflectionFileId(updateId,r.periodId,sha256),periodId:r.periodId,text,sha256,size:new TextEncoder().encode(text).length});
 }
 const next=submissionSchema.parse({...submission,files:[...submission.files,...docs.map(d=>({id:d.id,periodId:d.periodId,category:'closure',name:REFLECTION_FILE_NAME,size:d.size}))]});
 const planned=evidencePlan(next);
 for(const d of docs)d.key=planned.find(f=>f.id===d.id).key;
 return {submission:next,docs,uploads:planned.filter(f=>!docs.some(d=>d.id===f.id))};
}

// Read-only fetcher for reflection documents under the configured media base (never arbitrary URLs).
export function reflectionFetcher({base,get,timeoutMs=8000}){
 const prefix=base.replace(/\/$/,'')+'/';
 return async url=>{
  if(!url.startsWith(prefix))throw Error('Unexpected media location');
  const key=url.slice(prefix.length).split('/').map(decodeURIComponent).join('/');
  let timer;
  try {
   return await Promise.race([
    (async () => {
     const response=await get(key,url);
     if(!response.ok||Number(response.headers.get('content-length')||0)>MAX_REFLECTION_BYTES)throw Error('Unavailable');
     return response.text();
    })(),
    new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out')),timeoutMs);})
   ]);
  } finally { clearTimeout(timer); }
 };
}
