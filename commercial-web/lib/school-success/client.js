'use client';
import {browserClient} from '../supabase';
import {uploadEvidenceFile} from './storage-upload';
let client;
export async function successFetch(input,init={}){
 const url=new URL(input,location.origin);if(url.origin!==location.origin||!url.pathname.startsWith('/api/school-success/'))return fetch(input,init);
 const headers=new Headers(init.headers);const params=new URLSearchParams(location.search);
 if(params.get('access')){headers.set('X-School-Link',params.get('access'));if(params.get('teacher'))headers.set('X-Teacher',encodeURIComponent(params.get('teacher')));}
 else{client ||= browserClient();const {data:{session}}=await client.auth.getSession();if(session)headers.set('Authorization','Bearer '+session.access_token);}
 if(url.pathname==='/api/school-success/evidence/upload'){
  // Presigned PUT straight to R2, with bounded retries for transient failures and safe diagnostics.
  const report=outcome=>{const h=new Headers(headers);h.delete('X-Evidence-Token');h.set('Content-Type','application/json');fetch('/api/school-success/evidence/upload-report',{method:'POST',headers:h,body:JSON.stringify(outcome),keepalive:true,cache:'no-store'}).catch(()=>{});};
  return uploadEvidenceFile({fetchTicket:()=>fetch(url,{method:'POST',headers,cache:'no-store'}),body:init.body,report});
 }
 return fetch(url,{...init,headers,cache:'no-store'});
}
