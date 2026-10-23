'use client';
import {useEffect,useRef,useState} from 'react';
import {Mic,Square} from 'lucide-react';
import VoiceReflection from './school-success/ui/voice-reflection';
import {decodeRecording,pcmWave} from '@/lib/lesson-audio';

export default function LessonVoiceControls({disabled,uploadsEnabled=true,combinedFile,onChange,onFile,onAttachment,onRecording}){
 const callbacks=useRef({onFile,onRecording}),segments=useRef([]),pending=useRef(null),recorder=useRef(null),stream=useRef(null),alive=useRef(true),working=useRef(false),hadFile=useRef(false);
 callbacks.current={onFile,onRecording};
 const [manual,setManual]=useState(false),[speech,setSpeech]=useState(false),[starting,setStarting]=useState(false),[processing,setProcessing]=useState(false),[failed,setFailed]=useState(false),[error,setError]=useState('');
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;if(recorder.current){recorder.current.onstop=null;if(recorder.current.state==='recording')recorder.current.stop();}stream.current?.getTracks().forEach(t=>t.stop());callbacks.current.onRecording(false);};},[]);
 useEffect(()=>{callbacks.current.onRecording(manual||speech||starting||processing||failed);},[manual,speech,starting,processing,failed]);
 useEffect(()=>{if(hadFile.current&&!combinedFile){segments.current=[];pending.current=null;setFailed(false);setError('');}hadFile.current=Boolean(combinedFile);},[combinedFile]);
 async function append(file){
  if(working.current)return;working.current=true;pending.current=file;setProcessing(true);setError('');
  try{const decoded=await decodeRecording(file);if(!alive.current)return;const next=[...segments.current,decoded];const combined=new File([pcmWave(next)],'Lesson-reflection.wav',{type:'audio/wav'});callbacks.current.onFile(combined);segments.current=next;pending.current=null;setFailed(false);}
  catch(e){if(alive.current){setFailed(true);setError('Your latest recording is retained in this draft but could not be combined: '+e.message);}}
  finally{working.current=false;if(alive.current)setProcessing(false);}
 }
 async function start(){if(starting||manual)return;setStarting(true);setError('');try{
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('Recording is unavailable here. Attach a prepared audio recording or type your reflection.');
  const audio=await navigator.mediaDevices.getUserMedia({audio:true});if(!alive.current){audio.getTracks().forEach(t=>t.stop());return;}stream.current=audio;
  const rec=new MediaRecorder(audio),chunks=[];recorder.current=rec;rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  rec.onstop=async()=>{audio.getTracks().forEach(t=>t.stop());if(!alive.current)return;const type=rec.mimeType,ext=type.includes('mp4')?'m4a':type.includes('ogg')?'ogg':'webm';if(chunks.length)await append(new File(chunks,'Recording.'+ext,{type}));if(alive.current)setManual(false);};
  rec.start();setManual(true);
 }catch(e){stream.current?.getTracks().forEach(t=>t.stop());if(alive.current)setError(e.message);}finally{if(alive.current)setStarting(false);}}
 const locked=starting||processing||failed;
 return <><VoiceReflection disabled={disabled||manual||locked||!uploadsEnabled} onChange={onChange} onRecording={setSpeech} onFile={append}/>
 <div className="teacher-evidence"><h3>Lesson planning voice reflection</h3><p className="hint">Each Start–Stop segment is added to one combined recording for this class period. Your written planning sections stay separate.</p>
 <button className="button" type="button" disabled={locked||speech||!manual&&(disabled||!uploadsEnabled)} onClick={()=>manual?recorder.current?.stop():void start()}>{manual?<Square size={16}/>:<Mic size={16}/>} {manual?'Stop recording':'Record voice reflection'}</button>
 {processing&&<p role="status">Combining your recording…</p>}{error&&<p className="negative" role="alert">{error}</p>}
 {failed&&<div className="actions"><button className="button" type="button" disabled={processing} onClick={()=>void append(pending.current)}>Retry combining recording</button><button className="text-button" type="button" disabled={processing} onClick={()=>{pending.current=null;setFailed(false);setError('');}}>Discard latest uncombined segment</button></div>}
 {combinedFile&&<p role="status">One combined recording · {(combinedFile.size/1024/1024).toFixed(1)} MB</p>}
 <label className="field"><span>Or attach a prepared voice recording</span><input type="file" accept=".mp3,.m4a,.wav,.ogg,.webm,.mp4" disabled={disabled||manual||speech||locked||!uploadsEnabled} onChange={e=>{onAttachment(Array.from(e.target.files||[]));e.target.value='';}}/></label></div></>;
}
