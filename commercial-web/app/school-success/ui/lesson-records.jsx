'use client';
import {useMemo,useState} from 'react';
import {ArrowUpRight,BookOpen,Download,FileText,Headphones} from 'lucide-react';
import {reportDirectorySource} from '@/lib/school-success/directory';
import {buildLessonRecords,filterLessons,lessonFilterOptions,lessonSummary,visibleLessonSections,optionalLessonSections,defaultLessonSections,sectionOn,formatDay,formatStamp,classLine,isImageUrl,MAX_LESSONS_PER_PDF} from '@/lib/school-success/lesson-records';
import './lesson-records.css';

const PAGE=20;
// ASCII file names: some browsers drop non-Latin download names and save a generic 'download'.
const safeName=(s,fallback)=>String(s||'').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60)||fallback;
const safeUrl=url=>typeof url==='string'&&/^https?:\/\//i.test(url)?url:'';
function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
// Only the thumbnails the PDF will place: first six images per evidence section and lesson.
function thumbnailUrls(lessons,sections){
 const keys=['activities','writing','remedial','portfolio'].filter(k=>sectionOn(sections,k));
 return lessons.flatMap(l=>keys.flatMap(k=>(l[k]||[]).filter(f=>isImageUrl(f.url)).slice(0,6).map(f=>f.url)));
}

