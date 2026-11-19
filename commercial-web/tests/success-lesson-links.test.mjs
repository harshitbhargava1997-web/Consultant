import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {lessonDocumentationUrl,parseLessonDocumentationLink,safeReturnPath} from '../lib/school-success/lesson-links.js';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords,lessonDocumentationGroups,filterLessons,lessonEvidenceFiles} from '../lib/school-success/lesson-records.js';
import {buildProfiles,defaultReportSettings} from '../lib/school-success/reports.js';
import {createReportPdf} from '../lib/school-success/report-pdf.js';
import {groupLessons,reportAccessSession} from '../lib/school-success/lesson-snapshots.js';
import {createLessonDocumentationPdf} from '../lib/school-success/lesson-report-pdf.js';
import {reportEvidenceGroups} from '../lib/report-sequence.js';
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

function accessOption(entries,mode,renderChild=false){
 const lessons=buildLessonRecords(entries,from,to),groups=lessonDocumentationGroups(lessons);
 const docs=groups.map(group=>{
  const session=reportAccessSession({mode,origin,mediaBase:base,newSecret:()=>'A'.repeat(43)});
  const subset=groupLessons(lessons,group);let child=[];
  if(renderChild)child=uris(createLessonDocumentationPdf({kind:'teacher',lessons:subset,from,to,linkFor:session.linkFor}));
  else for(const file of subset.flatMap(lessonEvidenceFiles))session.linkFor(file.url);
  return {...group,url:session.url(),fileLink:session.existingFileLink,child};
 });
 return {lessonDocs:p=>docs.filter(g=>g.teacherKey===p.key),lessonDocsAccess:mode};
}

test('the parent links to the same activity and writing files as each child, in both access modes',async()=>{
 const entries=await entriesP,settings=structuredClone(defaultReportSettings);
 // Same teacher, grade and subject in another section. Reused photo URL must use the section actually printed.
 const example=entries.find(r=>r.kind==='submission'&&r.recordId==='101'&&r.files.some(f=>f.url.includes('/writing/')));
 const other={...example,id:'801',recordId:'801',periodId:'',section:'B',topic:'Another section',date:to};
 const all=[...entries,other],profiles=buildProfiles(all,raw().roster,from,to,settings);
 for(const mode of ['link','signin']){
  const options=accessOption(all,mode,true);
  for(const list of [[profiles[0]],profiles,...['Alpha School','Beta School'].map(school=>profiles.filter(p=>p.school===school))]){
   const doc=createReportPdf(list,from,to,settings,undefined,options),links=uris(doc),text=pdfText(doc).replace(/\s+/g,' ');
   const expected=[];
   for(const profile of list){
    const groups=options.lessonDocs(profile);expected.push(...groups.map(g=>g.url));
    for(const group of reportEvidenceGroups(profile).filter(g=>!['Lesson preparation PDFs','Audio recordings','After-class reflections'].includes(g.label))){
     for(const file of group.files){
      const child=groups.find(g=>g.grade===file.grade&&g.section===file.section&&g.subject===file.subject);
      const target=child.fileLink(file.url);
      assert.ok(child.child.includes(target),'the published child links to this very file');
      assert.match(target,mode==='link'?/\/shared\/.+\/file\/\d+#[A-Za-z0-9_-]+$/:/\/secure\/.+\/file\/\d+$/);expected.push(target);
     }
    }
   }
   assert.deepEqual(links.sort(),expected.sort());
   assert.doesNotMatch(text,/Durations are shown in hours and minutes|Anyone with the link can open the report|The school can revoke the link|File counts indicate submission coverage only|Files are listed here without links/);
   assert.doesNotMatch(links.join(' '),/media\.example|X-Amz-/);
   if(list===profiles){assert.match(text,/Open activity 1/);assert.match(text,/Open writing sample 1/);}
  }
 }
 assert.throws(()=>createReportPdf(profiles,from,to,settings,undefined,{lessonDocs:()=>[],lessonDocsAccess:'link'}),/could not be linked/);
});

test('individual, combined and per-school parents include the selected observations in both access modes', async () => {
 const settings = structuredClone(defaultReportSettings);
 settings.sections.observations = true;
 const alpha = {kind:'observation', id:'alpha', school:'Alpha School', teacher:'Asha', date:'2026-10-22',
  grade:'Grade 2', subject:'English', topic:'Blending CVC words', strengths:'Modelled six words',
  improvements:'Give pairs more time', actions:'Revisit the word list',
  rubrics:{Questioning:{score:2,comment:'Invite a second answer'}}};
 const beta = {...alpha, id:'beta', school:'Beta School', date:'2026-10-23', strengths:'Beta observation only'};
 const entries = [...await entriesP, alpha, beta];
 const profiles = buildProfiles(entries, raw().roster, from, to, settings);
 const reports = [[profiles.find(p => p.school === alpha.school && p.name === alpha.teacher)], profiles,
  ...['Alpha School','Beta School'].map(school => profiles.filter(p => p.school === school))];
 for (const list of reports) {
  for (const mode of ['link', 'signin']) {
   const options = accessOption(entries, mode);
   const text = pdfText(createReportPdf(list, from, to, settings, undefined, options)).replace(/\s+/g, ' ');
   for (const phrase of [alpha.improvements, alpha.actions, alpha.rubrics.Questioning.comment]) assert.ok(text.includes(phrase), mode + ': ' + phrase);
   for (const observation of [alpha, beta]) {
    const included = list.some(p => p.school === observation.school && p.name === observation.teacher);
    assert.equal(text.includes(observation.strengths), included, mode + ': ' + observation.school);
    assert.equal(text.includes(observation.date + ' / English / Blending CVC words'), included);
   }
  }
 }
 settings.sections.observations = false;
 for (const mode of ['link', 'signin']) {
  const text = pdfText(createReportPdf(profiles, from, to, settings, undefined, accessOption(entries, mode)));
  assert.doesNotMatch(text, /Invite a second answer|Beta observation only|Modelled six words/);
 }
});
