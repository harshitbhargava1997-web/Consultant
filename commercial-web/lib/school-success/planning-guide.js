import {formatReflection} from './teacher-flow.js';
// One-page lesson planning. Every field is visible at once; its guiding question and sentence starter are shown
// as faded placeholder text inside the box (never inserted into the answer).
// Entry: [key, [English title, Hindi title], [English placeholder, Hindi placeholder], max length]
export const guide = [
 ['objective',['Learning outcome','सीखने का प्रतिफल'],['By the end of this class period, students will be able to …','इस कालांश के अंत तक बच्चे … कर पाएँगे।'],650],
 ['materials',['Teaching-learning materials','शिक्षण-अधिगम सामग्री'],['I will use … to help students … Before class, I will prepare …','बच्चों को … सिखाने के लिए मैं … का उपयोग करूँगा/करूँगी। कक्षा से पहले मैं … तैयार करूँगा/करूँगी।'],650],
 ['teacher',['Teacher activities','शिक्षक की गतिविधियाँ'],['I will begin by … I will demonstrate … using … I will guide students to …','मैं … से शुरुआत करूँगा/करूँगी। … की मदद से … करके दिखाऊँगा/दिखाऊँगी। बच्चों को … करने में मार्गदर्शन दूँगा/दूँगी।'],650],
 ['student',['Student activity and participation','बच्चों की गतिविधि और भागीदारी'],['Students will work … to … Each child will … They will share by …','बच्चे … में काम करके … करेंगे। हर बच्चा … करेगा। बच्चे अपनी सीख … से साझा करेंगे।'],650],
 ['practice',['Classwork and practice','कक्षा कार्य और अभ्यास'],['Students will practise … by completing … (book / workbook pages)','बच्चे … पूरा करके … का अभ्यास करेंगे। (पुस्तक / कार्यपुस्तिका के पृष्ठ)'],650],
 ['review',['Check learning and next steps','सीख की जाँच और आगे के कदम'],['I will check understanding by … Children needing support will … Those ready for a challenge will …','मैं … से समझ की जाँच करूँगा/करूँगी। सहायता चाहने वाले बच्चे … करेंगे। तैयार बच्चों को … की चुनौती दूँगा/दूँगी।'],650]
];
// Optional field, saved with classwork under the same heading.
export const homework = ['homework',['Homework (optional)','गृहकार्य (वैकल्पिक)'],['At home, students will … to practise …','घर पर बच्चे … का अभ्यास करने के लिए … करेंगे।'],300];
export const PLAN_TYPES = ['daily','weekly'];
export const MAX_DAILY_PERIODS = 10, MAX_WEEKLY_DAYS = 6;

export function planningParts(p){
 const a=p.answers||{},hi=p.answerLanguage==='hi';
 return {...a,practice:[a.practice?.trim()?(hi?'कक्षा कार्य:\n':'Classwork:\n')+a.practice.trim():'',a.homework?.trim()?(hi?'गृहकार्य:\n':'Homework:\n')+a.homework.trim():''].filter(Boolean).join('\n')};
}
export function withPlanning(p,changes){const n={...p,...changes};return {...n,reflection:formatReflection(planningParts(n)),materials:n.answers?.materials||''};}
// First incomplete part of one block: 'details', 'date', a guide key, or 'length'. Empty string when complete.
export function planningIssue(p,{needsDate=false}={}){
 if(!p.grade||!p.subject||!p.topic?.trim())return 'details';
 if(needsDate&&!/^\d{4}-\d{2}-\d{2}$/.test(p.date||''))return 'date';
 const a=p.answers||{};
 for(const [key] of guide)if(!a[key]?.trim())return key;
 if((p.reflection||'').length>5000)return 'length';
 return '';
}
// Calendar helpers on plain YYYY-MM-DD strings (no time zone shifts).
const asDate=s=>new Date(s+'T00:00:00Z'),asText=d=>d.toISOString().slice(0,10);
export function addDays(day,n){const d=asDate(day);d.setUTCDate(d.getUTCDate()+n);return asText(d);}
export const isSunday=day=>asDate(day).getUTCDay()===0;
// The next school day after `day` (Monday to Saturday).
export function nextSchoolDay(day){let d=addDays(day,1);while(isSunday(d))d=addDays(d,1);return d;}
// `count` school days starting at `start` (itself moved forward if it is a Sunday).
export function schoolDays(start,count){const out=[];let d=start;while(isSunday(d))d=addDays(d,1);while(out.length<count){out.push(d);d=nextSchoolDay(d);}return out;}

// Turns the form into the submissions saved by the existing preparation workflow. A daily plan is one submission
// (one date, several periods). A weekly subject plan is one submission per day (one period each), so every saved
// lesson keeps its own planned date and existing records, reports and evidence work unchanged.
export function planSubmissions({type,date,shared,blocks,school,teacher}){
 const strip=({answers,answerLanguage,submissionId,date:_d,savedReceipt,...rest})=>rest;
 if(type==='weekly'){
  return blocks.map(b=>({id:b.submissionId,school,teacher,date:b.date,periods:[strip({...b,grade:shared.grade,section:shared.section,subject:shared.subject})],block:b.id}));
 }
 return [{id:shared.submissionId,school,teacher,date,periods:blocks.map(strip),block:null}];
}
// Problems that apply across blocks (shown at the top of the form).
export function planProblem({type,date,shared,blocks}){
 if(!blocks.length)return 'empty';
 if(type==='daily'){if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return 'date';if(blocks.length>MAX_DAILY_PERIODS)return 'count';return '';}
 if(!shared.grade||!shared.subject)return 'subject';
 if(blocks.length>MAX_WEEKLY_DAYS)return 'count';
 const dates=blocks.map(b=>b.date);
 if(dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d||'')))return 'date';
 if(new Set(dates).size!==dates.length)return 'duplicate-date';
 return '';
}
