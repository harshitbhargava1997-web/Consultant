const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{transformSync}=require('next/dist/build/swc');
const root=path.resolve(__dirname,'..');
function load(relative){const filename=path.join(root,relative),out=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}),m=new Module(filename,module);m.paths=Module._nodeModulePaths(path.dirname(filename));const normal=m.require.bind(m);m.require=name=>{if(name.endsWith('.css'))return {};if(name==='@/lib/school-success/client')return {successFetch(){throw Error('No network calls during render');}};if(name==='next/dynamic')return ()=>function Dynamic(){return null;};const target=name.startsWith('@/')?path.join(root,name.slice(2)):name.startsWith('.')?path.resolve(path.dirname(filename),name):null;return normal(target||name);};m._compile(out.code,filename);return m.exports;}
const ui=load('app/school-success/ui/lesson-records.jsx'),LessonRecords=ui.default;
async function fixture(){const {mapLive}=await import('../lib/school-success/live-mapping.js'),f=await import('./fixtures/lesson-records.mjs');const mapped=await mapLive(f.raw(),f.base);return {data:{entries:mapped.entries,roster:mapped.roster,period:{from:f.from,to:f.to},directory:{archives:[]}},from:f.from,to:f.to};}
const render=(props)=>renderToStaticMarkup(React.createElement(LessonRecords,props));

test('teacher lesson records list only that teacher’s lessons in submission order without preloading files',async()=>{
 const {data,from,to}=await fixture(),html=render({data,from,to,school:'Alpha School',teacherKey:JSON.stringify(['Alpha School','Asha']),mode:'teacher'});
 const order=['Counting in tens','Blending CVC words','मात्रा वाले शब्द'].map(t=>html.indexOf(t));
 assert.ok(order.every(i=>i>0));assert.deepEqual([...order].sort((a,b)=>a-b),order);
 assert.ok(!html.includes('Letter sounds'),'another teacher');assert.ok(!html.includes('Beta objective'),'another school');
 assert.ok(!html.includes('<img'),'collapsed lessons do not load images');assert.ok(!html.includes('<audio'));
 assert.match(html,/Teacher lesson PDF/);assert.match(html,/Lesson plans submitted in period/);
 assert.match(html,/<option value="Grade 2">Grade 2<\/option><option value="Grade 3">Grade 3<\/option>/);
 assert.match(html,/All sections/);
 assert.ok(!html.includes('consultant@example.test'));
});

test('school view offers a teacher filter keyed by school and never shows another school',async()=>{
 const {data,from,to}=await fixture(),html=render({data,from,to,school:'Alpha School',mode:'school'});
 assert.match(html,/All teachers/);assert.match(html,/School lesson PDF/);assert.match(html,/Letter sounds/);
 assert.ok(!html.includes('Beta School'));
 assert.match(html,/value="\[&quot;Alpha School&quot;,&quot;Asha&quot;\]"/);
});

test('an opened lesson shows plan fields, reflections (with their recording) and Academic Review, and no previous-portal voice notes',async()=>{
 const {data,from,to}=await fixture(),{buildLessonRecords}=await import('../lib/school-success/lesson-records.js');
 const lesson=buildLessonRecords(data.entries,from,to).find(l=>l.recordId==='101');
 const html=renderToStaticMarkup(React.createElement(ui.LessonCard,{lesson,number:2,showTeacher:false,busy:false,onDownload(){},defaultOpen:true}));
 for(const text of ['Learning objective','Teacher activity','Review / homework','Classroom activities','Student written work','After-class reflection recording','Academic Review','Reviewed 27 Oct 2026','Strong modelling','Lesson PDF'])assert.ok(html.includes(text),text);
 assert.ok(!/Lesson preparation recording|Audio recordings|previous portal/.test(html),'previous-portal voice notes are not shown');assert.equal((html.match(/<audio /g)||[]).length,0);
 assert.equal((html.match(/<img /g)||[]).length,3,'activity and writing photos only after opening');
 assert.match(html,/loading="lazy"/);assert.ok(!/CFU|Check for understanding/i.test(html));
});

test('stale periods and empty filters show clear states',async()=>{
 const {data,from,to}=await fixture();
 assert.match(render({data,from:'2026-09-01',to,school:'Alpha School',mode:'school'}),/Apply the selected period/);
 assert.match(render({data,from,to,school:'Nowhere School',mode:'school'}),/No lessons in this view/);
});

test('School 360 school detail offers the Lesson records tab without changing existing tabs',async()=>{
 const Portfolio=load('app/school-success/ui/school-portfolio.jsx').default,{school360Fixture,from,to}=require('./fixtures/school360.js');
 const html=renderToStaticMarkup(React.createElement(Portfolio,{data:school360Fixture(),from,to,view:{level:'school',school:'Alpha School',status:'all',sort:'name'},onViewChange(){},setFrom(){},setTo(){},refresh(){},onReview(){}}));
 assert.match(html,/Teachers<\/button>/);assert.match(html,/Evidence flow<\/button>/);assert.match(html,/Lesson records<\/button>/);
 assert.match(html,/Teacher breakdown/,'teachers tab remains the default');
});

