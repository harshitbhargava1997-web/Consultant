import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {lessonDocumentationUrl,parseLessonDocumentationLink,safeReturnPath} from '../lib/school-success/lesson-links.js';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords,lessonDocumentationGroups,filterLessons} from '../lib/school-success/lesson-records.js';
import {buildProfiles,defaultReportSettings} from '../lib/school-success/reports.js';
import {createReportPdf} from '../lib/school-success/report-pdf.js';
import {raw,base,from,to} from './fixtures/lesson-records.mjs';

const origin='https://vision.example.test';
const entriesP=mapLive(raw(),base).then(m=>m.entries);
const uris=doc=>[...doc.output().matchAll(/\/URI \(([^)]*)\)/g)].map(m=>m[1].replace(/\\([()\\])/g,'$1'));
const pdfText=doc=>{const dir=mkdtempSync(join(tmpdir(),'usage-'));try{const p=join(dir,'r.pdf');writeFileSync(p,Buffer.from(doc.output('arraybuffer')));return execFileSync('pdftotext',['-layout',p,'-'],{encoding:'utf8'});}finally{rmSync(dir,{recursive:true,force:true});}};
function docsOption(entries){const map=new Map();for(const g of lessonDocumentationGroups(buildLessonRecords(entries,from,to))){if(!map.has(g.teacherKey))map.set(g.teacherKey,[]);map.get(g.teacherKey).push({...g,url:lessonDocumentationUrl(origin,{...g,from,to})});}return {lessonDocs:p=>map.get(p.key)||[]};}

test('documentation links round-trip exact scope, including Hindi and empty section',()=>{
 const scope={school:'Alpha School',teacher:'आशा (Asha) & Co',grade:'Grade 3',section:'',subject:'Hindi',from,to};
 const url=lessonDocumentationUrl(origin,scope);
 assert.ok(url.startsWith(origin+'/school-success?view=lesson-docs&'));
 assert.ok(!/token|access=|key=/i.test(url),'no credentials or capability tokens in the link');
 assert.deepEqual(parseLessonDocumentationLink(new URL(url).search),{...scope,includeArchived:false});
 assert.equal(parseLessonDocumentationLink(new URL(lessonDocumentationUrl(origin,{...scope,includeArchived:true})).search).includeArchived,true);
});

test('malformed or over-long links are rejected instead of widening scope',()=>{
 const ok=new URL(lessonDocumentationUrl(origin,{school:'S',teacher:'T',from,to}));
 const variant=change=>{const u=new URL(ok);for(const [k,v] of Object.entries(change))v===null?u.searchParams.delete(k):u.searchParams.set(k,v);return parseLessonDocumentationLink(u.search);};
 assert.ok(variant({}));
 for(const change of [{view:'teacher'},{docSchool:null},{docTeacher:''},{from:'2026-13-01'},{from:'2026-11-01',to:'2026-10-01'},{from:'2026-01-01',to:'2026-06-30'},{docSubject:'x'.repeat(201)}])assert.equal(variant(change),null,JSON.stringify(change));
});

test('sign-in return path accepts only same-origin School Success pages',()=>{
 assert.equal(safeReturnPath('/school-success?view=lesson-docs&from=2026-10-01',origin),'/school-success?view=lesson-docs&from=2026-10-01');
 for(const bad of ['https://evil.example/school-success','//evil.example/school-success','/\\evil.example','/admin','/school-success/../api/admin','javascript:alert(1)','',null])assert.equal(safeReturnPath(bad,origin),'',String(bad));
});

