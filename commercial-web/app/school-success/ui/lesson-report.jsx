'use client';
import {lessonReportFiles,lessonReportUsage} from '@/lib/lesson-groups';
export default function LessonReport({profile,settings}){
 const grades=(profile.lessonGroups||[]).map(g=>({...g,subjects:g.subjects.map(s=>({...s,lessons:s.lessons.map(l=>({...l,files:lessonReportFiles(l,settings),usage:lessonReportUsage(l,settings)})).filter(l=>l.files.length||l.usage.length)})).filter(s=>s.lessons.length)})).filter(g=>g.subjects.length);
 if(!grades.length)return null;
 return <section className="card"><h2>Lesson preparation & classroom activities</h2><p>Grade → subject → planned lesson date. Preparation and subsequent evidence remain linked to their own lesson.</p>{grades.map(g=><section key={g.grade}><h2>Grade: {g.grade}</h2>{g.subjects.map(s=><section key={s.subject}><h3>Subject: {s.subject}</h3>{s.lessons.map(l=><article className="conversation" key={l.key}><b>{l.date} · {l.topic}{l.section?' · Section '+l.section:''}</b>{l.usage.map(r=><p key={r.id}>Preparation session · {r.date} · {Number(r.minutes||0).toFixed(1)} minutes</p>)}<div className="evidence-files">{l.files.map((f,i)=><a className="file" key={f.key||i} href={f.url} target="_blank" rel="noopener noreferrer"><span><b>{f.stage} · {f.category}</b><small>Saved / submitted: {f.date}{f.conductedOn?' · Taught on: '+f.conductedOn:''}</small></span></a>)}</div></article>)}</section>)}</section>)}</section>;
}
