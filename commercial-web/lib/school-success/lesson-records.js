// Lesson-wise documentation for the School Success module.
//
// A lesson is one teacher_records row (one class period). Every evidence URL is
// stored on that same row, so evidence is linked by record identity only. This
// module never matches lessons by teacher name, date or topic, and never joins
// consultant observations (which carry no lesson identity) to lessons.
import {fileCategory,lessonIdentity} from './school-portfolio.js';
import {teacherKey} from './reports.js';
import {feedbackTextWithReviewer,reviewerLabel} from './lesson-reviews.js';
import {noteSummary} from './feedback-notes.js';
import {chronologicalRows} from '../report-sequence.js';
import {isReflectionTextUrl} from './reflection-text.js';

// Provenance of the automatically generated preparation PDF: teacher-portal.jsx uploads it with
// file ID = lesson-period ID, so its key ends in implementation_<P>/lesson_plan/<P>.pdf. Uploaded
// lesson-plan documents and photos always get random IDs. This is an identity check, not a name guess.
export function isGeneratedPreparationPdf(url){
 try{const m=/\/implementation_([0-9a-f-]{36})\/lesson_plan\/([0-9a-f-]{36})\.pdf$/i.exec(decodeURIComponent(new URL(url).pathname));return Boolean(m)&&m[1].toLowerCase()===m[2].toLowerCase();}catch{return false;}
}

// Labels written by formatReflection() in teacher-flow.js. Only these exact
// heading lines are treated as structure; anything else stays as written text.
export const lessonPlanFields=[
 ['objective','Why — learning objective','Learning objective'],
 ['materials','Teaching-learning materials / resources','Teaching-learning materials'],
 ['teacher','Teacher activity — how','Teacher activity'],
 ['student','Student activity','Student activity'],
 ['practice','Practice & apply','Practice / classwork'],
 ['review','Review / next step','Review / homework']
];
export const optionalLessonSections=[
 ['activities','Classroom activities'],
 ['writing','Student written work'],
 ['audio','Audio recordings'],
 ['reflections','Teacher reflections'],
 ['feedback','Academic Review'],
 ['additional','Further classroom evidence']
];
export const defaultLessonSections=Object.fromEntries(optionalLessonSections.map(([key])=>[key,true]));
export const MAX_LESSONS_PER_PDF=400;

// These sections contain clickable files. Written reflections and academic feedback render as text.
export function lessonEvidenceFiles(lesson) {
 return [...lesson.planFiles, ...lesson.activities, ...lesson.writing, ...lesson.audio, ...lesson.reflections, ...lesson.additional];
}

const clean=value=>value==null?'':String(value).trim();
const safeUrl=url=>{try{const u=new URL(String(url));return /^https?:$/.test(u.protocol)?u.href:'';}catch{return '';}};
const extension=url=>{try{return new URL(url).pathname.split('.').pop().toLowerCase();}catch{return '';}};
export const isImageUrl=url=>['jpg','jpeg','png','webp'].includes(extension(url));
export const isAudioUrl=url=>['wav','mp3','m4a','ogg','webm','aac'].includes(extension(url));
export const isVideoUrl=url=>['mp4','mov'].includes(extension(url));
export const isPdfUrl=url=>extension(url)==='pdf';
export const mediaKind=url=>isImageUrl(url)?'Photo':isAudioUrl(url)?'Audio':isVideoUrl(url)?'Video':isPdfUrl(url)?'PDF':'File';

export function parseLessonPlan(reflection='',materials=''){
 const text=clean(reflection).replace(/\r\n?/g,'\n'),byHeading=new Map(lessonPlanFields.map(([key,heading])=>[heading,key]));
 const values={},notes=[];let current=null;
 for(const line of text.split('\n')){
  const key=byHeading.get(line.trim());
  if(key){current=key;values[key]=values[key]||[];continue;}
  (current?values[current]:notes).push(line);
 }
 const join=lines=>(lines||[]).join('\n').replace(/^\n+|\n+$/g,'').trim();
 const fields=lessonPlanFields.map(([key,,label])=>({key,label,text:join(values[key])})).filter(f=>f.text);
 const extra=clean(materials);
 // Mirrors the preparation PDF: separate materials are shown unless already written in the plan.
 if(extra&&!fields.some(f=>f.key==='materials')&&!text.includes(extra))fields.splice(Math.min(1,fields.length),0,{key:'materials',label:'Teaching-learning materials',text:extra});
 return {fields,notes:join(notes)};
}

const numericId=id=>/^\d+$/.test(id)?Number(id):Number.MAX_SAFE_INTEGER;
// Stored lesson timestamps are UTC without a zone suffix.
export const utcStamp=value=>{const s=clean(value);if(!s)return '';const d=new Date(/Z$|[+-]\d\d:?\d\d$/.test(s)?s:s.replace(' ','T')+'Z');return Number.isFinite(d.getTime())?d.toISOString():'';};
const lessonKeyOf=row=>lessonIdentity(row);