test('usage PDF links each class/section/subject group to its exact lesson documentation with distinct counts',async()=>{
 const entries=await entriesP,settings=structuredClone(defaultReportSettings),profiles=buildProfiles(entries,raw().roster,from,to,settings).filter(p=>p.school==='Alpha School'&&p.name==='Asha');
 const doc=createReportPdf(profiles,from,to,settings,undefined,docsOption(entries)),text=pdfText(doc),links=uris(doc).filter(u=>u.includes('view=lesson-docs'));
 assert.match(text,/Lesson documentation/);assert.match(text,/Lessons[\s\S]{0,200}documented/);assert.match(text,/Open lesson\s+documentation/);
 const scopes=links.map(u=>parseLessonDocumentationLink(new URL(u).search));
 assert.deepEqual(scopes.map(s=>[s.school,s.teacher,s.grade,s.section,s.subject,s.from,s.to]),[['Alpha School','Asha','Grade 2','A','English',from,to],['Alpha School','Asha','Grade 2','A','Mathematics',from,to],['Alpha School','Asha','Grade 3','B','Hindi',from,to]]);
 // Each link selects exactly the lessons it counts.
 const lessons=buildLessonRecords(entries,from,to);
 for(const s of scopes)assert.equal(filterLessons(lessons,{teacher:JSON.stringify([s.school,s.teacher]),grade:s.grade,section:s.section,subject:s.subject}).length,1);
});

test('usage PDF keeps activity and writing links but drops preparation PDF, audio and reflection lists; KPIs unchanged',async()=>{
 const entries=await entriesP,settings=structuredClone(defaultReportSettings),profiles=buildProfiles(entries,raw().roster,from,to,settings).filter(p=>p.school==='Alpha School'&&p.name==='Asha');
 const before=JSON.stringify(profiles.map(p=>[p.metrics.map(m=>[m.actual,m.target,m.status]),p.evidence.map(e=>[e.actual,e.target,e.status])]));
 const doc=createReportPdf(profiles,from,to,settings,undefined,docsOption(entries)),text=pdfText(doc),links=uris(doc);
 assert.equal(JSON.stringify(profiles.map(p=>[p.metrics.map(m=>[m.actual,m.target,m.status]),p.evidence.map(e=>[e.actual,e.target,e.status])])),before);
 assert.doesNotMatch(text,/Lesson preparation PDFs|Audio recordings|After-class reflections/);
 assert.ok(links.some(u=>u.endsWith('a1.jpg'))&&links.some(u=>u.endsWith('w1.jpg')),'activity and writing links remain');
 assert.ok(!links.some(u=>/\.wav$|plan\.pdf$|reflection\.pdf$/.test(u)),'no audio, preparation or reflection file links');
 assert.match(text,/Teacher evidence/);assert.match(text,/LP \/ Audio notes/,'quantitative evidence table still counts preparation/audio files');
});

test('combined and per-school PDFs give every teacher only their own documentation links',async()=>{
 const entries=await entriesP,settings=structuredClone(defaultReportSettings),profiles=buildProfiles(entries,raw().roster,from,to,settings);
 const option=docsOption(entries),combined=uris(createReportPdf(profiles,from,to,settings,undefined,option)).filter(u=>u.includes('view=lesson-docs')).map(u=>parseLessonDocumentationLink(new URL(u).search));
 assert.deepEqual([...new Set(combined.map(s=>s.school+'|'+s.teacher))].sort(),['Alpha School|Asha','Alpha School|Bina','Beta School|Asha']);
 const beta=uris(createReportPdf(profiles.filter(p=>p.school==='Beta School'),from,to,settings,undefined,option)).filter(u=>u.includes('view=lesson-docs')).map(u=>parseLessonDocumentationLink(new URL(u).search));
 assert.deepEqual(beta.map(s=>[s.school,s.teacher,s.subject]),[['Beta School','Asha','English']]);
 // Callers that do not pass options (older exports) still render without a documentation section.
 assert.doesNotMatch(pdfText(createReportPdf(profiles.slice(0,1),from,to,settings)),/Open lesson\s+documentation/);
});

const ACCESS={link:i=>`https://vision.example.test/school-success/shared/0b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f6${i}#${'A'.repeat(43)}`,signin:i=>`https://vision.example.test/school-success/secure/0b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f6${i}`};
const accessOption=(base,mode)=>({lessonDocs:p=>base.lessonDocs(p).map((g,i)=>({...g,url:ACCESS[mode](i)})),lessonDocsAccess:mode});

