// One immutable entry per submitted rubric. The numeric record ID ties it to one class period.
// The existing success_entries primary key makes a retry of the same submission idempotent.
import {lessonRecordId,rubricReview,reviewText} from './lesson-reviews.js';
const kind='lesson-review';
const prefix=id=>kind+'-'+id+'-';
const batchSize=60, parallelReads=4;
export async function readRubricRows(recordIds,scope,all) {
 const ids=[...new Set(recordIds.map(String))].filter(id=>lessonRecordId.safeParse(id).success);
 const batches=[],result=[];
 for(let offset=0;offset<ids.length;offset+=batchSize)batches.push(ids.slice(offset,offset+batchSize));
 async function readBatch(batch){
  const filters=batch.map(id=>'id.like.'+prefix(id)+'*');
  const rows=await all('success_entries','id',{...scope,select:'id,school,payload,updated',kind:'eq.'+kind,or:'('+filters.join(',')+')'});
  return rows.flatMap(row=>{
   const recordId=row.id.match(/^lesson-review-(\d+)-/)?.[1];
   if(!batch.includes(recordId))return [];
   const review=rubricReview.parse(JSON.parse(row.payload));
   return [{record_id:recordId,school:row.school,feedback:reviewText(review),updated_at:row.updated,review_id:row.id}];
  });
 }
 for(let start=0;start<batches.length;start+=parallelReads){
  const pages=await Promise.all(batches.slice(start,start+parallelReads).map(readBatch));
  for(const rows of pages)result.push(...rows);
 }
 return result;
}
export async function appendRubric({recordId,school,reviewer,requestId,review},request) {
 const id=prefix(recordId)+requestId;
 const row={id,school,kind,owner:reviewer,payload:JSON.stringify(rubricReview.parse(review)),updated:new Date().toISOString()};
 const inserted=await request('/rest/v1/success_entries?on_conflict=id&select=id','POST',row,{Prefer:'resolution=ignore-duplicates,return=representation'});
 if(inserted?.length)return {saved:true};
 const query=new URLSearchParams({id:'eq.'+id,school:'eq.'+school,kind:'eq.'+kind,select:'owner,payload'});
 const [existing]=await request('/rest/v1/success_entries?'+query);
 if(existing?.owner===reviewer && existing.payload===row.payload)return {saved:true,alreadySaved:true};
 throw Error('409:This review was already submitted with different feedback. Reopen the lesson to add another review.');
}
