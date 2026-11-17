'use client';
import {useEffect,useState} from 'react';
import {useParams} from 'next/navigation';
import {FileText} from 'lucide-react';
import {successFetch} from '@/lib/school-success/client';
import {browserClient} from '@/lib/supabase';
import {openLessonSnapshot} from '@/lib/school-success/snapshot-viewer';

// Durable target of "Open lesson documentation" links in Teacher 360° usage PDFs. Signs the reader in if
// needed, asks the server to authorise this snapshot for them, then opens the stored PDF directly.
export default function LessonDocumentationPdf(){
 const {id}=useParams(),[status,setStatus]=useState({state:'checking'});
 useEffect(()=>{
  let alive=true;
  openLessonSnapshot({id:String(id||''),
   getSession:async()=>{try{const client=browserClient();return client?(await client.auth.getSession()).data.session:null;}catch{return null;}},
   request:snapshot=>successFetch('/api/school-success/report-snapshots/'+snapshot,{method:'POST'}),
   navigate:url=>window.location.replace(url)}).then(next=>{if(alive)setStatus(next);}).catch(()=>{if(alive)setStatus({state:'error',message:'Lesson documentation could not be opened. Try again.'});});
  return()=>{alive=false;};
 },[id]);
 return <main className="welcome"><div className="brand-icon"><FileText/></div><h1>Lesson documentation</h1>
  {status.state==='error'?<><p role="alert">{status.message}</p><a className="button primary" href="/school-success">Open School Success</a></>
  :status.state==='signin'?<p>Opening Vision sign-in…</p>
  :status.state==='opening'?<><p role="status">Opening {status.filename||'the PDF'}…</p><p className="hint">If the PDF does not open on this device, <a href={status.downloadUrl}>download it</a>.</p></>
  :<p role="status">Checking your access…</p>}
 </main>;
}
