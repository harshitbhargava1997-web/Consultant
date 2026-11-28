import {withRequest,actor,checkOrigin,failure,assertSchool,database} from '@/lib/school-success/server';
import {env} from '@/lib/school-success/environment';
import {loadR2Config,r2UploadsConfigured,r2Request} from '@/lib/school-success/r2-evidence';
import {attachReflectionText,reflectionFetcher} from '@/lib/school-success/reflection-text';
import {weekLessonRows,saveWeeklyReview,publicBase} from '@/lib/school-success/live';
import {mapLive} from '@/lib/school-success/live-mapping';
import {weeklyRequest} from '@/lib/school-success/lesson-reviews';
import {buildLessonRecords} from '@/lib/school-success/lesson-records';
import {weekGroups,weekOverview} from '@/lib/school-success/weekly-review';
import {weekRange} from '@/lib/school-success/day-periods';
export const runtime='nodejs';
// Weekly review (owner decision, 26 November 2026). School Success staff, principals and coordinators, for their
// own schools:
//   week {school, teacher, week}                         → the teacher's lessons in that week by class and subject
//   overview {school, week}                              → every teacher's class-and-subject weeks, with review status
//   save {…, grade, section, subject, requestId, review} → one weekly review for that class and subject
async function withReflectionText(entries){
 const config=await loadR2Config(env,database());
 await attachReflectionText(entries,reflectionFetcher({base:publicBase(),get:(key,url)=>r2UploadsConfigured(config)?r2Request(config,key,'GET'):fetch(url,{signal:AbortSignal.timeout(8000)})}));
}
async function readWeek(school,teacher,week){
 const {from,to}=weekRange(week);
 const raw=await weekLessonRows({school,teacher,from,to});
 const {entries}=await mapLive({records:raw.records,reviews:raw.reviews,notes:raw.notes},publicBase());
 // Written after-class reflections are small saved documents: show the teacher's answers, not the file.
 await withReflectionText(entries);
 const lessons=buildLessonRecords(entries,'0001-01-01','9999-12-31',{scope:'all'});
 return weekGroups(lessons,raw.reviews,week);
}
export async function POST(req){
 return withRequest(req,async()=>{
  try{
   checkOrigin(req);
   const a=await actor(req);
   if(a.role!=='admin')throw Error('403:School Success staff access required');
   const input=weeklyRequest.parse(await req.json());
   assertSchool(a,input.school);
   const headers={'Cache-Control':'no-store'};
   if(input.action==='overview'){
    const {from,to}=weekRange(input.week),raw=await weekLessonRows({school:input.school,from,to});
    const {entries}=await mapLive({records:raw.records,reviews:raw.reviews,notes:raw.notes},publicBase());
    return Response.json(weekOverview(buildLessonRecords(entries,'0001-01-01','9999-12-31',{scope:'all'}),raw.reviews,input.week),{headers});
   }
   const week=await readWeek(input.school,input.teacher,input.week);
   if(input.action==='week')return Response.json(week,{headers});
   // The covered periods are read again here, never taken from the browser.
   const key=JSON.stringify([input.grade,input.section&&input.section!=='Not Applicable'?input.section:'',input.subject]);
   const group=week.groups.find(g=>g.key===key);
   if(!group)throw Error('There are no lessons in this week for this class and subject.');
   const result=await saveWeeklyReview({school:input.school,teacher:input.teacher,grade:group.grade,section:group.section,subject:group.subject,weekStart:week.from,weekEnd:week.to,recordIds:group.lessons.filter(l=>l.periodType!=='substitute').map(l=>l.recordId),requestId:input.requestId,review:input.review},a);
   return Response.json(result,{headers});
  }catch(e){return failure(e);}
 });
}
