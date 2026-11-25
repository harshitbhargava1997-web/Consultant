'use client';
// Teacher app layout for teachers signed in through their school link (owner-approved design, 24 November 2026):
// home with today's lessons, month numbers and recent lessons with a date filter; a plan reader for class; a bottom
// tab bar; and a profile menu for language, PIN and log out. Data comes from the existing myLessons summary and the
// existing lesson "resume" read; nothing new is stored.
import {useEffect,useState} from 'react';
import {House,ClipboardList,Camera,MessageSquareText,ChevronRight,ArrowLeft,CircleCheck,BookOpen,CalendarDays,KeyRound,LogOut,Languages,Target,Package,Presentation,Users,PencilLine,ListChecks,NotebookPen,StickyNote,X,RefreshCw,Type,PlayCircle} from 'lucide-react';
import {dayLabel,hindiOptions} from './lesson-plan-form';
import {monthStats} from './teacher-summary';
import {parsePlanText,planSectionTitles} from '@/lib/school-success/plan-text';
import {planDays,periodsOn,planFilterOptions,filterPlanDays,chipRange,classOf} from '@/lib/school-success/day-periods';

const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
// Monday of the week containing `day` (school weeks run Monday to Saturday).
export function weekStart(day){const d=new Date(day+'T00:00:00Z').getUTCDay();return addDays(day,-((d+6)%7));}
export function istHour(now=new Date()){return Number(now.toLocaleString('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',hour12:false}))%24;}
export function greeting(hour,language='en'){
 if(language==='hi')return hour<12?'सुप्रभात':hour<17?'नमस्ते':'शुभ संध्या';
 return hour<12?'Good morning':hour<17?'Good afternoon':'Good evening';
}
export function todaysLessons(summary){return (summary?.lessons||[]).filter(l=>l.plannedOn===summary.today);}
const classLabel=(p,o=v=>v)=>[[p.grade&&o(p.grade),p.section&&p.section!=='Not Applicable'?p.section:''].filter(Boolean).join(' '),p.subject&&o(p.subject)].filter(Boolean).join(' · ');

const FILTER_KEY='school-success:home-filters';
function savedFilters(){try{const v=JSON.parse(localStorage.getItem(FILTER_KEY)||'{}');return {filter:['today','week','month','range'].includes(v.filter)?v.filter:'week',cls:typeof v.cls==='string'?v.cls:'',subject:typeof v.subject==='string'?v.subject:''};}catch{return {filter:'week',cls:'',subject:''};}}

