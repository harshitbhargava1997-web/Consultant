const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{transformSync}=require('next/dist/build/swc');
const root=path.resolve(__dirname,'..'),cache=new Map();
// Compiles .jsx on demand (including nested component imports) for server rendering.
function load(filename){
 if(cache.has(filename))return cache.get(filename);
 const out=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}),m=new Module(filename,module);
 m.paths=Module._nodeModulePaths(path.dirname(filename));const normal=m.require.bind(m);cache.set(filename,m.exports);
 m.require=name=>{
  if(name.endsWith('.css'))return {};
  if(name==='@/lib/school-success/client')return {successFetch(){throw Error('No network calls during render');}};
  if(name==='next/dynamic')return ()=>()=>null;
  const target=name.startsWith('@/')?path.join(root,name.slice(2)):name.startsWith('.')?path.resolve(path.dirname(filename),name):null;
  if(target&&fs.existsSync(target+'.jsx'))return load(target+'.jsx');
  return normal(target||name);
 };
 m._compile(out.code,filename);cache.set(filename,m.exports);return m.exports;
}
const TeacherPortal=load(path.join(root,'app/school-success/ui/teacher-portal.jsx')).default;
const {SavedPeriodRecord}=load(path.join(root,'app/school-success/ui/lesson-evidence.jsx'));
const AfterClassReflection=load(path.join(root,'app/AfterClassReflection.jsx')).default;
const entries=[{kind:'submission',school:'Alpha School',teacher:'Asha',id:'1:preparation',date:'2026-10-20',grade:'Grade 2',subject:'English',topic:'Old feed lesson',files:[{url:'https://m.test/x.pdf',column:'Lesson_Plan_Picture'}],review:'Old feed feedback'}];
const render=actor=>renderToStaticMarkup(React.createElement(TeacherPortal,{data:{actor,roster:[{school:'Alpha School',name:'Asha'}],entries,period:{from:'2026-10-01',to:'2026-10-31'},uploadsEnabled:true},school:'Alpha School',refresh:async()=>{}}));

test('teacher landing offers two primary actions and no download controls or history feed',()=>{
 for(const actor of [{role:'school-teacher',school:'Alpha School',name:'Asha',email:'x@school.invalid'},{role:'admin',school:'',name:'Admin',email:'a@x.test'}]){
  const html=render(actor);
  assert.match(html,/Submit Lesson Plan/);assert.match(html,/Submit Evidence/);assert.match(html,/aria-pressed="true"/);
  for(const gone of ['Download reflection draft','Download submitted reflection','Download reflection &amp; evidence links','Download lesson &amp; evidence links','My Evidence','Teacher evidence','Loaded period','feed entry','Old feed lesson','Old feed feedback'])assert.ok(!html.includes(gone),actor.role+': '+gone);
  assert.match(html,/Save lesson preparation/);assert.match(html,/Audio reflection on your lesson plan/,'optional preparation recording kept');
 }
});

test('Add Evidence reflection has no audio controls; native Vision keeps its optional recording',()=>{
 const props={onChange(){},onFile(){},onRecording(){},uploadsEnabled:true};
 const success=renderToStaticMarkup(React.createElement(AfterClassReflection,{...props,audio:false,note:'Saved as dated text.'}));
 assert.ok(!success.includes('Record audio reflection')&&!success.includes('Audio reflection on your class'));
 assert.match(success,/Did students achieve the learning outcome/);assert.match(success,/Saved as dated text/);
 const vision=renderToStaticMarkup(React.createElement(AfterClassReflection,props));
 assert.match(vision,/Record audio reflection/);assert.match(vision,/saved as a dated reflection PDF/);
});

test('a reopened lesson shows dated reflections as text, plus earlier PDFs, recordings, other files and feedback',()=>{
 const period={id:'p1',reflection:'Why — learning objective\nRead words'};
 const lesson={files:[
  {periodId:'p1',category:'After-class reflection',url:'https://m.test/a/closure/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json',date:'2026-10-24',reflection:{answers:{achievement:'Second: four children improved',nextStep:'Two need help'}}},
  {periodId:'p1',category:'After-class reflection',url:'https://m.test/a/closure/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json',date:'2026-10-22',reflection:{answers:{achievement:'बच्चों ने पढ़ा',nextStep:''}}},
  {periodId:'p1',category:'After-class reflection',url:'https://m.test/a/closure/cccccccc-cccc-4ccc-8ccc-cccccccccccc.json',date:'2026-10-25'},
  {periodId:'p1',category:'After-class reflection',url:'https://m.test/a/closure/old.pdf',date:'2026-10-21'},
  {periodId:'p1',category:'After-class reflection',url:'https://m.test/a/closure/rec.webm',date:'2026-10-22'},
  {periodId:'p1',category:'Voice reflection',url:'https://m.test/a/voice/plan.wav',date:'2026-10-20'},
  {periodId:'p1',category:'Classroom activity',url:'https://m.test/a/activity/photo.jpg',date:'2026-10-22'},
  {periodId:'p1',category:'Lesson plan',url:'https://m.test/a/implementation_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/lesson_plan/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',date:'2026-10-20'},
  {periodId:'p2',category:'Classroom activity',url:'https://m.test/a/activity/other-period.jpg',date:'2026-10-22'}],
  feedback:[{periodId:'p1',text:'Strong modelling',date:'2026-10-23T05:00:00+00:00'}]};
 const html=renderToStaticMarkup(React.createElement(SavedPeriodRecord,{lesson,period}));
 assert.ok(html.indexOf('22 Oct 2026')<html.indexOf('24 Oct 2026'),'reflections in date order');
 for(const text of ['Saved after-class reflections','Reflection 1 · 22 Oct 2026','बच्चों ने पढ़ा','Reflection 2 · 24 Oct 2026','Second: four children improved','Two need help','Which students need support','could not be loaded just now','Earlier reflections (saved PDF)','Reflection PDF · 21 Oct 2026','After-class recording · 22 Oct 2026','Lesson planning recording · 20 Oct 2026','Classroom activity · 22 Oct 2026','Academic Review · 23 Oct 2026','Strong modelling','Read words'])assert.ok(html.includes(text),text);
 assert.ok(!/\.json/.test(html),'no raw JSON links');
 assert.ok(!html.includes('lesson_plan/aaaaaaaa'),'generated plan PDF hidden while the plan text is shown');
 assert.match(renderToStaticMarkup(React.createElement(SavedPeriodRecord,{lesson,period:{id:'p1',reflection:''}})),/Lesson plan · 20 Oct 2026/,'kept as fallback when no plan text exists');assert.ok(!html.includes('other-period'),'only this period');
});
