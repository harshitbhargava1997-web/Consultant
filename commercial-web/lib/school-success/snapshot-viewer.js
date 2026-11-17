// Flow for the durable link printed in usage PDFs (/school-success/report/<id>). Dependencies are injected
// so the decision logic is testable: getSession() → Vision session or null; request(id) → Response;
// navigate(url) replaces the current page.
import {isSnapshotId,snapshotPagePath} from './report-snapshots.js';
export async function openLessonSnapshot({id,getSession,request,navigate}){
 if(!isSnapshotId(id))return {state:'error',message:'This lesson documentation link is not valid.'};
 const signIn=()=>{navigate('/?next='+encodeURIComponent(snapshotPagePath(id)));return {state:'signin'};};
 if(!await getSession())return signIn();
 const response=await request(id);
 let body={};try{body=await response.json();}catch{}
 if(response.status===401)return signIn();
 if(response.status===403)return {state:'error',message:body.error||'This lesson documentation is not available for your account.'};
 if(response.status===404)return {state:'error',message:'This lesson documentation could not be found. Ask for the report to be exported again.'};
 if(!response.ok||!body.url)return {state:'error',message:body.error||'Lesson documentation could not be opened. Try again.'};
 navigate(body.url);
 return {state:'opening',url:body.url,downloadUrl:body.downloadUrl,filename:body.filename};
}
