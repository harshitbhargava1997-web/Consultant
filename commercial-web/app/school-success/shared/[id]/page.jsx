'use client';
import {useEffect,useState} from 'react';
import {useParams} from 'next/navigation';
import {FileText} from 'lucide-react';
import {openSharedLesson} from '@/lib/school-success/share-viewer';

// Target of sharing links in Teacher 360° usage PDFs. Opens that one PDF without a portal account; the
// link's secret (URL fragment) is checked by the server, which also enforces revocation.
export default function SharedLessonDocumentation(){
 const {id}=useParams(),[status,setStatus]=useState({state:'checking'});
 useEffect(()=>{
  let alive=true;
  openSharedLesson({id:String(id||''),hash:window.location.hash,
   request:(share,secret)=>fetch('/api/school-success/report-shares/'+share,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret}),cache:'no-store',credentials:'omit'}),
   navigate:url=>window.location.replace(url)}).then(next=>{if(alive)setStatus(next);});
  return()=>{alive=false;};
 },[id]);
 return <main className="welcome"><div className="brand-icon"><FileText/></div><h1>Lesson documentation</h1>
  {status.state==='error'||status.state==='revoked'?<p role="alert">{status.message}</p>
  :status.state==='opening'?<><p role="status">Opening {status.filename||'the PDF'}…</p><p className="hint">If the PDF does not open on this device, <a href={status.downloadUrl}>download it</a>.</p></>
  :<p role="status">Opening the shared PDF…</p>}
  {status.state!=='error'&&status.state!=='revoked'&&<p className="hint">Shared by the school. Anyone with this link can view this PDF.</p>}
 </main>;
}
