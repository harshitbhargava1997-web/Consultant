// Lesson plans are counted from the lesson records, not from files (owner decision, 25 November 2026).
// Lesson plans saved in the School Success portal are stored as text in the lesson record; from this date no PDF
// is made for them. Every report that counts or lists lesson plans uses evidenceFiles(row): a saved lesson-plan
// record with no plan file gets one "lesson plan" item. Records that already have a plan file (the PDF older
// plans were saved with, or an uploaded plan photo or document) are left exactly as they were, so older plans
// count exactly as before and each plan counts once.

// The PDF the portal used to generate for each class period: its file ID equals the period ID, so its storage
// key ends in implementation_<P>/lesson_plan/<P>.pdf. Uploaded plan files always have their own random IDs.
export function isGeneratedPreparationPdf(url){
 try{const m=/\/implementation_([0-9a-f-]{36})\/lesson_plan\/([0-9a-f-]{36})\.pdf$/i.exec(decodeURIComponent(new URL(url).pathname));return Boolean(m)&&m[1].toLowerCase()===m[2].toLowerCase();}catch{return false;}
}
// A saved lesson plan: the preparation entry of a School Success lesson record.
export const isLessonPlanRecord=row=>row?.kind==='submission'&&(row.stage==='preparation_saved'||row.feedStage==='Lesson preparation');
export const LESSON_PLAN_COLUMN='Lesson_Plan_Picture';
export function lessonPlanItem(row){
 const record=String(row.recordId||String(row.id||'').split(':')[0]);
 return {key:'lesson-plan:'+record,column:LESSON_PLAN_COLUMN,category:'Lesson plan',name:'Lesson plan',lessonPlan:true,recordId:record,url:''};
}
// The evidence of one report row, with a saved lesson plan that has no plan file as one item.
const planColumn=f=>(f.column||String(f.key||'').split(':')[0])===LESSON_PLAN_COLUMN||f.category==='lesson_plan';
export function evidenceFiles(row){
 const files=row?.files||[];
 return isLessonPlanRecord(row)&&!files.some(planColumn)?[lessonPlanItem(row),...files]:files;
}
// The key that identifies one evidence item when counting unique items.
export const evidenceKey=f=>f.lessonPlan?f.key:f.url;
