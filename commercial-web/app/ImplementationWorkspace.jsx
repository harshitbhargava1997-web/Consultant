"use client";
import {useEffect,useMemo,useRef,useState} from "react";
import {BookOpen,CheckCircle2,ClipboardCheck,FileAudio,FileText,Image as ImageIcon,
 Mic,Plus,RefreshCw,Send,ShieldCheck,Trash2,Upload,Users,Video,Eye,Filter} from "lucide-react";

const SUBJECTS=[
 "All Subjects Together","Phonics / Literacy","Mathematics","Numeracy","English","Hindi",
 "Environmental Studies (EVS)","Science","Social Science","General Knowledge (GK)",
 "English Grammar","Computer","Play Activity","Play Time","Play Based"
];
const CATEGORIES=[
 {id:"lesson_plan",label:"Lesson Plan (optional)",accept:"image/jpeg,image/png,image/webp,application/pdf"},
 {id:"activity",label:"Classroom Activity Conducted",accept:"image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,video/x-m4v,video/x-msvideo,application/pdf"},
 {id:"phonics",label:"Phonics / Phonetics Implementation",accept:"image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm,video/x-m4v,video/x-msvideo,application/pdf"}
];
const LABELS={voice:"Voice reflection",...Object.fromEntries(CATEGORIES.map(c=>[c.id,c.label])),
 writing:"Historical student writing",assessment:"Historical assessment",
 portfolio:"Historical portfolio",event_pictures:"Historical event pictures"};
