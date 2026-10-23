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
 {label:'Lesson preparation PDFs',files:chronologicalRows(files.filter(f=>f.category==='lesson_plan'||column(f)==='Lesson_Plan_Picture'))},
 {label:'Audio recordings',files:chronologicalRows(files.filter(f=>f.category==='voice'||column(f)==='Voice_Note_Link'))},
 {label:'',files:chronologicalRows(files.filter(f=>!['lesson_plan','voice'].includes(f.category)&&!['Lesson_Plan_Picture','Voice_Note_Link'].includes(column(f))))}
 ].filter(g=>g.files.length);}
export function reportEvidenceGroups(profile){
 return [...profile.evidence.flatMap((e,i)=>i===2?splitStoredFiles(e.files).map(g=>({label:g.label||e.label,files:g.files})):[{label:e.label,files:chronologicalRows(e.files)}]),{label:'Event pictures',files:chronologicalRows(profile.events||[])}];
}
