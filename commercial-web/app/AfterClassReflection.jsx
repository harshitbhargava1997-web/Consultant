'use client';
import ReflectionEditor from './ReflectionEditor';
import {closurePrompts,formatClosure} from '@/lib/closure-reflection';
// `note` lets School Success describe its text storage; native Vision keeps the default PDF wording.
export default function AfterClassReflection({note,...props}){
 return <><p className="hint">{note||'Complete these two reflections after teaching. Your text is saved as a dated reflection PDF with this evidence update. Audio is optional.'}</p><ReflectionEditor {...props} kind="closure" prompts={closurePrompts} format={formatClosure}/></>;
}
