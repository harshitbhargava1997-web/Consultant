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
export const reviewRequest = z.discriminatedUnion('action',[
 z.object({action:z.literal('open'),recordId:lessonRecordId}).strict(),
 z.object({action:z.literal('save'),recordId:lessonRecordId,requestId:z.string().uuid(),review:rubricReview}).strict()
]);

// Who gave a review, for display: "Meera Rao, Principal". Reviews saved before names were recorded only carry the
// reviewer's sign-in: mobile-number sign-ins are school leaders, others the School Success team.
export function reviewerLabel(by){
 if(!by)return '';
 if(by.name)return by.name+(by.role?', '+by.role:'');
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
