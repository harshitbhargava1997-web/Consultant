const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {transformSync}=require('next/dist/build/swc');
const filename=path.resolve(__dirname,'../app/ReflectionEditor.jsx');
const code=transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness({permission,uploadsEnabled=true}={}){
 const cells=[],effects=[],events=[],files=[];let index=0,capture,stops=0;
 const hooks={useState(initial){const i=index++;if(!(i in cells))cells[i]=initial;return[cells[i],value=>{cells[i]=typeof value==='function'?value(cells[i]):value;}];},useRef(value){const i=index++;return cells[i]||(cells[i]={current:value});},useEffect(fn,deps){const i=index++,old=cells[i];if(!old||deps.some((v,n)=>v!==old.deps[n])){old?.cleanup?.();cells[i]={deps};effects.push(()=>{cells[i].cleanup=fn();});}}};
 const track={stop(){stops++;}},audio={getTracks:()=>[track],getAudioTracks:()=>[track]};
 class Recorder{constructor(){capture=this;this.state='inactive';this.mimeType='audio/mp4';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['sample audio'],{type:this.mimeType})});this.done=this.onstop?.();}}
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,require(name){if(name==='react')return hooks;if(name==='@/lib/school-success/teacher-flow')return{reflectionPrompts:[['objective','Learning objective'],['materials','Materials']],reflectionSectionLimit:800,formatReflection:parts=>Object.values(parts).join('\n')};return require(name);},navigator:{mediaDevices:{getUserMedia:()=>permission?permission(audio):Promise.resolve(audio)}},MediaRecorder:Recorder,File,Blob,URL,setInterval,clearInterval,Date});
 const props={uploadsEnabled,onChange(...args){events.push(['text',...args]);},onFile(file){files.push(file);props.combinedFile=file;},onRecording(value){events.push(['recording',value]);}};
 const walk=(node,type)=>{if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(n=>walk(n,type));return[...(node.type===type?[node]:[]),...walk(node.props?.children,type)];};
 return{props,events,files,get capture(){return capture;},get stops(){return stops;},render(){index=0;const tree=module.exports.default(props);effects.splice(0).forEach(fn=>fn());return{button:walk(tree,'button')[0],fields:walk(tree,'textarea'),tree};},unmount(){for(const cell of cells)cell?.cleanup?.();}};
}
test('recording starts only on request and attaches playable container bytes before releasing the save lock',async()=>{
 const h=harness();let ui=h.render();assert.equal(h.capture,undefined);
 ui.fields[0].props.onChange({target:{value:'बच्चे शब्द पढ़ेंगे'}});assert.equal(h.events[0][1],'बच्चे शब्द पढ़ेंगे');
 ui.button.props.onClick();await tick();h.props.disabled=true;ui=h.render();assert.equal(ui.button.props.disabled,false,'stop remains available while parent locks submission');assert(ui.fields.every(f=>f.props.disabled));
 ui.button.props.onClick();await h.capture.done;ui=h.render();assert.equal(h.files.length,1);assert.equal(h.files[0].type,'audio/mp4');assert.match(h.files[0].name,/\.m4a$/);assert.equal(await h.files[0].text(),'sample audio');assert.deepEqual(h.events.filter(e=>e[0]==='recording').map(e=>e[1]),[true,false]);assert(h.stops>0);h.unmount();
});
test('denied microphone releases the save lock and preserves the prior reflection',async()=>{
 const h=harness({permission:()=>Promise.reject(Object.assign(new Error('denied'),{name:'NotAllowedError'}))});const prior=new File(['old'],'old.webm');h.props.combinedFile=prior;
 h.render().button.props.onClick();await tick();const ui=h.render();assert.equal(h.props.combinedFile,prior);assert.equal(h.files.length,0);assert.equal(ui.fields[0].props.disabled,false);assert.equal(h.events.at(-1)[1],false);h.unmount();
});
test('permission resolving after unmount releases microphone without attaching a recording',async()=>{
 let allow;const h=harness({permission:audio=>new Promise(resolve=>{allow=()=>resolve(audio);})});h.render().button.props.onClick();h.unmount();allow();await tick();assert(h.stops>0);assert.equal(h.capture,undefined);assert.equal(h.files.length,0);
});
test('disabled uploads do not prevent typing or keyboard dictation into planning fields',()=>{
 const h=harness({uploadsEnabled:false}),ui=h.render();assert.equal(ui.button.props.disabled,true);assert(ui.fields.every(f=>!f.props.disabled));ui.fields[0].props.onChange({target:{value:'Plan without audio'}});assert.equal(h.events[0][1],'Plan without audio');h.unmount();
});
test('after-class recording uses a separate filename and leaves the written reflection intact',async()=>{
 const h=harness();h.props.kind='closure';h.props.prompts=[['achievement','Outcome'],['nextStep','Remedial support']];h.props.format=parts=>Object.values(parts).join('\n');
 let ui=h.render();ui.fields[0].props.onChange({target:{value:'Most students achieved the outcome.'}});ui.fields[1].props.onChange({target:{value:'Plan extra blending practice.'}});
 ui.button.props.onClick();await tick();ui=h.render();ui.button.props.onClick();await h.capture.done;
 assert.equal(h.files[0].name,'After-class-reflection.m4a');ui=h.render();assert.equal(ui.fields[0].props.value,'Most students achieved the outcome.');assert.equal(ui.fields[1].props.value,'Plan extra blending practice.');h.unmount();
});
