export const closurePrompts=[['achievement','Did students achieve the learning outcome, and what went well in your class?'],['nextStep','Which students need support, what learning gaps do they have, and what will you do next to support them?']];
export const CLOSURE_RECORDING_SLOT='after-class-recording';
export function closureRecordingAttachment(files,file,id){
 const existing=files.find(f=>f.slot===CLOSURE_RECORDING_SLOT);
 return [...files.filter(f=>f.slot!==CLOSURE_RECORDING_SLOT),{id:existing?.id||id,slot:CLOSURE_RECORDING_SLOT,category:'closure',file}];
}
export const formatClosure=parts=>closurePrompts.filter(([key])=>parts[key]?.trim()).map(([key,label])=>label+'\n'+parts[key].trim()).join('\n\n');
// Store closure PDFs and recordings in the existing append-only classroom-evidence
// update. This preserves lesson identity and existing download/report permissions.
export async function closureFiles({periods,reflections,school,teacher,date,conductedOn,updateId,vision=false}){
 const filled=periods.filter(p=>reflections[p.id]?.trim());if(!filled.length)return [];
 const {preparationPdf}=vision?await import('./teacher-portal/preparation-pdf'):await import('./school-success/preparation-pdf');
 const result=[];
 for(const [index,p] of periods.entries()){
  if(!reflections[p.id]?.trim())continue;
  const bytes=await preparationPdf({...p,school,teacher,date,heading:'AFTER-CLASS REFLECTION',conductedOn,reflection:reflections[p.id],materials:'',audioUrls:[]});
  result.push({id:crypto.randomUUID(),periodId:p.id,category:'closure',file:new File([bytes],`After-class-reflection-${conductedOn}-period-${index+1}-${updateId.slice(0,8)}.pdf`,{type:'application/pdf'})});
 }
 return result;
}
