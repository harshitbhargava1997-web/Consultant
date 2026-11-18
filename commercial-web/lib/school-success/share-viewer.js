// Opens a shared lesson-documentation PDF from a sharing link (/school-success/shared/<id>#<secret>).
// No sign-in. The secret comes from the URL fragment and is sent only in a POST body to this app.
import {isShareId,isShareSecret} from './report-shares.js';
export async function openSharedLesson({id,hash,request,navigate}){
 const secret=String(hash||'').replace(/^#/,'');
 if(!isShareId(id)||!isShareSecret(secret))return {state:'error',message:'This sharing link is incomplete. Open the full link exactly as you received it.'};
 let res;
 try{res=await request(id,secret);}catch{return {state:'error',message:'The lesson documentation could not be reached. Check your connection and try again.'};}
 let body={};try{body=await res.json();}catch{}
 if(res.status===410)return {state:'revoked',message:body.error||'This sharing link has been revoked by the school.'};
 if(res.status===404)return {state:'error',message:body.error||'This sharing link is not valid.'};
 if(!res.ok)return {state:'error',message:body.error||'The lesson documentation could not be opened. Try again shortly.'};
 navigate(body.url);
 return {state:'opening',filename:body.filename,downloadUrl:body.downloadUrl};
}
