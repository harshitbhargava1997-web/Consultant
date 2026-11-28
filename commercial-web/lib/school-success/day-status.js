// Day status in the Planner (owner decision, 28 November 2026): after choosing the lesson date the teacher marks
// what the day is: Present (the default, never stored unless it replaces another status), Half day, Absent, School
// examination, or a holiday or vacation (summer, winter, festival, national holiday). Exams and vacations cover a
// From–To range. Principals, coordinators and the School Success team can correct any teacher's day.
//
// Stored as append-only success_entries rows (kind "day-status"); no new table or column. Nothing is overwritten:
// for each date the latest row that covers it is the day's status, and the earlier rows (the teacher's own mark
// before a principal's correction) stay as history.
//   id      day-status-<from>-<to>-<teacher hash>-<request id>   (the dates first, so a read can be narrowed by id)
//   owner   the sign-in that saved it (server only; never returned)
//   payload {teacher, from, to, status, half?, exam?, name?, note?, by:{name, role}}
import {z} from 'zod';

export const DAY_STATUS_KIND='day-status';
export const MAX_RANGE_DAYS=92;
export const DAY_STATUSES=['present','half-day','absent','exam','summer','winter','festival','national'];
export const SINGLE_DAY=new Set(['present','half-day','absent']);
export const RANGE_STATUSES=new Set(['exam','summer','winter','festival','national']);
export const EXAM_TYPES=['unit','periodic','term','half-yearly','annual'];
export const dayStatusNames={present:['Present','उपस्थित'],'half-day':['Half day','आधा दिन'],absent:['Absent','अनुपस्थित'],exam:['School examination','विद्यालय परीक्षा'],summer:['Summer vacation','ग्रीष्मावकाश'],winter:['Winter vacation','शीतावकाश'],festival:['Festival vacation','त्योहार अवकाश'],national:['National holiday','राष्ट्रीय अवकाश']};
export const examNames={unit:['Unit test','इकाई परीक्षा'],periodic:['Periodic test','आवधिक परीक्षा'],term:['Term exam','सत्र परीक्षा'],'half-yearly':['Half-yearly','अर्धवार्षिक'],annual:['Annual','वार्षिक']};
export const halfNames={first:['First half','पहली पाली'],second:['Second half','दूसरी पाली']};
// Days that need no lesson plan. On a half day only the half the teacher was in school is planned.
export const NO_PLAN=new Set(['absent','exam','summer','winter','festival','national']);

const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d=>!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d,'Invalid date');
const text=max=>z.string().trim().max(max).optional().default('');
export const dayStatusInput=z.object({
 from:day,to:day,status:z.enum(DAY_STATUSES),
 half:z.enum(['first','second']).optional(),
 exam:z.enum(EXAM_TYPES).optional(),
 name:text(60),note:text(200),
 requestId:z.string().uuid()
}).strict().superRefine((v,ctx)=>{
 if(v.from>v.to)ctx.addIssue({code:'custom',message:'The From date must be before the To date.'});
 if(SINGLE_DAY.has(v.status)&&v.from!==v.to)ctx.addIssue({code:'custom',message:'Present, Half day and Absent are marked one day at a time.'});
 if(daysBetween(v.from,v.to)+1>MAX_RANGE_DAYS)ctx.addIssue({code:'custom',message:'Choose at most '+MAX_RANGE_DAYS+' days.'});
 if(v.status==='half-day'&&!v.half)ctx.addIssue({code:'custom',message:'Choose which half you were in school.'});
 if(v.status==='exam'&&!v.exam)ctx.addIssue({code:'custom',message:'Choose the examination.'});
});
// Only the fields that belong to the chosen status are kept.
export function cleanStatus(v){
 return {from:v.from,to:v.to,status:v.status,...(v.status==='half-day'?{half:v.half}:{}),...(v.status==='exam'?{exam:v.exam}:{}),
  ...(['festival','national','exam'].includes(v.status)&&v.name?{name:v.name}:{}),...(v.note?{note:v.note}:{})};
}

export const addDays=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const daysBetween=(a,b)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
// Short, stable text hash (not a security control) keeping a teacher's rows apart within the id.
export function teacherTag(school,teacher){
 const s=school+'\0'+teacher;let a=0x811c9dc5,b=0x01000193^0x5bd1e995;
 for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);a=Math.imul(a^c,0x01000193);b=Math.imul(b^c,0x5bd1e995)^(b>>>13);}
 return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
export const dayStatusId=(school,teacher,from,to,requestId)=>DAY_STATUS_KIND+'-'+from+'-'+to+'-'+teacherTag(school,teacher)+'-'+requestId;
const idPattern=/^day-status-(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})-([0-9a-f]{16})-/;