const today=()=>{
 const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),
  day=String(d.getDate()).padStart(2,"0");return y+"-"+m+"-"+day;
};
let nextKey=0;
const emptyPeriod=(classId="")=>({
 key:++nextKey,classId,date:today(),subject:"Phonics / Literacy",topic:"",
 voiceNotes:"",competencyIds:[],language:"en-IN",attachments:{}
});
const classTitle=c=>c.grade+" · "+c.section+" · "+c.academic_year;
function EvidenceFile({file}){
 const mime=file.content_type||"",url=file.url||"";
 return <div className="implementation-media">
  {mime.startsWith("image/")&&url&&<a href={url} target="_blank" rel="noopener noreferrer">
   <img src={url} alt={file.file_name} loading="lazy"/></a>}
  {mime.startsWith("video/")&&url&&<video controls preload="metadata" src={url}/>}
  {mime.startsWith("audio/")&&url&&<audio controls preload="metadata" src={url}/>}
  <div><strong>{file.file_name}</strong><small>{LABELS[file.category]||file.category} · {(file.size_bytes/1048576).toFixed(1)} MB</small>
   {url?<a href={url} target="_blank" rel="noopener noreferrer">Open evidence <FileText size={13}/></a>:
    <span className="helper">Preview unavailable. Refresh to renew access.</span>}</div>
 </div>;
}
function ReviewCard({entry,files=[],review,teacher,classLabel,canFeedback,onSave,busy}){
 const [status,setStatus]=useState(review?.status||"reviewed");
 const [feedback,setFeedback]=useState(review?.feedback||"");
 useEffect(()=>{setStatus(review?.status||"reviewed");setFeedback(review?.feedback||"");},
  [entry.id,review?.status,review?.feedback]);
 return <article className="implementation-entry">
  <div className="implementation-entry-head">
   <div><strong>{entry.lesson_topic}</strong><small>{teacher} · {classLabel||"Class"} · {entry.subject}</small></div>
   <span className={"implementation-status "+(review?.status||"pending")}>
    {review?.status==="needs_follow_up"?"Needs follow-up":review?.status==="reviewed"?"Reviewed":"Awaiting review"}
   </span>
  </div>
  <div className="implementation-meta">
   <span>Lesson: {entry.implementation_date}</span><span>Period {entry.period_number}</span>
   <span>Submitted: {new Date(entry.submitted_at).toLocaleString("en-IN")}</span>
   <span>{files.length} files</span>
  </div>
  {entry.voice_reflection_note&&<div className="implementation-reflection"><strong>Voice reflection transcription</strong>
   <p>{entry.voice_reflection_note}</p></div>}
  {entry.teacher_reflection&&<div className="implementation-reflection"><strong>Implementation reflection</strong>
   <p>{entry.teacher_reflection}</p></div>}
  {files.length>0&&<div className="implementation-files">
   {files.map(f=><EvidenceFile file={f} key={f.id}/>)}
  </div>}
  {review&&<div className="implementation-feedback">
   <strong>Reviewer feedback · {review.status==="reviewed"?"Reviewed":"Needs follow-up"}</strong>
   {review.feedback&&<p>{review.feedback}</p>}
   <small>{new Date(review.reviewed_at).toLocaleString("en-IN")}</small>
  </div>}
  {canFeedback&&<div className="implementation-review-form">
   <div className="two-col">
    <label>Review outcome<select value={status} onChange={e=>setStatus(e.target.value)}>
     <option value="reviewed">Reviewed</option><option value="needs_follow_up">Needs follow-up</option>
    </select></label>
    <label>Constructive feedback<textarea rows={2} maxLength={4000} value={feedback}
     placeholder="What worked and what should the teacher try next?" onChange={e=>setFeedback(e.target.value)}/></label>
   </div>
   <button type="button" className="btn primary" disabled={busy||status==="needs_follow_up"&&!feedback.trim()}
    onClick={()=>onSave(entry.id,status,feedback)}><ClipboardCheck size={15}/> Save review</button>
  </div>}
 </article>;
}
export default function ImplementationWorkspace({client,session,schoolId,schoolName,competencies=[],isAdmin=false,grants=[]}){
 const can=feature=>isAdmin||grants.includes(feature);
 const [info,setInfo]=useState({entries:[],files:[],reviews:[],people:[],classes:[],canSubmit:false,canReview:false,canFeedback:false});
 const [periods,setPeriods]=useState([emptyPeriod()]);
 const [tab,setTab]=useState("submit");
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[message,setMessage]=useState("");
 const [teacherFilter,setTeacherFilter]=useState("all"),[classFilter,setClassFilter]=useState("all");
 const [statusFilter,setStatusFilter]=useState("all"),[categoryFilter,setCategoryFilter]=useState("all"),[search,setSearch]=useState("");
 const [dateFrom,setDateFrom]=useState(""),[dateTo,setDateTo]=useState("");
 const [receipt,setReceipt]=useState("");
 const [recording,setRecording]=useState(null),[transcribing,setTranscribing]=useState(null);
 const recorder=useRef(null),audioStream=useRef(null),speechRef=useRef(null);
 const preparedVoices=useRef(new Map());
 const hasSubmit=info.canSubmit&&can("implementation.submit");
 const hasReview=info.canReview&&can("implementation.review");
 const hasFeedback=hasReview&&info.canFeedback&&can("implementation.feedback");
 const own=info.entries.filter(e=>e.teacher_user_id===session?.user?.id);
 const reviewRows=hasReview?info.entries:own;
 const displayRoles=(info.people||[]);
 const personName=id=>displayRoles.find(p=>p.user_id===id)?.display_name||
  (id===session?.user?.id?"My submission":"Teacher");
 const className=id=>info.classes.find(c=>c.id===id)?classTitle(info.classes.find(c=>c.id===id)):"Class";
 const filesByEntry=id=>info.files.filter(f=>f.entry_id===id);
 const reviewByEntry=id=>info.reviews.find(r=>r.entry_id===id);
 const aggregate=useMemo(()=>{
  const categoryCounts=Object.fromEntries(Object.keys(LABELS).map(key=>[key,0]));
  for(const file of info.files)categoryCounts[file.category]=(categoryCounts[file.category]||0)+1;
  return {entries:info.entries.length,files:info.files.length,
   pending:info.entries.filter(e=>!info.reviews.some(r=>r.entry_id===e.id)).length,categoryCounts};
 },[info.entries,info.files,info.reviews]);
 const reviewerRows=reviewRows.filter(e=>
  (teacherFilter==="all"||e.teacher_user_id===teacherFilter)&&
  (classFilter==="all"||e.class_id===classFilter)&&
  (!dateFrom||e.implementation_date>=dateFrom)&&(!dateTo||e.implementation_date<=dateTo)&&
  (statusFilter==="all"||statusFilter==="pending"&&!reviewByEntry(e.id)||
   statusFilter!=="pending"&&reviewByEntry(e.id)?.status===statusFilter)&&
  (categoryFilter==="all"||filesByEntry(e.id).some(f=>f.category===categoryFilter))&&
  [e.lesson_topic,e.subject,personName(e.teacher_user_id)].join(" ").toLowerCase().includes(search.toLowerCase())
 );
 async function call(action,payload={}){
  const res=await fetch("/api/implementation?schoolId="+encodeURIComponent(schoolId),{
   method:"POST",headers:{"Authorization":"Bearer "+session.access_token,"Content-Type":"application/json"},
   body:JSON.stringify({action,...payload}),cache:"no-store"
  });
  const json=await res.json().catch(()=>({}));
  if(!res.ok)throw Error(json.error||"Implementation request failed.");
  return json;
 }
 async function load(quiet=false){
  if(!schoolId){setLoading(false);return;}
  if(!quiet)setLoading(true);
  try{
   const res=await fetch("/api/implementation?schoolId="+encodeURIComponent(schoolId),{
    headers:{"Authorization":"Bearer "+session.access_token},cache:"no-store"
   });
   const json=await res.json().catch(()=>({}));
   if(!res.ok)throw Error(json.error||"Unable to load evidence.");
   setInfo(json);
   setPeriods(old=>old.map(p=>({...p,classId:json.classes.some(c=>c.id===p.classId)?
    p.classId:json.classes[0]?.id||""})));
  }catch(e){setMessage(e.message);}finally{setLoading(false);}
 }
 useEffect(()=>{
  let active=true;setInfo({entries:[],files:[],reviews:[],people:[],classes:[],canSubmit:false,canReview:false,canFeedback:false});
  setMessage("");setLoading(true);setPeriods([emptyPeriod()]);setReceipt("");
  if(!schoolId){setLoading(false);return;}
  fetch("/api/implementation?schoolId="+encodeURIComponent(schoolId),{
   headers:{"Authorization":"Bearer "+session.access_token},cache:"no-store"
  }).then(async r=>{const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||"Unable to load evidence.");return j;})
   .then(j=>{if(active){setInfo(j);setPeriods([emptyPeriod(j.classes[0]?.id||"")]);setTab(j.canSubmit?"submit":"review");setLoading(false);}})
   .catch(e=>{if(active){setMessage(e.message);setLoading(false);}});
  return()=>{active=false;};
 },[schoolId,session?.access_token]);
 useEffect(()=>()=>{try{if(recorder.current?.state==="recording")recorder.current.stop();}catch{}
  try{speechRef.current?.stop();}catch{}audioStream.current?.getTracks().forEach(t=>t.stop());},[]);
 function update(key,values){setPeriods(old=>old.map(p=>p.key===key?{...p,...values}:p));}
 function uploadInput(key,category,files){
  const picked=Array.from(files||[]);
  if(category==="voice"){
   preparedVoices.current.delete(key);
   updateAttachment(key,category,picked.slice(0,1));
   if(picked[0]&&info.transcriptionAvailable)transcribeAudio(key,picked[0]);
  }else updateAttachment(key,category,picked);
 }
 function updateAttachment(key,category,files){
  setPeriods(old=>old.map(p=>p.key===key?{...p,attachments:{...p.attachments,[category]:files}}:p));
 }
 async function transcribeAudio(key,file){
  if(!info.transcriptionAvailable||!file)return;
  setTranscribing(key);
  try{
   const ticket=await call("uploadTicket",{category:"voice",contentType:file.type,name:file.name,size:file.size});
   const {error:uploadError}=await client.storage.from("vision-implementation")
    .uploadToSignedUrl(ticket.path,ticket.token,file,{contentType:file.type});
   if(uploadError)throw uploadError;
   const meta={path:ticket.path,category:"voice",contentType:file.type,name:file.name,size:file.size};
   preparedVoices.current.set(key,{file,meta});
   const period=periods.find(p=>p.key===key);
   const result=await call("transcribeVoice",{path:ticket.path,language:period?.language==="hi-IN"?"hi":"en"});
   update(key,{voiceNotes:result.transcript||""});
   setMessage("Voice transcribed. Please review and edit the transcription if needed.");
  }catch(e){
   setMessage("Audio kept for submission. Automatic transcription was unavailable: "+e.message+
    ". You can edit the transcript box when necessary.");
  }finally{setTranscribing(null);}
 }
 async function toggleMicrophone(key){
  if(recording===key){
   try{recorder.current?.stop();}catch{}
   try{speechRef.current?.stop();}catch{}
   speechRef.current=null;setRecording(null);return;
  }
  if(recording||!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){
   setMessage("Microphone recording is unavailable in this browser. Upload an audio recording instead.");return;
  }
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:true});
   audioStream.current=stream;
   const type=["audio/webm","audio/mp4"].find(t=>MediaRecorder.isTypeSupported(t))||"";
   const rec=new MediaRecorder(stream,type?{mimeType:type}:undefined),parts=[];
   const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
   if(SpeechRecognition){
    const speech=new SpeechRecognition();
    speech.continuous=true;speech.interimResults=true;
    speech.lang=periods.find(p=>p.key===key)?.language||"en-IN";
    const starting=periods.find(p=>p.key===key)?.voiceNotes||"";
    speech.onresult=event=>{
     const words=Array.from(event.results).map(item=>item[0]?.transcript||"").join(" ").trim();
     if(words)update(key,{voiceNotes:(starting+" "+words).trim().slice(0,5000)});
    };
    speech.onerror=()=>{if(!info.transcriptionAvailable)setMessage("Live speech recognition was interrupted. Your audio recording continues and can still be submitted.");};
    try{speech.start();speechRef.current=speech;}catch{speechRef.current=null;}
   }else if(!info.transcriptionAvailable){
    setMessage("Recording started. Live transcription is not supported by this browser. The voice file will still be saved.");
   }
   rec.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
   rec.onstop=()=>{
    const actual=(rec.mimeType||type||"audio/webm").split(";")[0];
    const file=new File(parts,"voice-reflection-"+Date.now()+"."+(actual.includes("mp4")?"m4a":"webm"),{type:actual});
    preparedVoices.current.delete(key);
    setPeriods(old=>old.map(p=>p.key===key?{...p,attachments:{
     ...p.attachments,voice:[file]
    }}:p));
    stream.getTracks().forEach(t=>t.stop());
    audioStream.current=null;recorder.current=null;setRecording(null);
    if(info.transcriptionAvailable)transcribeAudio(key,file);
   };
   recorder.current=rec;rec.start();setRecording(key);
   if(SpeechRecognition)setMessage("Recording voice. Live transcript will appear below where you can edit it.");
  }catch(e){setMessage("Cannot access microphone: "+e.message);}
 }
 async function submit(e){
  e.preventDefault();
  if(!hasSubmit||busy)return;
  if(recording||transcribing!==null){setMessage("Finish voice recording and transcription before submitting.");return;}
  if(periods.some(p=>!(p.attachments.voice||[]).length)){
   setMessage("Record or upload a voice reflection for every period before submitting.");return;
  }
  const all=periods.flatMap(p=>Object.entries(p.attachments).flatMap(([category,files])=>files.map(file=>({category,file}))));
  if(all.length>30||all.some(x=>x.file.size>50*1024*1024||x.file.size===0)){
   setMessage("Maximum 30 evidence files per submission and 50 MB per file.");return;
  }
  setBusy(true);setMessage("");
  const paths=[];
  let key=receipt;
  if(!key){key=crypto.randomUUID();setReceipt(key);}
  try{
   const details=[];
   for(let idx=0;idx<periods.length;idx++){
    const p=periods[idx],files=[];
    for(const [category,items] of Object.entries(p.attachments)){
     for(const file of items){
      const prepared=category==="voice"?preparedVoices.current.get(p.key):null;
      if(prepared?.file===file){
       paths.push(prepared.meta.path);files.push(prepared.meta);continue;
      }
      const ticket=await call("uploadTicket",{category,contentType:file.type,name:file.name,size:file.size});
      const {error:uploadError}=await client.storage.from("vision-implementation")
       .uploadToSignedUrl(ticket.path,ticket.token,file,{contentType:file.type});
      if(uploadError)throw uploadError;
      paths.push(ticket.path);
      files.push({path:ticket.path,category,contentType:file.type,name:file.name,size:file.size});
     }
    }
    details.push({period:idx+1,classId:p.classId,date:p.date,subject:p.subject,topic:p.topic,
     voiceNotes:p.voiceNotes,competencyIds:p.competencyIds,files});
   }
   const result=await call("submit",{submissionKey:key,periods:details});
   setMessage((result.message||"Submitted.")+" Receipt: "+result.receipt);
   preparedVoices.current.clear();setReceipt("");setPeriods([emptyPeriod(info.classes[0]?.id||"")]);setTab("mine");await load(true);
  }catch(err){
   // Already-linked evidence is kept by the API; only uncommitted uploads are removable.
   try{if(paths.length)await call("cleanupUploads",{paths});}catch{}
   preparedVoices.current.clear();
   setMessage("Submission not confirmed: "+err.message+" · Receipt: "+key+
    ". If a connection timed out after saving, refresh My submissions before trying again.");
  }finally{setBusy(false);}
 }
 async function saveReview(entryId,status,feedback){
  if(!hasFeedback)return;setBusy(true);setMessage("");
  try{const result=await call("review",{entryId,status,feedback});setMessage(result.message);await load(true);}
  catch(e){setMessage(e.message);}finally{setBusy(false);}
 }
 const allTeacherIds=[...new Set(reviewRows.map(e=>e.teacher_user_id))];
 return <div className="implementation-workspace">
  <section className="panel">
   <div className="panel-head"><h2><ClipboardCheck size={20}/> Teacher Implementation Evidence</h2>
    <span className="eyebrow">{schoolName||"SCHOOL WORKSPACE"}</span></div>
   <p className="helper">Daily classroom implementation and learning reflections. Submit period-wise evidence of lesson planning, teaching activities, student work, phonics, assessment, portfolio and voice reflections. School leaders, assigned Consultants and Super Admins can review submissions according to their access settings.</p>
   <div className="implementation-summary">
    <div><small>Recent submissions</small><strong>{aggregate.entries}</strong></div>
    <div><small>Evidence files</small><strong>{aggregate.files}</strong></div>
    <div><small>Awaiting review</small><strong>{aggregate.pending}</strong></div>
   </div>
   <div className="management-tabs" role="group" aria-label="Teacher implementation views">
    {hasSubmit&&<button type="button" className={"management-tab "+(tab==="submit"?"active":"")}
     onClick={()=>setTab("submit")}><Upload size={16}/> Submit evidence</button>}
    {hasSubmit&&<button type="button" className={"management-tab "+(tab==="mine"?"active":"")}
     onClick={()=>setTab("mine")}><BookOpen size={16}/> My submissions</button>}
    {hasReview&&<button type="button" className={"management-tab "+(tab==="review"?"active":"")}
     onClick={()=>setTab("review")}><Eye size={16}/> School evidence review</button>}
    <button className="management-tab" type="button" disabled={busy||loading} onClick={()=>load()}>
     <RefreshCw size={16}/> Refresh</button>
   </div>
  </section>
  {message&&<div className="notice" role="status">{message}</div>}
  {loading&&<p className="helper">Loading implementation evidence…</p>}
  {!schoolId&&<p className="helper">Select a school to continue.</p>}
  {tab==="submit"&&hasSubmit&&<form onSubmit={submit} className="implementation-submission">
   <div className="notice small"><FileAudio size={17}/>
    <span>Describe <strong>What</strong> you are teaching, <strong>Why</strong> the learning objective matters, the teacher and student activities, <strong>Practice & Apply</strong>, and <strong>Review</strong>. The uploaded lesson should reflect what happened on the selected date. Files are private and school-scoped.</span></div>
   {periods.map((p,index)=><section className="panel" key={p.key}>
    <div className="panel-head"><h2>Period {index+1}</h2>
     {periods.length>1&&<button type="button" className="btn outline" onClick={()=>setPeriods(old=>old.filter(x=>x.key!==p.key))}><Trash2 size={14}/> Remove</button>}</div>
    <div className="three-col">
     <label>Class · Section<select required value={p.classId} onChange={e=>update(p.key,{classId:e.target.value})}>
      <option value="">Select an assigned class</option>{info.classes.map(c=><option value={c.id} key={c.id}>{classTitle(c)}</option>)}</select></label>
     <label>Subject<select value={p.subject} onChange={e=>update(p.key,{subject:e.target.value})}>{SUBJECTS.map(sub=><option key={sub} value={sub}>{sub}</option>)}</select></label>
     <label>Implementation date<input required type="date" max={today()} value={p.date}
      onChange={e=>update(p.key,{date:e.target.value})}/></label>
    </div>
    <label>Lesson Plan No. & Topic / Chapter<input required minLength={3} maxLength={300}
     value={p.topic} placeholder="LP 12 – Plants Around Us"
     onChange={e=>update(p.key,{topic:e.target.value})}/></label>
    <div className="two-col">
     <label>Linked published literacy competency (optional)<select value={p.competencyId}
      onChange={e=>update(p.key,{competencyId:e.target.value})}>
      <option value="">No single competency linked</option>
      {competencies.filter(c=>c.active).map(c=><option key={c.id} value={c.id}>{c.grade} · {c.title}</option>)}
     </select></label>
     <label>Training programme applied (optional)<select value={p.trainingCourseId}
      onChange={e=>update(p.key,{trainingCourseId:e.target.value})}>
      <option value="">No training course linked</option>
      {courseList.filter(c=>c.target_roles.includes("teacher")).map(c=><option value={c.id} key={c.id}>{c.title}</option>)}
     </select></label>
    </div>
    <label>Teacher's implementation reflection<textarea rows={3} maxLength={5000}
     placeholder="What was the learning objective? How did you demonstrate, involve students, practise and review? What did students learn?"
     value={p.reflection} onChange={e=>update(p.key,{reflection:e.target.value})}/></label>
    <div className="implementation-voice">
     <h3><Mic size={17}/> Voice reflection</h3>
     <p className="helper">Use the microphone to record a short reflection, upload an existing audio file, or type a reflection summary.</p>
     <div className="implementation-voice-controls">
      <button type="button" className={"btn "+(recording===p.key?"primary":"outline")} disabled={busy||recording&&recording!==p.key}
       onClick={()=>toggleMicrophone(p.key)}><Mic size={15}/>{recording===p.key?"Stop recording":"Record voice"}</button>
      <label>Upload an audio recording<input type="file" multiple accept="audio/webm,audio/wav,audio/mp4,audio/mpeg,audio/x-m4a"
       onChange={e=>uploadInput(p.key,"voice",e.target.files)}/></label>
     </div>
     {p.attachments.voice?.length>0&&<p className="helper">{p.attachments.voice.map(f=>f.name).join(", ")}</p>}
     <label>Voice reflection notes (optional)<textarea rows={2} maxLength={5000} value={p.voiceNotes}
      onChange={e=>update(p.key,{voiceNotes:e.target.value})}/></label>
    </div>
    <h3 className="implementation-section-heading">Classroom Implementation & Learning Reflections</h3>
    <p className="helper">Attach photographs, documents or demonstration videos to the relevant evidence category. Multiple files per category are supported.</p>
    <div className="implementation-uploads">{CATEGORIES.map(category=><label key={category.id}
      className="implementation-file-category">
      <strong>{category.label}</strong>
      <input multiple type="file" accept={category.accept}
       onChange={e=>uploadInput(p.key,category.id,e.target.files)}/>
      <small>{p.attachments[category.id]?.length? p.attachments[category.id].length+" file(s) selected":"No files selected"}</small>
     </label>)}</div>
   </section>)}
   <div className="implementation-actions">
    <button type="button" className="btn outline" disabled={busy||periods.length>=10}
     onClick={()=>setPeriods(old=>[...old,emptyPeriod(info.classes[0]?.id||"")])}>
     <Plus size={16}/> Add another period ({periods.length}/10)</button>
    <button type="submit" className="btn primary" disabled={busy||!info.classes.length}>
     <Send size={16}/>{busy?"Uploading and saving…":"Submit daily implementation"}</button>
   </div>
   <p className="helper">Maximum 50 MB per file, 30 files across one submission, and up to 10 periods. A submission receipt is shown after saving. Do not share files containing unnecessary student personal details.</p>
  </form>}
  {(tab==="review"&&hasReview||tab==="mine"&&hasSubmit)&&<>
   <section className="panel">
    <div className="panel-head"><h2><Filter size={18}/> {tab==="review"?"School evidence dashboard":"My classroom submissions"}</h2></div>
    <p className="helper">Showing the latest 150 implementation entries. Filters apply to these recent records; refresh to renew private file links.</p>
    <div className="implementation-filters">
     {tab==="review"&&<label>Teacher<select value={teacherFilter} onChange={e=>setTeacherFilter(e.target.value)}>
      <option value="all">All teachers</option>
      {allTeacherIds.map(id=><option key={id} value={id}>{personName(id)}</option>)}</select></label>}
     <label>Class<select value={classFilter} onChange={e=>setClassFilter(e.target.value)}>
      <option value="all">All classes</option>{info.classes.map(c=><option value={c.id} key={c.id}>{classTitle(c)}</option>)}</select></label>
     <label>Review status<select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
      <option value="all">All statuses</option><option value="pending">Awaiting review</option>
      <option value="reviewed">Reviewed</option><option value="needs_follow_up">Needs follow-up</option></select></label>
     <label>Evidence category<select value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}>
      <option value="all">All materials</option>{Object.entries(LABELS).map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>
     <label>From lesson date<input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label>
     <label>To lesson date<input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label>
     <label>Search lesson<input type="search" value={search} onChange={e=>setSearch(e.target.value)}
      placeholder="Topic / subject / teacher"/></label>
    </div>
    {hasReview&&<div className="implementation-teacher-summary">
     <h3>Teacher implementation evidence coverage</h3>
     <p className="helper">Counts represent submitted evidence, not the quality of teaching. Review period is limited to the recent 150 entries loaded.</p>
     <div className="table-wrap"><table><thead><tr>
      <th>Teacher</th><th>Periods</th><th>Files</th><th>Voice</th><th>Lesson plans</th>
      <th>Activities</th><th>Writing</th><th>Phonics</th><th>Assessment</th><th>Portfolio</th><th>Pending reviews</th>
     </tr></thead><tbody>{allTeacherIds.map(id=>{
      const periods=reviewerRows.filter(e=>e.teacher_user_id===id);
      const evidences=periods.flatMap(e=>filesByEntry(e.id));
      const count=type=>evidences.filter(f=>f.category===type).length;
      return <tr key={id}><td>{personName(id)}</td><td>{periods.length}</td>
       <td>{evidences.length}</td><td>{count("voice")}</td><td>{count("lesson_plan")}</td>
       <td>{count("activity")}</td><td>{count("writing")}</td><td>{count("phonics")}</td>
       <td>{count("assessment")}</td><td>{count("portfolio")}</td>
       <td>{periods.filter(e=>!reviewByEntry(e.id)).length}</td></tr>;
     })}</tbody></table></div>
    </div>}
    {hasReview&&<div className="implementation-category-counts">
     {Object.entries(aggregate.categoryCounts).map(([id,count])=><span key={id}>{LABELS[id]}: <strong>{count}</strong></span>)}
    </div>}
   </section>
   {reviewerRows.map(e=><ReviewCard key={e.id} entry={e} files={filesByEntry(e.id)}
    review={reviewByEntry(e.id)} teacher={personName(e.teacher_user_id)}
    classLabel={className(e.class_id)} canFeedback={tab==="review"&&hasFeedback}
    onSave={saveReview} busy={busy}/>)}
   {!reviewerRows.length&&!loading&&<section className="panel"><p className="helper">
    No implementation evidence matches the selected filters yet.</p></section>}
  </>}
 </div>;
}
