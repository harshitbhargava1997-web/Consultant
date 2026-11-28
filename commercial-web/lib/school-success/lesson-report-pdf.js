// Lesson documentation PDFs for School Success: one lesson, one teacher, or one school.
// Shares one visual system across all three. Devanagari text is drawn through an injected
// canvas rasteriser (jsPDF cannot shape Indic scripts); all other text stays selectable.
// Evidence URLs are the existing stored links; nothing here creates or widens access.
import {jsPDF} from 'jspdf';
import {regularFont,boldFont} from './report-fonts.js';
import {visibleLessonSections,lessonSummary,groupLessons,classSubjectBreakdown,formatDay,formatStamp,classLine,defaultLessonSections,sectionOn,MAX_LESSONS_PER_PDF,isImageUrl,lessonDay} from './lesson-records.js';
import {reviewLevels,weekLabel,weekClass} from './lesson-reviews.js';

export const palette={navy:'#16323c',teal:'#127369',tealSoft:'#8fd3c8',ink:'#2b3d45',muted:'#66777e',faint:'#93a3a8',hair:'#dbe5e4',tint:'#f2f7f6',tealTint:'#e4f2ef',blue:'#2f5f8f',blueTint:'#e8eff7',plum:'#5d4a86',plumTint:'#eeebf6',amber:'#8a5a12',amberTint:'#f8f1e3',highlight:'#fff09a'};
export const hasDevanagari=s=>/[ऀ-ॿ꣠-ꣿ]/.test(String(s||''));
const PT=0.3528,PAGE_W=210,PAGE_H=297,M=18,W=PAGE_W-2*M,TOP=24,BOTTOM=276;
const lineHeight=size=>size*PT*1.45;
const kindTag={Photo:'PHOTO',Video:'VIDEO',PDF:'PDF',Audio:'AUDIO',File:'FILE'};
const sectionStyle={activities:[palette.teal,palette.tealTint],writing:[palette.blue,palette.blueTint],audio:[palette.plum,palette.plumTint],remedial:[palette.plum,palette.plumTint],portfolio:[palette.amber,palette.amberTint],reflections:[palette.teal,palette.tealTint],additional:[palette.amber,palette.amberTint],plan:[palette.navy,palette.tint]};
const plural=(n,one,many=one+'s')=>n+' '+(n===1?one:many);
const reflectionQuestions={achievement:'Did students achieve the learning outcome, and what went well in your class?',nextStep:'Which students need support, what learning gaps do they have, and what will you do next to support them?'};
const periodText=(from,to)=>from===to?formatDay(from):formatDay(from)+' – '+formatDay(to);
// "Mon 23 Nov" (lessons by planned date).
const shortDay=day=>{const t=Date.parse(String(day||'')+'T00:00:00Z');return Number.isFinite(t)?new Date(t).toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}):'';};
const longDay=day=>{const t=Date.parse(String(day||'')+'T00:00:00Z');return Number.isFinite(t)?new Date(t).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short',timeZone:'UTC'}).toUpperCase():'';};

export function createLessonDocumentationPdf({kind='teacher',lessons,from,to,sections=defaultLessonSections,images=new Map(),raster=null,generatedAt=new Date(),thumbnailsPerSection=6,audience='full',linkFor=url=>url}){
 if(!Array.isArray(lessons)||!lessons.length)throw Error('No lessons match the selected filters.');
 if(lessons.length>MAX_LESSONS_PER_PDF)throw Error(`This selection has ${lessons.length} lessons. Narrow the teacher, class, subject or dates to ${MAX_LESSONS_PER_PDF} lessons or fewer per PDF.`);
 if(kind==='lesson'&&lessons.length!==1)throw Error('Choose one lesson for an individual lesson PDF.');
 // Shareable copy (opened without sign-in): no thumbnails, no links to stored evidence, no written
 // reflection or review text (they can identify students). Plan details and counts remain.
 const shareable=audience==='shareable';
 if(!['full','shareable'].includes(audience))throw Error('Unknown lesson documentation audience');
 if(shareable){images=new Map();thumbnailsPerSection=0;}
 const FULL_VERSION='They are in the full evidence version, available with school sign-in.';
 if(kind==='teacher'&&new Set(lessons.map(l=>l.teacherKey)).size!==1)throw Error('Choose one teacher for a teacher lesson PDF.');
 if(kind==='school'&&new Set(lessons.map(l=>l.school)).size!==1)throw Error('Choose one school for a school lesson PDF.');
 const scope=lessons[0].scope||'period';
 // Consolidated reports are period snapshots; complete history is offered per lesson only.
 if(lessons.some(l=>(l.scope||'period')!==scope))throw Error('Lessons must share one reporting scope.');
 if(kind!=='lesson'&&scope==='all')throw Error('Consolidated lesson reports cover the selected period only.');
 // Lessons by planned date (owner decision, 28 November 2026): teaching order, both dates on every lesson, a weekly
 // review printed once after the last lesson it covers.
 const planned=scope==='planned';
 const on=key=>sectionOn(sections,key);
 const doc=new jsPDF({unit:'mm',format:'a4',compress:true});
 doc.addFileToVFS('Report-Regular.ttf',regularFont);doc.addFont('Report-Regular.ttf','Report','normal');
 doc.addFileToVFS('Report-Bold.ttf',boldFont);doc.addFont('Report-Bold.ttf','Report','bold');
 const first=lessons[0];
 const title={lesson:'Lesson Documentation',teacher:'Teacher Lesson Documentation',school:'School Lesson Documentation'}[kind];
 const context={lesson:[first.teacher,first.school].join(' · '),teacher:[first.teacher,first.school,periodText(from,to)].join(' · '),school:[first.school,periodText(from,to)].join(' · ')}[kind];
 const state={y:TOP,dry:false,page:1,reuse:false};
 const imageAliases=new Map();

 // ---------- text primitives ----------
 const font=(size,bold=false,color=palette.ink)=>{doc.setFont('Report',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(color);doc.setCharSpace(0);};
 // Lines wrapped by the canvas are also drawn by it, so measurement and drawing always agree.
 const rasterLines=new Set();
 const wrap=(value,width,size,bold=false)=>{
  const text=String(value??'').replace(/\r\n?/g,'\n');
  if(raster&&hasDevanagari(text)){const lines=raster.wrap(text,width,size,bold);lines.forEach(l=>rasterLines.add(l));return lines;}
  font(size,bold);return text.split('\n').flatMap(p=>p.trim()?doc.splitTextToSize(p,width):['']);
 };
 const textWidth=(value,size,bold=false)=>{if(raster&&hasDevanagari(value))return raster.width(String(value),size,bold);font(size,bold);return doc.getTextWidth(String(value));};
 // Single-line text that must not overflow (running header): shorten with an ellipsis.
 const fit=(value,width,size,bold=false)=>{let text=String(value??'');if(textWidth(text,size,bold)<=width)return text;const chars=Array.from(text);while(chars.length>1&&textWidth(chars.join('').trimEnd()+'…',size,bold)>width)chars.pop();return chars.join('').trimEnd()+'…';};
 function drawLine(line,x,top,size,{bold=false,color=palette.ink,align='left',spacing=0}={}){
  if(state.dry||!line)return;
  const h=lineHeight(size);
  if(raster&&(hasDevanagari(line)||rasterLines.has(line))){
   const img=raster.line(line,size,bold,color);
   const left=align==='right'?x-img.width:align==='center'?x-img.width/2:x;
   doc.addImage(img.data,'PNG',left,top,img.width,h,undefined,'FAST');return;
  }
  font(size,bold,color);if(spacing)doc.setCharSpace(spacing);
  doc.text(line,x,top+h*0.71,{align});
  if(spacing)doc.setCharSpace(0);
 }
 // ---------- page flow ----------
 function header(){
  if(state.dry)return;
  font(7.5,false,palette.faint);
  const label=title+'  ·  ';drawLine(label,M,9.5,7.5,{color:palette.faint});
  const offset=textWidth(label,7.5);drawLine(fit(context,W-offset,7.5),M+offset,9.5,7.5,{color:palette.muted});
  doc.setDrawColor(palette.hair);doc.setLineWidth(0.2);doc.line(M,16,PAGE_W-M,16);
 }
 function newPage(withHeader=true){
  state.page++;
  // reuse: fill pages reserved earlier (the index) instead of appending new ones.
  if(state.reuse)doc.setPage(state.page);
  else if(!state.dry){doc.addPage();if(withHeader)header();}
  state.y=withHeader?TOP:M;
 }
 const ensure=h=>{if(state.y+h>BOTTOM)newPage();};
 function paragraph(value,{x=M,width=W,size=9.8,bold=false,color=palette.ink,after=1.8,marked=[]}={}){
  const h=lineHeight(size),lines=wrap(value,width,size,bold),spans=markSpans(value,lines,marked);
  lines.forEach((line,i)=>{ensure(h);markLine(line,spans[i],x,state.y,size,bold);drawLine(line,x,state.y,size,{bold,color});state.y+=line?h:h*0.55;});
  state.y+=after;
 }
 // Reviewer highlights (owner decision, 27 November 2026): sentences a reviewer marked are drawn on a yellow band.
 // spans: for each wrapped line, the [start,end) character ranges inside it that fall in a marked sentence.
 function markSpans(value,lines,marked){
  const text=String(value??'').replace(/\r\n?/g,'\n'),ranges=[];
  for(const m of marked||[]){const t=String(m||'').trim();if(!t)continue;let at=text.indexOf(t);while(at>=0){ranges.push([at,at+t.length]);at=text.indexOf(t,at+t.length);}}
  if(!ranges.length)return lines.map(()=>[]);
  let cursor=0;
  return lines.map(line=>{if(!line)return [];const at=text.indexOf(line,cursor);if(at<0)return [];cursor=at+line.length;
   return ranges.filter(([a,b])=>a<at+line.length&&b>at).map(([a,b])=>[Math.max(a,at)-at,Math.min(b,at+line.length)-at]);});
 }
 function markLine(line,spans,x,top,size,bold=false){
  if(state.dry||!spans?.length)return;
  const h=lineHeight(size);
  for(const [a,b] of spans){const left=x+(a?textWidth(line.slice(0,a),size,bold):0),w=textWidth(line.slice(a,b),size,bold);if(w>0)rect(left-0.4,top+0.15,w+0.8,h*0.92,palette.highlight,0.5);}
 }
 function rule(y=state.y,color=palette.hair,width=0.2){if(state.dry)return;doc.setDrawColor(color);doc.setLineWidth(width);doc.line(M,y,PAGE_W-M,y);}
 function rect(x,y,w,h,fill,r=1.6){if(state.dry)return;doc.setFillColor(fill);r?doc.roundedRect(x,y,w,h,r,r,'F'):doc.rect(x,y,w,h,'F');}
 // linkFor maps each evidence URL to the link printed in the PDF (consolidated reports route evidence
 // through the report's own access link; null drops the link). Internal page links are unaffected.
 function link(x,y,w,h,target){if(state.dry||!target||shareable&&typeof target!=='number')return;if(typeof target!=='number'){target=linkFor(target);if(!target)return;}if(typeof target==='number')doc.link(x,y,w,h,{pageNumber:target});else if(/^https?:\/\//i.test(target))doc.link(x,y,w,h,{url:target});}
 function kicker(text,x=M,color=palette.teal){drawLine(text.toUpperCase(),x,state.y,7.6,{bold:true,color,spacing:0.35});state.y+=lineHeight(7.6)+0.6;}

 // ---------- components ----------
 function metaGrid(items,{columns=2,labelColor=palette.muted}={}){
  const gap=8,colW=(W-gap*(columns-1))/columns;
  for(let i=0;i<items.length;i+=columns){
   const row=items.slice(i,i+columns),heights=row.map(([,v])=>lineHeight(7)+wrap(v,colW,10.2,true).length*lineHeight(10.2));
   const h=Math.max(...heights)+3.2;ensure(h);
   row.forEach(([label,value],j)=>{const x=M+j*(colW+gap);drawLine(label.toUpperCase(),x,state.y,7,{bold:true,color:labelColor,spacing:0.3});wrap(value,colW,10.2,true).forEach((line,k)=>drawLine(line,x,state.y+lineHeight(7)+k*lineHeight(10.2),10.2,{bold:true,color:palette.navy}));});
   state.y+=h;
  }
 }
 function tiles(items){
  const columns=4,gap=4,w=(W-gap*(columns-1))/columns,h=19;
  for(let i=0;i<items.length;i+=columns){
   ensure(h+gap);
   items.slice(i,i+columns).forEach(([label,value],j)=>{const x=M+j*(w+gap);rect(x,state.y,w,h,palette.tint,2);if(!state.dry){doc.setFillColor(palette.teal);doc.rect(x,state.y+3,0.9,h-6,'F');}drawLine(String(value),x+4.5,state.y+2.4,17,{bold:true,color:palette.navy});wrap(label,w-7,7.4).slice(0,2).forEach((line,k)=>drawLine(line,x+4.5,state.y+11+k*lineHeight(7.4),7.4,{color:palette.muted}));});
   state.y+=h+gap;
  }
 }
 function sectionHeading(label,count,style=sectionStyle.plan,minBody=18){
  ensure(14+minBody);
  state.y+=2.5;
  if(!state.dry){doc.setFillColor(style[0]);doc.rect(M,state.y+0.6,1.1,4.6,'F');}
  drawLine(label.toUpperCase(),M+3.6,state.y,8.6,{bold:true,color:style[0],spacing:0.45});
  if(count!==undefined&&!state.dry){font(8.6,true);doc.setCharSpace(0.45);const w=doc.getTextWidth(label.toUpperCase())+label.length*0.45;doc.setCharSpace(0);drawLine(String(count),M+3.6+w+3,state.y,8.6,{color:palette.faint});}
  state.y+=lineHeight(8.6)+1.2;rule(state.y);state.y+=3.2;
 }
 // A label/value row that flows across pages line by line.
 function fieldRow(label,value,marked=[]){
  const labelW=43,valueX=M+labelW+4,valueW=W-labelW-4,size=9.8,h=lineHeight(size);
  const lines=wrap(value,valueW,size),labelLines=wrap(label,labelW,8.2,true),spans=markSpans(value,lines,marked);
  ensure(Math.max(labelLines.length*lineHeight(8.2),Math.min(lines.length,3)*h)+2);
  let labelDrawn=false,labelEnd=0;
  lines.forEach((line,i)=>{
   if(state.y+h>BOTTOM){newPage();labelDrawn=false;}
   if(!labelDrawn){labelLines.forEach((l,k)=>drawLine(l,M,state.y+0.5+k*lineHeight(8.2),8.2,{bold:true,color:palette.muted}));labelDrawn=true;labelEnd=state.y+0.5+labelLines.length*lineHeight(8.2);}
   markLine(line,spans[i],valueX,state.y,size);drawLine(line,valueX,state.y,size);state.y+=line?h:h*0.55;
  });
  // A label longer than its answer (e.g. "Student activity and participation (We do)") keeps its own space.
  if(state.y<labelEnd)state.y=labelEnd;
  state.y+=2.2;rule(state.y-1.1,palette.hair,0.15);state.y+=1.4;
 }
 function linkRow(file,{action='Open',style=sectionStyle.plan}={}){
  const h=10.5;ensure(h);
  const tag=kindTag[file.kind]||'FILE';
  if(!state.dry){
   const tw=13;
   rect(M,state.y+2.4,tw,4.6,style[1],1.2);drawLine(tag,M+tw/2,state.y+2.15,6.4,{bold:true,color:style[0],align:'center'});
   const x=M+tw+3.5;drawLine(file.label,x,state.y+0.7,9.4,{bold:true,color:palette.ink});
   const meta=[file.addedOn?'Added '+formatDay(file.addedOn):'',file.stage].filter(Boolean).join('  ·  ');
   if(meta)drawLine(meta,x,state.y+5.2,7.4,{color:palette.muted});
   drawLine(action+' ↗',PAGE_W-M,state.y+2.6,8.6,{bold:true,color:palette.teal,align:'right'});
   link(M,state.y+0.5,W,h-1,file.url);
  }
  state.y+=h;rule(state.y-0.4,palette.hair,0.12);
 }
 function thumbnails(files,style){
  const columns=3,gap=6,w=(W-gap*(columns-1))/columns,boxH=40,capH=11,cellH=boxH+capH+4;
  for(let i=0;i<files.length;i+=columns){
   ensure(cellH);
   files.slice(i,i+columns).forEach((file,j)=>{
    const x=M+j*(w+gap),img=images.get(file.url);
    rect(x,state.y,w,boxH,palette.tint,1.8);
    if(!state.dry&&img){
     const ratio=Math.min((w-3)/img.width,(boxH-3)/img.height),iw=img.width*ratio,ih=img.height*ratio;
     let alias=imageAliases.get(file.url);if(!alias){alias='ev'+imageAliases.size;imageAliases.set(file.url,alias);}
     doc.addImage(img.data,img.format||'JPEG',x+(w-iw)/2,state.y+(boxH-ih)/2,iw,ih,alias,'FAST');
    }
    if(!state.dry){doc.setFillColor(style[0]);doc.rect(x,state.y+boxH,w,0.7,'F');}
    drawLine(file.label,x,state.y+boxH+1.8,8.2,{bold:true,color:palette.ink});
    drawLine((file.addedOn?formatDay(file.addedOn)+'  ·  ':'')+'Open original ↗',x,state.y+boxH+6,7.2,{color:palette.teal});
    link(x,state.y,w,boxH+capH,file.url);
   });
   state.y+=cellH;
  }
 }
 function evidenceSection(label,files,style,{action='Open',note=''}={}){
  if(shareable){sectionHeading(label,files.length,style,18);paragraph(`${plural(files.length,'file')} recorded. Photos, videos, recordings and files are left out of this shareable copy. ${FULL_VERSION}`,{size:8.6,color:palette.muted,after:2});state.y+=2;return;}
  const firstPictured=isImageUrl(files[0].url)&&images.has(files[0].url);
  sectionHeading(label,files.length,style,(note?wrap(note,W,8.4).length*lineHeight(8.4)+1.5:0)+(firstPictured?56:11));
  if(note)paragraph(note,{size:8.4,color:palette.muted,after:1.5});
  const pictured=files.filter(f=>isImageUrl(f.url)&&images.has(f.url)).slice(0,thumbnailsPerSection),shown=new Set(pictured.map(f=>f.url));
  if(pictured.length)thumbnails(pictured,style);
  for(const file of files)if(!shown.has(file.url))linkRow(file,{action:file.kind==='Audio'?'Listen':action,style});
  state.y+=2;
 }
 function reviewPanel(feedback,{heading=true,label=''}={}){
  if(shareable){sectionHeading('Academic Review',undefined,sectionStyle.reflections,18);paragraph(`${feedback.date?'Review recorded on '+formatDay(feedback.date):'Review recorded'}. Review comments are left out of this shareable copy. ${FULL_VERSION}`,{size:8.6,color:palette.muted,after:2});state.y+=2;return;}
  const size=9.8,h=lineHeight(size),lines=wrap(feedback.text,W-12,size),total=lines.length*h+15;
  if(heading)sectionHeading('Academic Review',undefined,sectionStyle.reflections,Math.min(total,40));else ensure(Math.min(total,40));
  const draw=(segment,isFirst)=>{
   const height=segment.length*h+(isFirst?13:6);rect(M,state.y,W,height,palette.tint,2);
   if(!state.dry){doc.setFillColor(palette.teal);doc.rect(M,state.y,1.2,height,'F');}
   let y=state.y+3.5;
   if(isFirst){drawLine(label||(feedback.date?'Reviewed '+formatStamp(feedback.date).split(',')[0]:'Review recorded'),M+6,y,7.8,{bold:true,color:palette.teal,spacing:0.2});y+=lineHeight(7.8)+1.6;}
   segment.forEach((line,k)=>drawLine(line,M+6,y+k*h,size));
   state.y+=height+3;
  };
  let rest=lines,isFirst=true;
  while(rest.length){
   const room=Math.max(1,Math.floor((BOTTOM-state.y-(isFirst?13:6))/h));
   if(room<2&&rest.length>1){newPage();continue;}
   draw(rest.slice(0,room),isFirst);rest=rest.slice(room);isFirst=false;if(rest.length)newPage();
  }
 }
 // Written after-class reflections (text) inline; earlier PDF-only reflections and recordings as links.
 function reflectionSection(lesson,marks=markedFor(lesson)){
  const written=lesson.writtenReflections||[],files=lesson.reflections;
  if(shareable){const days=[...new Set([...written,...files].map(r=>r.date||r.addedOn).filter(Boolean))].sort().map(formatDay);sectionHeading('After-class reflections',written.length+files.length,sectionStyle.reflections,18);paragraph(`${plural(written.length+files.length,'reflection')} recorded${days.length?' ('+days.join(', ')+')':''}. Reflection text and recordings are left out of this shareable copy because they can identify students. ${FULL_VERSION}`,{size:8.6,color:palette.muted,after:2});state.y+=2;return;}
  sectionHeading('After-class reflections',written.length+files.length,sectionStyle.reflections,written.length?30:11);
  for(const r of written){
   ensure(24);
   const title=[r.label,r.date?formatDay(r.date):'',r.conductedOn?'taught '+formatDay(r.conductedOn):''].filter(Boolean).join('  ·  ');
   if(!state.dry){doc.setFillColor(palette.teal);doc.rect(M,state.y+0.8,0.9,3.6,'F');}
   drawLine(title,M+3,state.y,8.4,{bold:true,color:palette.teal});state.y+=lineHeight(8.4)+1.2;
   for(const key of ['achievement','nextStep']){
    const text=r.answers?.[key];if(!text)continue;
    const question=(r.prompts||[]).find(p=>p.key===key)?.label||reflectionQuestions[key];
    ensure(lineHeight(8.2)*2+lineHeight(9.8)*2);
    for(const line of wrap(question,W-3,8.2,true)){drawLine(line,M+3,state.y,8.2,{bold:true,color:palette.muted});state.y+=lineHeight(8.2);}
    state.y+=0.6;paragraph(text,{x:M+3,width:W-3,size:9.8,after:2,marked:marks('reflection.'+key)});
   }
   rule(state.y,palette.hair,0.15);state.y+=3;
  }
  if(files.some(f=>f.legacy))paragraph('Earlier reflections were saved as PDFs; their written text is preserved in the original file.',{size:8.2,color:palette.muted,after:1.5});
  for(const file of files)linkRow(file,{action:file.kind==='Audio'?'Listen':'Open',style:sectionStyle.reflections});
  state.y+=2;
 }
 function lessonHeader(lesson,index,total,teacherShown=false){
  const standalone=kind==='lesson';
  if(!standalone)kicker(`Lesson ${index+1} of ${total}`+(planned&&lessonDay(lesson)?'  ·  '+shortDay(lessonDay(lesson))+(lesson.dayNumber?'  ·  Period '+lesson.dayNumber:''):''));
  const titleLines=wrap(lesson.topic,W,standalone?20:16.5,true);
  for(const line of titleLines){drawLine(line,M,state.y,standalone?20:16.5,{bold:true,color:palette.navy});state.y+=lineHeight(standalone?20:16.5);}
  state.y+=1;
  if(kind==='school'&&!teacherShown)paragraph('Teacher: '+lesson.teacher,{size:10.2,color:palette.muted,after:2.5});else state.y+=1.5;
  const cls=[lesson.grade,lesson.section&&lesson.section!=='Not Applicable'?'Section '+lesson.section:''].filter(Boolean).join(' · ')||'—';
  // Lessons by planned date: the day it was planned for, and when the plan was submitted, on every lesson.
  const items=planned?[['Class',cls+'\n'+(lesson.subject||'—')],['Planned for',lessonDay(lesson)?formatDay(lessonDay(lesson)):'—'],['Plan submitted',formatStamp(lesson.submittedAt).replace(', ','\n')||'—'],['Taught',lesson.conductedOn?formatDay(lesson.conductedOn):'—']]:[['Class',cls],['Subject',lesson.subject||'—'],['Lesson date',[lesson.plannedDate?'Planned '+formatDay(lesson.plannedDate):'',lesson.conductedOn?'Taught '+formatDay(lesson.conductedOn):''].filter(Boolean).join('\n')||formatDay(lesson.firstDate)||'—'],['Submitted',formatStamp(lesson.submittedAt).replace(', ','\n')||'—']];
  const inner=W-8,share=[0.23,0.21,0.26,0.30],xs=share.map((_,i)=>M+4+share.slice(0,i).reduce((a,b)=>a+b,0)*inner);
  const lines=items.map(([,v],i)=>wrap(v,share[i]*inner-4,8.8,true)),h=Math.max(...lines.map(l=>l.length))*lineHeight(8.8)+lineHeight(6.8)+7;
  rect(M,state.y,W,h,palette.tint,2);
  items.forEach(([label],i)=>{const x=xs[i];drawLine(label.toUpperCase(),x,state.y+3,6.8,{bold:true,color:palette.muted,spacing:0.3});lines[i].forEach((line,k)=>drawLine(line,x,state.y+3+lineHeight(6.8)+0.6+k*lineHeight(8.8),8.8,{bold:true,color:palette.navy}));if(i&&!state.dry){doc.setDrawColor(palette.hair);doc.setLineWidth(0.2);doc.line(x-3,state.y+3,x-3,state.y+h-3);}});
  state.y+=h+3;
  if(scope==='period'&&(lesson.outsidePeriodFiles||lesson.reviewOutsidePeriod)){
   const parts=[lesson.outsidePeriodFiles?plural(lesson.outsidePeriodFiles,'file'):'',lesson.reviewOutsidePeriod?(lesson.feedback?'additional review feedback':'the Academic Review'):''].filter(Boolean).join(' and ');
   paragraph(`Outside this reporting period: ${parts} for this lesson ${lesson.outsidePeriodFiles+(lesson.reviewOutsidePeriod?1:0)===1?'was':'were'} recorded outside ${periodText(from,to)} and ${lesson.outsidePeriodFiles+(lesson.reviewOutsidePeriod?1:0)===1?'is':'are'} not shown. The complete lesson history PDF includes ${lesson.outsidePeriodFiles+(lesson.reviewOutsidePeriod?1:0)===1?'it':'them'}.`,{size:8.2,color:palette.amber,after:2});
  }
 }
 // The sentences reviewers highlighted on this lesson (latest version of every review, any reviewer), by field.
 // Left out of the shareable copy, which carries no review content, and when "Reviewer highlights" is off.
 function markedFor(lesson){
  const list=shareable||!sectionOn(sections,'highlights')?[]:(lesson.reviews||[]).flatMap(r=>r.highlights||[]).filter(h=>String(h.record)===String(lesson.recordId));
  const of=field=>list.filter(h=>h.field===field).map(h=>h.text);of.any=list.length>0;return of;
 }
 // ---------- reviews by type (lessons by planned date) ----------
 // A weekly review covers several lessons: it is printed once, after the last of them in this PDF; the others carry
 // one line pointing to it. Period reviews stay with their own lesson.
 const weeklyLast=new Map(),weeklyPages=new Map(),weeklyRefs=[],weeklyCovered=new Map();
 const reviewsOf=l=>l.reviews||[];
 const reviewKind=l=>{const r=reviewsOf(l),w=r.some(x=>x.weekly),p=r.some(x=>!x.weekly)||(!r.length&&Boolean(l.feedback));return w&&p?'Weekly + Period':w?'Weekly':p?'Period':'—';};
 const reviewColor={'Weekly':palette.teal,'Period':palette.blue,'Weekly + Period':palette.navy,'—':palette.faint};
 const weeklyTitle=r=>weekClass(r.weekly)+'  ·  '+weekLabel(r.weekly.weekStart,r.weekly.weekEnd);
 const whoLine=r=>[r.by,r.editedBy&&r.editedBy!==r.by?'updated by '+r.editedBy:r.editedBy?'updated':''].filter(Boolean).join(' · ');
 function refLine(text,key){
  const size=9.2,h=lineHeight(size)+4;ensure(h+3);
  const top=state.y;rect(M,top,W,h,palette.tint,1.5);
  if(!state.dry){doc.setFillColor(palette.teal);doc.rect(M,top,1.2,h,'F');}
  const shown=fit(text,key?W-24:W-8,size);drawLine(shown,M+5,top+2,size,{color:palette.ink});
  // "page N" is filled in once the weekly review's page is known.
  if(!state.dry&&key)weeklyRefs.push({page:state.page,x:M+5+textWidth(shown,size)+1.2,y:top+2,top,h,key,size});
  state.y+=h+3;
 }
 function weeklyBox(r){
  const rv=r.review||{},rows=[['planning','Planning'],['execution','Execution']].filter(([k])=>rv[k]).map(([k,l])=>[l+' · '+rv[k].level+' ('+reviewLevels[rv[k].level]+')',rv[k].note]);
  if(rv.focus)rows.push(['Focus for next week',rv.focus]);
  const covered=weeklyCovered.get(r.key)||[],count=r.weekly.periods||covered.length;
  ensure(42);weeklyPages.set(r.key,state.page);
  state.y+=2;rule(state.y,palette.teal,0.5);state.y+=3.5;
  kicker('Weekly review',M,palette.teal);
  for(const line of wrap(weeklyTitle(r),W,12.5,true)){drawLine(line,M,state.y,12.5,{bold:true,color:palette.navy});state.y+=lineHeight(12.5);}
  state.y+=0.8;
  paragraph('Covers '+plural(count,'lesson')+(covered.length?': '+covered.map(l=>l.topic+' ('+shortDay(lessonDay(l)).split(' ')[0]+')').join('  ·  '):''),{size:8,color:palette.muted,after:0.6});
  if(whoLine(r))paragraph('Given by '+whoLine(r)+(r.date?'  ·  '+formatDay(istDayOf(r.date)):''),{size:8,color:palette.muted,after:2});
  if(rows.length)for(const [label,text] of rows)fieldRow(label,text);else paragraph(r.text,{size:9.6});
  rule(state.y,palette.teal,0.5);state.y+=4;
 }
 const istDayOf=iso=>{const t=Date.parse(iso);return Number.isFinite(t)?new Date(t+330*60000).toISOString().slice(0,10):String(iso||'').slice(0,10);};
 function reviewsSection(lesson){
  const list=reviewsOf(lesson),period=list.filter(r=>!r.weekly),weekly=list.filter(r=>r.weekly&&r.key);
  if(!list.length){reviewPanel(lesson.feedback);return;}
  sectionHeading('Academic Review',undefined,sectionStyle.reflections,18);
  for(const r of period)reviewPanel({date:r.date,text:r.text+(whoLine(r)?'\n— '+whoLine(r):'')},{heading:false,label:'Period review'+(r.date?'  ·  '+formatDay(istDayOf(r.date)):'')});
  const here=[];
  for(const r of weekly){
   if(weeklyLast.get(r.key)===lesson.key){refLine('Reviewed in the weekly review  ·  '+weeklyTitle(r)+'  —  printed below',null);here.push(r);}
   else refLine('Reviewed in the weekly review  ·  '+weeklyTitle(r)+'  —  see page',r.key);
  }
  for(const r of here)weeklyBox(r);
 }
 function lessonBody(lesson){
  const visible=visibleLessonSections(lesson,sections);
  if(visible.plan){
   sectionHeading('Lesson plan',undefined,sectionStyle.plan,20);
   if(lesson.planFiles.length){if(shareable)paragraph(`${plural(lesson.planFiles.length,'uploaded plan file')} left out of this shareable copy. ${FULL_VERSION}`,{size:8.6,color:palette.muted,after:2});else for(const file of lesson.planFiles)linkRow(file,{style:sectionStyle.plan});state.y+=3;}
   const marks=markedFor(lesson);
   if(marks.any&&(lesson.plan.fields.length||lesson.plan.notes))paragraph('Highlighted lines were marked by a reviewer.',{size:8,color:palette.muted,after:1.5});
   for(const field of lesson.plan.fields)fieldRow(field.label,field.text,marks(field.key));
   if(lesson.plan.notes)fieldRow('Lesson notes',lesson.plan.notes,marks('notes'));
  }
  if(visible.activities)evidenceSection('Classroom activities',lesson.activities,sectionStyle.activities);
  if(visible.writing)evidenceSection('Student written work',lesson.writing,sectionStyle.writing);
  if(visible.remedial)evidenceSection('Remedial support',lesson.remedial,sectionStyle.remedial);
  if(visible.reflections)reflectionSection(lesson);
  if(visible.portfolio)evidenceSection('Student portfolio / assessment',lesson.portfolio,sectionStyle.portfolio);
  if(visible.feedback){if(planned&&!shareable)reviewsSection(lesson);else reviewPanel(lesson.feedback);}
  if(!Object.values(visible).some(Boolean))paragraph('No lesson plan details or selected evidence were recorded for this lesson.',{size:9,color:palette.muted});
 }
 // ---------- index ----------
 const counts=l=>[on('activities')&&['Activity',l.activities.length],on('writing')&&['Writing',l.writing.length],on('reflections')&&['Reflection',l.reflections.length+(l.writtenReflections||[]).length],on('feedback')&&['Review',l.feedback?'✓':'—']].filter(Boolean);
 function indexTable(groups,pages){
  const cols=[{label:'#',w:7},{label:'Submitted',w:22},{label:'Lesson',w:0},...counts(lessons[0]).map(([label])=>({label,w:label==='Activity'?15:13,align:'center'})),{label:'Page',w:10,align:'right'}];
  cols[2].w=W-cols.reduce((sum,c)=>sum+c.w,0)-(cols.length-1)*1.5;
  const head=()=>{let x=M;ensure(9);cols.forEach(c=>{drawLine(c.label.toUpperCase(),c.align==='right'?x+c.w:c.align==='center'?x+c.w/2:x,state.y,6.4,{bold:true,color:palette.muted,align:c.align});x+=c.w+1.5;});state.y+=lineHeight(6.4)+1.4;rule(state.y,palette.navy,0.3);state.y+=1.6;};
  head();let n=0,headPage=state.page;
  for(const group of groups){
   if(group.label){ensure(18);if(state.page!==headPage){head();headPage=state.page;}state.y+=1.5;for(const line of wrap(group.label,W,8.6,true)){drawLine(line,M,state.y,8.6,{bold:true,color:palette.teal});state.y+=lineHeight(8.6);}state.y+=1;}
   for(const lesson of group.lessons){
    n++;
    const topic=wrap(lesson.topic,cols[2].w,8.6,true),detail=kind==='school'?[]:wrap(classLine(lesson),cols[2].w,7.4);
    const simple=[String(indexNo.get(lesson.key)||n),lesson.submittedAt?formatStamp(lesson.submittedAt).split(',')[0]:formatDay(lesson.firstDate)];
    const tail=[...counts(lesson).map(([,v])=>String(v)),pages?String(pages.get(lesson.key)||''):''];
    const h=Math.max(topic.length*lineHeight(8.6)+detail.length*lineHeight(7.4),lineHeight(8.4))+3.2;
    if(state.y+h>BOTTOM){newPage();head();headPage=state.page;}
    let x=M;const top=state.y+1.4;
    simple.forEach((value,i)=>{drawLine(value,x,top,8.4,{color:palette.ink});x+=cols[i].w+1.5;});
    topic.forEach((line,k)=>drawLine(line,x,top+k*lineHeight(8.6),8.6,{bold:true,color:palette.navy}));
    detail.forEach((line,k)=>drawLine(line,x,top+topic.length*lineHeight(8.6)+k*lineHeight(7.4),7.4,{color:palette.muted}));
    x+=cols[2].w+1.5;
    tail.forEach((value,i)=>{const c=cols[3+i];drawLine(value,c.align==='right'?x+c.w:x+c.w/2,top,8.4,{color:c.label==='Page'?palette.teal:palette.ink,bold:c.label==='Page',align:c.align});x+=c.w+1.5;});
    if(pages)link(M,state.y,W,h,pages.get(lesson.key));
    state.y+=h;rule(state.y,palette.hair,0.12);
   }
  }
 }
 // Lessons by planned date: Period · Lesson · Plan submitted · Review type · Page, with each weekly review as its own
 // row after the last lesson it covers.
 function plannedIndex(groups,pages){
  const rev=on('feedback')&&!shareable;
  const cols=[{label:kind==='school'?'Day · period':'Period',w:kind==='school'?24:13},{label:'Lesson',w:0},{label:'Plan submitted',w:31},...(rev?[{label:'Review',w:25}]:[]),{label:'Page',w:10,align:'right'}];
  cols[1].w=W-cols.reduce((sum,c)=>sum+c.w,0)-(cols.length-1)*1.5;
  const head=()=>{let x=M;ensure(9);cols.forEach(c=>{drawLine(c.label.toUpperCase(),c.align==='right'?x+c.w:x,state.y,6.4,{bold:true,color:palette.muted,align:c.align});x+=c.w+1.5;});state.y+=lineHeight(6.4)+1.4;rule(state.y,palette.navy,0.3);state.y+=1.6;};
  head();let headPage=state.page;
  const pageCol=cols.length-1;
  for(const group of groups){
   if(group.label){ensure(16);if(state.page!==headPage){head();headPage=state.page;}rect(M,state.y,W,lineHeight(8)+2.4,'#fafcfb',0);drawLine(group.label,M+1.5,state.y+1.2,8,{bold:true,color:palette.navy,spacing:0.2});state.y+=lineHeight(8)+3;}
   for(const lesson of group.lessons){
    const topic=wrap(lesson.topic,cols[1].w,8.6,true),detail=wrap(classLine(lesson)+(kind==='school'?'':''),cols[1].w,7.4);
    const when=formatStamp(lesson.submittedAt).replace(/ \d{4},/,',').replace(/ IST$/,'');
    const h=Math.max(topic.length*lineHeight(8.6)+detail.length*lineHeight(7.4),lineHeight(8.4)*(when?1:1))+3.2;
    if(state.y+h>BOTTOM){newPage();head();headPage=state.page;}
    const top=state.y+1.4;let x=M;
    drawLine((kind==='school'?shortDay(lessonDay(lesson))+'  ':'')+(lesson.dayNumber?'P'+lesson.dayNumber:'—'),x,top,8.4,{bold:true,color:palette.ink});x+=cols[0].w+1.5;
    topic.forEach((line,k)=>drawLine(line,x,top+k*lineHeight(8.6),8.6,{bold:true,color:palette.navy}));
    detail.forEach((line,k)=>drawLine(line,x,top+topic.length*lineHeight(8.6)+k*lineHeight(7.4),7.4,{color:palette.muted}));
    x+=cols[1].w+1.5;
    drawLine(when||'—',x,top,8,{color:palette.ink});x+=cols[2].w+1.5;
    if(rev){const k=reviewKind(lesson);drawLine(k==='—'?'— not reviewed':k,x,top,8,{bold:true,color:reviewColor[k]});x+=cols[3].w+1.5;}
    drawLine(pages?String(pages.get(lesson.key)||''):'',x+cols[pageCol].w,top,8.4,{bold:true,color:palette.teal,align:'right'});
    if(pages)link(M,state.y,W,h,pages.get(lesson.key));
    state.y+=h;rule(state.y,palette.hair,0.12);
    if(!rev)continue;
    for(const r of reviewsOf(lesson))if(r.weekly&&r.key&&weeklyLast.get(r.key)===lesson.key){
     const covered=weeklyCovered.get(r.key)||[],count=r.weekly.periods||covered.length;
     const main=wrap('Weekly review  ·  '+weeklyTitle(r)+'  ·  covers '+plural(count,'lesson'),W-cols[pageCol].w-8,8.4,true),by=whoLine(r)?wrap(whoLine(r),W-cols[pageCol].w-8,7.4):[];
     const rh=main.length*lineHeight(8.4)+by.length*lineHeight(7.4)+3.4;
     if(state.y+rh>BOTTOM){newPage();head();headPage=state.page;}
     rect(M,state.y,W,rh,palette.tint,0);if(!state.dry){doc.setFillColor(palette.teal);doc.rect(M,state.y,1.1,rh,'F');}
     main.forEach((line,k)=>drawLine(line,M+3,state.y+1.5+k*lineHeight(8.4),8.4,{bold:true,color:palette.teal}));
     by.forEach((line,k)=>drawLine(line,M+3,state.y+1.5+main.length*lineHeight(8.4)+k*lineHeight(7.4),7.4,{color:palette.muted}));
     const wp=weeklyPages.get(r.key);
     drawLine(pages&&wp?String(wp):'',M+W,state.y+1.5,8.4,{bold:true,color:palette.teal,align:'right'});
     if(pages&&wp)link(M,state.y,W,rh,wp);
     state.y+=rh;rule(state.y,palette.hair,0.12);
    }
   }
  }
 }
 const indexNo=new Map();
 function overviewTable(head,rows,widths,textColumns=1){
  const cols=head.map((label,i)=>({label,w:widths[i],align:i<textColumns?'left':'center'}));
  const draw=()=>{let x=M;ensure(9);cols.forEach(c=>{drawLine(c.label.toUpperCase(),c.align==='center'?x+c.w/2:x,state.y,6.4,{bold:true,color:palette.muted,align:c.align});x+=c.w+1.5;});state.y+=lineHeight(6.4)+1.4;rule(state.y,palette.navy,0.3);state.y+=1.6;};
  draw();let page=state.page;
  for(const row of rows){const wrapped=row.map((c,i)=>wrap(String(c),cols[i].w,8.6,i===0)),h=Math.max(...wrapped.map(w=>w.length))*lineHeight(8.6)+2.8;if(state.y+h>BOTTOM){newPage();}if(state.page!==page){draw();page=state.page;}let x=M;wrapped.forEach((lines,i)=>{const c=cols[i];lines.forEach((line,k)=>drawLine(line,c.align==='center'?x+c.w/2:x,state.y+1.3+k*lineHeight(8.6),8.6,{bold:i===0,color:i===0?palette.navy:palette.ink,align:c.align}));x+=c.w+1.5;});state.y+=h;rule(state.y,palette.hair,0.12);}
  state.y+=5;
 }

 // ---------- cover ----------
 const summary=lessonSummary(lessons);
 function cover(){
  const subtitle=kind==='lesson'?[first.teacher,first.school].join('  ·  '):kind==='teacher'?first.teacher:first.school;
  const subSize=kind==='lesson'?10.5:15,subLines=wrap(subtitle,W,subSize).slice(0,4);
  const scopeLine=planned&&kind!=='lesson'?'Lessons planned for  '+periodText(from,to):kind==='lesson'?(scope==='all'?'Complete lesson history  ·  as of '+formatStamp(generatedAt.toISOString()).split(',')[0]:'Reporting period  ·  '+periodText(from,to)):periodText(from,to);
  const top=kind==='lesson'?13:22,titleSize=kind==='lesson'?19:25;
  const bandH=Math.max(kind==='lesson'?44:70,top+8+lineHeight(titleSize)+(kind==='lesson'?1:2)+subLines.length*lineHeight(subSize)+1.5+lineHeight(10.5)+(kind==='lesson'?7:12));
  rect(0,0,PAGE_W,bandH,palette.navy,0);
  if(!state.dry){doc.setFillColor(palette.teal);doc.rect(0,bandH,PAGE_W,1.2,'F');}
  state.y=top;
  drawLine('SCHOOL SUCCESS  ·  LESSON DOCUMENTATION',M,state.y,7.8,{bold:true,color:palette.tealSoft,spacing:0.5});state.y+=8;
  drawLine(title,M,state.y,titleSize,{bold:true,color:'#ffffff'});state.y+=lineHeight(titleSize)+(kind==='lesson'?1:2);
  for(const line of subLines){drawLine(line,M,state.y,subSize,{color:kind==='lesson'?'#d5e6e3':'#ffffff'});state.y+=lineHeight(subSize);}
  state.y+=1.5;drawLine(scopeLine,M,state.y,kind==='lesson'?8.6:10.5,{color:'#c4dcd8',bold:kind==='lesson'});
  if(kind==='lesson'){state.y=bandH+9;return;}
  state.y=bandH+12;
  const classes=[...new Set(lessons.map(l=>l.grade).filter(Boolean))],subjects=[...new Set(lessons.map(l=>l.subject).filter(Boolean))];
  metaGrid([['School',first.school],[kind==='teacher'?'Teacher':'Teachers',kind==='teacher'?first.teacher:plural(summary.teachers,'teacher')],[planned?'Lessons planned for':'Reporting period',periodText(from,to)],['Generated',formatStamp(generatedAt.toISOString())],['Classes',classes.join(', ')||'—'],['Subjects',subjects.join(', ')||'—']]);
  state.y+=4;kicker('Summary');state.y+=1;
  tiles([['Lessons documented',summary.lessons],[planned?'Lessons with a saved plan':'Lesson plans submitted in period',summary.plansSubmitted],...(kind==='school'?[['Teachers with lessons',summary.teachers]]:[]),
   ...[['activities','Classroom activities'],['writing','Student written work'],['remedial','Remedial support'],['reflections','After-class reflections'],['portfolio','Student portfolio / assessment']].filter(([k])=>on(k)).map(([k,l])=>[l,summary[k]]),
   ...(on('feedback')?[['Lessons with Academic Review',summary.reviewed]]:[])]);
  state.y+=3;kicker('About this report');
  const included=['Lesson plan',...[['activities','classroom activities'],['writing','student written work'],['remedial','remedial support'],['reflections','after-class reflections'],['portfolio','student portfolio / assessment'],['feedback','Academic Review']].filter(([k])=>on(k)).map(([,l])=>l)];
  for(const note of [
   ...(planned?[`Lessons planned for ${periodText(from,to)}, in teaching order: planned day, then period. Each lesson shows the day it was planned for and when its plan was submitted, with all its evidence, reflections and reviews, including those added after these dates.`,
    'A weekly review covers all lessons of one class and subject in a week: it is printed once, after the last of those lessons, and each of the others points to it. Period reviews stay with their own lesson.']
   :[`Reporting period ${periodText(from,to)}: evidence files, recordings, reflections and Academic Review appear only when they were submitted or recorded in this period, matching School 360° and Teacher 360° counts. Lesson plan details are shown in full for every lesson with activity in the period.`,
   'Lessons appear in the order they were first submitted. Evidence added later stays with its original lesson and does not change that order. Lessons with items outside the period say so; the complete history is available as an individual lesson PDF.']),
   shareable?'SHAREABLE COPY — this PDF can be opened without signing in. It omits photos, videos, recordings, student work, attachment links, reflection text and review comments; it shows lesson plans and counts. The full evidence version is available with school sign-in.':'Each file is listed once under the lesson it was uploaded for. Links open the original stored evidence and need an internet connection.',
   'Counts describe what was submitted. They are not ratings of teaching quality.',
   'Included sections: '+included.join(', ')+'.'
  ])paragraph('•  '+note,{size:8.8,color:palette.ink,after:1.2});
 }

 // ---------- assemble ----------
 cover();
 if(kind==='lesson'){
  lessonHeader(first,0,1);lessonBody(first);
 }else{
  if(kind==='school'){
   newPage();
   kicker('Teacher overview');state.y+=1;
   const groups=groupLessons(lessons)[0].teachers;
   const optional=[['activities','Activity','activities'],['writing','Writing','writing'],['remedial','Remedial','remedial'],['reflections','Reflection','reflections'],['portfolio','Portfolio','portfolio']].filter(([k])=>on(k));
   overviewTable(['Teacher','Lessons','Plans',...optional.map(([,l])=>l),...(on('feedback')?['Reviewed']:[])],groups.map(t=>{const s=lessonSummary(t.lessons);return [t.teacher,s.lessons,s.plansSubmitted,...optional.map(([,,k])=>s[k]),...(on('feedback')?[s.reviewed]:[])];}),(()=>{const n=2+optional.length+(on('feedback')?1:0),w=15.5;return [W-n*w-n*1.5,...Array(n).fill(w)];})());
   kicker('Class and subject breakdown');state.y+=1;
   const cs=[['activities','Activity'],['writing','Writing'],['reflections','Reflection']].filter(([k])=>on(k));
   overviewTable(['Class','Subject','Lessons','Teachers',...cs.map(([,l])=>l)],classSubjectBreakdown(lessons).map(r=>[r.grade||'—',r.subject||'—',r.lessons,r.teachers,...cs.map(([k])=>r[k])]),(()=>{const n=2+cs.length,w=17;const rest=W-n*w-(n+1)*1.5;return [rest*0.42,rest*0.58,...Array(n).fill(w)];})(),2);
  }
  // Number lessons in hierarchy order for school reports, chronological order for teachers.
  const hierarchy=kind==='school'?groupLessons(lessons)[0].teachers:[];
  const ordered=kind==='school'?hierarchy.flatMap(t=>t.classes.flatMap(c=>c.lessons)):lessons;
  ordered.forEach((l,i)=>indexNo.set(l.key,i+1));
  const groups=kind==='school'?hierarchy.flatMap(t=>t.classes.map(c=>({label:t.teacher+'  ·  '+classLine(c),lessons:c.lessons})))
   :planned?[...ordered.reduce((m,l)=>{const d=lessonDay(l);if(!m.has(d))m.set(d,{label:longDay(d)||'NO PLANNED DATE',lessons:[]});m.get(d).lessons.push(l);return m;},new Map()).values()]
   :[{label:'',lessons}];
  if(planned)for(const l of ordered)for(const r of reviewsOf(l))if(r.weekly&&r.key){weeklyLast.set(r.key,l.key);if(!weeklyCovered.has(r.key))weeklyCovered.set(r.key,[]);weeklyCovered.get(r.key).push(l);}
  const renderIndex=pages=>{
   if(planned){kicker(kind==='school'?'Lesson index  ·  by planned date':'Chronological lesson index  ·  by planned date');paragraph(kind==='school'?'Grouped by teacher, then class and subject; within each group, lessons follow the day and period they were planned for. Select a row to open it.':'Lessons by the day and period they were planned for. Review: Weekly (covered by that week\'s weekly review, listed after the week\'s lessons) · Period (its own lesson review). Select a row to open it.',{size:8.6,color:palette.muted,after:3});plannedIndex(groups,pages);return;}
   kicker(kind==='school'?'Lesson index':'Chronological lesson index');paragraph(kind==='school'?'Grouped by teacher, then class and subject. Within each group, lessons follow their original submission order. Select a row to open the lesson.':'Lessons in original submission order, earliest first. Select a row to open the lesson.',{size:8.6,color:palette.muted,after:3});indexTable(groups,pages);};
  // Measure the index without drawing, reserve its pages, then fill it once page numbers are known.
  const indexStart=state.page+1,saved={...state};
  Object.assign(state,{dry:true,page:indexStart,y:TOP});renderIndex(null);
  const indexPages=state.page-indexStart+1;Object.assign(state,saved);
  for(let i=0;i<indexPages;i++)newPage();
  const pages=new Map();let currentTeacher='';
  ordered.forEach((lesson,i)=>{
   newPage();pages.set(lesson.key,state.page);
   const divider=kind==='school'&&lesson.teacherKey!==currentTeacher;
   if(divider){currentTeacher=lesson.teacherKey;kicker('Teacher',M,palette.muted);for(const line of wrap(lesson.teacher,W,13,true)){drawLine(line,M,state.y,13,{bold:true,color:palette.teal});state.y+=lineHeight(13);}state.y+=1;rule(state.y,palette.teal,0.4);state.y+=5;}
   lessonHeader(lesson,i,ordered.length,divider);lessonBody(lesson);
  });
  // "see page N" on lessons covered by a weekly review printed later.
  for(const ref of weeklyRefs){const target=weeklyPages.get(ref.key);if(!target)continue;doc.setPage(ref.page);state.page=ref.page;drawLine(String(target),ref.x,ref.y,ref.size,{bold:true,color:palette.teal});link(M,ref.top,W,ref.h,target);}
  Object.assign(state,{page:indexStart,y:TOP,reuse:true});doc.setPage(indexStart);
  renderIndex(pages);
  if(state.page!==indexStart+indexPages-1)throw Error('Lesson index layout changed while rendering.');
  state.reuse=false;
 }
 // ---------- footers ----------
 const total=doc.getNumberOfPages();
 for(let i=1;i<=total;i++){
  doc.setPage(i);doc.setDrawColor(palette.hair);doc.setLineWidth(0.2);doc.line(M,283,PAGE_W-M,283);
  font(7.4,false,palette.faint);doc.text('School Success  ·  Lesson documentation  ·  Confidential academic record',M,288);
  doc.text(`Page ${i} of ${total}`,PAGE_W-M,288,{align:'right'});
 }
 doc.setProperties({title:title+' — '+context,subject:kind==='lesson'?first.topic:periodText(from,to),creator:'School Success'});
 return doc;
}
