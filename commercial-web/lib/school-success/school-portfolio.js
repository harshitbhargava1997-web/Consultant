import {buildProfiles,defaultReportSettings,reportSettingsSchema,includedMetric,eligibleDays,teacherKey} from './reports.js';
import {reportDirectorySource,isArchived} from './directory.js';
import {chronologicalRows} from '../report-sequence.js';
import {formatReportDuration} from './report-units.js';

export const portfolioModules=settings=>[0,1,3,2].filter(i=>includedMetric(i,settings));
export const portfolioSettings=data=>{const parsed=reportSettingsSchema.safeParse(data.reportSettings);return parsed.success?parsed.data:structuredClone(defaultReportSettings);};
export const fileCategory=file=>{
 const column=file.column||String(file.key||'').split(':')[0];
 if(column==='Lesson_Plan_Picture'||file.category==='lesson_plan')return 'preparation';
 if(column==='Voice_Note_Link'||file.category==='voice')return 'audio';
 if(column.startsWith('Video_Evidence_')||file.category==='activity')return 'activity';
 if(column==='Writing_Sample_Link'||file.category==='writing')return 'writing';
 if(column==='Phonics_Evidence_Link'||file.category==='phonics')return 'phonics';
 if(column==='Portfolio_Evidence_Link'||file.category==='portfolio')return 'portfolio';
 if(column==='Event_Pictures_Link'||file.category==='event_pictures')return 'events';
 return 'other';
};
export const portfolioCategories=[['all','All evidence'],['preparation','Lesson preparation PDFs'],['audio','Audio recordings'],['activity','Classroom activities'],['writing','Writing samples'],['phonics','Phonics evidence'],['portfolio','Portfolio artifacts'],['events','Event pictures'],['other','Other files']];
export const lessonIdentity=row=>JSON.stringify([row.school,row.teacher,row.recordId||row.id||[row.plannedDate||row.date,row.grade,row.section,row.subject,row.topic]]);
export function submissionStats(rows){
 const lessons=new Map(),preparations=new Set(),classroomLessons=new Set(),files=new Map(),teachers=new Set();
 for(const row of rows){
  const lesson=lessonIdentity(row),reviewed=Boolean(row.review?.trim());
  lessons.set(lesson,Boolean(lessons.get(lesson))||reviewed);
  if(row.stage==='preparation_saved'||row.feedStage==='Lesson preparation')preparations.add(lesson);
  for(const file of row.files||[]){
   if(!file.url)continue;
   const key=JSON.stringify([row.school,row.teacher,file.url]),category=fileCategory(file);
   files.set(key,{...file,category,teacher:row.teacher,date:row.date});teachers.add(teacherKey(row.school,row.teacher));
   if(!['preparation','audio'].includes(category))classroomLessons.add(lesson);
  }
 }
 const categories=Object.fromEntries(portfolioCategories.filter(([key])=>key!=='all').map(([key])=>[key,[...files.values()].filter(f=>f.category===key).length]));
 return {preparations:preparations.size,classroomLessons:classroomLessons.size,files:files.size,teachersWithFiles:teachers.size,pendingReview:[...lessons.values()].filter(reviewed=>!reviewed).length,categories};
}
function aggregate(name,profiles,submissions,from,to,settings,calendars){
 const metrics=[0,1,2,3].map(i=>{
  const actual=profiles.reduce((sum,p)=>sum+p.metrics[i].actual,0),target=profiles.reduce((sum,p)=>sum+p.metrics[i].target,0);
  return {module:profiles[0]?.metrics[i].module,label:profiles[0]?.metrics[i].label,actual,target,sessions:profiles.reduce((sum,p)=>sum+p.metrics[i].logs.length,0),percent:target>0?actual/target*100:null};
 });
 const withUsage=profiles.filter(p=>p.metrics.some(m=>m.actual>0)).length,stats=submissionStats(submissions);
 const lastDate=[...profiles.flatMap(p=>p.usage.map(r=>r.date)),...submissions.map(r=>r.date)].sort().at(-1)||'';
 const applicable=profiles.filter(p=>p.metrics.some((m,i)=>includedMetric(i,settings)&&m.target>0));
 const targetsMet=applicable.filter(p=>p.metrics.every((m,i)=>!includedMetric(i,settings)||!m.target||m.actual>=m.target)).length;
 return {name,profiles,submissions,metrics,teachers:profiles.length,withUsage,participation:profiles.length?withUsage/profiles.length*100:null,
  ...stats,lastDate,targetsMet,targetTeachers:applicable.length,days:profiles[0]?.days??eligibleDays(from,to,[...settings.holidays,...(settings.useSchoolCalendars?calendars[name]||[]:[])],settings.excludeSundays)};
}
export function buildSchoolPortfolio(data,from,to,{includeArchived=false}={}){
 const settings=portfolioSettings(data),archives=data.directory?.archives||[],source=reportDirectorySource(data,archives,includeArchived);
 const profiles=buildProfiles(source.entries,source.roster,from,to,settings,data.calendars||{});
 const submissions=chronologicalRows(source.entries.filter(r=>r.kind==='submission'&&r.date>=from&&r.date<=to));
 const names=[...new Set([...profiles.map(p=>p.school),...source.entries.filter(r=>r.kind==='school').map(r=>r.school||r.name)])]
  .filter(name=>name&&(includeArchived||!isArchived(archives,name))).sort((a,b)=>a.localeCompare(b));
 const schools=names.map(name=>aggregate(name,profiles.filter(p=>p.school===name),submissions.filter(r=>r.school===name),from,to,settings,data.calendars||{}));
 return {settings,profiles,submissions,schools};
}
export function portfolioTotals(schools){
 return schools.reduce((sum,s)=>({schools:sum.schools+1,teachers:sum.teachers+s.teachers,withUsage:sum.withUsage+s.withUsage,files:sum.files+s.files,preparations:sum.preparations+s.preparations,pendingReview:sum.pendingReview+s.pendingReview}),{schools:0,teachers:0,withUsage:0,files:0,preparations:0,pendingReview:0});
}
export function filterPortfolioSchools(schools,{school='',query='',status='all',sort='name'}={}){
 const filtered=schools.filter(s=>(!school||s.name===school)&&s.name.toLowerCase().includes(query.trim().toLowerCase())&&
  (status==='all'||status==='no-usage'&&s.withUsage===0||status==='no-uploads'&&s.files===0||status==='pending'&&s.pendingReview>0));
 return [...filtered].sort((a,b)=>{
  const usage=s=>s.metrics.reduce((sum,m)=>sum+m.actual,0);
  const result=sort==='participation'?(a.participation??-1)-(b.participation??-1):sort==='usage-asc'?usage(a)-usage(b):sort==='usage-desc'?usage(b)-usage(a):0;
  return result||a.name.localeCompare(b.name);
 });
}
export function filterSchoolEvidence(rows,{teacher='',category='all',review='all',query='',order='oldest'}={}){
 const filtered=rows.filter(r=>(!teacher||r.teacher===teacher)&&(category==='all'||(r.files||[]).some(f=>fileCategory(f)===category))&&
  (review==='all'||review==='pending'&&!r.review?.trim()||review==='reviewed'&&Boolean(r.review?.trim()))&&
  [r.school,r.teacher,r.grade,r.section,r.subject,r.topic,r.reflection,r.materials,r.date].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
 const ordered=chronologicalRows(filtered);
 return order==='newest'?ordered.reverse():ordered;
}
export function portfolioExportRows(schools,settings){
 return schools.map(s=>({School:s.name,'Teacher profiles':s.teachers,'Teachers with usage':s.withUsage,'Participation %':s.participation===null?'Not applicable':Number(s.participation.toFixed(1)),
  ...Object.fromEntries(portfolioModules(settings).flatMap(i=>[[(s.metrics[i].label||['Lesson preparation','Book usage','Additional Materials','E-books'][i])+' time',formatReportDuration(s.metrics[i].actual)],[(s.metrics[i].label||['Lesson preparation','Book usage','Additional Materials','E-books'][i])+' sessions',s.metrics[i].sessions]])),
  ...(settings.quantitative?{'Teachers meeting usage targets':s.targetsMet,'Teachers with usage targets':s.targetTeachers}:{}),
  ...(settings.sections.evidence?{'Prepared lessons':s.preparations,'Lessons with classroom evidence':s.classroomLessons,'Unique uploaded files':s.files,'Teachers with uploads':s.teachersWithFiles,'Lessons awaiting review':s.pendingReview,...Object.fromEntries(portfolioCategories.filter(([key])=>key!=='all').map(([key,label])=>[label,s.categories[key]]))}:{}),
  'Working days':s.days,'Last recorded activity':s.lastDate||''}));
}