// Home (owner request, 25 November 2026): today's periods and recent lessons are shown day by day, every class
// period with its number (Period 1, 2, 3, 4) in the order it was saved, whatever save it came from. Recent lessons
// can be narrowed by Today / This week (Monday–Sunday) / This month / a date, and by class and subject; each
// period opens its own plan. The choice is remembered on this phone.
export function TeacherHome({summary,language,teacher,school,newFeedback,onRead,onEvidence,onPlan,loading,error,onRetry,notice}){
 const t=(en,hi)=>language==='hi'?hi:en,o=v=>language==='hi'?(hindiOptions[v]||String(v).replace('Grade ','कक्षा ')):v;
 const [prefs,setPrefs]=useState(savedFilters),[range,setRange]=useState({from:'',to:''}),[all,setAll]=useState(false);
 const {filter,cls,subject}=prefs;
 function choose(change){setPrefs(p=>{const next={...p,...change};try{localStorage.setItem(FILTER_KEY,JSON.stringify(next));}catch{}return next;});setAll(false);}
 const lessons=summary?.lessons||[],todayDate=summary?.today||'';
 const periodsToday=summary?periodsOn(lessons,todayDate):[];
 const options=planFilterOptions(lessons);
 const classNames=new Map(lessons.flatMap(l=>l.periods||[]).map(p=>[classOf(p),[p.grade&&o(p.grade),p.section&&p.section!=='Not Applicable'?p.section:''].filter(Boolean).join(' ')]));
 // A remembered class or subject that is no longer in the list is ignored.
 const useCls=options.classes.includes(cls)?cls:'',useSubject=options.subjects.includes(subject)?subject:'';
 const days=summary?filterPlanDays(lessons,{...chipRange(filter,todayDate,range),cls:useCls,subject:useSubject}):[];
 const shown=all?days:days.slice(0,5);
 // Month numbers follow the class and subject filter.
 const narrowed=summary&&(useCls||useSubject)?{...summary,lessons:lessons.map(l=>({...l,periods:l.periods.filter(p=>(!useCls||classOf(p)===useCls)&&(!useSubject||p.subject===useSubject))}))}:summary;
 const s=monthStats(narrowed),month=summary?new Date(summary.today+'T00:00:00Z').toLocaleDateString(language==='hi'?'hi-IN':'en-IN',{month:'long',timeZone:'UTC'}):'';
 const first=String(teacher||'').split(' ')[0];
 const dateLine=summary?new Date(summary.today+'T00:00:00Z').toLocaleDateString(language==='hi'?'hi-IN':'en-IN',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}):'';
 const periodName=n=>t('Period','कालांश')+' '+n;
 return <div className="ta-home">
  <div className="ta-hello"><small>{dateLine}</small><h1>{greeting(istHour(),language)}, {first}</h1><p>{school}</p></div>
  {notice}
  <section className="ta-today">
   {summary&&!periodsToday.length?<>
    <h3>{t('No lesson planned for today','आज के लिए कोई पाठ योजना नहीं')}</h3><p>{t('Plan your next lesson in a few minutes.','कुछ मिनटों में अगला पाठ योजना बनाएँ।')}</p>
    <button type="button" className="ta-cta" onClick={onPlan}><ClipboardList size={18}/>{t('Plan a lesson','पाठ योजना बनाएँ')}</button></>
   :<>
    <h3>{t('Today','आज')} · {summary?periodsToday.length:'–'} {t(periodsToday.length===1?'lesson planned':'lessons planned','पाठ नियोजित')}</h3>
    <p>{t('Tap a lesson to read your plan. After class, add a photo or a quick reflection.','योजना पढ़ने के लिए पाठ छुएँ। कक्षा के बाद फोटो या छोटा चिंतन जोड़ें।')}</p>
    <div className="ta-today-chips">{periodsToday.map(x=><button type="button" key={x.key} className="ta-today-chip" onClick={()=>onRead(x.lesson.resumeToken,x.index,x.period)}><BookOpen size={14}/><span>{periodName(x.number)} · {classLabel(x.period,o)}</span></button>)}</div>
    {periodsToday[0]&&<button type="button" className="ta-cta" onClick={()=>onEvidence(periodsToday[0].lesson.resumeToken,0)}><Camera size={18}/>{t('Add evidence for today','आज के प्रमाण जोड़ें')}</button>}
   </>}
  </section>
  <div className="ta-stats">
   <div className="ta-stat"><b>{summary?s.planned:'–'}</b><span>{t('Lessons planned in ','योजना बनाई — ')+month}</span></div>
   <div className="ta-stat"><b>{summary?s.withEvidence:'–'}</b><span>{t('Evidence shared this month','इस महीने साझा किए गए प्रमाण')}</span></div>
   <div className="ta-stat"><b>{summary?newFeedback:'–'}</b><span>{t('New feedback','नई प्रतिक्रिया')}</span></div>
  </div>
  <section className="ta-card">
   <div className="ta-card-head"><h3>{t('Recent lessons','हाल के पाठ')}</h3></div>
   <p className="ta-sub">{t('Tap a period to read its plan, or the camera to add evidence.','योजना पढ़ने के लिए कालांश छुएँ, प्रमाण के लिए कैमरा।')}</p>
   <div className="ta-filters" role="group" aria-label={t('Show lessons from','पाठ दिखाएँ')}>{[['today',t('Today','आज')],['week',t('This week','इस सप्ताह')],['month',t('This month','इस महीने')],['range',t('Date','तिथि')]].map(([k,l])=><button type="button" key={k} aria-pressed={filter===k} className={'ta-chip'+(filter===k?' on':'')} onClick={()=>choose({filter:k})}>{k==='range'&&<CalendarDays size={13}/>}{l}</button>)}</div>
   {filter==='range'&&<div className="ta-range"><label><span>{t('From','से')}</span><input type="date" value={range.from} onChange={e=>setRange(r=>({...r,from:e.target.value}))}/></label><label><span>{t('To','तक')}</span><input type="date" value={range.to} onChange={e=>setRange(r=>({...r,to:e.target.value}))}/></label></div>}
   {(options.classes.length>0||options.subjects.length>0)&&<div className="ta-selects">
    <label><span>{t('Class','कक्षा')}</span><select aria-label={t('Class','कक्षा')} value={useCls} onChange={e=>choose({cls:e.target.value})}><option value="">{t('All classes','सभी कक्षाएँ')}</option>{options.classes.map(c=><option key={c} value={c}>{classNames.get(c)||c}</option>)}</select></label>
    <label><span>{t('Subject','विषय')}</span><select aria-label={t('Subject','विषय')} value={useSubject} onChange={e=>choose({subject:e.target.value})}><option value="">{t('All subjects','सभी विषय')}</option>{options.subjects.map(v=><option key={v} value={v}>{o(v)}</option>)}</select></label>
   </div>}
   {error?<div className="ta-empty"><p>{error}</p><button type="button" className="button" onClick={onRetry}><RefreshCw size={15}/>{t('Try again','फिर कोशिश करें')}</button></div>
   :loading&&!summary?<div className="ts-skeleton" aria-busy="true"><span/><span/></div>
   :!days.length?<div className="ta-empty"><p>{filter==='range'&&!range.from&&!range.to?t('Choose a date or a range.','कोई तिथि या अवधि चुनें।'):t('No lessons in this period.','इस अवधि में कोई पाठ नहीं।')}</p></div>
   :<ul className="ta-days">{shown.map(d=>{const m=/^\d{4}-(\d{2})-(\d{2})$/.exec(d.date),past=d.date<=todayDate;
    return <li key={d.date} className="ta-dayrow">
     <div className="ta-day-head"><span className="ta-date"><b>{m?Number(m[2]):''}</b><small>{dayLabel(d.date,language).split(',')[0]}</small></span><span className="ta-day-title"><b>{d.date===todayDate?t('Today','आज'):dayLabel(d.date,language)}</b><small>{d.periods.length} {t(d.periods.length===1?'period':'periods','कालांश')}</small></span></div>
     <ul className="ta-periods">{d.periods.map(x=><li key={x.key}>
      <button type="button" className="ta-period" onClick={()=>onRead(x.lesson.resumeToken,x.index,x.period)}><span className="ta-pnum">{periodName(x.number)}</span><span className="ta-lesson-text"><b>{classLabel(x.period,o)}</b><small>{x.period.topic}</small>{x.period.evidence&&<em><CircleCheck size={11}/>{t('Evidence added','प्रमाण जोड़ा गया')}</em>}</span></button>
      {past&&<button type="button" className="ta-cam" aria-label={t('Add evidence','प्रमाण जोड़ें')+' · '+periodName(x.number)+' · '+classLabel(x.period)} onClick={()=>onEvidence(x.lesson.resumeToken,x.index)}><Camera size={19}/></button>}
     </li>)}</ul>
    </li>;})}</ul>}
   {days.length>5&&!all&&<button type="button" className="text-button" onClick={()=>setAll(true)}>{t('Show all','सभी देखें')} ({days.length} {t('days','दिन')})<ChevronRight size={14}/></button>}
   {summary&&<p className="ta-note">{t('Lessons from the last 60 days and the next 30 days.','पिछले 60 और अगले 30 दिनों के पाठ।')}</p>}
  </section>
 </div>;
}