test('parent usage report: one "Open lesson documentation" link per group in the chosen access mode, and no direct file links',async()=>{
 const entries=await entriesP,settings=structuredClone(defaultReportSettings);settings.sections.evidence=true;
 const profiles=buildProfiles(entries,raw().roster,from,to,settings).filter(p=>p.school==='Alpha School'&&p.name==='Asha');
 const base=docsOption(entries),groups=base.lessonDocs(profiles[0]).length;
 for(const mode of ['link','signin']){
  const doc=createReportPdf(profiles,from,to,settings,undefined,accessOption(base,mode)),text=pdfText(doc).replace(/\s+/g,' '),links=uris(doc);
  assert.deepEqual(links.sort(),[...Array(groups).keys()].map(ACCESS[mode]).sort(),mode+': exactly one access link per group, nothing else');
  assert.match(text,/Each link opens the complete lesson report for this teacher and period, saved when this report was created: lesson plans, classroom photos, student writing, attachments, recordings, dated reflections and feedback\./);
  assert.match(text,mode==='link'?/Anyone with a link can open that report and its files without signing in\. The school can revoke a link; copies already downloaded cannot be recalled\./:/Opening a report or any of its files requires school sign-in\./);
  assert.match(text,/Open lesson\s+documentation/);assert.doesNotMatch(text,/Shareable copy|Full evidence/);
  assert.match(text,/Files are listed here without links; open them from the lesson documentation links/);
 }
 // Without consolidated report links (e.g. the KPI flow's internal use), evidence links are unchanged.
 assert.ok(uris(createReportPdf(profiles,from,to,settings,undefined,base)).some(u=>u.startsWith(mediaBase)));
});
const mediaBase=base.replace(/\/$/,'');

test('consultant observations: the same detailed content in both access options (individual, combined, per-school)',async()=>{
 const STUDENT='Zephyrine Quillfeather',settings=structuredClone(defaultReportSettings);settings.sections.observations=true;
 const observation=(id,school,teacher,date)=>({kind:'observation',id,school,teacher,date,grade:'Grade 2 A',subject:'English',topic:'Blending CVC words',
  rubrics:{Questioning:{score:2,comment:`${STUDENT} answered every question; others waited.`},'Classroom climate':`Praise ${STUDENT} less publicly.`},
  strengths:`Clear modelling; ${STUDENT} read all six words.`,improvements:`Seat ${STUDENT} away from the door.`,actions:`Share ${STUDENT}'s progress with her parents.`,followup:'',readOnly:true});
 const entries=[...await entriesP,observation('obs-1','Alpha School','Asha','2026-10-22'),observation('obs-2','Alpha School','Asha','2026-10-27'),observation('obs-3','Beta School','Asha','2026-10-23')];
 const profiles=buildProfiles(entries,raw().roster,from,to,settings),asha=profiles.find(p=>p.school==='Alpha School'&&p.name==='Asha');
 const base=docsOption(entries),text=doc=>pdfText(doc).replace(/\s+/g,' ');
 // Every teacher's observation section, up to the next teacher profile (other sections differ by mode by design).
 const observationSection=t=>t.replace(/SCHOOL SUCCESS \| Private academic review \d+\/\d+/g,'').split('Classroom observation report').slice(1).map(c=>c.split('TEACHER PROFILE')[0].replace(/ONELERN \/ SCHOOL SUCCESS\s*$/,'').trim());
 const reports={individual:[asha],combined:profiles,...Object.fromEntries([...new Set(profiles.map(p=>p.school))].map(s=>['zip:'+s,profiles.filter(p=>p.school===s)]))};
 for(const [label,list] of Object.entries(reports)){
  const link=text(createReportPdf(list,from,to,settings,undefined,accessOption(base,'link'))),signin=text(createReportPdf(list,from,to,settings,undefined,accessOption(base,'signin')));
  for(const t of [link,signin]){assert.ok(t.includes(STUDENT),label);assert.match(t,/answered every question/);assert.match(t,/Clear modelling/);assert.match(t,/away from the door/);}
  assert.ok(observationSection(link).length>0,label);assert.deepEqual(observationSection(link),observationSection(signin),label+': identical observation content in both options');
  assert.doesNotMatch(link,/left out of reports created for anyone with the link/);
 }
});
