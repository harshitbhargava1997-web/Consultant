'use client';
import {useMemo,useState} from 'react';
import {ArrowUpRight,BookOpen,Download,FileText,Headphones} from 'lucide-react';
import {reportDirectorySource} from '@/lib/school-success/directory';
import {buildLessonRecords,filterLessons,lessonFilterOptions,lessonSummary,visibleLessonSections,optionalLessonSections,defaultLessonSections,formatDay,formatStamp,classLine,isImageUrl,MAX_LESSONS_PER_PDF} from '@/lib/school-success/lesson-records';
import './lesson-records.css';

const PAGE=20;
// ASCII file names: some browsers drop non-Latin download names and save a generic 'download'.
const safeName=(s,fallback)=>String(s||'').normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60)||fallback;
const safeUrl=url=>typeof url==='string'&&/^https?:\/\//i.test(url)?url:'';
function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
// Only the thumbnails the PDF will place: first six images per evidence section and lesson.
function thumbnailUrls(lessons,sections){
 const keys=['activities','writing','additional'].filter(k=>sections[k]!==false);
 return lessons.flatMap(l=>keys.flatMap(k=>l[k].filter(f=>isImageUrl(f.url)).slice(0,6).map(f=>f.url)));
}

// Lesson-wise documentation: one card per lesson record, in original submission order.
// Reads only the already-authorised School Success data response; never writes records.
export default function LessonRecords({data,from,to,school='',teacherKey='',includeArchived=false,mode='teacher'}){
 const [filters,setFilters]=useState({teacher:'',grade:'',subject:''}),[sections,setSections]=useState(defaultLessonSections),[embed,setEmbed]=useState(true);
 const [page,setPage]=useState(1),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const fresh=data.period?.from===from&&data.period?.to===to;
 const source=useMemo(()=>reportDirectorySource(data,data.directory?.archives||[],includeArchived),[data,includeArchived]);
 // Period view (default) and complete per-lesson history, built from the same authorised data.
 const all=useMemo(()=>buildLessonRecords(source.entries,from,to),[source,from,to]);
 const history=useMemo(()=>new Map(buildLessonRecords(source.entries,from,to,{scope:'all'}).map(l=>[l.key,l])),[source,from,to]);
 const scoped=useMemo(()=>filterLessons(all,{school,teacher:teacherKey}),[all,school,teacherKey]);
 const teachers=useMemo(()=>[...new Map(scoped.map(l=>[l.teacherKey,l.teacher])).entries()].sort((a,b)=>a[1].localeCompare(b[1])),[scoped]);
 const options=lessonFilterOptions(scoped);
 const lessons=filterLessons(scoped,{teacher:filters.teacher,grade:filters.grade,subject:filters.subject});
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
   <div className="lr-head"><div><span className="eyebrow">LESSON DOCUMENTATION</span><h2>{mode==='school'?'Lesson records · '+school:'Lesson records'+(teacherName?' · '+teacherName:'')}</h2><p>Each lesson with its plan, classroom activities, written work, recordings, reflections and Academic Review, in the order it was first submitted. Evidence and reviews are limited to {formatDay(from)} – {formatDay(to)}; each lesson also offers its complete history.</p></div><BookOpen size={24}/></div>
   <div className="lr-filters">
    {mode==='school'&&<label className="field"><span>Teacher</span><select value={filters.teacher} onChange={e=>setFilter('teacher',e.target.value)}><option value="">All teachers</option>{teachers.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>}
    <label className="field"><span>Class</span><select value={filters.grade} onChange={e=>setFilter('grade',e.target.value)}><option value="">All classes</option>{options.grades.map(g=><option key={g}>{g}</option>)}</select></label>
    <label className="field"><span>Subject</span><select value={filters.subject} onChange={e=>setFilter('subject',e.target.value)}><option value="">All subjects</option>{options.subjects.map(s=><option key={s}>{s}</option>)}</select></label>
   </div>
   <details><summary className="text-button">PDF sections</summary>
    <p className="hint">The lesson plan is always included. Unchecked sections are left out of the PDF only; no records change.</p>
    <div className="lr-options">{optionalLessonSections.map(([key,label])=><label className="check-line" key={key}><input type="checkbox" checked={sections[key]!==false} onChange={e=>setSections(s=>({...s,[key]:e.target.checked}))}/>{label}</label>)}<label className="check-line"><input type="checkbox" checked={embed} onChange={e=>setEmbed(e.target.checked)}/>Embed photo thumbnails</label></div>
   </details>
   <div className="lr-downloads"><p>{lessons.length} lesson{lessons.length===1?'':'s'} · {formatDay(from)} to {formatDay(to)}</p><button className="button primary" disabled={!!busy||!lessons.length||(consolidatedKind==='teacher'&&new Set(lessons.map(l=>l.teacherKey)).size!==1)} onClick={()=>download(consolidatedKind,lessons)}><Download size={16}/>{consolidatedKind==='school'?'School lesson PDF':'Teacher lesson PDF'}</button></div>
  </section>
  {error&&<p className="alert error" role="alert">{error}</p>}{busy&&<p className="alert success" role="status">{busy}…</p>}{notice&&!busy&&<p className="alert success" role="status">{notice}</p>}
  <div className="lr-stats" aria-label="Lesson summary">
   <div><strong>{summary.lessons}</strong><span>Lessons in view</span></div>
   <div><strong>{summary.plansSubmitted}</strong><span>Lesson plans submitted in period</span></div>
   <div><strong>{summary.activities}</strong><span>Classroom activity files</span></div>
   <div><strong>{summary.writing}</strong><span>Student written work</span></div>
   <div><strong>{summary.audio}</strong><span>Audio recordings</span></div>
   <div><strong>{summary.reflections}</strong><span>Teacher reflections</span></div>
   <div><strong>{summary.reviewed}</strong><span>With Academic Review</span></div>
  </div>
  {!lessons.length?<section className="card empty"><h3>No lessons in this view</h3><p>No lesson records were submitted for the selected period and filters.</p></section>:<>
   <div className="lr-list">{lessons.slice((current-1)*PAGE,current*PAGE).map((lesson,i)=><LessonCard key={lesson.key} lesson={lesson} number={(current-1)*PAGE+i+1} showTeacher={mode==='school'} busy={!!busy} onDownload={()=>download('lesson',[lesson])} onDownloadHistory={history.has(lesson.key)?()=>download('lesson',[history.get(lesson.key)]):null}/>)}</div>
   {pages>1&&<div className="lr-pager"><button className="button" disabled={current===1} onClick={()=>setPage(current-1)}>Previous</button><span>Page {current} of {pages}</span><button className="button" disabled={current===pages} onClick={()=>setPage(current+1)}>Next</button></div>}
  </>}
 </div>;
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
export function LessonCard({lesson,number,showTeacher,busy,onDownload,onDownloadHistory=null,defaultOpen=false}){
 const [open,setOpen]=useState(defaultOpen),visible=visibleLessonSections(lesson);
 // Body (and any thumbnails) render only once opened, so files are not preloaded.
 return <details className="lr-lesson" open={defaultOpen||undefined} onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary><span className="lr-no">{number}</span><span className="lr-title"><b>{lesson.topic}</b><small>{[showTeacher&&lesson.teacher,classLine(lesson),lesson.submittedAt?'Submitted '+formatStamp(lesson.submittedAt):lesson.firstDate&&formatDay(lesson.firstDate)].filter(Boolean).join(' · ')}</small></span>
   <span className="lr-badges">{lesson.activities.length>0&&<span className="lr-badge">{lesson.activities.length} activity</span>}{lesson.writing.length>0&&<span className="lr-badge">{lesson.writing.length} writing</span>}{lesson.audio.length>0&&<span className="lr-badge"><Headphones size={11}/> {lesson.audio.length}</span>}{lesson.reflections.length>0&&<span className="lr-badge">Reflection</span>}{lesson.feedback&&<span className="lr-badge review">Academic Review</span>}{(lesson.outsidePeriodFiles>0||lesson.reviewOutsidePeriod)&&<span className="lr-badge outside">More outside period</span>}</span></summary>
  {open&&<div className="lr-body">
   <div className="lr-meta"><div><span>School</span><b>{lesson.school}</b></div><div><span>Teacher</span><b>{lesson.teacher}</b></div><div><span>Class</span><b>{[lesson.grade,lesson.section&&lesson.section!=='Not Applicable'?'Section '+lesson.section:''].filter(Boolean).join(' · ')||'—'}</b></div><div><span>Subject</span><b>{lesson.subject||'—'}</b></div><div><span>Lesson date</span><b>{[lesson.plannedDate&&'Planned '+formatDay(lesson.plannedDate),lesson.conductedOn&&'Taught '+formatDay(lesson.conductedOn)].filter(Boolean).join(' · ')||formatDay(lesson.firstDate)||'—'}</b></div><div><span>Submitted</span><b>{formatStamp(lesson.submittedAt)||'—'}</b></div></div>
   {(lesson.outsidePeriodFiles>0||lesson.reviewOutsidePeriod)&&<p className="lr-outside" role="note">Outside this reporting period: {[lesson.outsidePeriodFiles?lesson.outsidePeriodFiles+' file'+(lesson.outsidePeriodFiles===1?'':'s'):'',lesson.reviewOutsidePeriod?'the Academic Review':''].filter(Boolean).join(' and ')} for this lesson {lesson.outsidePeriodFiles+(lesson.reviewOutsidePeriod?1:0)===1?'is':'are'} not shown here. Use Complete history PDF to include {lesson.outsidePeriodFiles+(lesson.reviewOutsidePeriod?1:0)===1?'it':'them'}.</p>}
   {visible.plan&&<section className="lr-section plan"><h4>Lesson plan</h4>
    {(lesson.plan.fields.length>0||lesson.plan.notes)&&<dl>{lesson.plan.fields.map(f=><div key={f.key} style={{display:'contents'}}><dt>{f.label}</dt><dd>{f.text}</dd></div>)}{lesson.plan.notes&&<div style={{display:'contents'}}><dt>Lesson notes</dt><dd>{lesson.plan.notes}</dd></div>}</dl>}
    {lesson.planFiles.length>0&&<div className="lr-files">{lesson.planFiles.map(f=><FileLink key={f.url} file={f}/>)}</div>}
   </section>}
   {visible.activities&&<Evidence title="Classroom activities" files={lesson.activities} tone="activities" open={open}/>}
   {visible.writing&&<Evidence title="Student written work" files={lesson.writing} tone="writing" open={open}/>}
   {visible.audio&&<section className="lr-section audio"><h4>Audio recordings<em>{lesson.audio.length}</em></h4><div className="lr-files">{lesson.audio.map(f=>safeUrl(f.url)&&<div className="lr-audio" key={f.url}><span><b>{f.label}</b><small>{f.addedOn?'Added '+formatDay(f.addedOn):''} · <a className="text-button" href={f.url} target="_blank" rel="noopener noreferrer">Open<ArrowUpRight size={12}/></a></small></span><audio controls preload="none" src={f.url}/></div>)}</div></section>}
   {visible.reflections&&<section className="lr-section"><h4>Teacher reflections<em>{lesson.reflections.length}</em></h4><div className="lr-files">{lesson.reflections.map(f=><FileLink key={f.url} file={f} action={f.kind==='Audio'?'Listen':'Open'}/>)}</div></section>}
   {visible.feedback&&<section className="lr-section"><h4>Academic Review</h4><div className="lr-review"><b>{lesson.feedback.date?'Reviewed '+formatStamp(lesson.feedback.date).split(',')[0]:'Review recorded'}</b><p>{lesson.feedback.text}</p></div></section>}
   {visible.additional&&<Evidence title="Further classroom evidence" files={lesson.additional} tone="additional" open={open}/>}
   {!Object.values(visible).some(Boolean)&&<p className="hint">No lesson plan details or evidence were recorded for this lesson.</p>}
   <div className="lr-lesson-actions"><button className="button" disabled={busy} onClick={onDownload}><FileText size={15}/>Lesson PDF · this period</button>{onDownloadHistory&&<button className="button" disabled={busy} onClick={onDownloadHistory}><FileText size={15}/>Complete history PDF</button>}</div>
  </div>}
 </details>;
}