export function TabBar({mode,onGo,badge,language,disabled}){
 const t=(en,hi)=>language==='hi'?hi:en;
 const tabs=[['',House,t('Home','मुख्य')],['preparation',ClipboardList,t('Plan','योजना')],['evidence',Camera,t('Evidence','प्रमाण')],['feedback',MessageSquareText,t('Feedback','प्रतिक्रिया')]];
 const active=mode==='read'?'':mode;
 return <nav className="ta-tabs" aria-label={t('Teacher menu','शिक्षक मेनू')}>{tabs.map(([k,Icon,l])=><button type="button" key={k||'home'} disabled={disabled} aria-current={active===k?'page':undefined} className={'ta-tab'+(active===k?' on':'')} onClick={()=>onGo(k)}><span className="ta-tab-icon"><Icon size={20}/></span>{l}{k==='feedback'&&badge>0&&<span className="ta-badge">{badge}</span>}</button>)}</nav>;
}

export function ProfileSheet({open,onClose,name,school,language,onLanguage,onChangePin,onLogout,onVideo}){
 const t=(en,hi)=>language==='hi'?hi:en;
 useEffect(()=>{if(!open)return;const k=e=>{if(e.key==='Escape')onClose();};addEventListener('keydown',k);return()=>removeEventListener('keydown',k);},[open]);
 if(!open)return null;
 const initials=String(name||'').split(' ').filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
 return <><div className="ta-sheet-bg" onClick={onClose}/><div className="ta-sheet" role="dialog" aria-modal="true" aria-label={t('Your profile','आपकी प्रोफ़ाइल')}>
  <div className="ta-grab"/><button type="button" className="ta-sheet-x icon" aria-label={t('Close','बंद करें')} onClick={onClose}><X size={18}/></button>
  <div className="ta-me"><span className="ta-avatar big">{initials}</span><div><b>{name}</b><small>{school} · {t('Teacher','शिक्षक')}</small></div></div>
  <div className="ta-opt"><span className="ta-opt-icon"><Languages size={18}/></span><span className="ta-opt-label">{t('Language','भाषा')}</span><span className="ta-lang" role="group">{[['en','English'],['hi','हिन्दी']].map(([v,l])=><button type="button" key={v} aria-pressed={language===v} className={language===v?'on':''} onClick={()=>onLanguage(v)}>{l}</button>)}</span></div>
  {onVideo&&<button type="button" className="ta-opt" onClick={onVideo}><span className="ta-opt-icon"><PlayCircle size={18}/></span><span className="ta-opt-label">{t('How to use (video)','कैसे इस्तेमाल करें (वीडियो)')}</span><ChevronRight size={18}/></button>}
  <button type="button" className="ta-opt" onClick={onChangePin}><span className="ta-opt-icon"><KeyRound size={18}/></span><span className="ta-opt-label">{t('Change PIN','PIN बदलें')}</span><ChevronRight size={18}/></button>
  <button type="button" className="ta-opt danger" onClick={onLogout}><span className="ta-opt-icon"><LogOut size={18}/></span><span className="ta-opt-label">{t('Log out','लॉग आउट')}</span></button>
 </div></>;
}

