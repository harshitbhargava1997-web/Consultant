'use client';
import {useEffect,useState} from 'react';
import {useParams} from 'next/navigation';
import {FileText} from 'lucide-react';
import {successFetch} from '@/lib/school-success/client';
import {browserClient} from '@/lib/supabase';
import {openReportAccess} from '@/lib/school-success/report-viewer';

// Target of consolidated lesson-report links and of every file link inside those reports.
// mode 'link': anyone holding the link; mode 'signin': Vision sign-in with access to the school.
export default function ReportLinkPage({mode,file=false}){
 const params=useParams(),id=String(params?.id||''),n=file?String(params?.n||''):null,[status,setStatus]=useState({state:'checking'});
 useEffect(()=>{
  let alive=true;
  const api='/api/school-success/report-shares/'+id+(file?'/file/'+n:'');
  openReportAccess({mode,id,n,hash:window.location.hash,pagePath:window.location.pathname,
   getSession:async()=>{try{const client=browserClient();return client?(await client.auth.getSession()).data.session:null;}catch{return null;}},
   // Link mode never sends sign-in credentials; sign-in mode sends the Vision session.
   request:body=>mode==='signin'?successFetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}):fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',credentials:'omit'}),
   navigate:url=>window.location.replace(url)}).then(next=>{if(alive)setStatus(next);});
  return()=>{alive=false;};
 },[id,n,mode,file]);
 const title=file?'Lesson documentation file':'Lesson documentation';
 return <main className="welcome"><div className="brand-icon"><FileText/></div><h1>{title}</h1>
  {status.state==='error'||status.state==='revoked'?<p role="alert">{status.message}</p>
  :status.state==='signin'?<p>Opening Vision sign-in…</p>
  :status.state==='opening'?<><p role="status">Opening {status.filename||(file?'the file':'the report')}…</p>{status.downloadUrl&&<p className="hint">If the PDF does not open on this device, <a href={status.downloadUrl}>download it</a>.</p>}</>
  :<p role="status">{mode==='signin'?'Checking your access…':'Opening…'}</p>}
  {status.state!=='error'&&status.state!=='revoked'&&<p className="hint">{mode==='signin'?'Shared by the school. School sign-in is required.':'Shared by the school. Anyone with this link can view this report and its files.'}</p>}
 </main>;
}
