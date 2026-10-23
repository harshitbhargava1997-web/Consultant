const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {renderToStaticMarkup}=require('react-dom/server'),React=require('react'),{transformSync}=require('next/dist/build/swc');
const root=path.resolve(__dirname,'..'),cache=new Map();
function component(relative){const filename=path.join(root,relative);if(cache.has(filename))return cache.get(filename);
 const source=fs.readFileSync(filename,'utf8'),output=transformSync(source,{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}),m=new Module(filename,module);m.paths=Module._nodeModulePaths(path.dirname(filename));
 const normal=m.require.bind(m);m.require=name=>{let target=name.startsWith('@/')?path.join(root,name.slice(2)):name.startsWith('.')?path.resolve(path.dirname(filename),name):null;if(target&&fs.existsSync(target+'.jsx'))return component(path.relative(root,target+'.jsx'));return target?normal(target):normal(name);};m._compile(output.code,filename);cache.set(filename,m.exports.default);return m.exports.default;
}
test('both teacher portals use a period-scoped combined recording control without changing data endpoints',()=>{
 for(const name of ['app/TeacherPortalWorkspace.jsx','app/school-success/ui/teacher-portal.jsx']){const source=fs.readFileSync(path.join(root,name),'utf8');assert.match(source,/<LessonVoiceControls combinedFile=/);assert.match(source,/recordingAttachment\(p.files,file/);}
 const Controls=component('app/LessonVoiceControls.jsx'),html=renderToStaticMarkup(React.createElement(Controls,{onFile(){},onAttachment(){},onChange(){},onRecording(){}}));assert.match(html,/one combined recording for this class period/);assert.match(html,/Learning|learning objective/);assert.match(html,/Teaching-learning materials/);assert.match(html,/Review \/ next step/);assert.doesNotMatch(html,/optional/i);
});
test('stored file links separate preparation PDFs and audio without a grade/subject hierarchy',()=>{
 const Links=component('app/StoredFileLinks.jsx');const html=renderToStaticMarkup(React.createElement(Links,{files:[{id:'voice',category:'voice',url:'https://example.com/audio',name:'Reflection.wav'},{id:'plan',category:'lesson_plan',url:'https://example.com/plan',name:'Preparation.pdf'},{id:'activity',category:'activity',url:'https://example.com/activity',name:'Classroom.png'}]}));assert(html.indexOf('Lesson preparation PDFs')<html.indexOf('Audio recordings'));for(const name of ['plan','audio','activity'])assert(html.includes('example.com/'+name));assert.doesNotMatch(html,/Grade:|Subject:/);
});