const sectionIcons={objective:[Target,'c1'],materials:[Package,'c1'],teacher:[Presentation,'c2'],student:[Users,'c3'],practice:[PencilLine,'c4'],review:[ListChecks,'c2'],classwork:[NotebookPen,'c4'],notes:[StickyNote,'c1']};
// The saved plan for one lesson, in large, easy-to-read sections, with "After class: add evidence".
export function PlanReader({token,periodIndex=0,match,request,language,today,onBack,onEvidence}){
 const t=(en,hi)=>language==='hi'?hi:en,o=v=>language==='hi'?(hindiOptions[v]||String(v).replace('Grade ','कक्षा ')):v;
 const [lesson,setLesson]=useState(null),[error,setError]=useState(''),[index,setIndex]=useState(periodIndex);
 const [large,setLarge]=useState(()=>{try{return localStorage.getItem('school-success:plan-large')==='1';}catch{return false;}});
 async function load(){setError('');setLesson(null);try{const d=await request({action:'resume',resume:token});setLesson(d);
  // The home list and the saved lesson can order periods differently; open the period the teacher tapped.
  const ps=d.submission.periods,hit=match?ps.findIndex(p=>p.grade===match.grade&&p.subject===match.subject&&p.topic===match.topic&&(p.section||'')===(match.section||'')):-1;
  setIndex(hit>=0?hit:Math.min(periodIndex,ps.length-1));}catch(e){setError(e.message||t('The plan could not be opened.','योजना नहीं खुल सकी।'));}}
 useEffect(()=>{void load();},[token]);
 function toggleLarge(){setLarge(v=>{try{localStorage.setItem('school-success:plan-large',v?'0':'1');}catch{}return !v;});}
 const ps=lesson?.submission?.periods||[],p=ps[index],sections=p?parsePlanText(p.reflection):[];
 const date=lesson?.submission?.date,when=date===today?t('Today','आज'):date===addDays(today,1)?t('Tomorrow','कल'):dayLabel(date,language);
 return <div className={'ta-reader'+(large?' large':'')}>
  <div className="ta-title"><button type="button" className="ta-back" aria-label={t('Back','वापस')} onClick={onBack}><ArrowLeft size={18}/></button><h2>{t('Lesson plan','पाठ योजना')}</h2><button type="button" className={'ta-chip'+(large?' on':'')} aria-pressed={large} onClick={toggleLarge}><Type size={13}/>A+</button></div>
  {error&&<div className="alert error" role="alert">{error} <button type="button" className="text-button" onClick={()=>void load()}>{t('Try again','फिर कोशिश करें')}</button></div>}
  {!lesson&&!error&&<div className="ts-skeleton" aria-busy="true"><span/><span/></div>}
  {p&&<>
   {ps.length>1&&<div className="ev-periods" role="tablist">{ps.map((q,i)=><button type="button" role="tab" aria-selected={i===index} key={q.id} className={'ev-period-chip'+(i===index?' on':'')} onClick={()=>setIndex(i)}><b>{t('Period','कालांश')} {i+1}</b><small>{classLabel(q,o)}</small></button>)}</div>}
   <div className="ta-plan-head"><span className="ta-day"><CalendarDays size={12}/>{when}{ps.length>1?' · '+t('Period','कालांश')+' '+(index+1):''}</span><h2>{p.topic||t('Lesson','पाठ')}</h2><p>{classLabel(p,o)}</p></div>
   {sections.length?sections.map(s=>{const [Icon,c]=sectionIcons[s.key]||sectionIcons.notes;return <section className="ta-sec" key={s.key}><h4><span className={'ta-sec-icon '+c}><Icon size={14}/></span>{planSectionTitles[s.key][language==='hi'?1:0]}</h4><p>{s.text}</p></section>;})
   :<div className="ta-empty"><p>{t('No plan details were written for this period.','इस कालांश के लिए योजना का विवरण नहीं लिखा गया।')}</p></div>}
   {date<=today?<div className="ev-submit-bar"><button type="button" className="button primary ev-submit" onClick={()=>onEvidence(token,index)}><Camera size={18}/>{t('After class: add evidence','कक्षा के बाद: प्रमाण जोड़ें')}</button></div>
   :<p className="ta-note center">{t('You can add evidence after you teach this lesson.','यह पाठ पढ़ाने के बाद प्रमाण जोड़ सकते हैं।')}</p>}
  </>}
 </div>;
}
