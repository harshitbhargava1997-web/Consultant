'use client';
import {useEffect,useState} from 'react';
import {ClipboardList,Camera,MessageSquareText,ArrowRight,RefreshCw,CircleCheck,ThumbsUp} from 'lucide-react';
import {dayLabel,hindiOptions} from './lesson-plan-form';

const monthNames={en:['January','February','March','April','May','June','July','August','September','October','November','December'],hi:['जनवरी','फ़रवरी','मार्च','अप्रैल','मई','जून','जुलाई','अगस्त','सितंबर','अक्टूबर','नवंबर','दिसंबर']};
// Recent lessons: every lesson planned on or before today, newest first, with or without evidence. Evidence is
// measured against the school's targets for the period, not per lesson, so nothing here is shown as overdue.
export function recentLessons(summary){
 if(!summary)return [];
 return summary.lessons.filter(l=>l.plannedOn<=summary.today).sort((a,b)=>b.plannedOn.localeCompare(a.plannedOn)||String(a.id).localeCompare(String(b.id)));
}
export function monthStats(summary){
 if(!summary)return {planned:0,withEvidence:0,feedback:0,upcoming:0};
 const month=summary.today.slice(0,7),inMonth=summary.lessons.filter(l=>l.plannedOn.slice(0,7)===month);
 const periods=inMonth.flatMap(l=>l.periods);
 return {planned:periods.length,withEvidence:periods.filter(p=>p.evidence).length,feedback:summary.feedback.filter(f=>String(f.date).slice(0,7)===month).length,upcoming:summary.lessons.filter(l=>l.plannedOn>summary.today).reduce((n,l)=>n+l.periods.length,0)};
}
// "Yesterday" / "3 days ago" from two YYYY-MM-DD strings.
export function ago(today,day,language='en'){const n=Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000);if(language==='hi')return n===1?'कल':n+' दिन पहले';return n===1?'Yesterday':n+' days ago';}
export const seenKey=who=>'school-success:feedback-seen:'+who;
// Feedback the teacher has not seen yet on this device (the Feedback tab marks it as seen).
export function newFeedbackCount(summary,who){
 const items=summary?.feedback||[];if(!items.length)return 0;
 let seen='';try{seen=localStorage.getItem(seenKey(who))||'';}catch{}
 return items.filter(f=>String(f.date)>seen).length;
}
function lessonTitle(p,language){const o=v=>language==='hi'?(hindiOptions[v]||v.replace('Grade ','कक्षा ')):v;return [p.grade&&o(p.grade)+(p.section&&p.section!=='Not Applicable'?' '+p.section:''),p.subject&&o(p.subject)].filter(Boolean).join(' · ');}

export function SummaryStrip({summary,language}){
 const t=(en,hi)=>language==='hi'?hi:en,s=monthStats(summary),month=summary?monthNames[language][Number(summary.today.slice(5,7))-1]:'';
 return <section className="ts-strip" aria-label={t('Your month','आपका महीना')}>
  <div className="ts-stat"><span className="ts-icon c1"><ClipboardList size={18}/></span><div><strong>{summary?s.planned:'–'}</strong><small>{t('Lessons planned in ','योजना बनाई — ')+month}</small>{s.upcoming>0&&<em>{s.upcoming} {t('coming up','आने वाले')}</em>}</div></div>
  <div className="ts-stat"><span className="ts-icon c2"><Camera size={18}/></span><div><strong>{summary?s.withEvidence:'–'}</strong><small>{t('Evidence shared this month','इस महीने साझा किए गए प्रमाण')}</small></div></div>
  <div className="ts-stat"><span className="ts-icon c3"><MessageSquareText size={18}/></span><div><strong>{summary?s.feedback:'–'}</strong><small>{t('Feedback received this month','इस महीने मिली प्रतिक्रिया')}</small></div></div>
 </section>;
}

export function RecentLessons({summary,language,onOpen,limit,onShowAll,loading,error,onRetry}){
 const t=(en,hi)=>language==='hi'?hi:en,items=recentLessons(summary),shown=limit?items.slice(0,limit):items;
 return <section className="ts-card">
  <div className="ts-card-head"><div><h3>{t('Recent lessons','हाल के पाठ')}</h3><p>{t('Add photos, written work or a reflection when you have them.','जब आपके पास हों, फोटो, लिखित कार्य या चिंतन जोड़ें।')}</p></div></div>
  {error?<div className="ts-empty"><p>{error}</p><button type="button" className="button" onClick={onRetry}><RefreshCw size={15}/>{t('Try again','फिर कोशिश करें')}</button></div>
  :loading&&!summary?<div className="ts-skeleton" aria-busy="true"><span/><span/></div>
  :!items.length?<div className="ts-empty"><ClipboardList size={28}/><p>{t('Your lessons appear here after their planned day.','आपके पाठ नियोजित दिन के बाद यहाँ दिखेंगे।')}</p></div>
  :<ul className="ts-list">{shown.map(l=>{const m=/^\d{4}-(\d{2})-(\d{2})$/.exec(l.plannedOn);const first=l.periods[0]||{};
    return <li key={l.id}><button type="button" className="ts-lesson" onClick={()=>onOpen(l.resumeToken)}>
     <span className="ts-date"><b>{m?Number(m[2]):''}</b><small>{dayLabel(l.plannedOn,language).split(',')[0]}</small></span>
     <span className="ts-lesson-text"><b>{lessonTitle(first,language)}{l.periods.length>1?' +'+(l.periods.length-1):''}</b><small>{first.topic}</small>{l.evidence&&<em className="ts-done"><CircleCheck size={12}/>{t('Evidence added','प्रमाण जोड़ा गया')}</em>}</span>
     <span className="ts-go">{l.evidence?t('Add more','और जोड़ें'):t('Add evidence','प्रमाण जोड़ें')}<ArrowRight size={15}/></span>
    </button></li>;})}</ul>}
  {limit&&items.length>limit&&<button type="button" className="text-button" onClick={onShowAll}>{t('Show all recent lessons','सभी हाल के पाठ देखें')} ({items.length})<ArrowRight size={14}/></button>}
 </section>;
}

