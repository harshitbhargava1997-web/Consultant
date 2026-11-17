'use client';
import {useEffect,useRef,useState} from 'react';
import {Mic,Square} from 'lucide-react';
import {formatReflection,reflectionPrompts,reflectionSectionLimit} from '@/lib/school-success/teacher-flow';

// audio=false hides the optional recording block (School Success after-class evidence); default keeps it.
export default function ReflectionEditor({disabled,uploadsEnabled=true,combinedFile,onChange,onFile,onRecording,prompts=reflectionPrompts,format=formatReflection,kind='planning',audio=true}){
 const afterClass=kind==='closure',saveAction=afterClass?'Submit classroom evidence':'Save lesson preparation';
 const [parts,setParts]=useState({}),[phase,setPhase]=useState('idle'),[error,setError]=useState(''),[seconds,setSeconds]=useState(0),[preview,setPreview]=useState('');
 const callbacks=useRef({onChange,onFile,onRecording}),values=useRef({}),recorder=useRef(null),stream=useRef(null),alive=useRef(true),active=useRef(false);
 callbacks.current={onChange,onFile,onRecording};
 useEffect(()=>{
  alive.current=true;
  return()=>{
   alive.current=false;
   if(recorder.current){recorder.current.onstop=null;recorder.current.ondataavailable=null;recorder.current.onerror=null;if(recorder.current.state!=='inactive')recorder.current.stop();}
   stream.current?.getTracks().forEach(track=>track.stop());
   callbacks.current.onRecording(false);
  };
 },[]);
 useEffect(()=>{
  if(!combinedFile){setPreview('');return;}
  const url=URL.createObjectURL(combinedFile);setPreview(url);
  return()=>URL.revokeObjectURL(url);
 },[combinedFile]);
 useEffect(()=>{
  if(phase!=='recording')return;
  const started=Date.now(),timer=setInterval(()=>setSeconds(Math.floor((Date.now()-started)/1000)),1000);
  return()=>clearInterval(timer);
 },[phase]);
 function publish(key,text){
  const next={...values.current,[key]:text};values.current=next;setParts(next);
  callbacks.current.onChange(format(next),next.materials||'');
 }
 function release(){
  stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;recorder.current=null;active.current=false;
  if(alive.current){setPhase('idle');callbacks.current.onRecording(false);}
 }
 function stop(){
  if(recorder.current?.state==='recording'){setPhase('saving');recorder.current.stop();}
 }
 async function start(){
  if(active.current||disabled||!uploadsEnabled)return;
  active.current=true;setPhase('starting');setError('');setSeconds(0);callbacks.current.onRecording(true);
  try{
   if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('Audio recording is unavailable in this browser. You can still save your written notes.');
   const audio=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   if(!alive.current){audio.getTracks().forEach(track=>track.stop());return;}
   stream.current=audio;
   // Keep the browser-native container: no second microphone client or audio decoding.
   const capture=new MediaRecorder(audio,{audioBitsPerSecond:64000}),chunks=[];let bytes=0;
   recorder.current=capture;
   capture.ondataavailable=event=>{
    if(event.data.size){chunks.push(event.data);bytes+=event.data.size;}
    if(bytes>=48*1024*1024&&capture.state==='recording'){setError('Recording stopped near the file-size limit. Review it before saving.');stop();}
   };
   capture.onstop=async()=>{
    audio.getTracks().forEach(track=>track.stop());
    if(!alive.current)return;
    setPhase('saving');
    try{
     if(!bytes)throw Error('No audio was captured. Please record again.');
     if(bytes>50*1024*1024)throw Error('This recording exceeds 50 MB. Please record a shorter reflection.');
     const type=capture.mimeType||chunks[0]?.type||'audio/webm',extension=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm';
     await callbacks.current.onFile(new File(chunks,(afterClass?'After-class-reflection.':'Lesson-planning-reflection.')+extension,{type}));
    }catch(e){if(alive.current)setError('Could not attach this recording: '+e.message);}
    finally{release();}
   };
   capture.onerror=()=>{if(alive.current)setError('Recording was interrupted. Listen to the captured audio and record again if needed.');if(capture.state==='recording')stop();};
   for(const track of audio.getAudioTracks())track.onended=()=>{if(alive.current&&capture.state==='recording'){setError('Microphone access ended. Review the captured audio before saving.');stop();}};
   capture.start(1000);setPhase('recording');
  }catch(e){if(alive.current)setError(e.name==='NotAllowedError'?'Microphone permission was not granted. Allow it to record, or save your written notes without audio.':e.message);release();}
 }
 const recording=phase==='recording',locked=phase!=='idle';
 return <>
  <div className="teacher-evidence"><h3>{afterClass?'After-class reflection':'1. Lesson planning'}</h3>
   <p className="hint">Type in each field, or tap the microphone on your device’s keyboard to speak. Review the words before saving.</p>
   {prompts.map(([key,label])=><label className="field" key={key}><span>{label}</span><textarea rows={3} maxLength={reflectionSectionLimit} disabled={disabled||locked} value={parts[key]||''} onChange={e=>publish(key,e.target.value)} placeholder={afterClass?label:key==='objective'?'What should students learn, and why?':key==='materials'?'Which books, teaching materials or other resources will you use?':key==='teacher'?'How will you teach?':key==='student'?'What will students do?':key==='practice'?'Course Book / Workbook pages, classwork and homework':'How will you check learning? What needs to happen next?'}/></label>)}
   <details><summary>{afterClass?'Preview the after-class reflection':'Preview the lesson planning notes'}</summary><p style={{whiteSpace:'pre-wrap'}}>{format(parts)||'Your notes will appear here as you fill in the fields.'}</p></details>
  </div>
  {audio&&<div className="teacher-evidence"><h3>{afterClass?'Audio reflection on your class (optional)':'2. Audio reflection on your lesson plan (optional)'}</h3>
   <p className="hint">{afterClass?'Reflect in your own language on the learning outcome, what went well and your remedial plan for students who need support.':'After completing the fields, reflect on your plan in your own language: what you will teach, how you will teach it and how you will check learning.'} This saves your voice without converting it to text.</p>
   <p className="hint">Finish keyboard dictation before recording. Keep this page open while speaking.</p>
   <button className="button primary" type="button" disabled={phase==='starting'||phase==='saving'||!recording&&(disabled||!uploadsEnabled)} onClick={()=>recording?stop():void start()}>{recording?<Square size={16}/>:<Mic size={16}/>} {phase==='starting'?'Opening microphone…':phase==='saving'?'Attaching recording…':recording?'Stop recording':combinedFile?'Record again':'Record audio reflection'}</button>
   <p role="status" aria-live="polite">{phase==='starting'?'Requesting microphone access…':phase==='saving'?'Attaching audio to this lesson draft…':recording?'Audio recording in progress':combinedFile?'Audio attached to this draft. '+saveAction+' to upload it.':'No audio recorded. You can save the written notes without it.'}</p>
   {recording&&<p>Recording time: {Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</p>}
   {!uploadsEnabled&&<p className="hint">Audio uploads are unavailable. You can still complete the text fields.</p>}
   {error&&<p className="negative" role="alert">{error}</p>}
   {combinedFile&&<><p className="hint">Listen before saving. Recording again replaces this draft’s audio after the new recording finishes successfully.</p>{preview&&<audio aria-label={afterClass?'After-class audio reflection':'Lesson planning audio reflection'} controls preload="metadata" src={preview} style={{width:'100%'}}/>}</>}
  </div>}
 </>;
}
