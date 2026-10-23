import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildProfiles, defaultReportSettings, reportSettingsSchema, reportRows} from '../lib/school-success/reports.js';
import {reportTime} from '../lib/school-success/report-units.js';
import {profileUsageChart, schoolUsageChart, bookUsageChart, comparisonChart, schoolComparisonChart, reportPresentation, chartMaximum} from '../lib/school-success/report-charts.js';
import {compareProfiles} from '../lib/school-success/report-comparison.js';
import {createReportPdf} from '../lib/school-success/report-pdf.js';
const from='2026-10-12', to='2026-10-13';
const roster=[{school:'Example school',name:'Sample teacher'}, {school:'Example school',name:'Zero activity teacher'}];
const rows=[['Lesson Plan',60],['Lesson Plan',30],['Content / Book',120],['Additional Materials',30],['E-book',60]].map(([module,minutes],i)=>({kind:'usage',school:roster[0].school,teacher:roster[0].name,date:from,module,minutes,topic:module==='Content / Book'?'Reading chapter':'Resource '+i,grade:'2',subject:'English'}));
const profiles=settings=>buildProfiles(rows,roster,from,to,settings);
function pdfText(settings, list=profiles(settings), comparison){const pdf=createReportPdf(list,from,to,settings,comparison),dir=mkdtempSync(join(tmpdir(),'chart-test-'));try{const path=join(dir,'report.pdf');writeFileSync(path,Buffer.from(pdf.output('arraybuffer')));return {text:execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'}),pages:pdf.getNumberOfPages()};}finally{rmSync(dir,{recursive:true,force:true});}}
test('old saved settings default to tables and hours, and new choices survive save/reload validation',()=>{
 const legacy=structuredClone(defaultReportSettings);delete legacy.visualization;delete legacy.timeUnit;
 assert.equal(reportSettingsSchema.parse(legacy).visualization,'tables');assert.equal(reportSettingsSchema.parse(legacy).timeUnit,'hours');
 for(const visualization of ['tables','charts','both'])for(const timeUnit of ['hours','minutes'])assert.deepEqual(reportSettingsSchema.parse(JSON.parse(JSON.stringify({...legacy,visualization,timeUnit}))),{...legacy,visualization,timeUnit});
 assert.equal(reportSettingsSchema.safeParse({...legacy,visualization:'pie'}).success,false);
});
test('all usage and workbook conversions use hours without changing raw minutes, sessions or attainment',()=>{
 const s=structuredClone(defaultReportSettings),[p]=profiles(s),before=JSON.stringify(p);
 const chart=profileUsageChart(p,s);assert.equal(chart.unit,'Hours');assert.equal(chart.rows[0].actual,1.5);assert.equal(chart.rows[1].actual,2);assert.equal(chart.rows[0].target,1/3);
 assert.equal(bookUsageChart(p,s).rows[0].actual,2);assert.equal(bookUsageChart(p,s).rows[0].note,'1 session');
 assert.equal(schoolUsageChart([p],0,s).rows[0].actual,1.5);
 assert.equal(profileUsageChart(p,{...s,timeUnit:'minutes'}).rows[0].actual,90);
 const exported=reportRows([p],'hours')[0];assert.equal(exported['Lesson preparation hours'],1.5);assert.equal(exported['Lesson preparation attainment %'],450);assert.equal(exported['Lesson preparation target (hours)'],.3333);
 assert.equal(JSON.stringify(p),before);assert.equal(p.metrics[0].logs.length,2);
 assert.equal(reportTime().format(90),'1.5');assert.equal(reportTime().format(.1),'<0.01');assert.equal(reportTime().format(0),'0');
});
test('chart mode respects hidden modules, zero targets, disabled KPIs and zero usage',()=>{
 const s=structuredClone(defaultReportSettings);s.sections.lessonPlan=false;s.sections.additional=false;s.sections.ebooks=false;s.daily[1]=0;
 const p=profiles(s)[0],chart=profileUsageChart(p,s);assert.deepEqual(chart.rows.map(r=>r.label),['Book usage']);assert.equal(chart.series.length,1);assert.equal(chart.rows[0].target,undefined);
 s.quantitative=false;assert.equal(profileUsageChart(p,s).series.length,1);assert.equal(schoolUsageChart([p],1,s).rows[0].target,undefined);
 const zero=profileUsageChart(profiles(s)[1],s);assert.equal(zero.rows[0].actual,0);assert.ok(chartMaximum(zero)>0);
});
test('period comparison plots use the same totals in hours and retain both date ranges',()=>{
 const s=structuredClone(defaultReportSettings),list=profiles(s),comparison={profiles:list,from:'2026-10-05',to:'2026-10-06',visibleMinutes:1,regularDays:5,changeThreshold:1,excludeSundays:true},changes=compareProfiles(list,comparison);
 const plot=comparisonChart(changes,comparison,from,to,s);assert.equal(plot.rows[0].current,5);assert.equal(plot.rows[0].previous,5);assert.equal(plot.series[0].detail,'2026-10-05 to 2026-10-06');
 assert.equal(schoolComparisonChart(list,changes,comparison,from,to,s).rows[0].current,1.5);
});
test('actual PDFs switch between tables, charts and both in either unit; evidence link sections retain their order',()=>{
 for(const visualization of ['tables','charts','both'])for(const timeUnit of ['hours','minutes']){
  const s={...structuredClone(defaultReportSettings),visualization,timeUnit},p=profiles(s)[0];
  for(const [index,label] of ['Lesson preparation PDFs','Audio recordings','Activity files','Writing samples','Phonics evidence'].entries()){
   const evidenceIndex=[2,2,0,1,3][index],column=['Lesson_Plan_Picture','Voice_Note_Link','Video_Evidence_1','Writing_Sample_Link','Phonics_Evidence_Link'][index];p.evidence[evidenceIndex].files.push({column,url:'https://example.com/'+index,date:from,subject:'English',topic:label});
  }
  const text=pdfText(s,[p]).text,teacher=text.slice(text.indexOf('TEACHER PROFILE'));
  assert.equal(text.includes('Scale starts at zero'),visualization!=='tables');assert.equal(/Book \/ chapter\s+Grade\s+Subject\s+Sessions/.test(teacher),visualization!=='charts');
  assert.equal(teacher.includes('Recorded resource usage'),visualization!=='tables');
  assert.match(text,timeUnit==='hours'?/Hours/:/Minutes/);
  assert.equal(teacher.includes('Total '+timeUnit),visualization!=='charts');
  let previous=teacher.indexOf('File counts indicate');for(const label of ['Lesson preparation PDFs','Audio recordings','Activity files','Writing samples','Phonics evidence']){const i=teacher.indexOf(label,previous+1);assert.ok(i>previous,label);previous=i;}
 }
});
test('PDF charts omit disabled benchmarks and retain every teacher through pagination',()=>{
 const s={...structuredClone(defaultReportSettings),visualization:'charts',quantitative:false,qualitative:false};
 const longRoster=Array.from({length:17},(_,i)=>({school:'Example school',name:'Teacher '+String(i).padStart(2,'0')+' with a longer display name'}));
 const list=buildProfiles(rows,longRoster,from,to,s),result=pdfText(s,list);
 assert.ok(result.pages>17);for(const p of longRoster)assert.ok(result.text.includes(p.name),p.name);
 assert.doesNotMatch(result.text,/Target|Attainment|Usage against benchmark|Period target/);assert.match(result.text,/continued/);
 const comparison={profiles:list,from:'2026-10-05',to:'2026-10-06',visibleMinutes:1,regularDays:5,changeThreshold:1,excludeSundays:true};
 const text=pdfText(s,list.slice(0,1),comparison).text;assert.match(text,/Previous hours/);assert.match(text,/Current hours/);assert.match(text,/2026-10-05 to 2026-10-06/);assert.match(text,/2026-10-12 to 2026-10-13/);
});
