'use client';
import ReflectionEditor from './ReflectionEditor';
import {closurePrompts,formatClosure} from '@/lib/closure-reflection';
export default function AfterClassReflection(props){
 return <><p className="hint">Complete these two reflections after teaching. Your text is saved as a dated reflection PDF with this evidence update. Audio is optional.</p><ReflectionEditor {...props} kind="closure" prompts={closurePrompts} format={formatClosure}/></>;
}
