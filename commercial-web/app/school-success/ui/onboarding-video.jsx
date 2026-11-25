'use client';
// Teachers' "How to use" video (owner request, 25 November 2026): shown after PIN sign-in until watched, and any
// time from the profile menu. Uses YouTube's player (privacy-enhanced domain) to record how much was watched.
// If the video cannot load (weak internet), the teacher can still continue, so nobody is locked out.
import {useEffect,useRef,useState} from 'react';
import {PlayCircle,ArrowRight,CircleCheck,RefreshCw,X,Play,Pause,RotateCcw} from 'lucide-react';
import {successFetch} from '@/lib/school-success/client';

let apiPromise=null;
function loadYouTubeApi(){
 if(typeof window==='undefined')return Promise.reject(Error('no window'));
 if(window.YT?.Player)return Promise.resolve(window.YT);
 apiPromise ||= new Promise((resolve,reject)=>{
  const prev=window.onYouTubeIframeAPIReady;window.onYouTubeIframeAPIReady=()=>{prev?.();resolve(window.YT);};
  const s=document.createElement('script');s.src='https://www.youtube.com/iframe_api';s.async=true;s.onerror=()=>{apiPromise=null;reject(Error('YouTube could not load'));};document.head.appendChild(s);
 });
 return apiPromise;
}
export async function videoApi(body,headers=()=>({})){
 const res=await successFetch('/api/school-success/onboarding-video',{method:'POST',headers:{'Content-Type':'application/json',...headers()},body:JSON.stringify(body)});
 const out=await res.json().catch(()=>({}));if(!res.ok)throw Error(out.error||'Please try again.');return out;
}

