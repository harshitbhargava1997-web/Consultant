import {z} from 'zod';

export const reviewLevels = {A:'Strong practice', B:'Developing', C:'Needs support'};
export const reviewCriteria = {
 planning: {label:'Planning', question:'Do the activities and the check for understanding match the learning outcome?',
  A:'The outcome, activity and learning check align.', B:'The outcome is clear. The activity or learning check needs a closer match.', C:'The plan needs a clear outcome and a way to check it.'},
 execution: {label:'Execution', question:'What do the classroom activity and student work show about learning?',
  A:'The evidence shows students practising and demonstrating the intended learning.', B:'The evidence shows participation and some progress toward the outcome.', C:'The evidence points to a learning gap that needs follow-up.'}
};
export const lessonRecordId = z.string().regex(/^\d{1,19}$/);
const criterion = z.object({level:z.enum(['A','B','C']), note:z.string().trim().min(1,'Add a short feedback note.').max(500)}).strict();
export const rubricReview = z.object({planning:criterion.optional(), execution:criterion.optional()}).strict()
 .refine(r=>r.planning || r.execution,'Review planning, execution or both.');
// Weekly review (owner decision, 26 November 2026): one teacher, one class and subject, one week (Monday–Sunday).
// Planning and Execution ratings as for a lesson, plus a focus for next week. Kept alongside lesson reviews.
export const weeklyReview = z.object({planning:criterion.optional(), execution:criterion.optional(), focus:z.string().trim().min(1,'Add a focus for next week.').max(500)}).strict()
 .refine(r=>r.planning || r.execution,'Review planning, execution or both.');
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Choose a valid date');
const text = z.string().trim().max(200);
export const weeklyRequest = z.discriminatedUnion('action',[
 z.object({action:z.literal('week'),school:text.min(1),teacher:text.min(1),week:day}).strict(),
 z.object({action:z.literal('overview'),school:text.min(1),week:day}).strict(),
 z.object({action:z.literal('save'),school:text.min(1),teacher:text.min(1),week:day,grade:text.min(1),section:z.string().trim().max(40),subject:text.min(1),requestId:z.string().uuid(),review:weeklyReview}).strict()
]);
const weekDay=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',timeZone:'UTC'}),weekYear=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
export const weekLabel=(from,to)=>weekDay.format(new Date(from+'T00:00:00Z'))+' – '+weekYear.format(new Date(to+'T00:00:00Z'));
export const weekClass=w=>[[w.grade,w.section&&w.section!=='Not Applicable'?w.section:''].filter(Boolean).join(' '),w.subject].filter(Boolean).join(' · ');
// The text the teacher and the reports show for a weekly review.
export function weeklyText(review,weekly){
 return ['Weekly review · '+weekLabel(weekly.weekStart,weekly.weekEnd)+' · '+weekClass(weekly)+' ('+weekly.periods+(weekly.periods===1?' period)':' periods)'),
  reviewText(review),'Focus for next week\n'+review.focus].filter(Boolean).join('\n\n');
}
export const reviewRequest = z.discriminatedUnion('action',[
 z.object({action:z.literal('open'),recordId:lessonRecordId}).strict(),
 z.object({action:z.literal('save'),recordId:lessonRecordId,requestId:z.string().uuid(),review:rubricReview}).strict()
]);

// Who gave a review, for display: "Meera Rao, Principal". Reviews saved before names were recorded only carry the
// reviewer's sign-in: mobile-number sign-ins are school leaders, others the School Success team.
// The reviewer's display name, or '' when the account has none (its sign-in email or mobile is never shown).
export const reviewerName=name=>{const n=String(name||'').trim();return !n||n.includes('@')||/^\+?\d[\d\s-]{6,}$/.test(n)?'':n.slice(0,160);};
export function reviewerLabel(by){
 if(!by)return '';
 // A sign-in address is never shown as a name (accounts without a display name; also reviews saved before this).
 const name=reviewerName(by.name);
 if(name)return name+(by.role?', '+by.role:'');
 return by.role||'';
}
export function reviewerFromSignIn(signIn){
 const s=String(signIn||'');if(!s)return null;
 return {name:'',role:/@mobile\.schoolsuccess\.in$/i.test(s)?'School leader':'School Success team'};
}
export function reviewerRole(a){return a?.isSuperAdmin?'Super Admin':a?.leader?(a.title||'School leader'):'Consultant';}
export function reviewText(review) {
 return Object.entries(reviewCriteria).filter(([key])=>review[key]).map(([key,criterion])=>{
  const {level,note}=review[key];
  return criterion.label+' · '+level+' ('+reviewLevels[level]+')\n'+note;
 }).join('\n\n');
}
const dateLabel=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
export function feedbackText(history) {
 if(history.length===1)return history[0].text;
 return history.map(({text,date})=>{
  const stamp=Date.parse(date);
  return (Number.isFinite(stamp)?dateLabel.format(stamp)+'\n':'')+text;
 }).join('\n\n');
}
// The same text with "— Name, Role" after each review whose reviewer is known.
export function feedbackTextWithReviewer(history) {
 return feedbackText(history.map(h=>{const who=reviewerLabel(h.by);return who?{...h,text:h.text+'\n— '+who}:h;}));
}
