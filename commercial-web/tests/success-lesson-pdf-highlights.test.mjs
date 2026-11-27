// Reviewer highlights in the lesson documentation PDF (owner decision, 27 November 2026): sentences any reviewer
// highlighted are drawn on a yellow band in the plan and written reflection; the review panel does not list them.
// "Reviewer highlights" can be switched off; the shareable copy never carries them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {mapLive} from '../lib/school-success/live-mapping.js';
import {buildLessonRecords} from '../lib/school-success/lesson-records.js';
import {createLessonDocumentationPdf} from '../lib/school-success/lesson-report-pdf.js';
import {raw,base,from,to} from './fixtures/lesson-records.mjs';

// Pixels of the highlight colour (#fff09a) on the rendered pages (the PDF content itself is compressed).
const yellowPixels=file=>{const ppm=execFileSync('pdftoppm',['-r','40',file],{maxBuffer:1<<28});let n=0,i=0;
 // pdftoppm writes one P6 image per page: header "P6\n<w> <h>\n255\n" then RGB bytes.
 while(i<ppm.length){const head=/^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(ppm.subarray(i,i+40).toString('latin1'));if(!head)break;i+=head[0].length;const end=i+Number(head[1])*Number(head[2])*3;
  for(;i<end;i+=3)if(ppm[i]>245&&Math.abs(ppm[i+1]-240)<8&&Math.abs(ppm[i+2]-154)<14)n++;}
 return n;};
const pdf=doc=>{const dir=mkdtempSync(join(tmpdir(),'hl-'));try{const f=join(dir,'r.pdf');writeFileSync(f,Buffer.from(doc.output('arraybuffer')));return {text:execFileSync('pdftotext',['-layout',f,'-'],{encoding:'utf8'}),raw:doc.output(),file:f,dir};}catch(e){rmSync(dir,{recursive:true,force:true});throw e;}};
async function lesson(){
 const lessons=buildLessonRecords((await mapLive(raw(),base)).entries,from,to),l=lessons.find(x=>x.recordId==='101');
 const sentence=l.plan.fields[0].text.split(/(?<=[.!?])\s+/)[0];
 const review={key:'k1',text:'Planning · A (Strong practice)\nClear outcome.',date:'2026-10-24T05:00:00.000Z',by:'Meera Rao, Principal',highlights:[{record:'101',field:l.plan.fields[0].key,text:sentence},{record:'999',field:l.plan.fields[0].key,text:'Other lesson.'}]};
 return {l:{...l,reviews:[...(l.reviews||[]),review]},sentence};
}

test('highlighted plan sentences are drawn on a yellow band, with a short note; the review lists none',async()=>{
 const {l,sentence}=await lesson();
 const out=pdf(createLessonDocumentationPdf({kind:'lesson',lessons:[l],from,to}));
 try{
  assert.match(out.text,/Highlighted lines were marked by a reviewer\./);
  assert.ok(out.text.replace(/\s+/g,' ').includes(sentence.replace(/\s+/g,' ').slice(0,30)),'the sentence itself is still printed');
  assert.ok(yellowPixels(out.file)>40,'a yellow band is drawn');
  assert.doesNotMatch(out.text,/yellow|Other lesson/i,'no "yellow" wording; another lesson\'s highlight is ignored');
  execFileSync('pdftoppm',['-r','110','-f','1','-l','1','-png',out.file,join(process.env.HL_SHOT_DIR||out.dir,'hl')]);
 }finally{rmSync(out.dir,{recursive:true,force:true});}
});

test('"Reviewer highlights" off, the shareable copy, and lessons without highlights show no band',async()=>{
 const {l}=await lesson();
 for(const [name,doc] of [['off',createLessonDocumentationPdf({kind:'lesson',lessons:[l],from,to,sections:{highlights:false}})],['shareable',createLessonDocumentationPdf({kind:'lesson',lessons:[l],from,to,audience:'shareable'})],['none',createLessonDocumentationPdf({kind:'lesson',lessons:[{...l,reviews:[]}],from,to})]]){
  const out=pdf(doc);try{assert.doesNotMatch(out.text,/Highlighted lines/,name);assert.equal(yellowPixels(out.file),0,name);}finally{rmSync(out.dir,{recursive:true,force:true});}
 }
});
