import {formatReflection,subjectsFor} from './teacher-flow.js';
import {PERIOD_TYPE_HEADING,periodTypeNames,periodTypeHeadings} from './period-types.js';
import {periodNumberText} from './period-number.js';
// One-page lesson planning. Every field is visible at once; its guiding question and sentence starter are shown
// as faded placeholder text inside the box (never inserted into the answer).
// Entry: [key, [English title, Hindi title], [English placeholder, Hindi placeholder], max length, required]
// Order follows the lesson: outcome, materials, I do, We do, You do, review, then classwork and homework.
// No planning field is required (owner decision); only class, subject and topic identify the lesson. The screen never
// labels a field optional.
export const guide = [
 ['objective',['Learning outcome','सीखने का प्रतिफल'],['By the end of this class period, students will be able to …','इस कालांश के अंत तक बच्चे … कर पाएँगे।'],650,false],
 ['materials',['Teaching-learning materials','शिक्षण-अधिगम सामग्री'],['I will use … to help students … Before class, I will prepare …','बच्चों को … सिखाने के लिए मैं … का उपयोग करूँगा/करूँगी। कक्षा से पहले मैं … तैयार करूँगा/करूँगी।'],650,false],
 ['teacher',['Teacher activity (I do)','शिक्षक की गतिविधि (मैं करूँ)'],['I will begin by … I will demonstrate … using … I will guide students to …','मैं … से शुरुआत करूँगा/करूँगी। … की मदद से … करके दिखाऊँगा/दिखाऊँगी। बच्चों को … करने में मार्गदर्शन दूँगा/दूँगी।'],650,false],
 ['student',['Student activity and participation (We do)','बच्चों की गतिविधि और भागीदारी (हम करें)'],['Together we will … Students will work … to … Each child will … They will share by …','हम मिलकर … करेंगे। बच्चे … में काम करके … करेंगे। हर बच्चा … करेगा। बच्चे अपनी सीख … से साझा करेंगे।'],650,false],
 ['practice',['Practice and apply (You do)','अभ्यास और उपयोग (आप करें)'],['On their own, students will practise … by …','बच्चे स्वयं … करके … का अभ्यास करेंगे।'],650,false],
 ['review',['Check learning and next steps','सीख की जाँच और आगे के कदम'],['I will check understanding by … Children needing support will … Those ready for a challenge will …','मैं … से समझ की जाँच करूँगा/करूँगी। सहायता चाहने वाले बच्चे … करेंगे। तैयार बच्चों को … की चुनौती दूँगा/दूँगी।'],650,false],
 ['classwork',['Classwork and homework','कक्षा कार्य और गृहकार्य'],['Classwork: … (book / workbook pages). Homework: …','कक्षा कार्य: … (पुस्तक / कार्यपुस्तिका के पृष्ठ)। गृहकार्य: …'],500,false]
];
export const requiredKeys = guide.filter(g=>g[4]).map(g=>g[0]);
// Remedial and substitute periods ask much less (owner decision, 28 November 2026). Same entry shape as guide.
export const periodTypeGuide = {
 remedial:[
  ['children',['How many children?','कितने बच्चे?'],['A number or a group name — no children’s names','संख्या या समूह का नाम — बच्चों के नाम नहीं'],80,false],
  ['support',['What will you do?','आप क्या करेंगे?'],['I will help them … by … I will check their progress by …','मैं … करके उनकी मदद करूँगा/करूँगी। प्रगति की जाँच … से करूँगा/करूँगी।'],650,false]],
 substitute:[
  ['done',['What was done in this class','इस कक्षा में क्या किया गया'],['Example: Read the story aloud; children answered 5 questions.','उदाहरण: कहानी पढ़ी; बच्चों ने 5 प्रश्नों के उत्तर लिखे।'],500,false]]
};
export const guideFor = type => periodTypeGuide[type] || guide;
export const PLAN_TYPES = ['daily','weekly'];
export const MAX_DAILY_PERIODS = 10, MAX_WEEKLY_DAYS = 6;

