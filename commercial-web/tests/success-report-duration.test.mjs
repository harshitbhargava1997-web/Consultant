import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildProfiles,defaultReportSettings,reportSettingsSchema,reportRows} from '../lib/school-success/reports.js';
import {formatReportDuration as duration} from '../lib/school-success/report-units.js';
import {createReportPdf} from '../lib/school-success/report-pdf.js';
const from='2026-10-12',to='2026-10-13',roster=[{school:'Sample school',name:'Sample teacher'}];
const rows=[60,30].map(minutes=>({kind:'usage',school:'Sample school',teacher:'Sample teacher',date:from,module:'Lesson Plan',minutes}));
function extract(pdf){const dir=mkdtempSync(join(tmpdir(),'duration-test-'));try{const path=join(dir,'report.pdf');writeFileSync(path,Buffer.from(pdf.output('arraybuffer')));return execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8'});}finally{rmSync(dir,{recursive:true,force:true});}}
test('durations show hours and remaining minutes, including carries, small values and signed changes',()=>{
 for(const [minutes,expected] of [[0,'0 min'],[5,'5 min'],[60,'1 hr 0 min'],[90,'1 hr 30 min'],[125,'2 hr 5 min'],[-90,'-1 hr 30 min'],[59.6,'1 hr 0 min'],[59.4,'59 min'],[.1,'<1 min']])assert.equal(duration(minutes),expected);
 assert.equal(duration(Infinity),'—');
});
test('old chart preferences are ignored without changing other saved benchmarks or sections',()=>{
 const original=structuredClone(defaultReportSettings);original.daily=[10,20,0,30];original.sections.additional=false;
 for(const visualization of ['tables','charts','both'])for(const timeUnit of ['hours','minutes'])assert.deepEqual(reportSettingsSchema.parse({...original,visualization,timeUnit}),original);
});
test('duration presentation preserves raw totals, sessions, targets, percentages and numeric workbook data',()=>{
 const [p]=buildProfiles(rows,roster,from,to,defaultReportSettings),before=JSON.stringify(p),[record]=reportRows([p]);
 assert.equal(record['Lesson preparation time'],'1 hr 30 min');assert.equal(record['Lesson preparation minutes'],90);assert.equal(record['Lesson preparation target time'],'20 min');assert.equal(record['Lesson preparation target'],20);assert.equal(record['Lesson preparation attainment %'],450);
 assert.equal(p.metrics[0].logs.length,2);assert.equal(JSON.stringify(p),before);
 const fractional=buildProfiles(rows.map(r=>({...r,minutes:.4})),roster,from,to,defaultReportSettings)[0];assert.equal(fractional.metrics[0].actual,.8);assert.equal(duration(fractional.metrics[0].actual),'1 min');
});
test('actual PDFs remain in tables for every old saved view and retain dated comparisons',()=>{
 for(const visualization of ['tables','charts','both']){
  const settings={...structuredClone(defaultReportSettings),visualization,timeUnit:'hours'},list=buildProfiles(rows,roster,from,to,settings),comparison={profiles:list,from:'2026-10-05',to:'2026-10-06',visibleMinutes:1,regularDays:5,changeThreshold:1,excludeSundays:true};
  const text=extract(createReportPdf(list,from,to,settings,comparison));
  assert.match(text,/1 hr 30 min/);assert.match(text,/Activity\s+Sessions\s+Preparation time/);assert.match(text,/Previous time\s+Current time/);assert.match(text,/2026-10-05\s+2026-10-12/);assert.doesNotMatch(text,/Scale starts at zero|Recorded resource usage|\b1\.5\b/);
 }
});
test('table PDFs preserve all teachers and omit disabled KPIs after duration formatting',()=>{
 const settings={...structuredClone(defaultReportSettings),quantitative:false,qualitative:false},people=Array.from({length:17},(_,i)=>({school:'Sample school',name:'Teacher '+String(i).padStart(2,'0')})),list=buildProfiles([],people,from,to,settings),text=extract(createReportPdf(list,from,to,settings));
 for(const p of people)assert.ok(text.includes(p.name),p.name);assert.doesNotMatch(text,/Period target|Usage against benchmark|Evidence submission overview/);assert.match(text,/0 min/);
});
