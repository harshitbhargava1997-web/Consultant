const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {renderToStaticMarkup}=require('react-dom/server'),React=require('react'),{transformSync}=require('next/dist/build/swc');
const {defaultReportSettings}=require('../lib/school-success/reports.js');
const root=path.resolve(__dirname,'..'),cache=new Map();
function component(relative){
 const filename=path.join(root,relative);if(cache.has(filename))return cache.get(filename);
 const output=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}),m=new Module(filename,module);m.paths=Module._nodeModulePaths(path.dirname(filename));
 const normal=m.require.bind(m);m.require=name=>{if(name.endsWith('.css'))return {};if(name==='@/lib/school-success/client')return {successFetch(){throw Error('No network calls during render');}};const target=name.startsWith('@/')?path.join(root,name.slice(2)):name.startsWith('.')?path.resolve(path.dirname(filename),name):null;if(target&&fs.existsSync(target+'.jsx'))return component(path.relative(root,target+'.jsx'));return normal(target||name);};m._compile(output.code,filename);cache.set(filename,m.exports);return m.exports;
}
const Workspace=component('app/school-success/ui/report-workspace.jsx').default;
function render(visualization,timeUnit){const settings={...structuredClone(defaultReportSettings),visualization,timeUnit};return renderToStaticMarkup(React.createElement(Workspace,{data:{reportSettings:settings,entries:[{kind:'usage',school:'School',teacher:'Teacher',date:'2026-10-12',module:'Content / Book',minutes:90,topic:'Reading resource'}],roster:[{school:'School',name:'Teacher'}],period:{from:'2026-10-12',to:'2026-10-13'}},school:'School',from:'2026-10-12',to:'2026-10-13',setFrom(){},setTo(){},refresh(){},mode:'Teacher 360°'}));}
test('real report component renders the selected format, unit and accurate book values',()=>{
 for(const view of ['tables','charts','both'])for(const unit of ['hours','minutes']){
  const html=render(view,unit);assert.match(html,/aria-label="Report display format"/);assert.match(html,/aria-label="Report time unit"/);
  assert.equal(html.includes('aria-label="Recorded resource usage"'),view!=='tables');
  assert.equal(html.includes('<th>Book / chapter</th>'),view!=='charts');assert.match(html,unit==='hours'?/1\.5/:/90\.0/);
  assert.match(html,new RegExp('aria-pressed="true">'+view[0].toUpperCase()+view.slice(1)+'</button>'));assert.match(html,new RegExp('aria-pressed="true">'+unit[0].toUpperCase()+unit.slice(1)+'</button>'));
  assert.match(html,/Teacher PDF/);assert.match(html,/Combined PDF/);assert.match(html,/School PDFs/);
 }
});
