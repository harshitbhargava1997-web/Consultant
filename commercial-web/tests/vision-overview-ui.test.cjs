const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{transformSync}=require('next/dist/build/swc');
const filename=path.resolve(__dirname,'../app/OverviewTotals.jsx');
const out=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}});
const compiled=new Module(filename,module);compiled.paths=Module._nodeModulePaths(path.dirname(filename));compiled._compile(out.code,filename);const Cards=compiled.exports.default;
test('overview renders four labelled totals, formats large counts and distinguishes unavailable from zero',()=>{
 const render=p=>renderToStaticMarkup(React.createElement(Cards,p));
 const html=render({admin:true,totals:{schools:8,teachers:35,students:5001,consultants:2}});
 for(const label of ['Total schools','Total teachers','Total students','Total consultants','5,001','all active Vision schools'])assert.ok(html.includes(label),label);
 assert.ok(render({totals:{schools:0,teachers:0,students:0,consultants:0}}).includes('<strong>0</strong>'));
 const unavailable=render({loading:true,error:'Please refresh'});assert.ok(unavailable.includes('<strong>—</strong>'));assert.ok(unavailable.includes('aria-busy="true"'));assert.ok(unavailable.includes('Please refresh'));assert.ok(!unavailable.includes('<strong>0</strong>'));
});
