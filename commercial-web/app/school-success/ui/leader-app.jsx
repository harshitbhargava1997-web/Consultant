'use client';
// School leader dashboard (principals, coordinators, school management). Redesigned 26 November 2026 (owner
// decision) so nothing is shown twice: "This week" has three counts and one card per teacher with their subjects
// (reviewed or awaiting review) and a "No plan yet" flag; bottom tabs open the day-wise review, the weekly
// subject-wise review (with period reviews alongside) and the Feedback list (weekly and period reviews, with the
// teacher's "Noted"). Reads the same school-scoped data as before.
import {useEffect,useMemo,useState} from 'react';
import {CalendarDays,ChevronRight,CircleCheck,KeyRound,LogOut,X,MessageSquareText,ArrowLeft,RefreshCw,House,CalendarRange,CalendarCheck2} from 'lucide-react';
import {buildLessonRecords,formatDay} from '@/lib/school-success/lesson-records';
import {MAX_RANGE_DAYS,rangeFor,initials,leaderHome,feedbackItems,subjectLabel} from '@/lib/school-success/leader-home';
import {weekRange} from '@/lib/school-success/day-periods';
import ReviewScreens from './review-screens';
import TeacherPinAdmin from './teacher-pin-admin';
import {browserClient} from '@/lib/supabase';

const istToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const tone=name=>['c1','c2','c3','c4'][[...String(name)].reduce((n,c)=>n+c.charCodeAt(0),0)%4];
const plural=(n,one,many)=>n+' '+(n===1?one:many);
const TABS=[['home',House,'This week'],['day',CalendarDays,'Day'],['weekly',CalendarRange,'Weekly'],['feedback',MessageSquareText,'Feedback']];

function SubjectChip({s,showWeek,onOpen}){
 const state=s.done?(s.weekly?'✓ Weekly review done':'✓ Reviewed'):s.reviewed?s.reviewed+' of '+s.periods+' reviewed':'Awaiting review';
 return <button type="button" className={'la-sub '+(s.done?'ok':'wait')} onClick={onOpen}>
  <b>{s.done&&'✓ '}{subjectLabel({...s,grade:String(s.grade).replace(/^Grade\s+/i,'')})}</b><small>{plural(s.periods,'period','periods')} · {s.done?state.slice(2):state}{showWeek?' · w/c '+formatDay(s.week).replace(/ \d{4}$/,''):''}</small></button>;
}