// One stored row as a status, or null when it does not check out.
export function parseRow(row){
 let p;try{p=JSON.parse(row.payload);}catch{return null;}
 const m=idPattern.exec(row.id||'');if(!m||!p||typeof p.teacher!=='string')return null;
 const v=dayStatusInput.safeParse({...cleanStatus({...p,note:p.note||'',name:p.name||''}),requestId:'00000000-0000-4000-8000-000000000000'});
 if(!v.success||m[1]!==p.from||m[2]!==p.to||m[3]!==teacherTag(row.school,p.teacher))return null;
 const by=p.by&&typeof p.by.name==='string'?{name:p.by.name.slice(0,160),role:String(p.by.role||'').slice(0,60)}:{name:'',role:''};
 return {id:row.id,school:row.school,teacher:p.teacher,...cleanStatus(v.data),by,byTeacher:by.role==='Teacher',at:row.updated};
}
const newer=(a,b)=>String(a.at).localeCompare(String(b.at))||a.id.localeCompare(b.id);
// The status of every teacher-day in [from, to] that has one. A day without a stored status is Present.
// Returns one entry per teacher and date: the latest status, whether a school leader changed it, and the teacher's
// own latest mark when it differs.
export function resolveDays(statuses,from,to){
 const out=new Map();
 for(const s of [...statuses].sort(newer)){
  const start=s.from>from?s.from:from,end=s.to<to?s.to:to;
  for(let d=start;d<=end;d=addDays(d,1)){
   const k=s.teacher+'|'+d,prev=out.get(k);
   out.set(k,{...s,date:d,teacherMark:s.byTeacher?null:(prev?.byTeacher?strip(prev):prev?.teacherMark||null)});
  }
 }
 return [...out.values()].map(({id,school,byTeacher,...rest})=>({...rest,changedByLeader:!byTeacher}))
  .sort((a,b)=>a.teacher.localeCompare(b.teacher)||a.date.localeCompare(b.date));
}
const strip=s=>({status:s.status,from:s.from,to:s.to,...(s.half?{half:s.half}:{}),...(s.exam?{exam:s.exam}:{}),...(s.name?{name:s.name}:{}),...(s.note?{note:s.note}:{}),at:s.at});

// "Winter vacation", "School examination · Half-yearly", "Half day · First half", "Festival vacation · Diwali".
export function statusLabel(s,language='en'){
 if(!s)return '';const i=language==='hi'?1:0,parts=[dayStatusNames[s.status]?.[i]||s.status];
 if(s.status==='half-day'&&s.half)parts.push(halfNames[s.half][i]);
 if(s.status==='exam'&&s.exam)parts.push(examNames[s.exam][i]);
 if(s.name)parts.push(s.name);
 return parts.join(' · ');
}
// Short tag for a week grid cell: "Absent", "Half day · 1st", "Exam · Half-yearly", "Festival".
export function shortLabel(s){
 if(!s)return '';
 if(s.status==='half-day')return 'Half day'+(s.half?' · '+(s.half==='first'?'1st':'2nd'):'');
 if(s.status==='exam')return 'Exam'+(s.exam?' · '+examNames[s.exam][0]:'');
 return {present:'Present',absent:'Absent',summer:'Summer vacation',winter:'Winter vacation',festival:s.name||'Festival vacation',national:s.name||'National holiday'}[s.status]||s.status;
}

// Storage. `request` is the server's database request helper (service role); `all` its paged reader.
export async function readDayStatuses({school,teacher='',from,to},all){
 // A stored range starts at most MAX_RANGE_DAYS before `from`; the id starts with its From date.
 const low=DAY_STATUS_KIND+'-'+addDays(from,-MAX_RANGE_DAYS),high=DAY_STATUS_KIND+'-'+to+'-~';
 const rows=await all('success_entries','id',{school:'eq.'+school,kind:'eq.'+DAY_STATUS_KIND,select:'id,school,payload,updated',and:'(id.gte.'+low+',id.lte.'+high+')'});
 const tag=teacher?teacherTag(school,teacher):'';
 const list=rows.filter(r=>r.school===school&&(!tag||r.id.includes('-'+tag+'-'))).map(parseRow).filter(s=>s&&(!teacher||s.teacher===teacher)&&s.from<=to&&s.to>=from);
 return resolveDays(list,from,to);
}
export async function appendDayStatus({school,teacher,owner,by,input},request){
 const v=dayStatusInput.parse(input),status=cleanStatus(v);
 const id=dayStatusId(school,teacher,v.from,v.to,v.requestId),updated=new Date().toISOString();
 const payload=JSON.stringify({teacher,...status,by});
 const row={id,school,kind:DAY_STATUS_KIND,owner,payload,updated};
 const inserted=await request('/rest/v1/success_entries?on_conflict=id&select=id','POST',row,{Prefer:'resolution=ignore-duplicates,return=representation'});
 if(inserted?.length)return {saved:true};
 // A retry of the same save is fine; a different save under the same request id is not.
 const [existing]=await request('/rest/v1/success_entries?'+new URLSearchParams({id:'eq.'+id,school:'eq.'+school,kind:'eq.'+DAY_STATUS_KIND,select:'owner,payload'}));
 let same=false;try{const p=JSON.parse(existing?.payload||'{}');same=existing?.owner===owner&&JSON.stringify({...p,by:null})===JSON.stringify({...JSON.parse(payload),by:null});}catch{}
 if(same)return {saved:true,alreadySaved:true};
 throw Error('409:This day was already saved differently. Please try again.');
}
