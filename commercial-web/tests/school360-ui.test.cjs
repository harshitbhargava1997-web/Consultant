const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{transformSync}=require('next/dist/build/swc');
const {school360Fixture,from,to}=require('./fixtures/school360.js');
const root=path.resolve(__dirname,'..');
function component(relative){const filename=path.join(root,relative),out=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}),m=new Module(filename,module);m.paths=Module._nodeModulePaths(path.dirname(filename));const normal=m.require.bind(m);m.require=name=>{if(name.endsWith('.css'))return {};if(name==='@/lib/school-success/client')return {successFetch(){throw Error('No network calls during render');}};if(name==='next/dynamic')return ()=>()=>null;const target=name.startsWith('@/')?path.join(root,name.slice(2)):name.startsWith('.')?path.resolve(path.dirname(filename),name):null;return normal(target||name);};m._compile(out.code,filename);return m.exports.default;}
const Portfolio=component('app/school-success/ui/school-portfolio.jsx'),Teacher=component('app/school-success/ui/report-workspace.jsx');
function render(view={},data=school360Fixture()){return renderToStaticMarkup(React.createElement(Portfolio,{data,from,to,view:{level:'portfolio',status:'all',sort:'name',...view},onViewChange(){},setFrom(){},setTo(){},refresh(){},onReview(){}}));}
test('portfolio renders quantitative school comparisons without actual evidence or reflection content',()=>{
 const html=render();for(const value of ['Complete portfolio','Alpha School','Beta School','Empty School','1 hr 30 min','Prepared lessons','Classroom lessons with evidence'])assert.ok(html.includes(value),value);
 assert.ok(!html.includes('media.example'));assert.ok(!html.includes('Children will blend'));assert.ok(!html.includes('Picture cards'));assert.ok(!html.includes('Review this lesson'));
});
test('selected school shows actual qualitative flow and excludes other schools and outside-period files',()=>{
 const html=render({level:'school',school:'Alpha School',tab:'evidence',category:'all',review:'all'});
 for(const value of ['Lesson preparation','Classroom evidence','Children will blend','Picture cards','plan.pdf','voice.wav','phonics.mp4','Review this lesson'])assert.ok(html.includes(value),value);
 assert.ok(!html.includes('outside.jpg'));assert.ok(!html.includes('Observation marker'));assert.ok(!html.includes('Beta School'));
});
test('stale periods hide results and consultant observations are opt-in',()=>{
 const stale=school360Fixture();stale.period.to='2026-10-23';assert.ok(!render({},stale).includes('<caption>School portfolio'));
 assert.ok(render({level:'school',school:'Alpha School',tab:'teachers',includeObservations:true}).includes('Observation marker'));
});
test('Teacher 360 opens the exact selected school-teacher profile and preserves default entry behavior',()=>{
 const props={data:school360Fixture(),school:'Alpha School',from,to,setFrom(){},setTo(){},refresh(){},mode:'Teacher 360°',initialTeacherKey:JSON.stringify(['Alpha School','Bina'])};
 const html=renderToStaticMarkup(React.createElement(Teacher,props));assert.match(html,/<h2>Bina<\/h2>/);assert.ok(!html.includes('<h2>Asha</h2>'));
 const missing=renderToStaticMarkup(React.createElement(Teacher,{...props,initialTeacherKey:JSON.stringify(['Beta School','Asha'])}));assert.ok(!missing.includes('teacher-report'));
});
