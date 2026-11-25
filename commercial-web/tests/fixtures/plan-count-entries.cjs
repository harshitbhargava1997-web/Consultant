// Test lesson records for lesson-plan counting (Teacher 360° and School 360°). Synthetic names and links only.
const M='https://media.example.test/schools/Sunrise/teachers/Asha';
const P=n=>`${String(n).padStart(8,'a')}-aaaa-4aaa-8aaa-${String(n).padStart(12,'a')}`;
const gen=(sub,per)=>({key:'Lesson_Plan_Picture:'+per,column:'Lesson_Plan_Picture',url:`${M}/2026-11-03/submission_${sub}/implementation_${per}/lesson_plan/${per}.pdf`,name:'Lesson Plan Picture',category:'Lesson Plan Picture'});
const photo=(id,n)=>({key:'Lesson_Plan_Picture:'+id+':'+n,column:'Lesson_Plan_Picture',url:`${M}/legacy/plan-photo-${id}-${n}.jpg`,name:'Lesson Plan Picture',category:'Lesson Plan Picture'});
const act=(id)=>({key:'Video_Evidence_1:'+id,column:'Video_Evidence_1',url:`${M}/x/activity/${id}.jpg`,name:'Video Evidence 1',category:'Video Evidence 1'});
const base=(id,teacher,date,extra={})=>({kind:'submission',id,recordId:id.split(':')[0],school:'Sunrise Public School',teacher,date,grade:'Grade 2',section:'A',subject:'English',topic:'Lesson '+id,reflection:'',materials:'',files:[],review:'',...extra});
const prep=(rec,teacher,date,files,reflection='Objective: read CVC words')=>base(rec+':preparation',teacher,date,{stage:'preparation_saved',feedStage:'Lesson preparation',plannedDate:date,reflection,files});
module.exports=function entries({newLessons=true}={}){
 const s1=P(1),s2=P(2),s3=P(3);
 const rows=[
  // Older lessons saved with the generated preparation PDF (one per class period)
  prep('101','Asha Verma','2026-11-03',[gen(s1,P(11))]),
  prep('102','Asha Verma','2026-11-03',[gen(s1,P(12))]),
  prep('103','Ravi Kumar','2026-11-04',[gen(s2,P(13))],''),                  // plan with no written text
  base('101:e1','Asha Verma','2026-11-05',{stage:'evidence_submitted',feedStage:'Classroom evidence',files:[act('a1')]}),
  // Previous portal: uploaded photos of handwritten plans (no lesson stage)
  base('201','Meena Shah','2026-11-06',{files:[photo('201',0),photo('201',1)]}),
  // A preparation that also had an uploaded plan document next to the generated PDF
  prep('104','Meena Shah','2026-11-07',[gen(s3,P(14)),photo('104',0)]),
  // Outside the period
  prep('105','Asha Verma','2026-10-20',[gen(P(5),P(15))]),
 ];
 // New lessons: saved without a PDF
 if(newLessons)rows.push(prep('301','Asha Verma','2026-11-10',[]),prep('302','Ravi Kumar','2026-11-11',[]),
  base('301:e1','Asha Verma','2026-11-12',{stage:'evidence_submitted',feedStage:'Classroom evidence',files:[act('n1')]}));
 return rows;
};
