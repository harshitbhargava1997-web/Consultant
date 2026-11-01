'use client';
import {useEffect,useRef,useState} from 'react';
import {Mic,Square} from 'lucide-react';
import {attachSpeechSession,speechText,speechErrorMessage} from '@/lib/school-success/speech-session';

export default function TopicDictation({value,onChange,onRecording,disabled}) {
 const [active,setActive]=useState(false),[finishing,setFinishing]=useState(false),[language,setLanguage]=useState('en-IN'),[status,setStatus]=useState(''),[error,setError]=useState('');
 const session=useRef(null),running=useRef(false),callbacks=useRef({onChange,onRecording}),current=useRef(value);
 callbacks.current={onChange,onRecording};current.current=value;
 useEffect(()=>()=>{running.current=false;session.current?.dispose();callbacks.current.onRecording(false);},[]);
 function end(){running.current=false;setActive(false);setFinishing(false);callbacks.current.onRecording(false);}
 async function stop(){setFinishing(true);await session.current?.finish();session.current?.dispose();end();setStatus('Review the topic before saving.');}
 function start(){
  setError('');const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!Recognition){setError('Dictation is unavailable here. Use your phone keyboard microphone or type the topic.');return;}
  session.current?.dispose();const r=new Recognition(),text=speechText(current.current||'');r.lang=language;r.continuous=true;r.interimResults=true;
  r.onresult=e=>{const result=text.read(e.results);callbacks.current.onChange(result.text.slice(0,1000));setStatus(result.interim||'Listening…');};
  running.current=true;setActive(true);callbacks.current.onRecording(true);
  session.current=attachSpeechSession(r,{active:()=>running.current,onCycle:()=>text.cycle(),onState:setStatus,onUnavailable:reason=>{setError(speechErrorMessage(reason));end();}});
  try{session.current.start();}catch(e){session.current?.dispose();end();setError(e.message);}
 }
 return <div className="teacher-evidence"><div className="actions"><label className="field">Topic speaking language<select value={language} disabled={active||disabled} onChange={e=>setLanguage(e.target.value)}><option value="en-IN">English (India)</option><option value="hi-IN">Hindi</option></select></label><button type="button" className="button" disabled={finishing||disabled&&!active} onClick={()=>active?void stop():start()}>{active?<Square size={16}/>:<Mic size={16}/>} {finishing?'Finishing…':active?'Stop topic dictation':'Dictate topic / lesson plan number'}</button></div>{status&&<p role="status">{status}</p>}{error&&<p role="alert">{error}</p>}<p className="hint">Dictation fills the topic field. Review and edit the text before saving.</p></div>;
}
