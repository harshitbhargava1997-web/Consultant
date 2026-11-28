'use client';
// Download lesson PDF for principals, coordinators and school management (owner decision, 28 November 2026): one
// teacher, one class and subject (or all), the lessons planned for the chosen dates, as the same lesson
// documentation PDF the Teacher 360° report links to. Built in the browser from the school's already-authorised data.
import {useEffect,useMemo,useState} from 'react';
import {Download,RefreshCw} from 'lucide-react';
import {buildLessonRecords,filterLessons,formatDay,isImageUrl,classLine,MAX_LESSONS_PER_PDF} from '@/lib/school-success/lesson-records';
import {weekRange} from '@/lib/school-success/day-periods';

const istToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const MAX_DAYS=100;
const safe=v=>String(v||'').normalize('NFKD').replace(/[^\w-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60)||'Lessons';
function save(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const groupKey=l=>JSON.stringify([l.grade,l.section,l.subject]);

export default function LeaderLessonPdf({data,refresh,teachers}){
 const today=istToday(),monday=weekRange(today).from;
 const [teacher,setTeacher]=useState(teachers[0]||''),[group,setGroup]=useState(''),[range,setRange]=useState({from:monday,to:addDays(monday,5)});
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const from=range.from<=range.to?range.from:range.to,to=range.from<=range.to?range.to:range.from;
 const days=from&&to?Math.round((Date.parse(to)-Date.parse(from))/86400000)+1:0,tooLong=days>MAX_DAYS;
 const loaded=Boolean(data.period&&from&&to&&from>=data.period.from&&to<=data.period.to);
 // Load the chosen dates when they fall outside the dates already loaded.
 useEffect(()=>{if(!from||!to||tooLong||loaded)return;let live=true;setBusy('Loading these dates…');setError('');
  refresh({from,to}).catch(e=>{if(live)setError(e.message||'Could not load these dates.');}).finally(()=>{if(live)setBusy('');});
  return ()=>{live=false;};},[from,to]);
 const lessons=useMemo(()=>loaded?buildLessonRecords(data.entries||[],from,to,{scope:'planned'}):[],[data.entries,from,to,loaded]);
 const mine=lessons.filter(l=>l.teacher===teacher);
 const groups=[...new Map(mine.map(l=>[groupKey(l),l])).values()].sort((a,b)=>classLine(a).localeCompare(classLine(b),undefined,{numeric:true}));
 const chosen=group?mine.filter(l=>groupKey(l)===group):mine;

 async function download(){
  setError('');setNotice('');
  try{
   if(!chosen.length)throw Error('No lessons were planned for these dates.');
   if(chosen.length>MAX_LESSONS_PER_PDF)throw Error(`This selection has ${chosen.length} lessons. Choose fewer dates or one class and subject.`);
   setBusy('Preparing the PDF…');
   const [{createLessonDocumentationPdf},{canvasRaster,loadLessonFont,loadEvidenceImages}]=await Promise.all([import('@/lib/school-success/lesson-report-pdf'),import('@/lib/school-success/lesson-pdf-assets')]);
   try{await loadLessonFont();}catch{/* device fonts still shape Hindi */}
   const wanted=[...new Set(chosen.flatMap(l=>['activities','writing','remedial','portfolio'].flatMap(k=>(l[k]||[]).filter(f=>isImageUrl(f.url)).slice(0,6).map(f=>f.url))))];
   const images=wanted.length?await loadEvidenceImages(wanted,{limit:150,onProgress:(done,total)=>setBusy(`Adding photos ${done} of ${total}`)}):new Map();
   setBusy('Laying out the PDF…');await new Promise(r=>setTimeout(r,0));
   const doc=createLessonDocumentationPdf({kind:'teacher',lessons:filterLessons(chosen,{teacher:chosen[0].teacherKey}),from,to,images,raster:canvasRaster()});
   const g=group?chosen[0]:null;
   save(doc.output('blob'),['Lessons',safe(teacher),g?safe(classLine(g)):'',from,to].filter(Boolean).join('_')+'.pdf');
   const missing=wanted.length-images.size;
   setNotice('PDF downloaded.'+(missing>0?` ${missing===1?'1 photo is':missing+' photos are'} included as a link because it could not be loaded.`:''));
  }catch(e){setError(e.message||'Could not prepare the PDF.');}
  finally{setBusy('');}
 }

 return <section className="ta-card la-pdf">
  <p className="ta-sub">Plans, classroom evidence, reflections and reviews for one teacher, by the day each lesson was planned for. Each lesson also shows when its plan was submitted.</p>
  <label className="field"><span>Teacher</span><select value={teacher} onChange={e=>{setTeacher(e.target.value);setGroup('');}}>{teachers.map(t=><option key={t}>{t}</option>)}</select></label>
  <div className="la-selects"><label className="field"><span>From</span><input type="date" value={range.from} onChange={e=>e.target.value&&setRange(r=>({...r,from:e.target.value}))}/></label>
   <label className="field"><span>To</span><input type="date" value={range.to} onChange={e=>e.target.value&&setRange(r=>({...r,to:e.target.value}))}/></label></div>
  <label className="field"><span>Class · subject</span><select value={group} onChange={e=>setGroup(e.target.value)} disabled={!loaded}><option value="">All classes and subjects</option>{groups.map(l=><option key={groupKey(l)} value={groupKey(l)}>{classLine(l)}</option>)}</select></label>
  <p className="hint la-pdf-count">{tooLong?`Choose at most ${MAX_DAYS} days.`:!loaded?'Loading these dates…':`${chosen.length} ${chosen.length===1?'lesson':'lessons'} planned for ${formatDay(from)}${from===to?'':' – '+formatDay(to)}.`}</p>
  {error&&<p className="alert error" role="alert">{error} {!loaded&&<button type="button" className="text-button" onClick={()=>{setError('');setBusy('Loading these dates…');refresh({from,to}).catch(e=>setError(e.message)).finally(()=>setBusy(''));}}><RefreshCw size={14}/>Try again</button>}</p>}
  {notice&&<p className="alert success" role="status">{notice}</p>}
  <button type="button" className="button primary la-pdf-btn" disabled={Boolean(busy)||!loaded||tooLong||!chosen.length} onClick={()=>void download()}><Download size={18}/>{busy||'Download lesson PDF'}</button>
 </section>;
}
