// Builds the lesson-documentation PDF snapshots linked from Teacher 360° usage PDFs. Each group
// (teacher × class × section × subject × period) is rendered with the existing Teacher Lesson PDF
// generator, stored, and only then linked. Any group that still fails after retries stops the export,
// so a parent report never contains a broken link or silently omits a teacher's documentation.
import {buildLessonRecords,lessonDocumentationGroups,lessonEvidenceFiles} from './lesson-records.js';
import {MAX_SNAPSHOT_BYTES} from './report-snapshots.js';
import {evidenceKeyFromUrl,evidenceKeyInScope,evidenceLink,reportLink} from './report-shares.js';

export const MAX_DOCUMENTATION_GROUPS=300;
// Thumbnail budgets tried in order until the PDF fits the storage limit (0 = links only, as before).
export const THUMBNAIL_LEVELS=[6,2,0];
const groupKey=g=>JSON.stringify([g.teacherKey,g.grade,g.section,g.subject]);
export const groupLessons=(lessons,g)=>lessons.filter(l=>l.teacherKey===g.teacherKey&&l.grade===g.grade&&l.section===g.section&&l.subject===g.subject);

// Lessons planned for these dates (owner decision, 28 November 2026), each with its whole record.
export function documentationGroups(entries,from,to,teacherKeys){
 const lessons=buildLessonRecords(entries,from,to,{scope:'planned'}),keys=new Set(teacherKeys);
 return {lessons,groups:lessonDocumentationGroups(lessons).filter(g=>keys.has(g.teacherKey))};
}

// Check the whole selection before fetching thumbnails or storing the first group's PDF.
export function checkReportEvidence(lessons, mediaBase) {
 const issues = [];
 for (const lesson of lessons) {
  const location = [lesson.school, lesson.teacher, lesson.grade, lesson.section, lesson.subject, lesson.topic].filter(Boolean).join(' · ');
  for (const file of lessonEvidenceFiles(lesson)) {
   const key = evidenceKeyFromUrl(file.url, mediaBase);
   if (key && evidenceKeyInScope(key, lesson.school, lesson.teacher)) continue;
   issues.push([location, file.addedOn || lesson.firstDate, file.label].filter(Boolean).join(' · '));
  }
 }
 if (issues.length) throw Error('These attachments need a copy in the correct teacher’s school media storage before the complete report can be created. Ask your school administrator to correct the listed files.\n' + issues.join('\n'));
}

