'use client';
import {useState} from 'react';
import {Link2Off} from 'lucide-react';
import {successFetch} from '@/lib/school-success/client';
import {parseShareLink} from '@/lib/school-success/report-shares';

// Status and revocation of one sharing link, for signed-in administrators with access to its school.
// Only the share ID is sent; the link's secret (after #) stays on this device.
export default function ShareLinkManager(){
 const [link,setLink]=useState(''),[info,setInfo]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function call(action){
  const id=parseShareLink(link);
  if(!id){setError('Paste a lesson report link that contains /school-success/shared/ or /school-success/secure/.');setInfo(null);return;}
  if(action==='revoke'&&!window.confirm('Revoke this link? The report and every file in it will stop opening for everyone who has the link. Copies already downloaded cannot be recalled.'))return;
  setBusy(true);setError('');
  try{
   const res=await successFetch('/api/school-success/report-shares/'+id+'/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
   const body=await res.json();if(!res.ok)throw Error(body.error||'The sharing link could not be checked');
   setInfo(body);
  }catch(e){setError(e.message);setInfo(null);}finally{setBusy(false);}
 }
 const s=info?.scope;
 return <details className="share-manager"><summary><Link2Off size={16}/> Check or revoke a lesson report link</summary>
  <label className="field"><span>Sharing link</span><input value={link} onChange={e=>{setLink(e.target.value);setInfo(null);setError('');}} placeholder="https://…/school-success/shared/… or /secure/…" autoComplete="off"/></label>
  <div className="actions"><button className="button" type="button" disabled={busy||!link} onClick={()=>call('status')}>Check link</button>{info&&!info.revoked&&<button className="button danger" type="button" disabled={busy} onClick={()=>call('revoke')}>Revoke link</button>}</div>
  {error&&<p className="negative" role="alert">{error}</p>}
  {info&&<div role="status" className="share-status"><p><b>{info.revoked?'Revoked':'Active'}</b> · {info.mode==='signin'?'Require school sign-in':'Anyone with the link'}{info.files?' · '+info.files+' file'+(info.files===1?'':'s'):''}{info.revoked&&info.revokedAt?' since '+new Date(info.revokedAt).toLocaleString():''} · created {new Date(info.createdAt).toLocaleString()}</p>
   <p>{s.teacher} · {[s.grade,s.section&&s.section!=='Not Applicable'?'Section '+s.section:''].filter(Boolean).join(' ')} · {s.subject} · {s.from} to {s.to} · {s.school}</p>
   {info.revoked&&<p className="hint">This link no longer opens. Copies downloaded before revocation cannot be recalled.</p>}</div>}
 </details>;
}
