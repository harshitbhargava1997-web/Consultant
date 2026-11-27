// One immutable entry per submitted rubric. The numeric record ID ties it to one class period.
// The existing success_entries primary key makes a retry of the same submission idempotent.
import {lessonRecordId,rubricReview,reviewText,reviewerFromSignIn,weeklyReview,weeklyText} from './lesson-reviews.js';
const kind='lesson-review';
const prefix=id=>kind+'-'+id+'-';
const batchSize=60, parallelReads=4;
export async function readRubricRows(recordIds,scope,all) {
 const ids=[...new Set(recordIds.map(String))].filter(id=>lessonRecordId.safeParse(id).success);
 const batches=[],result=[];
 for(let offset=0;offset<ids.length;offset+=batchSize)batches.push(ids.slice(offset,offset+batchSize));
 async function readBatch(batch){
  const filters=batch.map(id=>'id.like.'+prefix(id)+'*');
  const rows=await all('success_entries','id',{...scope,select:'id,school,owner,payload,updated',kind:'eq.'+kind,or:'('+filters.join(',')+')'});
  return rows.flatMap(row=>{
   const recordId=row.id.match(/^lesson-review-(\d+)-/)?.[1];
   if(!batch.includes(recordId))return [];
   // Newer reviews also store who gave them (name and role) next to the rubric.
   const v=parseVersion(row);return v?[v]:[];
  });
 }
 for(let start=0;start<batches.length;start+=parallelReads){
  const pages=await Promise.all(batches.slice(start,start+parallelReads).map(readBatch));
  for(const rows of pages)result.push(...rows);
 }
 return latestVersions(result);
}
// One stored review row as a review version. "edits" names the review it replaces on screen (its first version's
// key); the owner (sign-in) is kept only on the server and never leaves latestVersions.
function parseVersion(row){
 const recordId=row.id.match(/^lesson-review-(\d+)-/)?.[1];
 const {reviewer,weekly,edits,...rubric}=JSON.parse(row.payload);
 const by=reviewer&&typeof reviewer.name==='string'?{name:reviewer.name.slice(0,160),role:String(reviewer.role||'').slice(0,60)}:reviewerFromSignIn(row.owner);
 const root=typeof edits==='string'&&edits?edits:'';
 // A weekly review is stored once for every period it covers; all its rows share one key (review_id), so the
 // teacher sees it once and one "Noted" covers it.
 if(weekly){const review=weeklyReview.parse(rubric);return {record_id:recordId,school:row.school,feedback:weeklyText(review,weekly),updated_at:row.updated,review_id:weeklyKey(weekly.id),root,owner:row.owner,by,highlights:review.highlights||[],weekly:{...weekly,review}};}
 const review=rubricReview.parse(rubric);
 return {record_id:recordId,school:row.school,feedback:reviewText(review),updated_at:row.updated,review_id:row.id,root,owner:row.owner,by,highlights:review.highlights||[],review};
}
// Edited reviews (owner decision, 27 November 2026): every version stays stored; screens, reports and the teacher see
// the latest version of each review, with who first gave it and who last changed it. The latest version has its own
// key, so the teacher's earlier "Noted" no longer applies and they note it again.
export function latestVersions(rows){
 const groups=new Map();
 for(const r of rows){const k=r.record_id+'|'+(r.root||r.review_id);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 return [...groups.values()].map(list=>{
  list.sort((a,b)=>String(a.updated_at).localeCompare(String(b.updated_at))||String(a.review_id).localeCompare(String(b.review_id)));
  const first=list.find(r=>!r.root)||list[0],last=list.at(-1),{owner,...shown}=last;
  return {...shown,root:first.review_id,by:first.by,...(last!==first?{edited:{by:last.by,at:last.updated_at,versions:list.length},given_at:first.updated_at}:{})};
 });
}
// Every stored version of one lesson's reviews, with the sign-in that saved each (server only: edit permission).
export async function readReviewVersions(recordId,school,request){
 const rows=await request('/rest/v1/success_entries?'+new URLSearchParams({school:'eq.'+school,kind:'eq.'+kind,id:'like.'+prefix(recordId)+'*',select:'id,school,owner,payload,updated',order:'id',limit:'1000'}));
 return (rows||[]).filter(r=>r.id.startsWith(prefix(recordId))).flatMap(r=>{try{const v=parseVersion(r);return v?[v]:[];}catch{return [];}});
}
export async function appendRubric({recordId,school,reviewer,reviewerName='',reviewerRole='',requestId,review,edits=''},request) {
 const id=prefix(recordId)+requestId;
 const rubric=rubricReview.parse(review);
 const body={...rubric,...(reviewerName?{reviewer:{name:reviewerName,role:reviewerRole}}:{}),...(edits?{edits}:{})};
 const row={id,school,kind,owner:reviewer,payload:JSON.stringify(body),updated:new Date().toISOString()};
 const inserted=await request('/rest/v1/success_entries?on_conflict=id&select=id','POST',row,{Prefer:'resolution=ignore-duplicates,return=representation'});
 if(inserted?.length)return {saved:true};
 const query=new URLSearchParams({id:'eq.'+id,school:'eq.'+school,kind:'eq.'+kind,select:'owner,payload'});
 const [existing]=await request('/rest/v1/success_entries?'+query);
 if(existing?.owner===reviewer && existing.payload===row.payload)return {saved:true,alreadySaved:true};
 throw Error('409:This review was already submitted with different feedback. Reopen the lesson to add another review.');
}

// Weekly reviews (owner decision, 26 November 2026): one teacher, one class and subject, one week. Saved as one
// immutable row per covered period (lesson-review-<record>-weekly-<request>), so every place that already reads a
// lesson's reviews (awaiting review, Lesson records, PDFs, the teacher's Feedback and "Noted") includes it.
export const weeklyKey=requestId=>'weekly-'+requestId;
export async function appendWeeklyReview({school,teacher,grade,section,subject,weekStart,weekEnd,recordIds,reviewer,reviewerName='',reviewerRole='',requestId,review,edits=''},request){
 const parsed=weeklyReview.parse(review),ids=[...new Set(recordIds.map(String))].filter(id=>lessonRecordId.safeParse(id).success);
 if(!ids.length)throw Error('There are no lessons in this week for this class and subject.');
 const weekly={id:requestId,teacher,grade,section,subject,weekStart,weekEnd,periods:ids.length,recordIds:ids};
 const payload=JSON.stringify({...parsed,weekly,reviewer:{name:reviewerName,role:reviewerRole},...(edits?{edits}:{})}),updated=new Date().toISOString();
 const rows=ids.map(id=>({id:prefix(id)+'weekly-'+requestId,school,kind,owner:reviewer,payload,updated}));
 const inserted=await request('/rest/v1/success_entries?on_conflict=id&select=id','POST',rows,{Prefer:'resolution=ignore-duplicates,return=representation'});
 if((inserted||[]).length===rows.length)return {saved:true,periods:ids.length};
 // A retry of the same save: every row must already hold this exact review.
 const existing=await request('/rest/v1/success_entries?'+new URLSearchParams({id:'in.('+rows.map(r=>r.id).join(',')+')',school:'eq.'+school,kind:'eq.'+kind,select:'id,owner,payload'}));
 const have=new Map((existing||[]).map(r=>[r.id,r]));
 if(rows.every(r=>have.get(r.id)?.owner===reviewer&&have.get(r.id)?.payload===payload))return {saved:true,alreadySaved:true,periods:ids.length};
 throw Error('409:This weekly review was already submitted with different feedback. Reopen the week to add another review.');
}