// Builds one complete consolidated lesson report (full evidence) per teacher/class/section/subject group
// and its access link, for the Teacher 360° usage PDFs. Injected:
//   begin(group) → session: a FRESH access ID (and secret) for this export, plus session.linkFor(url) that
//                  maps every evidence URL in the PDF to that access link and records it (session.reset()
//                  clears the record between size-fallback renders);
//   render(lessons, {thumbnailsPerSection, session}) → Uint8Array PDF;
//   store(bytes, scope) → {id, url};   link(stored, group, session) → {url}.
// Nothing is cached across exports: every export gets new access links (a link revoked meanwhile, by
// anyone, is never reused) and a PDF whose evidence links belong to that new access record.
// Returns Map(teacherKey → [{...group, url}]); throws (no report) if any group fails after retries.
export async function buildDocumentationLinks({entries,from,to,teacherKeys,selection=documentationGroups(entries,from,to,teacherKeys),includeArchived=false,generatedAt,render,store,link=stored=>({url:stored.url}),begin=()=>({linkFor(){throw Error('This evidence needs a report access link.');},reset(){}}),onProgress=()=>{},concurrency=2,attempts=3,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 const {lessons,groups}=selection;
 if(groups.length>MAX_DOCUMENTATION_GROUPS)throw Error(`This export has ${groups.length} class and subject groups. Choose fewer schools or a shorter period (at most ${MAX_DOCUMENTATION_GROUPS}).`);
 const links=new Map(),failures=[];let done=0;
 onProgress({done,total:groups.length});
 async function retrying(task){
  let lastError;
  for(let attempt=1;attempt<=attempts;attempt++){
   try{return await task();}
   catch(e){lastError=e;if(e.permanent)break;if(attempt<attempts)await wait(500*attempt);}
  }
  throw lastError||Error('storage failed');
 }
 async function one(g){
  const subset=groupLessons(lessons,g),session=await begin(g);
  let bytes=null;
  for(const level of THUMBNAIL_LEVELS){session.reset?.();bytes=await render(subset,{thumbnailsPerSection:level,session});if(bytes.length<=MAX_SNAPSHOT_BYTES)break;}
  if(bytes.length>MAX_SNAPSHOT_BYTES)throw Error('the lesson documentation is larger than 4 MB even without photo thumbnails; choose a shorter period');
  const scope={kind:'teacher-lesson-documentation',school:g.school,teacher:g.teacher,grade:g.grade,section:g.section,subject:g.subject,from,to,generatedAt,includeArchived,variant:'full'};
  const stored=await retrying(()=>store(bytes,scope));
  const urls=await retrying(()=>link(stored,g,session,subset));
  if(!links.has(g.teacherKey))links.set(g.teacherKey,[]);
  links.get(g.teacherKey).push({...g,...urls});
 }
 let next=0;
 async function worker(){while(next<groups.length){const g=groups[next++];try{await one(g);}catch(e){failures.push(`${g.teacher} · ${[g.grade,g.section].filter(Boolean).join(' ')} · ${g.subject}: ${e.message}`);}finally{done++;onProgress({done,total:groups.length,group:g});}}}
 await Promise.all(Array.from({length:Math.min(concurrency,groups.length)},worker));
 if(failures.length)throw Error(`Lesson documentation could not be prepared for ${failures.length} group${failures.length===1?'':'s'}, so no report was created. ${failures.slice(0,5).join('; ')}${failures.length>5?'; …':''}. Try the export again.`);
 // Preserve the established group order regardless of completion order.
 for(const list of links.values())list.sort((a,b)=>groups.indexOf(groups.find(g=>groupKey(g)===groupKey(a)))-groups.indexOf(groups.find(g=>groupKey(g)===groupKey(b))));
 return links;
}

// Browser upload helper: raw PDF body, scope in a header; 4xx other than 408/429 are permanent.
export async function storeSnapshot(fetcher,bytes,scope){
 const header=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(scope)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 const response=await fetcher('/api/school-success/report-snapshots',{method:'POST',headers:{'Content-Type':'application/pdf','X-Snapshot-Scope':header},body:bytes});
 let body={};try{body=await response.json();}catch{}
 if(!response.ok){const error=Error(body.error||'storage failed');error.permanent=response.status>=400&&response.status<500&&![408,429].includes(response.status);throw error;}
 return body;
}

// Saves the access record for one exported report (see report-shares.js). Same retry semantics as
// storeSnapshot: 4xx other than 408/429 are permanent.
export async function createReportAccess(fetcher,record){
 const response=await fetcher('/api/school-success/report-shares',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record)});
 let body={};try{body=await response.json();}catch{}
 if(!response.ok){const error=Error(body.error||'the report link could not be created');error.permanent=response.status>=400&&response.status<500&&![408,429].includes(response.status);throw error;}
 return body;
}
// Per-export access session: fresh ID and secret, and the evidence manifest the PDF's links point to.
export function reportAccessSession({mode,origin,mediaBase,newId=()=>crypto.randomUUID(),newSecret}){
 const id=newId(),secret=mode==='link'?newSecret():null,evidence=[],index=new Map();
 return {id,secret,mode,evidence,
  reset(){evidence.length=0;index.clear();},
  linkFor(url) {
   const key = evidenceKeyFromUrl(url, mediaBase);
   if (!key) throw Error('This evidence file needs a copy in school media storage before it can be shared.');
   if (!index.has(key)) { index.set(key, evidence.length); evidence.push(key); }
   return evidenceLink(origin, mode, id, index.get(key), secret);
  },
  // Parent PDFs can link only to a file already registered by the final child render.
  existingFileLink(url) {
   const n = index.get(evidenceKeyFromUrl(url, mediaBase));
   return n === undefined ? null : evidenceLink(origin,mode,id,n,secret);
  },
  url:()=>reportLink(origin,mode,id,secret)};
}