export function planningParts(p){
 const a=p.answers||{},hi=p.answerLanguage==='hi';
 // Drafts from the earlier form kept homework separately; it now belongs to classwork and homework.
 const classwork=(a.classwork??a.homework??'').trim();
 // Saved under the existing six headings, so lesson PDFs and records read it unchanged. Classwork and homework
 // come after the learning check, inside the review section.
 const {classwork:_c,homework:_h,...rest}=a;
 return {...rest,practice:a.practice?.trim()||'',review:[a.review?.trim()||'',classwork?(hi?'कक्षा कार्य और गृहकार्य:\n':'Classwork and homework:\n')+classwork:''].filter(Boolean).join('\n')};
}
// A remedial or substitute period is saved with a "Period type" heading and its own short answers.
// The real period number (1–8), when chosen, comes first (owner decision, 28 November 2026).
export function planText(p){
 const number=periodNumberText(Number(p.periodNumber)),body=planBody(p);
 return number?number+(body?'\n\n'+body:''):body;
}
function planBody(p){
 const type=p.periodType||'regular';
 if(type==='regular')return formatReflection(planningParts(p));
 const a=p.answers||{};
 return [PERIOD_TYPE_HEADING+'\n'+periodTypeNames[type],...periodTypeGuide[type].filter(([key])=>a[key]?.trim()).map(([key])=>periodTypeHeadings[key]+'\n'+a[key].trim())].join('\n\n');
}
export function withPlanning(p,changes){const n={...p,...changes},regular=(n.periodType||'regular')==='regular';return {...n,reflection:planText(n),materials:regular?n.answers?.materials||'':''};}
// First incomplete part of one block: 'details', 'date', a guide key, or 'length'. Empty string when complete.
export function planningIssue(p,{needsDate=false}={}){
 // The subject must be one offered for the class (an older draft may hold "All Subjects Together", or a primary
 // subject after the class was changed to Nursery); it is then chosen again.
 if(!p.grade||!p.subject||!subjectsFor(p.grade).includes(p.subject)||!p.topic?.trim())return 'details';
 if(needsDate&&!/^\d{4}-\d{2}-\d{2}$/.test(p.date||''))return 'date';
 const a=p.answers||{};
 for(const key of requiredKeys)if(!a[key]?.trim())return key;
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
 const strip=({answers,answerLanguage,submissionId,date:_d,savedReceipt,periodNumber,autoNumber,...rest})=>rest;
 // The saved plan text carries the chosen period number; on a weekly plan a day without its own number takes the
 // plan's "Usually period".
 const numbered=(b,n)=>({...b,reflection:planText({...b,periodNumber:n})});
 if(type==='weekly'){
  return blocks.map(b=>({id:b.submissionId,school,teacher,date:b.date,periods:[strip(numbered({...b,grade:shared.grade,section:shared.section,subject:shared.subject},b.periodNumber||shared.periodNumber))],block:b.id}));
 }
 return [{id:shared.submissionId,school,teacher,date,periods:blocks.map(b=>strip(numbered(b,b.periodNumber))),block:null}];
}
// Problems that apply across blocks (shown at the top of the form).
export function planProblem({type,date,shared,blocks}){
 if(!blocks.length)return 'empty';
 if(type==='daily'){if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))return 'date';if(blocks.length>MAX_DAILY_PERIODS)return 'count';return '';}
 if(!shared.grade||!shared.subject||!subjectsFor(shared.grade).includes(shared.subject))return 'subject';
 if(blocks.length>MAX_WEEKLY_DAYS)return 'count';
 const dates=blocks.map(b=>b.date);
 if(dates.some(d=>!/^\d{4}-\d{2}-\d{2}$/.test(d||'')))return 'date';
 if(new Set(dates).size!==dates.length)return 'duplicate-date';
 return '';
}
