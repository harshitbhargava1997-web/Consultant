// Builds the lesson-documentation PDF snapshots linked from Teacher 360° usage PDFs. Each group
// (teacher × class × section × subject × period) is rendered with the existing Teacher Lesson PDF
// generator, stored, and only then linked. Any group that still fails after retries stops the export,
// so a parent report never contains a broken link or silently omits a teacher's documentation.
import {buildLessonRecords,lessonDocumentationGroups} from './lesson-records.js';
import {MAX_SNAPSHOT_BYTES} from './report-snapshots.js';

export const MAX_DOCUMENTATION_GROUPS=300;
// Thumbnail budgets tried in order until the PDF fits the storage limit (0 = links only, as before).
export const THUMBNAIL_LEVELS=[6,2,0];
const groupKey=g=>JSON.stringify([g.teacherKey,g.grade,g.section,g.subject]);
export const groupLessons=(lessons,g)=>lessons.filter(l=>l.teacherKey===g.teacherKey&&l.grade===g.grade&&l.section===g.section&&l.subject===g.subject);

export function documentationGroups(entries,from,to,teacherKeys){
 const lessons=buildLessonRecords(entries,from,to),keys=new Set(teacherKeys);
 return {lessons,groups:lessonDocumentationGroups(lessons).filter(g=>keys.has(g.teacherKey))};
}

// render(lessons, {thumbnailsPerSection, audience}) → Uint8Array PDF; store(bytes, scope) → {id, url};
// link(stored, group) → {url, fullUrl?} where stored = {full?, shareable?}; all injected.
// audiences: which versions to store per group ('full' always opens with sign-in; 'shareable' is the
// redacted copy). cache: Map reused while the loaded data is unchanged. Only immutable snapshots are
// cached — link() runs on every export, so a sharing link revoked meanwhile (by anyone, anywhere) is
// never put into a new report. Returns Map(teacherKey → [{...group, url, fullUrl?}]).
export async function buildDocumentationLinks({entries,from,to,teacherKeys,includeArchived=false,generatedAt,render,store,link=stored=>({url:stored.full.url}),audiences=['full'],cache=new Map(),onProgress=()=>{},concurrency=2,attempts=3,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 const {lessons,groups}=documentationGroups(entries,from,to,teacherKeys);
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
 async function snapshot(g,subset,audience){
  const scopeKey=JSON.stringify([groupKey(g),from,to,includeArchived,audience]);
  const cached=cache.get(scopeKey);if(cached)return cached;
  let bytes=null;
  // The shareable copy never carries thumbnails; the full version falls back to fewer to fit.
  for(const level of audience==='shareable'?[0]:THUMBNAIL_LEVELS){bytes=await render(subset,{thumbnailsPerSection:level,audience});if(bytes.length<=MAX_SNAPSHOT_BYTES)break;}
  if(bytes.length>MAX_SNAPSHOT_BYTES)throw Error('the lesson documentation is larger than 4 MB even without photo thumbnails; choose a shorter period');
  const scope={kind:'teacher-lesson-documentation',school:g.school,teacher:g.teacher,grade:g.grade,section:g.section,subject:g.subject,from,to,generatedAt,includeArchived,variant:audience};
  const stored=await retrying(()=>store(bytes,scope));
  cache.set(scopeKey,stored);
  return stored;
 }
 async function one(g){
  const subset=groupLessons(lessons,g),stored={};
  for(const audience of audiences)stored[audience]=await snapshot(g,subset,audience);
  const urls=await retrying(()=>link(stored,g));
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

// Creates a sharing link (no sign-in for holders of the link) for a stored snapshot. Same retry
// semantics as storeSnapshot: 4xx other than 408/429 are permanent.
export async function createShareLink(fetcher,snapshotId){
 const response=await fetcher('/api/school-success/report-shares',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({snapshotId})});
 let body={};try{body=await response.json();}catch{}
 if(!response.ok){const error=Error(body.error||'sharing link could not be created');error.permanent=response.status>=400&&response.status<500&&![408,429].includes(response.status);throw error;}
 return body;
}
