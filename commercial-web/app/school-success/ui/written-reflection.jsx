'use client';
import {useState} from 'react';
import {formatClosure,closurePrompts} from '@/lib/closure-reflection';
// After-class reflection: both questions visible at once; the sentence starter is faded text inside each box.
export const closureStarters={
 en:['Students demonstrated … through … The activity that helped was … Some students found … difficult.','The students/group needing support are … They need help with … I will … and check progress by …'],
 hi:['बच्चों ने … करके … की समझ दिखाई। … गतिविधि उपयोगी रही। कुछ बच्चों को … में कठिनाई हुई।','… बच्चों/समूह को … में मदद चाहिए। मैं … करूँगा/करूँगी और … से प्रगति जाँचूँगा/जाँचूँगी।']
};
export default function WrittenReflection({language,onChange,disabled}){
 const [parts,setParts]=useState({});const hi=language==='hi';
 const labels=hi?['क्या बच्चों ने सीखने का प्रतिफल प्राप्त किया? क्या प्रमाण मिले और क्या अच्छा रहा?','किन बच्चों को मदद चाहिए? कौन-सी कठिनाई है और आप आगे क्या करेंगे?']:closurePrompts.map(p=>p[1]);
 const starters=closureStarters[hi?'hi':'en'];
 function change(k,v){const next={...parts,[k]:v};setParts(next);onChange(formatClosure(next));}
 return <div className="teacher-evidence"><h3>{hi?'कक्षा के बाद का चिंतन':'After-class reflection'}</h3><p>{hi?'टाइप करें या कीबोर्ड के माइक से बोलकर लिखें।':'Type, or use your keyboard microphone to speak.'}</p>{closurePrompts.map(([key],i)=><label className="field" key={key}><span>{labels[i]}</span><textarea rows={4} maxLength={800} disabled={disabled} value={parts[key]||''} placeholder={starters[i]} onChange={e=>change(key,e.target.value)}/></label>)}</div>;
}
