// Browser flow for consolidated-report links, for the report itself and for each evidence file.
//   mode 'link'   — /school-success/shared/<id>[/file/<n>]#<secret>: no account; the secret comes from
//                   the fragment and is only ever POSTed to this app.
//   mode 'signin' — /school-success/secure/<id>[/file/<n>]: Vision sign-in (then back to this page)
//                   and access to the school are required.
// Dependencies are injected: request(body) → Response, getSession() → session|null, navigate(url).
import {isShareId,isShareSecret} from './report-shares.js';
export async function openReportAccess({mode,id,n=null,hash='',pagePath,getSession=async()=>null,request,navigate}){
 const what=n===null?'lesson documentation':'file';
 if(!isShareId(id)||(n!==null&&!/^\d{1,4}$/.test(String(n))))return {state:'error',message:`This ${what} link is not valid.`};
 let body;
 if(mode==='signin'){
  const signIn=()=>{navigate('/?next='+encodeURIComponent(pagePath));return {state:'signin'};};
  if(!await getSession())return signIn();
  body={};
  var onUnauthorized=signIn;
 }else{
  const secret=String(hash||'').replace(/^#/,'');
  if(!isShareSecret(secret))return {state:'error',message:'This sharing link is incomplete. Open the full link exactly as you received it.'};
  body={secret};
 }
 let res;
 try{res=await request(body);}catch{return {state:'error',message:`The ${what} could not be reached. Check your connection and try again.`};}
 let data={};try{data=await res.json();}catch{}
 if(res.status===401&&onUnauthorized)return onUnauthorized();
 if(res.status===410)return {state:'revoked',message:data.error||'This link has been revoked by the school.'};
 if(res.status===403)return {state:'error',message:data.error||`This ${what} is not available for your account.`};
 if(res.status===404)return {state:'error',message:data.error||`This ${what} link is not valid.`};
 if(!res.ok||!data.url)return {state:'error',message:data.error||`The ${what} could not be opened. Try again shortly.`};
 navigate(data.url);
 return {state:'opening',filename:data.filename,downloadUrl:data.downloadUrl};
}
