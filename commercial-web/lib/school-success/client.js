'use client';
import {browserClient} from '../supabase';
import {uploadEvidenceFile} from './storage-upload';
import {teacherSession} from './teacher-session';
import {linkParams} from './link-params.js';
let client;
export async function successFetch(input,init={}){
 const url=new URL(input,location.origin);if(url.origin!==location.origin||!url.pathname.startsWith('/api/school-success/'))return fetch(input,init);
 const headers=new Headers(init.headers);const params=linkParams();
 // On a school link, the teacher comes only from the PIN session; without one the request is for the school (name selection).
 if(params.get('access')){headers.set('X-School-Link',params.get('access'));headers.delete('X-Teacher');headers.delete('X-Teacher-Session');const s=teacherSession(params.get('access'));if(s){headers.set('X-Teacher',encodeURIComponent(s.teacher));headers.set('X-Teacher-Session',s.token);}}
 else{client ||= browserClient();const {data:{session}}=await client.auth.getSession();if(session)headers.set('Authorization','Bearer '+session.access_token);}
 if(url.pathname==='/api/school-success/evidence/upload'){
  // Presigned PUT straight to R2, with bounded retries for transient failures and safe diagnostics.
  const report=outcome=>{const h=new Headers(headers);h.delete('X-Evidence-Token');h.set('Content-Type','application/json');fetch('/api/school-success/evidence/upload-report',{method:'POST',headers:h,body:JSON.stringify(outcome),keepalive:true,cache:'no-store'}).catch(()=>{});};
  return uploadEvidenceFile({fetchTicket:()=>fetch(url,{method:'POST',headers,cache:'no-store'}),initialTicket:init.uploadTicket,body:init.body,report});
 }
 return fetch(url,{...init,headers,cache:'no-store'});
}