export function FeedbackCard({summary,language,who,onOpen,onNote}){
 const t=(en,hi)=>language==='hi'?hi:en,items=summary?.feedback||[];
 const [seen,setSeen]=useState(null),[expanded,setExpanded]=useState(false),[noting,setNoting]=useState(''),[noteError,setNoteError]=useState('');
 // "Noted" tells the reviewer the teacher has read this feedback. It is saved once and cannot be undone.
 async function note(f){const id=f.recordId+'|'+f.key;setNoting(id);setNoteError('');try{await onNote(f);}catch(e){setNoteError(e.message||t('Could not save. Please try again.','सहेजा नहीं जा सका। फिर कोशिश करें।'));}finally{setNoting('');}}
 useEffect(()=>{if(!summary)return;let last='';try{last=localStorage.getItem(seenKey(who))||'';}catch{}setSeen(last);
  // Items stay marked "New" during this visit; the next visit treats them as read.
  const newest=items[0]?.date;if(newest)try{localStorage.setItem(seenKey(who),newest);}catch{}},[summary,who]);
 const isNew=f=>seen!==null&&String(f.date)>seen;
 const shown=expanded?items:items.slice(0,3);
 return <section className="ts-card ts-feedback">
  <div className="ts-card-head"><div><h3>{t('Feedback received','मिली प्रतिक्रिया')}</h3><p>{t('Comments from your academic reviewer on your lessons.','आपके पाठों पर शैक्षणिक समीक्षक की टिप्पणियाँ।')}</p></div>{items.filter(isNew).length>0&&<span className="ts-new">{items.filter(isNew).length} {t('new','नई')}</span>}</div>
  {!items.length?<div className="ts-empty"><MessageSquareText size={26}/><p>{t('No feedback yet. When your lessons are reviewed, comments appear here.','अभी कोई प्रतिक्रिया नहीं है। समीक्षा होने पर टिप्पणियाँ यहाँ दिखेंगी।')}</p></div>
  :<ul className="ts-feed">{shown.map((f,i)=><li key={f.lessonId+':'+i} className={isNew(f)?'new':''}>
    <div className="ts-feed-head"><b>{lessonTitle(f,language)}</b>{isNew(f)&&<span className="ts-new small">{t('New','नई')}</span>}<small>{f.date?dayLabel(String(f.date).slice(0,10),language):''}</small></div>
    <p className="ts-topic">{f.topic}</p>
    <p className="ts-feed-text">{f.text}</p>
    <div className="ts-feed-actions">{onNote&&f.recordId&&(f.notedAt?<span className="ts-noted done"><CircleCheck size={14}/>{t('Noted on ','नोट किया · ')+dayLabel(String(f.notedAt).slice(0,10),language)}</span>:<button type="button" className="ts-noted" disabled={!!noting} onClick={()=>void note(f)}><ThumbsUp size={14}/>{noting===f.recordId+'|'+f.key?t('Saving…','सहेजा जा रहा है…'):t('Noted','नोट किया')}</button>)}<button type="button" className="text-button" onClick={()=>onOpen(f.resumeToken)}>{t('Open lesson','पाठ खोलें')}<ArrowRight size={14}/></button></div>
   </li>)}</ul>}
  {noteError&&<p className="alert error" role="alert">{noteError}</p>}
  {onNote&&items.length>0&&<p className="hint">{t('Tap “Noted” to let your reviewer know you have read their feedback.','समीक्षक को बताने के लिए कि आपने प्रतिक्रिया पढ़ ली है, “नोट किया” दबाएँ।')}</p>}
  {items.length>3&&<button type="button" className="text-button" onClick={()=>setExpanded(v=>!v)}>{expanded?t('Show less','कम दिखाएँ'):t('Show all feedback','सभी प्रतिक्रिया देखें')+' ('+items.length+')'}</button>}
 </section>;
}
