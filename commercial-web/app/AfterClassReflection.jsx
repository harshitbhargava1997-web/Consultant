'use client';
import VoiceReflection from './school-success/ui/voice-reflection';
import {closurePrompts,formatClosure} from '@/lib/closure-reflection';
export default function AfterClassReflection({disabled,onChange,onRecording,onFile}){
 return <VoiceReflection title="After-class reflection" description="Share what happened after teaching. Complete whichever prompts help describe the lesson. Your text is saved as a dated reflection PDF with this evidence update; recordings are retained separately." prompts={closurePrompts} format={formatClosure} disabled={disabled} onChange={onChange} onRecording={onRecording} onFile={onFile}/>;
}