function fileSection(file){
 const category=fileCategory(file);
 if(category==='closure')return 'reflections';
 if(category==='preparation')return 'plan';
 if(category==='audio')return 'audio';
 if(category==='activity')return 'activities';
 if(category==='writing')return 'writing';
 return 'additional';
}
const additionalLabels={remedial:'Remedial plan / support',phonics:'Phonics / literacy evidence',portfolio:'Student portfolio',events:'Event picture',other:'Other file'};

// Reporting scope:
//  'period' (default) — evidence files and the Academic Review appear only when they were
//     submitted/recorded within the selected dates, matching the period-scoped School 360° and
//     Teacher 360° counts. The lesson plan text is the lesson itself and is always shown.
//  'all' — complete lesson history: every stored file and all feedback, whatever the date.
// Labels are numbered on the complete history so "Classroom activity 3" is the same file in both.
export const REPORT_SCOPES=['period','all'];
export const istDay=iso=>{const t=new Date(iso).getTime();return Number.isFinite(t)?new Date(t+330*60000).toISOString().slice(0,10):'';};
function lessonFromEntries(rows,{from,to,scope='period'}){
 const ordered=chronologicalRows(rows),first=ordered[0],files=new Map(),inRange=d=>Boolean(d)&&d>=from&&d<=to;
 for(const row of ordered)for(const file of row.files||[]){
  const url=safeUrl(file.url);if(!url)continue;
  // One file is counted once per lesson, however often it is re-sent; keep every date it was sent.
  const known=files.get(url);
  if(known){if(row.date&&!known.dates.includes(row.date))known.dates.push(row.date);if(file.reflection&&!known.reflection)known.reflection=file.reflection;continue;}
  files.set(url,{url,key:file.key||url,column:file.column||'',category:fileCategory(file),section:fileSection(file),addedOn:row.date||'',dates:row.date?[row.date]:[],stage:row.feedStage||'',eventId:row.evidenceEventId||'',
   ...(isReflectionTextUrl(url)?{reflection:file.reflection||null,textDocument:true}:{}),...(isGeneratedPreparationPdf(url)&&row.feedStage==='Lesson preparation'?{generatedPreparation:true}:{})});
 }
 const all=[...files.values()],pick=section=>all.filter(f=>f.section===section);
 const label=(list,name)=>list.map((f,i)=>({...f,kind:mediaKind(f.url),label:name(f,i,list)}));
 const reflections=pick('reflections'),reflectionAudio=reflections.filter(f=>isAudioUrl(f.url));
 // Written reflections saved as text (new) are shown inline; earlier reflections exist only as saved PDFs.
 const written=reflections.filter(f=>f.textDocument&&f.reflection),unreadable=reflections.filter(f=>f.textDocument&&!f.reflection);
 const reflectionDocs=reflections.filter(f=>!isAudioUrl(f.url)&&!f.textDocument);
 const plan=parseLessonPlan(first.reflection,first.materials),planText=plan.fields.length>0||Boolean(plan.notes);
 const keep=f=>scope==='all'||f.dates.some(inRange);
 const scoped=list=>list.filter(keep);
 const sections={
  // The generated preparation PDF repeats the plan text shown inline, so it is listed only when no plan text exists.
  planFiles:label(pick('plan').filter(f=>!(f.generatedPreparation&&planText)),(f,i,l)=>{const type=x=>x.generatedPreparation?'Saved lesson plan (PDF)':isImageUrl(x.url)?'Lesson plan photo':'Lesson plan document',same=l.filter(x=>type(x)===type(f));return type(f)+(same.length>1?' '+(same.indexOf(f)+1):'');}),
  activities:label(pick('activities'),(f,i)=>'Classroom activity '+(i+1)),
  writing:label(pick('writing'),(f,i)=>'Written work sample '+(i+1)),
  audio:label(pick('audio'),(f,i,l)=>'Lesson preparation recording'+(l.length>1?' '+(i+1):'')),
  writtenReflections:written.map((f,i)=>({url:f.url,date:f.addedOn,dates:f.dates,savedAt:f.reflection.savedAt||'',conductedOn:f.reflection.conductedOn||'',answers:f.reflection.answers,prompts:f.reflection.prompts||[],label:'Written reflection'+(written.length>1?' '+(i+1):'')})),
  reflections:[...label(reflectionDocs,(f,i,l)=>'Earlier after-class reflection (saved PDF)'+(l.length>1?' '+(i+1):'')).map(f=>({...f,legacy:true})),...label(unreadable,(f,i,l)=>'Written reflection (open saved text)'+(l.length>1?' '+(i+1):'')),...label(reflectionAudio,(f,i,l)=>'After-class reflection recording'+(l.length>1?' '+(i+1):''))],
  additional:label(pick('additional'),(f,i,l)=>{const same=l.filter(x=>x.category===f.category);return (additionalLabels[f.category]||'Other file')+(same.length>1?' '+(same.indexOf(f)+1):'');})
 };
 // Period view: the taught date comes only from in-period activity, so later uploads do not leak in.
 const conducted=rows.filter(r=>scope==='all'||inRange(r.date)).map(r=>clean(r.conductedOn)).filter(Boolean).sort().at(-1)||'';
 const prepared=utcStamp(rows.map(r=>r.preparationSavedAt).find(Boolean)),submitted=utcStamp(rows.map(r=>r.lessonSubmittedAt).find(Boolean));
 const legacy=rows.find(r=>clean(r.review));
 const history=first.reviewHistory || (legacy?[{text:clean(legacy.review),date:legacy.reviewedAt||legacy.version||''}]:[]);
 const visibleReviews=history.filter(r=>scope==='all'||inRange(istDay(utcStamp(r.date))));

 const firstDate=rows.map(r=>r.date).filter(Boolean).sort()[0]||'';
 return {
  key:lessonKeyOf(first),recordId:clean(first.recordId||first.id),submissionId:clean(first.submissionId),periodId:clean(first.periodId),
  school:first.school,teacher:first.teacher,teacherKey:teacherKey(first.school,first.teacher),
  grade:clean(first.grade),section:clean(first.section),subject:clean(first.subject),topic:clean(first.topic)||'Classroom practice',
  plannedDate:clean(first.plannedDate),conductedOn:conducted,submittedAt:prepared||submitted,firstDate,
  hasPreparation:rows.some(r=>r.stage==='preparation_saved'||r.feedStage==='Lesson preparation'),
  scope,period:{from,to},plan,
  ...Object.fromEntries(Object.entries(sections).map(([key,list])=>[key,scoped(list)])),
  outsidePeriodFiles:scope==='all'?0:all.filter(f=>!keep(f)).length,
  reviewOutsidePeriod:visibleReviews.length<history.length,
  feedback:visibleReviews.length?{label:'Academic Review',text:feedbackTextWithReviewer(visibleReviews),date:utcStamp(visibleReviews.at(-1).date),by:reviewerLabel(visibleReviews.at(-1).by)}:null,
  // The teacher's "Noted" on the feedback shown here: latest date, and whether every item was noted.
  feedbackNoted:noteSummary(visibleReviews.filter(r=>r.key),first.feedbackNotes||[])
 };
}

