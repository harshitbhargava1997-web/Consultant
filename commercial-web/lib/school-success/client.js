'use client';
import {browserClient} from '../supabase';
let client;
export async function successFetch(input,init={}){
 const url=new URL(input,location.origin);if(url.origin!==location.origin||!url.pathname.startsWith('/api/school-success/'))return fetch(input,init);
 const headers=new Headers(init.headers);const params=new URLSearchParams(location.search);
 if(params.get('access')){headers.set('X-School-Link',params.get('access'));if(params.get('teacher'))headers.set('X-Teacher',encodeURIComponent(params.get('teacher')));}
 else{client ||= browserClient();const {data:{session}}=await client.auth.getSession();if(session)headers.set('Authorization','Bearer '+session.access_token);if(params.get('schoolId'))headers.set('X-Vision-School',params.get('schoolId'));}
 if(url.pathname==='/api/school-success/evidence/upload'){
  const ticket=await fetch(url,{method:'POST',headers,cache:'no-store'});if(!ticket.ok)return ticket;
  const value=await ticket.json();
  const uploaded=await fetch(value.url,{method:'PUT',headers:{'Content-Type':value.contentType},body:init.body});
  if(!uploaded.ok)return Response.json({error:'Storage upload failed. Please retry this file.'},{status:502});
  return Response.json({ok:true});
 }
 return fetch(url,{...init,headers,cache:'no-store'});
}
