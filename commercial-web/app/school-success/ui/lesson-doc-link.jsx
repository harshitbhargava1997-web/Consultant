'use client';
import dynamic from 'next/dynamic';
import {ArrowLeft,BookOpen} from 'lucide-react';
import {teacherKey} from '@/lib/school-success/reports';
import {formatDay} from '@/lib/school-success/lesson-records';
const LessonRecords=dynamic(()=>import('./lesson-records'),{loading:()=> <section className="card">Loading lesson records…</section>});

// Destination of "Open lesson documentation" links in Teacher 360° usage PDFs. The link only
// pre-fills filters: `data` comes from the authenticated portal read, which already limits schools
// to the signed-in user's School Success grant, so a modified link cannot reveal another school.
export default function LessonDocumentationLink({data,link,onClose}){
 const back=<button className="button" onClick={onClose}><ArrowLeft size={16}/>Back to School Success</button>;
 if(!link)return <section className="card" role="alert"><h2>Lesson documentation link not recognised</h2><p>This link is incomplete or has an invalid date range. Open the report again from Teacher 360°.</p>{back}</section>;
 if(data.actor?.role!=='admin')return <section className="card" role="alert"><h2>Lesson documentation is not available</h2><p>Lesson documentation is available to School Success administrators and consultants assigned to the school.</p>{back}</section>;
 const fresh=data.period?.from===link.from&&data.period?.to===link.to;
 if(!fresh)return <section className="card" role="status"><p>Loading lesson documentation for {formatDay(link.from)} – {formatDay(link.to)}…</p></section>;
 const schools=new Set([...(data.directory?.schools||[]),...(data.entries||[]).map(r=>r.school||r.name)]);
 if(!schools.has(link.school))return <section className="card" role="alert"><h2>Lesson documentation is not available</h2><p>This school is not in your School Success access, or it is no longer in the directory.</p>{back}</section>;
 const classLabel=[link.grade,link.section&&link.section!=='Not Applicable'?'Section '+link.section:''].filter(Boolean).join(' · ')||'All classes';
 return <div className="lesson-doc-link">
  <section className="card"><div className="card-head"><div><span className="eyebrow">FROM A TEACHER 360° REPORT</span><h2>{link.teacher}</h2><p>{link.school} · {classLabel} · {link.subject||'All subjects'} · {formatDay(link.from)} – {formatDay(link.to)}</p></div><BookOpen size={24}/></div>
   <p className="hint">Opened from a Teacher 360° report. The lessons below match that report's teacher, class, section, subject and period. Use <b>Teacher lesson PDF</b> to download the documentation.</p>{back}</section>
  <LessonRecords data={data} from={link.from} to={link.to} school={link.school} teacherKey={teacherKey(link.school,link.teacher)} includeArchived={link.includeArchived} mode="teacher" initialFilters={{grade:link.grade,section:link.section,subject:link.subject}}/>
 </div>;
}
