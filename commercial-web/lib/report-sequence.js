export const isRemedialFile=f=>f.category==='remedial'||/\/remedial\//.test(f.url||'');
export const isClosureFile=f=>f.category==='closure'||/\/closure\//.test(f.url||'');
export function chronologicalRows(rows=[]){
 return rows.map((row,index)=>({row,index})).sort((a,b)=>{
  const day=r=>String(r.date||r.implementation_date||r.planned_on||'');
  const time=r=>String(r.submittedAt||r.submitted_at||r.prepared_at||'');
  const stage=r=>r.stage==='preparation_saved'||r.feedStage==='Lesson preparation'?0:1;
  return day(a.row).localeCompare(day(b.row))||stage(a.row)-stage(b.row)||time(a.row).localeCompare(time(b.row))||a.index-b.index;
 }).map(x=>x.row);
}
const column=f=>f.column||String(f.key||'').split(':')[0];
export function splitStoredFiles(files=[]){return [
 {label:'Remedial plans / support shared with students',files:chronologicalRows(files.filter(isRemedialFile))},
 {label:'After-class reflections',files:chronologicalRows(files.filter(isClosureFile))},
 {label:'Lesson preparation PDFs',files:chronologicalRows(files.filter(f=>f.category==='lesson_plan'||column(f)==='Lesson_Plan_Picture'))},
 {label:'Audio recordings',files:chronologicalRows(files.filter(f=>f.category==='voice'||column(f)==='Voice_Note_Link'))},
 {label:'',files:chronologicalRows(files.filter(f=>!isClosureFile(f)&&!isRemedialFile(f)&&!['lesson_plan','voice'].includes(f.category)&&!['Lesson_Plan_Picture','Voice_Note_Link'].includes(column(f))))}
 ].filter(g=>g.files.length);}
// Teacher 360° evidence: the School Success portal categories only. Previous-portal items (phonics evidence,
// audio notes, event pictures) are not shown (owner decision, 25 November 2026).
export function reportEvidenceGroups(profile){
 return profile.evidence.map(e=>({label:e.label,files:chronologicalRows(e.files)}));
}

