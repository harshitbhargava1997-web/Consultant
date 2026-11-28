'use client';
// Day status in the Planner (owner decision, 28 November 2026, option B): under the lesson date, three one-tap
// buttons for the everyday choices (Present, Half day, Absent) and an "Exam or holiday?" link that opens big tiles
// for School examination and the four kinds of holiday or vacation. Present is the default and needs no tap.
// Exams and vacations take a From–To range. Principals, coordinators and the School Success team use the same
// control to correct a teacher's day (leader mode); the teacher's own mark is kept.
import {useEffect,useMemo,useState} from 'react';
import {CalendarOff,Check,X} from 'lucide-react';
import {dayStatusNames,examNames,halfNames,EXAM_TYPES,RANGE_STATUSES,statusLabel} from '@/lib/school-success/day-status';
import {reviewerLabel} from '@/lib/school-success/lesson-reviews';

const tiles=[['exam','📝'],['summer','☀️'],['winter','❄️'],['festival','🪔'],['national','🇮🇳'],['other','🗓️']];
const short=d=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(d||'');return m?Number(m[3])+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m[2])-1]:'';};
export const rangeText=s=>s.from===s.to?short(s.from):short(s.from)+' – '+short(s.to);
const blank=date=>({status:'present',half:'',exam:'',name:'',note:'',from:date,to:date});
const fromSaved=(s,date)=>s?{status:s.status,half:s.half||'',exam:s.exam||'',name:s.name||'',note:s.note||'',from:s.from,to:s.to}:blank(date);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// date: the day being planned or corrected. api(body) → {statuses}. saved: the day's stored status (or null).
// onSaved(status|null): told of the new status. leader: correcting someone else's day.
export default function DayStatus({language='en',date,api,saved,onSaved,leader=false,teacherName='',disabled=false}){
 const hi=language==='hi',t=(en,hn)=>hi?hn:en,name=k=>dayStatusNames[k][hi?1:0];
 const initial=useMemo(()=>fromSaved(saved,date),[saved,date]);
 const [draft,setDraft]=useState(initial),[sheet,setSheet]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 useEffect(()=>{setDraft(initial);setError('');setDone('');},[initial]);
 const ranged=RANGE_STATUSES.has(draft.status);
 // Choosing a status starts from the planned day; a range keeps its dates when switching between range types.
 function choose(status){setDraft(d=>({...blank(date),status,half:status==='half-day'?d.half||'first':'',from:RANGE_STATUSES.has(status)&&RANGE_STATUSES.has(d.status)?d.from:date,to:RANGE_STATUSES.has(status)&&RANGE_STATUSES.has(d.status)?d.to:date,note:d.note}));setSheet(false);setError('');setDone('');}
 const change=c=>{setDraft(d=>({...d,...c}));setError('');setDone('');};
 // Nothing to save while the draft matches what is stored (Present when nothing is stored).
 const dirty=!same(draft,initial);
 async function save(){
  setBusy(true);setError('');
  try{
   const body={action:'save',from:draft.from,to:ranged?draft.to:draft.from,status:draft.status,requestId:crypto.randomUUID(),
    ...(draft.status==='half-day'?{half:draft.half}:{}),...(draft.status==='exam'?{exam:draft.exam}:{}),...(draft.name.trim()?{name:draft.name.trim()}:{}),...(draft.note.trim()?{note:draft.note.trim()}:{})};
   const r=await api(body),next=(r.statuses||[]).find(s=>s.date===date)||null;
   onSaved?.(next);setDone(t('Saved.','सहेजा गया।'));
  }catch(e){setError(e.message||t('Could not save. Please try again.','सहेजा नहीं जा सका। फिर कोशिश करें।'));}
  finally{setBusy(false);}
 }
 const off=disabled||busy;
 // Enter in a text box must not submit the lesson plan form this control sits in.
 return <div className={'ds'+(leader?' leader':'')} onKeyDown={e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT')e.preventDefault();}}>
  {leader&&saved?.teacherMark&&<p className="ds-mark">{t('Marked by teacher','शिक्षक ने चिह्नित किया')}: <b>{statusLabel(saved.teacherMark,language)}</b></p>}
  {leader&&saved&&!saved.changedByLeader&&<p className="ds-mark">{t('Marked by','चिह्नित')} {teacherName||t('the teacher','शिक्षक')}: <b>{statusLabel(saved,language)}</b></p>}
  <span className="ds-label">{t('This day','यह दिन')}</span>
  <div className="ds-quick" role="radiogroup" aria-label={t('This day','यह दिन')}>
   {['present','half-day','absent'].map(k=>{const on=draft.status===k;return <button key={k} type="button" role="radio" aria-checked={on} disabled={off} className={'ds-btn '+k+(on?' on':'')} onClick={()=>choose(k)}>{on&&<Check size={14}/>}{name(k)}</button>;})}
  </div>
  {ranged?<button type="button" className="ds-chosen" disabled={off} onClick={()=>setSheet(true)}><span>{tiles.find(([k])=>k===draft.status)?.[1]} <b>{name(draft.status)}</b></span><em>{t('Change','बदलें')}</em></button>
  :<button type="button" className="ds-more" disabled={off} onClick={()=>setSheet(true)}><CalendarOff size={14}/>{t('Exam or holiday? Mark it','परीक्षा या अवकाश? चिह्नित करें')} →</button>}

  {draft.status==='half-day'&&<div className="ds-detail"><span className="ds-sub">{leader?t('Which half was the teacher in school?','शिक्षक किस पाली में विद्यालय में थे?'):t('Which half were you in school?','आप किस पाली में विद्यालय में थे?')}</span>
   <div className="ds-seg" role="radiogroup">{['first','second'].map(h=><button key={h} type="button" role="radio" aria-checked={draft.half===h} disabled={off} className={draft.half===h?'on':''} onClick={()=>change({half:h})}>{halfNames[h][hi?1:0]}</button>)}</div></div>}
  {draft.status==='exam'&&<div className="ds-detail"><span className="ds-sub">{t('Which examination?','कौन-सी परीक्षा?')}</span>
   <div className="ds-pills" role="radiogroup">{EXAM_TYPES.map(k=><button key={k} type="button" role="radio" aria-checked={draft.exam===k} disabled={off} className={draft.exam===k?'on':''} onClick={()=>change({exam:k})}>{examNames[k][hi?1:0]}</button>)}</div></div>}
  {(draft.status==='festival'||draft.status==='national'||draft.status==='other')&&<label className="ds-detail"><span className="ds-sub">{draft.status==='other'?t('Name of the holiday','अवकाश का नाम'):draft.status==='festival'?t('Festival (optional)','त्योहार (वैकल्पिक)'):t('Which holiday? (optional)','कौन-सा अवकाश? (वैकल्पिक)')}</span>
   <input maxLength={60} disabled={off} value={draft.name} placeholder={draft.status==='other'?t('Example: Sports day, local fair','उदाहरण: खेल दिवस, स्थानीय मेला'):draft.status==='festival'?t('Example: Diwali','उदाहरण: दीपावली'):t('Example: Republic Day','उदाहरण: गणतंत्र दिवस')} onChange={e=>change({name:e.target.value})}/></label>}
  {ranged&&<div className="ds-range"><label><span className="ds-sub">{t('From','से')}</span><input type="date" disabled={off} value={draft.from} onChange={e=>e.target.value&&change({from:e.target.value,to:draft.to<e.target.value?e.target.value:draft.to})}/></label>
   <label><span className="ds-sub">{t('To','तक')}</span><input type="date" disabled={off} min={draft.from} value={draft.to} onChange={e=>e.target.value&&change({to:e.target.value})}/></label></div>}
  {leader||draft.status==='absent'?<label className="ds-detail"><span className="ds-sub">{leader?t('Reason (optional)','कारण (वैकल्पिक)'):t('Note (optional)','टिप्पणी (वैकल्पिक)')}</span>
   <input maxLength={200} disabled={off} value={draft.note} placeholder={leader?t('Example: came after lunch','उदाहरण: भोजनावकाश के बाद आए'):t('Example: medical leave','उदाहरण: चिकित्सा अवकाश')} onChange={e=>change({note:e.target.value})}/></label>:null}

  {saved&&!dirty&&!leader&&<p className="ds-saved"><Check size={14}/>{statusLabel(saved,language)}{saved.from!==saved.to?' · '+rangeText(saved):''}{saved.changedByLeader&&<em className="ds-changed">{t('Changed by','बदला गया —')} {reviewerLabel(saved.by)||t('your school','आपके विद्यालय')}{saved.teacherMark?' · '+t('you marked','आपने चिह्नित किया')+': '+statusLabel(saved.teacherMark,language):''}{saved.note?' · '+saved.note:''}</em>}</p>}
  {error&&<p className="lp-error" role="alert">{error}</p>}
  {done&&!dirty&&<p className="ds-done" role="status">{done}</p>}
  {dirty&&<button type="button" className="button primary ds-save" disabled={off||(draft.status==='exam'&&!draft.exam)||(draft.status==='half-day'&&!draft.half)||(draft.status==='other'&&!draft.name.trim())} onClick={()=>void save()}>{busy?t('Saving…','सहेजा जा रहा है…'):leader?t('Save change','बदलाव सहेजें'):draft.status==='present'?t('Save as Present','उपस्थित के रूप में सहेजें'):ranged&&draft.from!==draft.to?t('Save','सहेजें'):t('Save day','दिन सहेजें')}</button>}

  {sheet&&<><div className="ta-sheet-bg ds-sheet-bg" onClick={()=>setSheet(false)}/><div className="ta-sheet ds-sheet" role="dialog" aria-modal="true" aria-label={t('Exam or holiday','परीक्षा या अवकाश')}>
   <div className="ta-grab"/><button type="button" className="ta-sheet-x icon" aria-label={t('Close','बंद करें')} onClick={()=>setSheet(false)}><X size={18}/></button>
   <h3>{t('Exam or holiday','परीक्षा या अवकाश')}</h3>
   <div className="ds-tiles">{tiles.map(([k,icon])=><button key={k} type="button" className={'ds-tile'+(draft.status===k?' on':'')} onClick={()=>choose(k)}><i aria-hidden="true">{icon}</i>{name(k)}</button>)}</div>
  </div></>}
 </div>;
}

// The teacher's day statuses for [from, to] as a Map date → status (owner decision, 28 November 2026: Home and the
// weekly subject plan show and change the same day status as the daily plan). reload() reads them again.
export function useDayStatuses(api,from,to){
 const key=from+'|'+to,[state,setState]=useState({key:'',map:new Map(),loaded:false}),[tick,setTick]=useState(0);
 useEffect(()=>{
  if(!api||!from||!to)return;let live=true;
  api({action:'read',from,to}).then(r=>{if(live)setState({key,map:new Map((r.statuses||[]).map(s=>[s.date,s])),loaded:true});})
   .catch(()=>{if(live)setState({key,map:new Map(),loaded:true});});
  return ()=>{live=false;};
 },[key,tick,!!api]);
 return {map:state.key===key?state.map:new Map(),loaded:state.key===key&&state.loaded,reload:()=>setTick(n=>n+1)};
}
// The day-status control in a bottom sheet, for one date (a day of the weekly plan's strip, a marked day in the
// daily plan). choices (Home): [{date,label}] — Today and Tomorrow — with savedFor(date) giving each day's status.
export function DaySheet({language='en',date,title,api,saved,savedFor,choices,onClose,onSaved}){
 const t=(en,hn)=>language==='hi'?hn:en;
 const [pick,setPick]=useState(date||choices?.[0]?.date||''),day=choices?pick:date;
 useEffect(()=>{const k=e=>{if(e.key==='Escape')onClose();};addEventListener('keydown',k);return ()=>removeEventListener('keydown',k);},[]);
 return <><div className="ta-sheet-bg" onClick={onClose}/><div className="ta-sheet ds-day-sheet" role="dialog" aria-modal="true" aria-label={title}>
  <div className="ta-grab"/><button type="button" className="ta-sheet-x icon" aria-label={t('Close','बंद करें')} onClick={onClose}><X size={18}/></button>
  <h3 className="ds-day-title">{title}</h3>
  {choices&&<div className="ds-seg ds-when" role="radiogroup" aria-label={title}>{choices.map(c=><button key={c.date} type="button" role="radio" aria-checked={pick===c.date} className={pick===c.date?'on':''} onClick={()=>setPick(c.date)}>{c.label}</button>)}</div>}
  <DayStatus key={day} language={language} date={day} api={api} saved={(savedFor?savedFor(day):saved)||null} onSaved={s=>onSaved?.(s,day)}/>
 </div></>;
}
