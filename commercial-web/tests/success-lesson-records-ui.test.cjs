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
 assert.match(html,/<option>Grade 2<\/option><option>Grade 3<\/option>/);
 assert.ok(!html.includes('consultant@example.test'));
});

test('school view offers a teacher filter keyed by school and never shows another school',async()=>{
 const {data,from,to}=await fixture(),html=render({data,from,to,school:'Alpha School',mode:'school'});
 assert.match(html,/All teachers/);assert.match(html,/School lesson PDF/);assert.match(html,/Letter sounds/);
 assert.ok(!html.includes('Beta School'));
 assert.match(html,/value="\[&quot;Alpha School&quot;,&quot;Asha&quot;\]"/);
});

test('an opened lesson shows plan fields, labelled recordings, reflections and Academic Review',async()=>{
 const {data,from,to}=await fixture(),{buildLessonRecords}=await import('../lib/school-success/lesson-records.js');
 const lesson=buildLessonRecords(data.entries,from,to).find(l=>l.recordId==='101');
 const html=renderToStaticMarkup(React.createElement(ui.LessonCard,{lesson,number:2,showTeacher:false,busy:false,onDownload(){},defaultOpen:true}));
 for(const text of ['Learning objective','Teacher activity','Review / homework','Classroom activities','Student written work','Lesson preparation recording 1','Lesson preparation recording 2','After-class reflection recording','Academic Review','Reviewed 27 Oct 2026','Strong modelling','Lesson PDF'])assert.ok(html.includes(text),text);
 assert.equal((html.match(/<audio /g)||[]).length,2);assert.match(html,/preload="none"/);
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
});