test('a lesson with items outside the period says so and offers the complete history PDF',async()=>{
 const {data,from,to}=await fixture(),{buildLessonRecords}=await import('../lib/school-success/lesson-records.js');
 const lesson={...buildLessonRecords(data.entries,from,to).find(l=>l.recordId==='101'),outsidePeriodFiles:2,reviewOutsidePeriod:false};
 const html=renderToStaticMarkup(React.createElement(ui.LessonCard,{lesson,number:1,showTeacher:false,busy:false,onDownload(){},onDownloadHistory(){},defaultOpen:true}));
 assert.match(html,/Outside this reporting period: 2 files for this lesson are not shown here/);
 assert.match(html,/More outside period/);assert.match(html,/Lesson PDF · this period/);assert.match(html,/Complete history PDF/);
 const mixed=renderToStaticMarkup(React.createElement(ui.LessonCard,{lesson:{...lesson,reviewOutsidePeriod:true,feedback:{text:'Planning feedback for this period.'}},number:1,defaultOpen:true,onReview(){}}));
 assert.match(mixed,/2 files and additional review feedback/);
 assert.match(mixed,/Planning feedback for this period/);
 assert.match(mixed,/Review lesson/);
});

// Destination of usage-PDF links, rendered with the real LessonRecords component.
function loadLinkView(){
 const filename=path.join(root,'app/school-success/ui/lesson-doc-link.jsx'),out=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}),m=new Module(filename,module);
 m.paths=Module._nodeModulePaths(path.dirname(filename));const normal=m.require.bind(m);
 m.require=name=>{if(name==='next/dynamic')return ()=>ui.default;const target=name.startsWith('@/')?path.join(root,name.slice(2)):null;return normal(target||name);};
 m._compile(out.code,filename);return m.exports.default;
}
test('lesson documentation link opens exactly the linked teacher, class, section, subject and period',async()=>{
 const {data,from,to}=await fixture(),View=loadLinkView();
 const link={school:'Alpha School',teacher:'Asha',grade:'Grade 2',section:'A',subject:'English',from,to,includeArchived:false};
 const html=renderToStaticMarkup(React.createElement(View,{data:{...data,actor:{role:'admin'},directory:{schools:['Alpha School','Beta School'],archives:[]}},link,onClose(){}}));
 assert.match(html,/Opened from a Teacher 360° report/);assert.match(html,/Teacher lesson PDF/);
 assert.equal((html.match(/class="lr-lesson"/g)||[]).length,1);assert.match(html,/Blending CVC words/);
 assert.ok(!html.includes('Counting in tens'),'other subject excluded');assert.ok(!html.includes('मात्रा वाले शब्द'),'other class excluded');
 assert.ok(!html.includes('Beta objective'),'same-name teacher at another school excluded');
});
test('link destination refuses non-admins, schools outside the grant, stale periods and malformed links',async()=>{
 const {data,from,to}=await fixture(),View=loadLinkView(),link={school:'Alpha School',teacher:'Asha',grade:'Grade 2',section:'A',subject:'English',from,to};
 const render=(d,l=link)=>renderToStaticMarkup(React.createElement(View,{data:d,link:l,onClose(){}}));
 assert.match(render({...data,actor:{role:'school-teacher'}}),/not available/);
 // The server returned only Beta School for this user; a link edited to Alpha School shows nothing.
 const scoped={...data,actor:{role:'admin'},entries:data.entries.filter(r=>r.school==='Beta School'),directory:{schools:['Beta School'],archives:[]}};
 const denied=render(scoped);assert.match(denied,/not in your School Success access/);assert.ok(!denied.includes('Blending CVC words'));
 assert.match(render({...data,actor:{role:'admin'},period:{from:'2026-09-01',to:'2026-09-30'}}),/Loading lesson documentation/);
 assert.match(render({...data,actor:{role:'admin'}},null),/not recognised/);
});
test('written reflections render inline in an opened lesson with their date and questions',()=>{
 const lesson={key:'k',recordId:'1',school:'S',teacher:'T',teacherKey:'["S","T"]',grade:'Grade 2',section:'A',subject:'Hindi',topic:'मात्रा',plannedDate:'2026-10-21',conductedOn:'2026-10-22',submittedAt:'2026-10-20T05:00:00.000Z',firstDate:'2026-10-20',plan:{fields:[],notes:''},planFiles:[],activities:[],writing:[],audio:[],additional:[],feedback:null,outsidePeriodFiles:0,
  writtenReflections:[{url:'https://m.test/x/closure/1.json',date:'2026-10-22',conductedOn:'2026-10-22',label:'Written reflection',answers:{achievement:'बच्चों ने पढ़ा। Most read well.',nextStep:'Ravi needs ि practice.'},prompts:[]}],
  reflections:[{url:'https://m.test/x/closure/old.pdf',kind:'PDF',label:'Earlier after-class reflection (saved PDF)',legacy:true,addedOn:'2026-10-21'}]};
 const html=renderToStaticMarkup(React.createElement(ui.LessonCard,{lesson,number:1,showTeacher:false,busy:false,onDownload(){},defaultOpen:true}));
 for(const text of ['Written reflection · 22 Oct 2026','Did students achieve the learning outcome','बच्चों ने पढ़ा। Most read well.','Which students need support','Ravi needs ि practice.','Earlier reflections were saved as PDFs','Earlier after-class reflection (saved PDF)'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('closure/1.json'),'the stored text document is not shown as a raw file link');
});