// Locked player (owner decision, 25 November 2026): YouTube's own controls, title, logo and Share are hidden or
// blocked so teachers cannot open or copy the YouTube link. Our controls: Play/Pause and back 10 seconds (no skipping
// ahead). The teacher's name is shown faintly on the video. Phones only allow the first play from a tap on the video
// itself, so until it starts the middle of the video is left open; the edges (title, logo, Share) are always blocked.
const fmtTime=s=>{s=Math.max(0,Math.floor(s||0));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
export default function OnboardingVideo({videoId,language='en',headers,firstTime=true,onDone,watermark=''}){
 const t=(en,hi)=>language==='hi'?hi:en;
 const box=useRef(null),player=useRef(null),last=useRef(0),tick=useRef(null),clock=useRef(null);
 const [state,setState]=useState('loading'),[done,setDone]=useState(false),[percent,setPercent]=useState(0);
 const [playing,setPlaying]=useState(false),[started,setStarted]=useState(false),[time,setTime]=useState({c:0,d:0});
 const send=(event,extra={})=>videoApi({action:'progress',event,...extra},headers).then(r=>{if(r.watched)setDone(true);}).catch(()=>{});
 function report(event){
  const p=player.current;if(!p?.getDuration)return;
  const d=p.getDuration()||0,c=p.getCurrentTime()||0,pct=d?Math.round(c/d*100):0;
  const played=Math.max(0,Math.min(60,c-last.current));last.current=c;setPercent(pct);
  void send(event,{percent:pct,played});
 }
 useEffect(()=>{
  let alive=true;
  void send('open');
  const slow=setTimeout(()=>{if(alive)setState(s=>s==='loading'?'failed':s);},20000);
  loadYouTubeApi().then(YT=>{if(!alive)return;
   player.current=new YT.Player(box.current,{videoId,host:'https://www.youtube-nocookie.com',
    playerVars:{controls:0,disablekb:1,fs:0,rel:0,iv_load_policy:3,playsinline:1,modestbranding:1,hl:language},
    events:{onReady:()=>{if(alive){clearTimeout(slow);setState('ready');setTime({c:0,d:player.current.getDuration?.()||0});}},
     onError:()=>{if(alive){setState('failed');void send('error');}},
     onStateChange:e=>{
      if(e.data===1){setStarted(true);setPlaying(true);last.current=player.current.getCurrentTime()||0;clearInterval(tick.current);tick.current=setInterval(()=>report('progress'),15000);
       clearInterval(clock.current);clock.current=setInterval(()=>{const p=player.current;if(p?.getCurrentTime){const c=p.getCurrentTime(),d=p.getDuration()||0;setTime({c,d});if(d)setPercent(pc=>Math.max(pc,Math.round(c/d*100)));}},500);}
      if(e.data===2){setPlaying(false);clearInterval(tick.current);clearInterval(clock.current);report('progress');}
      if(e.data===0){setPlaying(false);clearInterval(tick.current);clearInterval(clock.current);report('ended');setDone(true);setPercent(100);}
     }}});
  }).catch(()=>{if(alive)setState('failed');});
  return ()=>{alive=false;clearTimeout(slow);clearInterval(tick.current);clearInterval(clock.current);try{if(player.current?.getCurrentTime)report('progress');player.current?.destroy?.();}catch{}};
 },[videoId]);
 function toggle(){const p=player.current;if(!p?.playVideo)return;if(playing)p.pauseVideo();else p.playVideo();}
 function back10(){const p=player.current;if(!p?.seekTo)return;const c=Math.max(0,(p.getCurrentTime()||0)-10);last.current=c;p.seekTo(c,true);setTime(x=>({...x,c}));}
 const canContinue=!firstTime||done||state==='failed';
 return <section className="ov-screen">
  <div className="ov-head"><span className="ov-icon"><PlayCircle size={22}/></span><div><h2>{t('How to use School Success','School Success कैसे इस्तेमाल करें')}</h2><p>{firstTime?t('Please watch this short video before you start. It shows how to plan lessons, add your after-class reflection and evidence, and read feedback.','शुरू करने से पहले यह छोटा वीडियो देखें। इसमें लेसन प्लान, क्लास के बाद का चिंतन, एविडेंस और फीडबैक के बारे में बताया गया है।'):t('Watch again any time.','जब चाहें दोबारा देखें।')}</p></div>{!firstTime&&<button type="button" className="icon ov-x" aria-label={t('Close','बंद करें')} onClick={onDone}><X size={20}/></button>}</div>
  <div className="ov-frame" onContextMenu={e=>e.preventDefault()}>
   <div ref={box} className="ov-player"/>
   {state==='ready'&&<>
    {watermark&&<div className="ov-mark" aria-hidden="true">{watermark}</div>}
    <div className="ov-shield top" aria-hidden="true"/>
    {started?<button type="button" className="ov-shield full" aria-label={playing?t('Pause','रोकें'):t('Play','चलाएँ')} onClick={toggle}>{!playing&&<span className="ov-big"><Play size={34}/></span>}</button>
     :<div className="ov-start" aria-hidden="true"><span>{t('Tap the video to start','शुरू करने के लिए वीडियो पर टैप करें')}</span></div>}
    <div className="ov-bar">
     <button type="button" className="ov-btn" disabled={!started} aria-label={playing?t('Pause','रोकें'):t('Play','चलाएँ')} onClick={toggle}>{playing?<Pause size={20}/>:<Play size={20}/>}</button>
     <button type="button" className="ov-btn" disabled={!started} aria-label={t('Back 10 seconds','10 सेकंड पीछे')} onClick={back10}><RotateCcw size={18}/><small>10</small></button>
     <span className="ov-track" aria-hidden="true"><span style={{width:(time.d?Math.min(100,time.c/time.d*100):0)+'%'}}/></span>
     <span className="ov-time">{fmtTime(time.c)} / {fmtTime(time.d)}</span>
    </div>
   </>}
   {state!=='ready'&&<div className="ov-wait">{state==='failed'?<><p>{t('The video could not load. Check your internet and try again, or continue for now.','वीडियो नहीं खुल सका। इंटरनेट जाँचकर फिर कोशिश करें, या अभी आगे बढ़ें।')}</p><button type="button" className="button" onClick={()=>location.reload()}><RefreshCw size={15}/>{t('Try again','फिर कोशिश करें')}</button></>:<p>{t('Loading the video…','वीडियो खुल रहा है…')}</p>}</div>}
  </div>
  {firstTime&&<div className="ov-progress" aria-label={t('Watched','देखा गया')}><span style={{width:(done?100:percent)+'%'}}/></div>}
  <button type="button" className="button primary ov-go" disabled={!canContinue} onClick={onDone}>{done&&firstTime?<CircleCheck size={18}/>:<ArrowRight size={18}/>}{firstTime?(done?t('Continue to my portal','मेरे पोर्टल पर जाएँ'):state==='failed'?t('Continue without the video','वीडियो के बिना आगे बढ़ें'):t('Watch to the end to continue','आगे बढ़ने के लिए पूरा वीडियो देखें')):t('Back to my portal','मेरे पोर्टल पर लौटें')}</button>
 </section>;
}

// Super Admin: set the unlisted YouTube link and see which teachers watched it.
export function VideoAdmin({schools}){
 const [url,setUrl]=useState(''),[current,setCurrent]=useState(null),[school,setSchool]=useState(schools.length===1?schools[0]:''),[report,setReport]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 useEffect(()=>{videoApi({action:'get'}).then(r=>{setCurrent(r);setUrl(r.url||'');}).catch(e=>setError(e.message));},[]);
 useEffect(()=>{if(school)void load(school);},[school]);
 async function load(s=school){if(!s)return;setBusy('load');setError('');try{setReport(await videoApi({action:'report',school:s}));}catch(e){setError(e.message);}finally{setBusy('');}}
 async function save(e){e.preventDefault();setBusy('save');setError('');setNotice('');try{const r=await videoApi({action:'setVideo',url});setCurrent(c=>({...c,videoId:r.videoId,url}));setNotice(r.videoId?'Saved. Teachers will see this video after they sign in with their PIN.':'Video removed. Teachers go straight to their portal.');if(school)await load();}catch(err){setError(err.message);}finally{setBusy('');}}
 const fmt=v=>v?new Date(v).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'}):'—';
 const mins=s=>s?Math.floor(s/60)+' min '+String(s%60).padStart(2,'0')+' s':'—';
 const rows=report?.teachers||[],counts={w:rows.filter(r=>r.status==='Watched').length,s:rows.filter(r=>r.status==='Started').length};
 return <section className="card ov-admin">
  <div className="card-head"><div><h2><PlayCircle size={18}/> Teacher video</h2><p>Teachers see this video after signing in with their PIN, until they have watched it. Use an <b>Unlisted</b> YouTube link (Private videos do not play for teachers).</p></div></div>
  <form className="ov-url" onSubmit={save}><label className="field"><span>YouTube link</span><input value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://youtu.be/…"/></label><button className="button primary" disabled={!!busy}>{busy==='save'?'Saving…':'Save video'}</button></form>
  {current?.videoId?<p className="hint">Current video ID: <code>{current.videoId}</code></p>:<p className="hint">No video set. Teachers go straight to their portal.</p>}
  {error&&<p className="alert error" role="alert">{error}</p>}{notice&&<p className="alert success" role="status">{notice}</p>}
  <label className="field"><span>School</span><select value={school} onChange={e=>setSchool(e.target.value)}><option value="">Select school</option>{schools.map(s=><option key={s}>{s}</option>)}</select></label>
  {busy==='load'&&<p role="status">Loading…</p>}
  {report&&<><p className="ov-sum"><b>{counts.w}</b> of {rows.length} teachers watched · <b>{counts.s}</b> started · <b>{rows.length-counts.w-counts.s}</b> not opened <button type="button" className="text-button" onClick={()=>void load()}><RefreshCw size={14}/>Refresh</button></p>
   <div className="table-wrap"><table className="ov-table"><thead><tr><th>Teacher</th><th>Status</th><th>Watched</th><th>Watch time</th><th>First opened</th><th>Finished</th></tr></thead>
    <tbody>{rows.map(r=><tr key={r.teacher}><td>{r.teacher}</td><td><span className={'pill '+(r.status==='Watched'?'green':r.status==='Started'?'amber':'')}>{r.status}</span></td><td>{r.maxPercent?r.maxPercent+'%':'—'}</td><td>{mins(r.watchSeconds)}</td><td>{fmt(r.firstOpenedAt)}</td><td>{fmt(r.completedAt)}</td></tr>)}</tbody></table></div></>}
 </section>;
}