export default function LeaderApp({data,refresh}){
 const today=istToday(),actor=data.actor,school=[...new Set((data.roster||[]).map(r=>r.school).concat((data.entries||[]).filter(e=>e.kind==='school').map(e=>e.school||e.name)))].filter(Boolean).sort()[0]||'';
 const [filter,setFilter]=useState('week'),[custom,setCustom]=useState({from:'',to:''});
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[sheet,setSheet]=useState(false),[view,setView]=useState(''),[tab,setTab]=useState('home');
 // Where the Day and Weekly screens open: set from a teacher or subject on "This week", or from a feedback item.
 const [focus,setFocus]=useState({teacher:'',date:'',week:'',group:'',n:0});
 const [fb,setFb]=useState({teacher:'',subject:'',type:'all',noted:'all'});
 const range=rangeFor(filter,today,custom),ready=Boolean(range.from&&range.to);
 const days=ready?Math.round((Date.parse(range.to)-Date.parse(range.from))/86400000)+1:0,tooLong=days>MAX_RANGE_DAYS;
 const loaded=data.period&&ready&&range.from>=data.period.from&&range.to<=data.period.to;
 // Load the chosen dates when they fall outside the period already loaded (at most 100 days).
 useEffect(()=>{if(!ready||tooLong||loaded)return;let live=true;setLoading(true);setError('');
  refresh({from:range.from,to:range.to}).catch(e=>{if(live)setError(e.message||'Could not load these dates.');}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};},[range.from,range.to]);
 // Every loaded lesson with its whole review history; the views below pick by planned date or review date.
 const lessons=useMemo(()=>buildLessonRecords(data.entries||[],data.period?.from||'0001-01-01',data.period?.to||'9999-12-31',{scope:'all'}),[data.entries,data.period]);
 const home=useMemo(()=>leaderHome(lessons,data.roster||[],range),[lessons,data.roster,range.from,range.to]);
 const items=useMemo(()=>ready?feedbackItems(lessons,range,fb):[],[lessons,range.from,range.to,fb]);
 const teachers=[...new Set((data.roster||[]).map(r=>r.name).concat(lessons.map(l=>l.teacher)))].filter(Boolean).sort((a,b)=>a.localeCompare(b));
 const subjects=[...new Set(lessons.map(l=>l.subject).filter(Boolean))].sort();
 const label={week:'This week',last:'Last week',month:'This month',range:'Selected dates'}[filter];
 const span=ready?(formatDay(range.from)+(range.from===range.to?'':' – '+formatDay(filter==='week'?addDays(weekRange(today).from,6):range.to))):'Choose dates';
 const role=actor.title||'School leader';
 const go=(next,change={})=>{setFocus(f=>({...f,...change,n:f.n+1}));setTab(next);setView('');window.scrollTo?.(0,0);};
 const openWeek=(teacher,group,week)=>go('weekly',{teacher,group,week});
 const openDay=(teacher,date)=>go('day',{teacher,date:date||today});
 const reload=()=>{void refresh({from:data.period.from,to:data.period.to}).catch(()=>{});};
 async function signOut(){try{await browserClient()?.auth.signOut();}catch{}location.href='/school-success';}

 const top=<div className="ta-top"><div className="ta-brand"><i>S</i>School Success</div><button type="button" className="ta-avatar la-avatar" aria-label="Your profile" onClick={()=>setSheet(true)}>{initials(actor.name)}</button></div>;
 const sheetEl=sheet&&<><div className="ta-sheet-bg" onClick={()=>setSheet(false)}/><div className="ta-sheet" role="dialog" aria-modal="true" aria-label="Your profile"><div className="ta-grab"/><button type="button" className="ta-sheet-x icon" aria-label="Close" onClick={()=>setSheet(false)}><X size={18}/></button>
  <div className="ta-me"><span className="ta-avatar big la-avatar">{initials(actor.name)}</span><div><b>{actor.name}</b><small>{role} · {school}</small></div></div>
  <button type="button" className="ta-opt" onClick={()=>{setSheet(false);setView('pins');}}><span className="ta-opt-icon"><KeyRound size={18}/></span><span className="ta-opt-label">Teacher PINs</span><ChevronRight size={18}/></button>
  <button type="button" className="ta-opt danger" onClick={()=>void signOut()}><span className="ta-opt-icon"><LogOut size={18}/></span><span className="ta-opt-label">Sign out</span></button></div></>;
 const tabBar=<nav className="ta-tabs" aria-label="Principal menu">{TABS.map(([k,Icon,l])=><button type="button" key={k} aria-current={tab===k&&!view?'page':undefined} className={'ta-tab'+(tab===k&&!view?' on':'')} onClick={()=>{setTab(k);setView('');}}><span className="ta-tab-icon"><Icon size={20}/></span>{l}{k==='home'&&home.awaiting>0&&<span className="ta-badge">{home.awaiting}</span>}</button>)}</nav>;
 const shell=body=><div className="teacher-workspace tp ta-app leader-app">{top}{body}{tabBar}{sheetEl}</div>;
 const title=(text,sub)=><div className="ta-hello"><small>{sub}</small><h1>{text}</h1></div>;

 if(view==='pins')return shell(<><div className="ta-title"><button type="button" className="ta-back" aria-label="Back" onClick={()=>setView('')}><ArrowLeft size={18}/></button><h2>Teacher PINs</h2></div><TeacherPinAdmin schools={school?[school]:[]} initialSchool={school} open/></>);
 if(tab==='day'||tab==='weekly')return shell(<>
  {title(tab==='day'?'Day-wise review':'Weekly review',tab==='day'?'Every period of one teacher’s day':'One subject’s week · period reviews alongside')}
  <ReviewScreens key={tab+focus.n} compact tab={tab} data={data} school={school} initial={focus} onSelect={s=>setFocus(f=>f.teacher===s.teacher&&f.date===s.date&&f.week===s.week&&f.group===s.group?f:{...f,teacher:s.teacher,date:s.date,week:s.week,group:s.group})} onSaved={reload}/>
 </>);

 const chips=<>
  <div className="ta-filters" role="group" aria-label="Dates">{[['last','Last week'],['week','This week'],['month','This month'],['range','Dates']].map(([k,l])=><button type="button" key={k} aria-pressed={filter===k} className={'ta-chip'+(filter===k?' on':'')} onClick={()=>setFilter(k)}>{k==='range'&&<CalendarDays size={13}/>}{l}</button>)}</div>
  {filter==='range'&&<div className="ta-range"><label><span>From</span><input type="date" max={today} value={custom.from} onChange={e=>setCustom(c=>({...c,from:e.target.value}))}/></label><label><span>To</span><input type="date" max={today} value={custom.to} onChange={e=>setCustom(c=>({...c,to:e.target.value}))}/></label></div>}
  {error&&<div className="alert error" role="alert">{error} <button type="button" className="text-button" onClick={()=>{setError('');setLoading(true);refresh({from:range.from,to:range.to}).catch(e=>setError(e.message)).finally(()=>setLoading(false));}}><RefreshCw size={14}/>Try again</button></div>}
 </>;
 const waiting=tooLong?<div className="ta-card ta-empty"><p>Choose at most {MAX_RANGE_DAYS} days.</p></div>
  :!ready?<div className="ta-card ta-empty"><p>Choose a start and end date.</p></div>
  :loading||!loaded?<div className="ts-skeleton" aria-busy="true"><span/><span/></div>:null;

 if(tab==='feedback')return shell(<>
  <div className="ta-hello"><small>Weekly and period reviews you and your team gave</small><h1>Feedback</h1><p>{label} · {span}</p></div>
  {chips}
  <div className="la-selects la-fb-filters">
   <label className="field"><span>Teacher</span><select value={fb.teacher} onChange={e=>setFb(f=>({...f,teacher:e.target.value}))}><option value="">All teachers</option>{teachers.map(n=><option key={n}>{n}</option>)}</select></label>
   <label className="field"><span>Subject</span><select value={fb.subject} onChange={e=>setFb(f=>({...f,subject:e.target.value}))}><option value="">All subjects</option>{subjects.map(s=><option key={s}>{s}</option>)}</select></label>
   <label className="field"><span>Review</span><select value={fb.type} onChange={e=>setFb(f=>({...f,type:e.target.value}))}><option value="all">Weekly and period</option><option value="weekly">Weekly reviews</option><option value="period">Period reviews</option></select></label>
   <label className="field"><span>Teacher noted</span><select value={fb.noted} onChange={e=>setFb(f=>({...f,noted:e.target.value}))}><option value="all">All</option><option value="noted">Noted</option><option value="waiting">Not noted yet</option></select></label>
  </div>
  {waiting||(!items.length?<div className="ta-card ta-empty"><p>No feedback in these dates{fb.teacher||fb.subject||fb.type!=='all'||fb.noted!=='all'?' for these filters':''}.</p></div>
  :<ul className="la-feed">{items.map(i=><li key={i.id} className={i.type}>
   <div className="la-feed-head"><b>{i.teacher} · {i.title}</b><span className={'la-kind '+i.type}>{i.type==='weekly'?'Weekly':'Period'}</span></div>
   <small className="la-feed-class">{i.detail}</small><p>{i.text}</p>
   <div className="la-feed-foot"><small className="la-feed-by">{formatDay(String(i.date).slice(0,10))}{i.by?' · '+i.by:''}</small>
    {i.notedAt?<span className="la-noted"><CircleCheck size={13}/>Noted {formatDay(String(i.notedAt).slice(0,10))}</span>:<span className="la-noted wait">Not noted yet</span>}
    <button type="button" className="text-button" onClick={()=>i.type==='weekly'?openWeek(i.teacher,i.group,i.week):openDay(i.teacher,i.day)}>{i.type==='weekly'?'Open week':'Open day'}<ChevronRight size={14}/></button></div>
  </li>)}</ul>)}
 </>);

 return shell(<>
  <div className="ta-hello"><small>{role} · {school}</small><h1>{label}</h1><p>{span}</p></div>
  {chips}
  {waiting||<>
   <div className="la-stats">
    <div className="ta-stat"><b>{home.planned}<small> / {home.staff}</small></b><span>Teachers planned</span></div>
    <div className="ta-stat"><b>{home.files}</b><span>Evidence files shared</span></div>
    {home.next?<button type="button" className="ta-stat la-act" onClick={()=>openWeek(home.next.teacher,home.next.group,home.next.week)}><b>{home.awaiting}</b><span>{home.awaiting===1?'Subject':'Subjects'} awaiting your review</span><em>Review now<ChevronRight size={13}/></em></button>
    :<div className="ta-stat la-done"><b><CalendarCheck2 size={20}/></b><span>{home.subjects?'Every subject reviewed':'Nothing to review yet'}</span></div>}
   </div>
   <section className="ta-card la-teachers"><div className="ta-card-head"><h3>Your teachers</h3><small className="la-hint">Tap a subject to review its week</small></div>
    {!home.teachers.length?<p className="ta-empty">No teachers yet.</p>:home.teachers.map(t=><div className="la-teacher" key={t.name}>
     <div className="la-trow"><span className={'la-face '+tone(t.name)}>{initials(t.name)}</span>
      {t.periods?<span className="la-text"><b>{t.name}</b><small>{plural(t.periods,'period','periods')} · {t.reviewed} reviewed</small></span>
      :<span className="la-text"><b>{t.name} <em className="la-flag">No plan yet</em></b><small>{t.lastPlan?'Last plan: '+formatDay(t.lastPlan):'No plan in the loaded dates'}</small></span>}
      {t.periods>0&&<button type="button" className="text-button la-open" onClick={()=>openDay(t.name,t.lastDate)}>Open day<ChevronRight size={14}/></button>}</div>
     {t.subjects.length>0&&<div className="la-subs">{t.subjects.map(s=><SubjectChip key={s.id} s={s} showWeek={home.multiWeek} onOpen={()=>openWeek(t.name,s.group,s.week)}/>)}</div>}
    </div>)}
   </section>
  </>}
 </>);
}