// Orders by the original submission timestamp. Later evidence never moves a lesson.
export function compareLessons(a,b){
 const time=l=>l.submittedAt||(l.plannedDate||l.firstDate||'9999-12-31')+'T00:00:00.000Z';
 return time(a).localeCompare(time(b))||numericId(a.recordId)-numericId(b.recordId)||a.recordId.localeCompare(b.recordId)||a.key.localeCompare(b.key);
}

// entries: mapLive entries already limited by server access scope and the report directory source.
// A lesson is included when any of its activity (preparation or evidence) falls in the period.
export function buildLessonRecords(entries,from,to,{scope='period'}={}){
 if(!REPORT_SCOPES.includes(scope))throw Error('Unknown lesson report scope');
 const submissions=(entries||[]).filter(r=>r.kind==='submission'&&r.school&&r.teacher);
 const groups=new Map();
 for(const row of submissions){const key=lessonKeyOf(row);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
 const lessons=[];
 for(const rows of groups.values()){
  const inPeriod=rows.filter(r=>r.date>=from&&r.date<=to);
  if(!inPeriod.length)continue;
  const lesson=lessonFromEntries(rows,{from,to,scope});
  lesson.planSubmittedInPeriod=inPeriod.some(r=>r.stage==='preparation_saved'||r.feedStage==='Lesson preparation');
  lessons.push(lesson);
 }
 return lessons.sort(compareLessons);
}

// section: undefined/null = any section; '' matches lessons recorded without a section.
export function filterLessons(lessons,{school='',teacher='',grade='',section=null,subject=''}={}){
 return lessons.filter(l=>(!school||l.school===school)&&(!teacher||l.teacherKey===teacher)&&(!grade||l.grade===grade)&&(section==null||l.section===section)&&(!subject||l.subject===subject));
}
export const lessonFilterOptions=lessons=>({
 grades:[...new Set(lessons.map(l=>l.grade).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),
 sections:[...new Set(lessons.map(l=>l.section))].sort((a,b)=>a.localeCompare(b)),
 subjects:[...new Set(lessons.map(l=>l.subject).filter(Boolean))].sort((a,b)=>a.localeCompare(b))
});

export function visibleLessonSections(lesson,sections=defaultLessonSections){
 const on=key=>sections[key]!==false;
 return {
  plan:lesson.plan.fields.length>0||Boolean(lesson.plan.notes)||lesson.planFiles.length>0,
  activities:on('activities')&&lesson.activities.length>0,
  writing:on('writing')&&lesson.writing.length>0,
  audio:on('audio')&&lesson.audio.length>0,
  reflections:on('reflections')&&(lesson.reflections.length>0||(lesson.writtenReflections||[]).length>0),
  feedback:on('feedback')&&Boolean(lesson.feedback),
  additional:on('additional')&&lesson.additional.length>0
 };
}

export function lessonSummary(lessons){
 const sum=key=>lessons.reduce((n,l)=>n+l[key].length,0);
 return {lessons:lessons.length,plansSubmitted:lessons.filter(l=>l.planSubmittedInPeriod).length,teachers:new Set(lessons.map(l=>l.teacherKey)).size,
  activities:sum('activities'),writing:sum('writing'),audio:sum('audio'),reflections:sum('reflections')+lessons.reduce((n,l)=>n+(l.writtenReflections||[]).length,0),additional:sum('additional'),
  reviewed:lessons.filter(l=>l.feedback).length};
}

// School → Teacher → Class/Subject → Lesson. Teachers are keyed by school and name.
export function groupLessons(lessons){
 const schools=new Map();
 for(const lesson of lessons){
  if(!schools.has(lesson.school))schools.set(lesson.school,new Map());
  const teachers=schools.get(lesson.school);
  if(!teachers.has(lesson.teacherKey))teachers.set(lesson.teacherKey,{school:lesson.school,teacher:lesson.teacher,key:lesson.teacherKey,classes:new Map(),lessons:[]});
  const t=teachers.get(lesson.teacherKey),classKey=JSON.stringify([lesson.grade,lesson.section,lesson.subject]);
  if(!t.classes.has(classKey))t.classes.set(classKey,{grade:lesson.grade,section:lesson.section,subject:lesson.subject,lessons:[]});
  t.classes.get(classKey).lessons.push(lesson);t.lessons.push(lesson);
 }
 return [...schools.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([school,teachers])=>({school,teachers:[...teachers.values()].sort((a,b)=>a.teacher.localeCompare(b.teacher)).map(t=>({...t,classes:[...t.classes.values()].sort((a,b)=>a.grade.localeCompare(b.grade,undefined,{numeric:true})||a.section.localeCompare(b.section)||a.subject.localeCompare(b.subject))}))}));
}

// Teacher → class/section → subject groups for the Teacher 360° usage PDF. Counts are distinct lessons.
export function lessonDocumentationGroups(lessons){
 const groups=new Map();
 for(const l of lessons){
  const key=JSON.stringify([l.teacherKey,l.grade,l.section,l.subject]);
  const g=groups.get(key)||{school:l.school,teacher:l.teacher,teacherKey:l.teacherKey,grade:l.grade,section:l.section,subject:l.subject,lessons:0,topics:[]};
  g.lessons++;g.topics.push(l.topic);groups.set(key,g);
 }
 return [...groups.values()].sort((a,b)=>a.teacherKey.localeCompare(b.teacherKey)||a.grade.localeCompare(b.grade,undefined,{numeric:true})||a.section.localeCompare(b.section)||a.subject.localeCompare(b.subject));
}

export function classSubjectBreakdown(lessons){
 const rows=new Map();
 for(const l of lessons){
  const key=JSON.stringify([l.grade,l.subject]);
  const row=rows.get(key)||{grade:l.grade,subject:l.subject,lessons:0,teachers:new Set(),activities:0,writing:0,audio:0};
  row.lessons++;row.teachers.add(l.teacherKey);row.activities+=l.activities.length;row.writing+=l.writing.length;row.audio+=l.audio.length;rows.set(key,row);
 }
 return [...rows.values()].map(r=>({...r,teachers:r.teachers.size})).sort((a,b)=>a.grade.localeCompare(b.grade,undefined,{numeric:true})||a.subject.localeCompare(b.subject));
}

const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function formatDay(day){const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(clean(day));return m?Number(m[3])+' '+months[Number(m[2])-1]+' '+m[1]:'';}
export function formatStamp(iso){
 if(!iso)return '';
 const d=new Date(new Date(iso).getTime()+330*60000);if(!Number.isFinite(d.getTime()))return '';
 const h=d.getUTCHours(),m=String(d.getUTCMinutes()).padStart(2,'0');
 return formatDay(d.toISOString().slice(0,10))+', '+((h%12)||12)+':'+m+' '+(h<12?'am':'pm')+' IST';
}
export const classLine=l=>[l.grade,l.section&&l.section!=='Not Applicable'?'Section '+l.section:'',l.subject].filter(Boolean).join(' · ');
