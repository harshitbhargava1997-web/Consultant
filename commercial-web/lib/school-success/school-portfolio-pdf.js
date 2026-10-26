import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import {regularFont,boldFont} from './report-fonts.js';
import {portfolioModules,portfolioCategories,fileCategory,portfolioTotals} from './school-portfolio.js';
import {formatReportDuration as duration} from './report-units.js';
import {chronologicalRows} from '../report-sequence.js';
const labels=['Lesson preparation','Book usage','Additional Materials','E-books'];
const sessions=count=>`${count} session${count===1?'':'s'}`;
export function createSchoolPortfolioPdf({schools,from,to,settings,detail=false,includeEvidence=false,includeObservations=false,rawObservations=[]}){
 if(!schools.length)throw Error('Select at least one school.');
 const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
 doc.addFileToVFS('Report-Regular.ttf',regularFont);doc.addFont('Report-Regular.ttf','Report','normal');
 doc.addFileToVFS('Report-Bold.ttf',boldFont);doc.addFont('Report-Bold.ttf','Report','bold');
 const width=297,height=210,margin=14,modules=portfolioModules(settings);let y=23;
 const text=(value,size=10,bold=false)=>{
  if(bold&&size>=12&&y>height-62){doc.addPage();y=22;}
  doc.setFont('Report',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor('#163a43');
  const lines=doc.splitTextToSize(String(value),width-margin*2);
  for(const line of lines){if(y>height-22){doc.addPage();y=22;}doc.text(line,margin,y);y+=size*.43+2;}y+=3;
 };
 const table=(head,body,urls)=>{
  if(!body.length){text('No records in this review period.',9);return;}
  if(y>height-45){doc.addPage();y=22;}
  autoTable(doc,{startY:y,head:[head],body,margin:{top:18,left:margin,right:margin,bottom:18},
   styles:{font:'Report',fontSize:8,cellPadding:2.5,overflow:'linebreak',textColor:'#243e48'},
   headStyles:{fillColor:'#163a43',textColor:'#ffffff',fontStyle:'bold'},alternateRowStyles:{fillColor:'#f1f7f6'},rowPageBreak:'avoid',
   didDrawCell:cell=>{const url=urls?.[cell.row.index];if(cell.section==='body'&&cell.column.index===0&&url&&/^https?:\/\//i.test(url))doc.link(cell.cell.x,cell.cell.y,cell.cell.width,cell.cell.height,{url});}
  });y=doc.lastAutoTable.finalY+10;
 };
 const totals=portfolioTotals(schools),schoolDetail=detail&&schools.length===1;
 text('SCHOOL SUCCESS / SCHOOL 360',10,true);text(schoolDetail?schools[0].name:'Complete school portfolio',22,true);
 text(`${from} to ${to} | ${totals.schools} schools | ${totals.teachers} teacher profiles | ${totals.withUsage} teachers with recorded usage`,10);
 text('Durations are shown in hours and minutes. Participation and submission counts describe recorded activity.',9);
 text('School usage and participation',13,true);
 table(['School','Teachers using / total',...modules.map(i=>labels[i]),...(settings.quantitative?['Teachers meeting usage targets']:[])],
  schools.map(s=>[s.name,`${s.withUsage} / ${s.teachers}`,...modules.map(i=>`${duration(s.metrics[i].actual)}\n${sessions(s.metrics[i].sessions)}`),...(settings.quantitative?[s.targetTeachers?`${s.targetsMet} / ${s.targetTeachers}`:'Not applicable']:[])]));
 if(settings.sections.evidence){
  text('Preparation and evidence counts',13,true);
  table(['School','Prepared lessons','Classroom lessons with evidence','Unique files','Teachers with uploads','Lessons awaiting review'],schools.map(s=>[s.name,s.preparations,s.classroomLessons,s.files,s.teachersWithFiles,s.pendingReview]));
 }
 if(settings.quantitative){
  text('School usage targets',13,true);
  table(['School',...modules.map(i=>labels[i]+' target')],schools.map(s=>[s.name,...modules.map(i=>s.metrics[i].target?duration(s.metrics[i].target):'Off')]));
 }
 if(schoolDetail){
  const school=schools[0];text('Teacher breakdown',13,true);
  table(['Teacher',...modules.map(i=>labels[i]),...(settings.sections.evidence?['Unique uploaded files']:[])],school.profiles.map(p=>[p.name,...modules.map(i=>`${duration(p.metrics[i].actual)}\n${sessions(p.metrics[i].logs.length)}`),...(settings.sections.evidence?[new Set(school.submissions.filter(r=>r.teacher===p.name).flatMap(r=>(r.files||[]).map(f=>f.url).filter(Boolean))).size]:[])]));
  if(includeEvidence&&settings.sections.evidence){
   for(const category of ['preparation','audio','activity','writing','phonics','portfolio','events','other']){
    const seen=new Set(),rows=[];
    for(const row of chronologicalRows(school.submissions))for(const file of row.files||[]){
     const key=JSON.stringify([row.teacher,file.url]);
     if(fileCategory(file)!==category||!file.url||seen.has(key))continue;
     seen.add(key);rows.push({row,file});
    }
    if(!rows.length)continue;
    text(portfolioCategories.find(([key])=>key===category)[1],13,true);
    table(['Open submitted file','Teacher','Submitted date','Planned date','Class / subject','Lesson / activity'],rows.map(({row})=>['Open file',row.teacher,row.date,row.plannedDate||'',`${row.grade||''} ${row.section||''} / ${row.subject||''}`,row.topic||'']),rows.map(({file})=>file.url));
   }
  }
  if(includeObservations){
   text('Consultant classroom observations',13,true);
   const observations=chronologicalRows(rawObservations.filter(r=>r.kind==='observation'&&r.school===school.name&&r.date>=from&&r.date<=to));
   table(['Date','Teacher / subject','Strengths','Areas for growth','Agreed actions'],observations.map(r=>[r.date,r.teacher+' / '+r.subject,r.strengths||'',r.improvements||'',r.actions||'']));
  }
 }
 for(let page=1;page<=doc.getNumberOfPages();page++){
  doc.setPage(page);doc.setFont('Report','normal');doc.setFontSize(8);doc.setTextColor('#647780');
  doc.text(`${from} to ${to}`,margin,height-8);doc.text(`${page} / ${doc.getNumberOfPages()}`,width-margin,height-8,{align:'right'});
 }
 return doc;
}