// Lesson-wise documentation: one card per lesson record, in original submission order.
// Reads only the already-authorised School Success data response; never writes records.
const ANY='__any__';
// initialFilters: {grade, section, subject} — e.g. from a lesson-documentation link. section '' = recorded without a section.
export default function LessonRecords({data,from,to,school='',teacherKey='',includeArchived=false,mode='teacher',initialFilters={},onReview}){
 const [filters,setFilters]=useState({teacher:'',grade:initialFilters.grade??ANY,section:initialFilters.section??ANY,subject:initialFilters.subject??ANY}),[sections,setSections]=useState(defaultLessonSections),[embed,setEmbed]=useState(true);
 const [page,setPage]=useState(1),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const fresh=data.period?.from===from&&data.period?.to===to;
 const source=useMemo(()=>reportDirectorySource(data,data.directory?.archives||[],includeArchived),[data,includeArchived]);
 // Lessons planned for these dates, in teaching order, each with its whole record (owner decision, 28 November
 // 2026); the complete per-lesson history is built from the same authorised data.
 const all=useMemo(()=>buildLessonRecords(source.entries,from,to,{scope:'planned'}),[source,from,to]);
 const history=useMemo(()=>new Map(buildLessonRecords(source.entries,from,to,{scope:'all'}).map(l=>[l.key,l])),[source,from,to]);
 const scoped=useMemo(()=>filterLessons(all,{school,teacher:teacherKey}),[all,school,teacherKey]);
 const teachers=useMemo(()=>[...new Map(scoped.map(l=>[l.teacherKey,l.teacher])).entries()].sort((a,b)=>a[1].localeCompare(b[1])),[scoped]);
 const options=lessonFilterOptions(scoped);
 // Exact matching: '' means "not recorded", ANY means no filter, so a link never widens its scope.
 const match=(value,filter)=>filter===ANY||value===filter;
 const lessons=filterLessons(scoped,{teacher:filters.teacher}).filter(l=>match(l.grade,filters.grade)&&match(l.section,filters.section)&&match(l.subject,filters.subject));
 const summary=lessonSummary(lessons),pages=Math.max(1,Math.ceil(lessons.length/PAGE)),current=Math.min(page,pages);
 const setFilter=(key,value)=>{setFilters(f=>({...f,[key]:value}));setPage(1);};
 const teacherName=teacherKey?scoped[0]?.teacher||'':'';
 const consolidatedKind=mode==='school'&&!filters.teacher?'school':'teacher';

 async function download(kind,list){
  setBusy('Preparing PDF');setError('');setNotice('');
  try{
   if(!fresh)throw Error('Apply the selected period before downloading.');
   if(!list.length)throw Error('No lessons match these filters.');
   if(list.length>MAX_LESSONS_PER_PDF)throw Error(`This selection has ${list.length} lessons. Narrow the filters to ${MAX_LESSONS_PER_PDF} lessons or fewer.`);
   const [{createLessonDocumentationPdf},{canvasRaster,loadLessonFont,loadEvidenceImages}]=await Promise.all([import('@/lib/school-success/lesson-report-pdf'),import('@/lib/school-success/lesson-pdf-assets')]);
   try{await loadLessonFont();}catch{setNotice('The Hindi font could not be loaded; Hindi text uses this device’s fonts.');}
   const wanted=embed?thumbnailUrls(list,sections):[];
   const images=wanted.length?await loadEvidenceImages(wanted,{limit:kind==='lesson'?36:150,onProgress:(done,total)=>setBusy(`Adding photos ${done} of ${total}`)}):new Map();
   setBusy('Laying out the PDF');await new Promise(resolve=>setTimeout(resolve,0));
   const doc=createLessonDocumentationPdf({kind,lessons:list,from,to,sections,images,raster:canvasRaster()});
   const first=list[0],name=kind==='lesson'?`Lesson_${safeName(first.teacher,'Teacher')}_${first.plannedDate||first.firstDate||from}_${safeName(first.recordId,'record')}${first.scope==='all'?'_complete_history':''}`:kind==='teacher'?`Teacher_Lessons_${safeName(first.teacher,'Teacher')}_${from}_${to}`:`School_Lessons_${safeName(first.school,'School')}_${from}_${to}`;
   save(doc.output('blob'),name+'.pdf');
   const missing=new Set(wanted).size-images.size;
   if(missing>0)setNotice(n=>[n,missing===1?'1 photo is included as a link because it could not be loaded for the PDF.':`${missing} photos are included as links because they could not be loaded for the PDF.`].filter(Boolean).join(' '));
  }catch(e){setError(e.message||'Unable to prepare the PDF.');}
  finally{setBusy('');}
 }

 if(!fresh)return <section className="card lesson-records-stale" role="status"><p>Apply the selected period to review lesson records. Loaded period: {data.period?.from} to {data.period?.to}.</p></section>;
 return <div className="lesson-records">
  <section className="card">
   <div className="lr-head"><div><span className="eyebrow">LESSON DOCUMENTATION</span><h2>{mode==='school'?'Lesson records · '+school:'Lesson records'+(teacherName?' · '+teacherName:'')}</h2><p>Lessons planned for {formatDay(from)} – {formatDay(to)}, in teaching order, each with its plan, classroom activities, written work, recordings, reflections and Academic Review, and when the plan was submitted.</p></div><BookOpen size={24}/></div>
   <div className="lr-filters">
    {mode==='school'&&<label className="field"><span>Teacher</span><select value={filters.teacher} onChange={e=>setFilter('teacher',e.target.value)}><option value="">All teachers</option>{teachers.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>}
    <label className="field"><span>Class</span><select value={filters.grade} onChange={e=>setFilter('grade',e.target.value)}><option value={ANY}>All classes</option>{[...new Set([...options.grades,...(filters.grade!==ANY?[filters.grade]:[])])].map(g=><option key={g||'none'} value={g}>{g||'Not recorded'}</option>)}</select></label>
    <label className="field"><span>Section</span><select value={filters.section} onChange={e=>setFilter('section',e.target.value)}><option value={ANY}>All sections</option>{[...new Set([...options.sections,...(filters.section!==ANY?[filters.section]:[])])].map(s=><option key={s||'none'} value={s}>{s||'Not recorded'}</option>)}</select></label>
    <label className="field"><span>Subject</span><select value={filters.subject} onChange={e=>setFilter('subject',e.target.value)}><option value={ANY}>All subjects</option>{[...new Set([...options.subjects,...(filters.subject!==ANY?[filters.subject]:[])])].map(s=><option key={s||'none'} value={s}>{s||'Not recorded'}</option>)}</select></label>
   </div>
   <details><summary className="text-button">PDF sections</summary>
    <p className="hint">The lesson plan is always included. Unchecked sections are left out of the PDF only; no records change.</p>
    <div className="lr-options">{optionalLessonSections.map(([key,label])=><label className="check-line" key={key}><input type="checkbox" checked={sectionOn(sections,key)} onChange={e=>setSections(s=>({...s,[key]:e.target.checked}))}/>{label}</label>)}<label className="check-line"><input type="checkbox" checked={sectionOn(sections,'highlights')} onChange={e=>setSections(s=>({...s,highlights:e.target.checked}))}/>Reviewer highlights</label><label className="check-line"><input type="checkbox" checked={embed} onChange={e=>setEmbed(e.target.checked)}/>Embed photo thumbnails</label></div>
   </details>
   <div className="lr-downloads"><p>{lessons.length} lesson{lessons.length===1?'':'s'} · {formatDay(from)} to {formatDay(to)}</p><button className="button primary" disabled={!!busy||!lessons.length||(consolidatedKind==='teacher'&&new Set(lessons.map(l=>l.teacherKey)).size!==1)} onClick={()=>download(consolidatedKind,lessons)}><Download size={16}/>{consolidatedKind==='school'?'School lesson PDF':'Teacher lesson PDF'}</button></div>
  </section>
  {error&&<p className="alert error" role="alert">{error}</p>}{busy&&<p className="alert success" role="status">{busy}…</p>}{notice&&!busy&&<p className="alert success" role="status">{notice}</p>}
  <div className="lr-stats" aria-label="Lesson summary">
   <div><strong>{summary.lessons}</strong><span>Lessons in view</span></div>
   <div><strong>{summary.plansSubmitted}</strong><span>Lesson plans submitted in period</span></div>
   <div><strong>{summary.activities}</strong><span>Classroom activities</span></div>
   <div><strong>{summary.writing}</strong><span>Student written work</span></div>
   <div><strong>{summary.remedial}</strong><span>Remedial support</span></div>
   <div><strong>{summary.reflections}</strong><span>After-class reflections</span></div>
   <div><strong>{summary.portfolio}</strong><span>Student portfolio / assessment</span></div>
   <div><strong>{summary.reviewed}</strong><span>With Academic Review</span></div>
  </div>
  {!lessons.length?<section className="card empty"><h3>No lessons in this view</h3><p>No lesson records were submitted for the selected period and filters.</p></section>:<>
   <div className="lr-list">{lessons.slice((current-1)*PAGE,current*PAGE).map((lesson,i)=><LessonCard key={lesson.key} lesson={lesson} number={(current-1)*PAGE+i+1} showTeacher={mode==='school'} busy={!!busy} onReview={onReview} onDownload={()=>download('lesson',[lesson])} onDownloadHistory={history.has(lesson.key)?()=>download('lesson',[history.get(lesson.key)]):null}/>)}</div>
   {pages>1&&<div className="lr-pager"><button className="button" disabled={current===1} onClick={()=>setPage(current-1)}>Previous</button><span>Page {current} of {pages}</span><button className="button" disabled={current===pages} onClick={()=>setPage(current+1)}>Next</button></div>}
  </>}
 </div>;
}

const reflectionQuestions={achievement:'Did students achieve the learning outcome, and what went well in your class?',nextStep:'Which students need support, what learning gaps do they have, and what will you do next to support them?'};
export function WrittenReflection({reflection}){
 const label=key=>reflection.prompts?.find(p=>p.key===key)?.label||reflectionQuestions[key];
 return <article className="lr-reflection"><b>{reflection.label}{reflection.date?' · '+formatDay(reflection.date):''}{reflection.conductedOn?' · taught '+formatDay(reflection.conductedOn):''}</b>
  {['achievement','nextStep'].filter(key=>reflection.answers?.[key]).map(key=><div key={key}><span>{label(key)}</span><p>{reflection.answers[key]}</p></div>)}
 </article>;
}
function FileLink({file,action='Open'}){
 const url=safeUrl(file.url);if(!url)return null;
 return <a className={'lr-file'+(file.kind==='Audio'?' audio':'')} href={url} target="_blank" rel="noopener noreferrer"><span className="tag">{file.kind.toUpperCase()}</span><span><b>{file.label}</b><small>{[file.addedOn&&'Added '+formatDay(file.addedOn),file.stage].filter(Boolean).join(' · ')}</small></span><span className="go">{action}<ArrowUpRight size={14}/></span></a>;
}
function Evidence({title,files,tone,open}){
 const pictures=open?files.filter(f=>isImageUrl(f.url)&&safeUrl(f.url)):[],shown=new Set(pictures.map(f=>f.url));
 return <section className={'lr-section '+tone}><h4>{title}<em>{files.length}</em></h4>
  {pictures.length>0&&<div className="lr-thumbs">{pictures.map(f=><a key={f.url} className="lr-thumb" href={f.url} target="_blank" rel="noopener noreferrer"><img src={f.url} alt={f.label} loading="lazy"/><span>{f.label}<small>{f.addedOn?formatDay(f.addedOn):''}</small></span></a>)}</div>}
  <div className="lr-files">{files.filter(f=>!shown.has(f.url)).map(f=><FileLink key={f.url} file={f}/>)}</div>
 </section>;
}
export function LessonCard({lesson,number,showTeacher,busy,onDownload,onReview,onDownloadHistory=null,defaultOpen=false}){
 const [open,setOpen]=useState(defaultOpen),visible=visibleLessonSections(lesson);
 // Body (and any thumbnails) render only once opened, so files are not preloaded.
 return <details className="lr-lesson" open={defaultOpen||undefined} onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary><span className="lr-no">{number}</span><span className="lr-title"><b>{lesson.topic}</b><small>{[showTeacher&&lesson.teacher,classLine(lesson),lesson.submittedAt?'Submitted '+formatStamp(lesson.submittedAt):lesson.firstDate&&formatDay(lesson.firstDate)].filter(Boolean).join(' · ')}</small></span>
   <span className="lr-badges">{lesson.activities.length>0&&<span className="lr-badge">{lesson.activities.length} activity</span>}{lesson.writing.length>0&&<span className="lr-badge">{lesson.writing.length} writing</span>}{(lesson.remedial||[]).length>0&&<span className="lr-badge">{lesson.remedial.length} remedial</span>}{(lesson.reflections.length>0||(lesson.writtenReflections||[]).length>0)&&<span className="lr-badge">Reflection</span>}{(lesson.portfolio||[]).length>0&&<span className="lr-badge">{lesson.portfolio.length} portfolio</span>}{lesson.feedback&&<span className="lr-badge review">Academic Review</span>}{(lesson.outsidePeriodFiles>0||lesson.reviewOutsidePeriod)&&<span className="lr-badge outside">More outside period</span>}</span></summary>
  {open&&<div className="lr-body">
   <div className="lr-meta"><div><span>School</span><b>{lesson.school}</b></div><div><span>Teacher</span><b>{lesson.teacher}</b></div><div><span>Class</span><b>{[lesson.grade,lesson.section&&lesson.section!=='Not Applicable'?'Section '+lesson.section:''].filter(Boolean).join(' · ')||'—'}</b></div><div><span>Subject</span><b>{lesson.subject||'—'}</b></div><div><span>Lesson date</span><b>{[lesson.plannedDate&&'Planned '+formatDay(lesson.plannedDate),lesson.conductedOn&&'Taught '+formatDay(lesson.conductedOn)].filter(Boolean).join(' · ')||formatDay(lesson.firstDate)||'—'}</b></div><div><span>Submitted</span><b>{formatStamp(lesson.submittedAt)||'—'}</b></div></div>
   {(lesson.outsidePeriodFiles>0||lesson.reviewOutsidePeriod)&&<p className="lr-outside" role="note">Outside this reporting period: {[lesson.outsidePeriodFiles?lesson.outsidePeriodFiles+' file'+(lesson.outsidePeriodFiles===1?'':'s'):'',lesson.reviewOutsidePeriod?(lesson.feedback?'additional review feedback':'the Academic Review'):''].filter(Boolean).join(' and ')} for this lesson {lesson.outsidePeriodFiles+(lesson.reviewOutsidePeriod?1:0)===1?'is':'are'} not shown here. Use Complete history PDF to include {lesson.outsidePeriodFiles+(lesson.reviewOutsidePeriod?1:0)===1?'it':'them'}.</p>}
   {visible.plan&&<section className="lr-section plan"><h4>Lesson plan</h4>
    {(lesson.plan.fields.length>0||lesson.plan.notes)&&<dl>{lesson.plan.fields.map(f=><div key={f.key} style={{display:'contents'}}><dt>{f.label}</dt><dd>{f.text}</dd></div>)}{lesson.plan.notes&&<div style={{display:'contents'}}><dt>Lesson notes</dt><dd>{lesson.plan.notes}</dd></div>}</dl>}
    {lesson.planFiles.length>0&&<div className="lr-files">{lesson.planFiles.map(f=><FileLink key={f.url} file={f}/>)}</div>}
   </section>}
   {visible.activities&&<Evidence title="Classroom activities" files={lesson.activities} tone="activities" open={open}/>}
   {visible.writing&&<Evidence title="Student written work" files={lesson.writing} tone="writing" open={open}/>}
   {visible.remedial&&<Evidence title="Remedial support" files={lesson.remedial} tone="audio" open={open}/>}
   {visible.reflections&&<section className="lr-section"><h4>After-class reflections<em>{(lesson.writtenReflections||[]).length+lesson.reflections.length}</em></h4>
    {(lesson.writtenReflections||[]).map(r=><WrittenReflection key={r.url} reflection={r}/>)}
    {lesson.reflections.some(f=>f.legacy)&&<p className="hint">Earlier reflections were saved as PDFs; their written text is available by opening the saved file.</p>}
    {lesson.reflections.length>0&&<div className="lr-files">{lesson.reflections.map(f=><FileLink key={f.url} file={f} action={f.kind==='Audio'?'Listen':'Open'}/>)}</div>}
   </section>}
   {visible.portfolio&&<Evidence title="Student portfolio / assessment" files={lesson.portfolio} tone="additional" open={open}/>}
   {visible.feedback&&<section className="lr-section"><h4>Academic Review</h4><div className="lr-review"><b>{lesson.feedback.date?'Reviewed '+formatStamp(lesson.feedback.date).split(',')[0]:'Review recorded'}</b><p>{lesson.feedback.text}</p></div></section>}
   {!Object.values(visible).some(Boolean)&&<p className="hint">No lesson plan details or evidence were recorded for this lesson.</p>}
   <div className="lr-lesson-actions">{onReview&&<button className="button primary" disabled={busy} onClick={()=>onReview(lesson)}>Review lesson</button>}<button className="button" disabled={busy} onClick={onDownload}><FileText size={15}/>Lesson PDF · this period</button>{onDownloadHistory&&<button className="button" disabled={busy} onClick={onDownloadHistory}><FileText size={15}/>Complete history PDF</button>}</div>
  </div>}
 </details>;
}
