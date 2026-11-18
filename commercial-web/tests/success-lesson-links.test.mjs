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

test('parent usage report with shareable links: two links per group, and no attachment links anywhere; private keeps sign-in links',async()=>{
 const entries=await entriesP,settings=structuredClone(defaultReportSettings);settings.sections.evidence=true;
 const profiles=buildProfiles(entries,raw().roster,from,to,settings).filter(p=>p.school==='Alpha School'&&p.name==='Asha');
 const share=i=>`https://vision.example.test/school-success/shared/0b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f6${i}#${'A'.repeat(43)}`,full=i=>`https://vision.example.test/school-success/report/1b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f6${i}`;
 const base=docsOption(entries),shared={lessonDocs:p=>base.lessonDocs(p).map((g,i)=>({...g,url:share(i),fullUrl:full(i)})),lessonDocsAccess:'shared'};
 const doc=createReportPdf(profiles,from,to,settings,undefined,shared),text=pdfText(doc).replace(/\s+/g,' '),links=uris(doc),groups=base.lessonDocs(profiles[0]).length;
 assert.match(text,/"Shareable copy" opens without signing in: anyone with the link can view it\./);
 assert.match(text,/leaves out photos, videos, recordings, student work, attachment links, reflection text and review comments/);
 assert.match(text,/The school can revoke a link; copies already downloaded cannot be recalled\./);assert.doesNotMatch(text,/Sign-in is required\./);
 assert.match(text,/Open shareable copy ↗/);assert.match(text,/\(no sign-in\)/);assert.match(text,/Open full evidence ↗/);assert.match(text,/\(school sign-in\)/);assert.match(text,/Shareable copy Full evidence/);
 assert.deepEqual(links.sort(),[...Array(groups).keys()].flatMap(i=>[share(i),full(i)]).sort(),'only sharing links and sign-in links to the app');
 assert.ok(links.every(u=>u.startsWith('https://vision.example.test/school-success/')),'no media/attachment URL can bypass the choice');
 assert.match(text,/evidence files are listed without links; open them in Teacher 360° with school sign-in/);
 // Private export of the same data: unchanged wording and evidence links.
 const priv=createReportPdf(profiles,from,to,settings,undefined,base);
 assert.match(pdfText(priv).replace(/\s+/g,' '),/Sign-in is required\./);
 assert.ok(uris(priv).some(u=>u.startsWith(baseUrl())),'private reports still link evidence for signed-in reviewers');
});
const baseUrl=()=>base.replace(/\/$/,'');

test('shareable parent reports (individual, combined, per-school ZIP) show observation counts and dates only; the full-evidence report keeps the notes',async()=>{
 const STUDENT='Zephyrine Quillfeather',settings=structuredClone(defaultReportSettings);settings.sections.observations=true;
 // Fictional consultant observations naming a student in notes and rubric comments, for teachers in both schools.
 const observation=(id,school,teacher,date)=>({kind:'observation',id,school,teacher,date,grade:'Grade 2 A',subject:'English',topic:'Blending CVC words',
  rubrics:{Questioning:{score:2,comment:`${STUDENT} answered every question; others waited.`},'Classroom climate':`Praise ${STUDENT} less publicly.`},
  strengths:`Clear modelling; ${STUDENT} read all six words.`,improvements:`Seat ${STUDENT} away from the door.`,actions:`Share ${STUDENT}'s progress with her parents.`,followup:'',readOnly:true});
 const entries=[...await entriesP,observation('obs-1','Alpha School','Asha','2026-10-22'),observation('obs-2','Alpha School','Asha','2026-10-27'),observation('obs-3','Beta School','Asha','2026-10-23')];
 const profiles=buildProfiles(entries,raw().roster,from,to,settings),asha=profiles.find(p=>p.school==='Alpha School'&&p.name==='Asha');
 assert.deepEqual(asha.observations.map(o=>o.date),['2026-10-22','2026-10-24','2026-10-27'],'two added observations plus the fixture\'s own, in date order; Beta School\'s Asha keeps hers');
 assert.equal(profiles.find(p=>p.school==='Beta School'&&p.name==='Asha').observations.length,1);
 const base=docsOption(entries),shared={lessonDocs:p=>base.lessonDocs(p).map((g,i)=>({...g,url:`https://vision.example.test/school-success/shared/0b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f6${i}#${'A'.repeat(43)}`,fullUrl:`https://vision.example.test/school-success/report/1b9e7a39-6c55-4f5e-9d5c-2a1c3d4e5f6${i}`})),lessonDocsAccess:'shared'};
 const text=doc=>pdfText(doc).replace(/\s+/g,' ');
 // The same lists the Teacher 360° export passes for each format.
 const reports={individual:[asha],combined:profiles,...Object.fromEntries([...new Set(profiles.map(p=>p.school))].map(s=>['zip:'+s,profiles.filter(p=>p.school===s)]))};
 for(const [label,list] of Object.entries(reports)){
  const t=text(createReportPdf(list,from,to,settings,undefined,shared));
  for(const fragment of [STUDENT,'Zephyrine','Quillfeather','answered every question','away from the door','Clear modelling'])assert.ok(!t.includes(fragment),`${label}: shareable parent omits "${fragment}"`);
  assert.match(t,/Classroom observation report/,label);
  assert.match(t,/Observation notes and rubric comments are left out of this shareable report; they are in the full-evidence report with school sign-in\./,label);
 }
 const indiv=text(createReportPdf([asha],from,to,settings,undefined,shared));
 assert.match(indiv,/3 consultant observations recorded in this review period/);assert.match(indiv,/Observation 1 2026-10-22/);assert.match(indiv,/Observation 2 2026-10-24/);assert.match(indiv,/Observation 3 2026-10-27/);
 // Authorised full-evidence report (sign-in): detailed observations, including the name, are kept.
 const full=text(createReportPdf([asha],from,to,settings,undefined,base));
 assert.ok(full.includes(STUDENT),'full report keeps the observation notes');assert.match(full,/answered every question/);assert.match(full,/Clear modelling/);
 assert.ok(text(createReportPdf(profiles,from,to,settings,undefined,base)).includes(STUDENT),'combined full report too');
});
