export const closurePrompts=[['achievement','What did students learn or achieve?'],['wentWell','What went well in the classroom?'],['nextStep','Who needs more support, and what will I do next?']];
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
