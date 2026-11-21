'use client';
import {useState} from 'react';
import {formatClosure,closurePrompts} from '@/lib/closure-reflection';
export default function WrittenReflection({language,onChange,disabled}){
 const [parts,setParts]=useState({});const hi=language==='hi';
 const labels=hi?['क्या बच्चों ने सीखने का प्रतिफल प्राप्त किया? क्या प्रमाण मिले और क्या अच्छा रहा?','किन बच्चों को मदद चाहिए? कौन-सी कठिनाई है और आप आगे क्या करेंगे?']:closurePrompts.map(p=>p[1]);
 const starters=hi?['बच्चों ने ___ करके ___ की समझ दिखाई। ___ गतिविधि उपयोगी रही। कुछ बच्चों को ___ में कठिनाई हुई।','___ बच्चों/समूह को ___ में मदद चाहिए। मैं ___ करूँगा/करूँगी और ___ से प्रगति जाँचूँगा/जाँचूँगी।']:['Students demonstrated ___ through ___ . The activity that helped was ___ . Some students found ___ difficult.','The students/group needing support are ___ . They need help with ___ . I will ___ and check progress by ___ .'];
 function change(k,v){const next={...parts,[k]:v};setParts(next);onChange(formatClosure(next));}
 return <div className="teacher-evidence"><h3>{hi?'कक्षा के बाद का चिंतन':'After-class reflection'}</h3><p>{hi?'टाइप करें या कीबोर्ड के माइक से बोलकर लिखें। वाक्य के खाली स्थान पूरे करें।':'Type or use your keyboard microphone. Complete any starter blanks.'}</p>{closurePrompts.map(([key],i)=><div key={key}><label className="field"><span>{labels[i]}</span><textarea rows={4} maxLength={800} disabled={disabled} value={parts[key]||''} onChange={e=>change(key,e.target.value)}/></label><button className="button" type="button" disabled={disabled||!!parts[key]} onClick={()=>change(key,starters[i])}>{hi?'वाक्य की शुरुआत लें':'Use sentence starter'}</button></div>)}</div>;
}
