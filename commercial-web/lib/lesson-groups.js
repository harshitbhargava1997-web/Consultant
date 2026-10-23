const compare=(a,b)=>String(a||'').localeCompare(String(b||''),'en',{numeric:true,sensitivity:'base'});
const rank=grade=>{const g=String(grade||'').toLowerCase();return g==='nursery'?0:g==='lkg'?1:g==='ukg'?2:/\d+/.test(g)?3+Number(g.match(/\d+/)[0]):100;};
// Callers supply one teacher's rows. Explicit record identities connect updates;
// matching topic text never combines unrelated lessons or teachers.
export function groupLessonRows(rows){
 const grades=new Map();
 for(const r of rows){const grade=r.grade||'Grade not recorded',subject=r.subject||'Subject not recorded';
  if(!grades.has(grade))grades.set(grade,new Map());const subjects=grades.get(grade);
  if(!subjects.has(subject))subjects.set(subject,new Map());const lessons=subjects.get(subject);
  const identity=r.recordId||r.id;if(!identity)throw Error('Lesson identity is required');
  const key=JSON.stringify([r.school||'',r.teacher||'',identity]);
  if(!lessons.has(key))lessons.set(key,{key,grade,subject,section:r.section||'',date:r.plannedDate||r.planned_on||r.date||r.implementation_date||'',topic:r.topic||r.lesson_topic||'Lesson topic not recorded',rows:[]});
  lessons.get(key).rows.push(r);
 }
 return [...grades].sort(([a],[b])=>rank(a)-rank(b)||compare(a,b)).map(([grade,subjects])=>({grade,subjects:[...subjects].sort(([a],[b])=>compare(a,b)).map(([subject,lessons])=>({subject,lessons:[...lessons.values()].sort((a,b)=>compare(a.date,b.date)||compare(a.section,b.section)||compare(a.topic,b.topic)||compare(a.key,b.key)).map(l=>({...l,rows:l.rows.slice().sort((a,b)=>compare(a.date||a.implementation_date,b.date||b.implementation_date)||compare(a.id,b.id))}))}))}));
}
export function visionLessonRows(lessons){return lessons.flatMap(l=>l.periods.map(p=>({...p,recordId:JSON.stringify([l.id,p.id]),plannedDate:l.planned_on,date:l.planned_on,lesson:l,period:p})));}
const preparationColumns=new Set(['Voice_Note_Link','Lesson_Plan_Picture']);
export function lessonReportFiles(lesson,settings){
 const files=[],seen=new Set();
 for(const r of lesson.rows)for(const f of r.files||[]){
  const prep=r.stage==='preparation_saved'||r.feedStage==='Lesson preparation'||!r.stage&&preparationColumns.has(f.column||String(f.key).split(':')[0]);
  if(prep?!settings.sections.lessonPlan:!settings.sections.evidence)continue;
  const key=JSON.stringify([r.id,f.url]);if(seen.has(key))continue;seen.add(key);
  files.push({...f,date:r.date,conductedOn:prep?'':r.conductedOn||'',stage:prep?'Lesson preparation':'Classroom evidence',category:preparationColumns.has(f.column)?f.column==='Voice_Note_Link'?'Voice reflection':'Lesson preparation PDF':(f.category||f.name||'Activity evidence').replaceAll('_',' ')});
 }
 return files.sort((a,b)=>(a.stage==='Lesson preparation'?0:1)-(b.stage==='Lesson preparation'?0:1)||compare(a.date,b.date)||compare(a.category,b.category)||compare(a.url,b.url));
}
export function lessonReportUsage(lesson,settings){return settings.sections.lessonPlan?lesson.rows.filter(r=>r.kind==='usage'&&r.module==='Lesson Plan'):[];}
