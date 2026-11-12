'use client';
import {useEffect,useRef,useState} from 'react';
import VoiceReflection from './school-success/ui/voice-reflection';
import {decodeRecording,pcmWave} from '@/lib/lesson-audio';

export default function LessonVoiceControls({disabled,uploadsEnabled=true,combinedFile,onChange,onFile,onRecording}){
 const callbacks=useRef({onFile,onRecording}),segments=useRef([]),pending=useRef(null),alive=useRef(true),working=useRef(false),hadFile=useRef(false);
 callbacks.current={onFile,onRecording};
 const [speech,setSpeech]=useState(false),[processing,setProcessing]=useState(false),[failed,setFailed]=useState(false),[error,setError]=useState('');
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;callbacks.current.onRecording(false);};},[]);
 useEffect(()=>{callbacks.current.onRecording(speech||processing||failed);},[speech,processing,failed]);
 useEffect(()=>{if(hadFile.current&&!combinedFile){segments.current=[];pending.current=null;setFailed(false);setError('');}hadFile.current=Boolean(combinedFile);},[combinedFile]);
 async function append(file){
  if(working.current)return;working.current=true;pending.current=file;setProcessing(true);setError('');
  try{const decoded=await decodeRecording(file);if(!alive.current)return;const next=[...segments.current,decoded];const combined=new File([pcmWave(next)],'Lesson-reflection.wav',{type:'audio/wav'});callbacks.current.onFile(combined);segments.current=next;pending.current=null;setFailed(false);}
  catch(e){if(alive.current){setFailed(true);setError('Your latest recording is retained in this draft but could not be combined: '+e.message);}}
  finally{working.current=false;if(alive.current)setProcessing(false);}
 }
 const locked=processing||failed;
 return <><VoiceReflection disabled={disabled||locked||!uploadsEnabled} onChange={onChange} onRecording={setSpeech} onFile={append}/>
 <p className="hint">Audio captured during voice planning is added to one combined recording for this class period and saved with your plan. You can also type your plan; no additional recording or upload is required.</p>
 {processing&&<p role="status">Combining planning audio…</p>}{error&&<p className="negative" role="alert">{error}</p>}
 {failed&&<div className="actions"><button className="button" type="button" disabled={processing} onClick={()=>void append(pending.current)}>Retry combining recording</button><button className="text-button" type="button" disabled={processing} onClick={()=>{pending.current=null;setFailed(false);setError('');}}>Discard latest uncombined segment</button></div>}
 {combinedFile&&<p role="status">One combined recording · {(combinedFile.size/1024/1024).toFixed(1)} MB</p>}
 </>;
}
