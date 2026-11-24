import {withRequest,actor,checkOrigin,failure} from '@/lib/school-success/server';
import {reviewerLesson,saveLessonRubric,gateway,publicBase} from '@/lib/school-success/live';
import {mapLive} from '@/lib/school-success/live-mapping';
import {reviewRequest} from '@/lib/school-success/lesson-reviews';
import {buildLessonRecords} from '@/lib/school-success/lesson-records';

export async function POST(req) {
 return withRequest(req,async()=>{
  try{
   checkOrigin(req);
   const a=await actor(req);
   if(a.role!=='admin')throw Error('403:School Success staff access required');
   const input=reviewRequest.parse(await req.json());
   const row=await reviewerLesson(input.recordId,a);
   const headers={'Cache-Control':'no-store'};
   if(input.action==='save')return Response.json(await saveLessonRubric(row,a,input),{headers});
   const {rows:reviews,notes}=await gateway({action:'readLessonReviews',ids:[input.recordId]});
   const {entries}=await mapLive({records:[row],reviews,notes},publicBase());
   const [lesson]=buildLessonRecords(entries,'0001-01-01','9999-12-31',{scope:'all'});
   if(!lesson)throw Error('This lesson has no reviewable record.');
   return Response.json({lesson},{headers});
  }catch(e){return failure(e);}
 });
}
